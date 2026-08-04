import { GoogleGenerativeAI } from '@google/generative-ai';

/**
 * Integración con Gemini (cascada de modelos: ver `MODELOS`).
 *
 * Dos usos en la app:
 *   1. Facturas — se envía la imagen o el PDF del comprobante en Base64 y el
 *      modelo devuelve un JSON estricto {proveedor, concepto, monto} con el
 *      que se rellenan los inputs del formulario.
 *   2. Chat IA del Administrador — texto + adjuntos (imágenes o documentos)
 *      en Base64 inline, y se pinta la respuesta real del modelo.
 *
 * La clave vive en `VITE_GEMINI_API_KEY` (archivo .env).
 */

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

/**
 * Cascada de modelos: se prueban en orden hasta que uno responda. Los alias
 * `-latest` los resuelve el propio servidor, así que la app no se rompe cuando
 * Google retira una versión concreta (causa habitual del 404 "model not found").
 */
export const MODELOS = [
  'gemini-flash-latest',
  'gemini-2.0-flash',
  'gemini-pro-latest'
];

export const MODELO_PRIMARIO = MODELOS[0];
export const MODELO_RESPALDO = MODELOS[1];

export const AVISO_SIN_CLAVE =
  'Falta VITE_GEMINI_API_KEY en el archivo .env. Añádela y reinicia el servidor de desarrollo.';

/** Tamaño máximo por adjunto: por encima, la petición inline no es viable. */
export const ADJUNTO_MAX_MB = 15;

/** ¿Está configurada la clave? La interfaz lo usa para avisar en vez de fallar. */
export function hayClaveGemini() {
  return typeof API_KEY === 'string' && API_KEY.trim().length > 0;
}

let clienteCache = null;
const modelosCache = new Map();

function modelo(nombre = MODELO_PRIMARIO) {
  if (!clienteCache) clienteCache = new GoogleGenerativeAI(API_KEY);
  if (!modelosCache.has(nombre)) {
    modelosCache.set(nombre, clienteCache.getGenerativeModel({ model: nombre }));
  }
  return modelosCache.get(nombre);
}

/**
 * Recorre `MODELOS` y devuelve la respuesta del primero que funcione. Si uno
 * falla (404 del modelo, cuota agotada, 429, 503…) se pasa al siguiente sin
 * romper la interfaz; solo si fallan todos se lanza un error legible.
 *
 * @param {object} peticion cuerpo idéntico al de `generateContent`
 * @returns {Promise<{respuesta: object, modeloUsado: string}>}
 */
async function generarConFallback(peticion) {
  let ultimoError = null;

  for (const nombre of MODELOS) {
    try {
      const respuesta = await modelo(nombre).generateContent(peticion);
      return { respuesta, modeloUsado: nombre };
    } catch (err) {
      ultimoError = err;
      // El modelo puede haber quedado cacheado con un nombre que ya no existe
      modelosCache.delete(nombre);
      console.warn(`[gemini] ${nombre} falló (${err?.message || err}); probando el siguiente modelo.`);
    }
  }

  const detalle = ultimoError?.message || 'Error desconocido';
  throw new Error(`La IA no respondió con ninguno de los modelos disponibles: ${detalle}`);
}

/**
 * Convierte un File del navegador en la parte `inlineData` que espera Gemini.
 * `FileReader` entrega un data URL: se recorta la cabecera y queda el Base64.
 */
export function archivoAParteInline(file) {
  return new Promise((resolve, reject) => {
    if (!file) { reject(new Error('No se seleccionó ningún archivo.')); return; }
    if (file.size > ADJUNTO_MAX_MB * 1024 * 1024) {
      reject(new Error(`El archivo supera ${ADJUNTO_MAX_MB} MB.`));
      return;
    }

    const lector = new FileReader();
    lector.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    lector.onload = () => {
      const base64 = String(lector.result || '').split(',')[1] || '';
      resolve({
        inlineData: {
          data: base64,
          mimeType: file.type || 'application/octet-stream'
        }
      });
    };
    lector.readAsDataURL(file);
  });
}

/** Extrae el primer objeto JSON de una respuesta, venga o no con ```json. */
function parsearJSON(texto) {
  const limpio = String(texto || '')
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();

  try {
    return JSON.parse(limpio);
  } catch {
    const inicio = limpio.indexOf('{');
    const fin = limpio.lastIndexOf('}');
    if (inicio === -1 || fin <= inicio) return null;
    try {
      return JSON.parse(limpio.slice(inicio, fin + 1));
    } catch {
      return null;
    }
  }
}

const PROMPT_FACTURA = `Eres un analista contable de una constructora en El Salvador.
Lee el comprobante adjunto (factura, recibo o crédito fiscal) y devuelve ÚNICAMENTE
un objeto JSON válido, sin texto adicional ni bloques de código, con esta forma exacta:
{"proveedor": "", "concepto": "", "monto": ""}

Reglas:
- "proveedor": nombre completo del emisor tal como aparece en el documento.
- "concepto": resumen breve (máximo 90 caracteres) de los bienes o servicios facturados.
- "monto": TOTAL a pagar como número decimal en texto plano, sin símbolo de moneda,
  sin separadores de miles y con punto decimal (ejemplo: "1284.50").
- Si un dato no aparece en el documento, deja su valor como cadena vacía.`;

/**
 * Lee un comprobante con Gemini y devuelve los campos del formulario.
 * @param {File} file imagen o PDF de la factura
 * @returns {Promise<{datos: {proveedor: string, concepto: string, monto: string}|null, error: string|null}>}
 */
export async function analizarComprobante(file) {
  if (!hayClaveGemini()) return { datos: null, error: AVISO_SIN_CLAVE };
  if (!file) return { datos: null, error: 'Adjunta primero la imagen o el PDF del comprobante.' };

  try {
    const parte = await archivoAParteInline(file);
    const { respuesta, modeloUsado } = await generarConFallback({
      contents: [{ role: 'user', parts: [{ text: PROMPT_FACTURA }, parte] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0 }
    });

    const crudo = respuesta?.response?.text?.() || '';
    const json = parsearJSON(crudo);
    if (!json) return { datos: null, error: 'La IA no devolvió un JSON legible. Intenta de nuevo.' };

    // El monto viaja como texto: se limpia todo lo que no sea número o punto
    const monto = String(json.monto ?? '').replace(/[^0-9.]/g, '');

    return {
      datos: {
        proveedor: String(json.proveedor ?? '').trim(),
        concepto: String(json.concepto ?? '').trim(),
        monto
      },
      modeloUsado,
      error: null
    };
  } catch (err) {
    return { datos: null, error: err?.message || 'No se pudo analizar el comprobante.' };
  }
}

const SISTEMA_CHAT = `Eres el Asistente Ejecutivo de IA de MM Capital, una desarrolladora
inmobiliaria y constructora salvadoreña. Respondes al Administrador en el mismo idioma en
que te escriben, de forma directa, profesional y breve. Cuando te adjunten imágenes o
documentos, analízalos y responde sobre su contenido real. No inventes cifras: si un dato
no está en la conversación ni en los adjuntos, dilo con claridad.`;

/**
 * Conversación multimodal con el modelo.
 * @param {{texto: string, archivos?: File[], historial?: Array<{sender: string, text: string}>}} params
 * @returns {Promise<{texto: string|null, error: string|null}>}
 */
export async function conversarConIA({ texto, archivos = [], historial = [] }) {
  if (!hayClaveGemini()) return { texto: null, error: AVISO_SIN_CLAVE };

  const mensaje = String(texto || '').trim();
  if (!mensaje && archivos.length === 0) return { texto: null, error: null };

  try {
    const adjuntos = await Promise.all(archivos.map(archivoAParteInline));

    // Historial previo como turnos reales: el modelo mantiene el contexto
    const contents = historial
      .filter(m => m?.text)
      .slice(-10)
      .map(m => ({
        role: m.sender === 'user' ? 'user' : 'model',
        parts: [{ text: String(m.text) }]
      }));

    contents.push({
      role: 'user',
      parts: [{ text: mensaje || 'Analiza los archivos adjuntos.' }, ...adjuntos]
    });

    const { respuesta, modeloUsado } = await generarConFallback({
      contents,
      systemInstruction: { role: 'system', parts: [{ text: SISTEMA_CHAT }] }
    });

    const salida = respuesta?.response?.text?.() || '';
    if (!salida.trim()) return { texto: null, error: 'La IA no devolvió respuesta.' };
    return { texto: salida.trim(), modeloUsado, error: null };
  } catch (err) {
    return { texto: null, error: err?.message || 'No se pudo contactar con la IA.' };
  }
}
