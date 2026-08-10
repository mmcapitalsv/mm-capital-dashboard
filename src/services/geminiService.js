import { supabase } from '../supabaseClient';

/**
 * Integración con Gemini a través de la Edge Function `chat-gemini`.
 *
 * La clave de Google NO está en el navegador: vive en los secretos de Supabase
 * (`GEMINI_API_KEY`) y solo la usa la función, que además exige un JWT válido.
 * Aquí solo se arma el cuerpo de la petición y se lee la respuesta.
 *
 * Dos usos en la app:
 *   1. Facturas — se envía la imagen o el PDF del comprobante en Base64 y el
 *      modelo devuelve un JSON estricto {proveedor, concepto, monto} con el
 *      que se rellenan los inputs del formulario.
 *   2. Chat IA del Administrador — texto + adjuntos (imágenes o documentos)
 *      en Base64 inline, y se pinta la respuesta real del modelo.
 */

const FUNCION = 'chat-gemini';

/**
 * Cascada de modelos: la función los prueba en orden hasta que uno responda.
 * Los alias `-latest` los resuelve el propio servidor de Google, así que la app
 * no se rompe cuando retiran una versión concreta (404 "model not found").
 */
export const MODELOS = [
  'gemini-flash-latest',
  'gemini-2.0-flash',
  'gemini-pro-latest'
];

export const MODELO_PRIMARIO = MODELOS[0];
export const MODELO_RESPALDO = MODELOS[1];

export const AVISO_SIN_CLAVE =
  'La IA no está disponible: falta configurar la función chat-gemini en Supabase.';

/** Tamaño máximo por adjunto: por encima, la petición inline no es viable. */
export const ADJUNTO_MAX_MB = 15;

/**
 * ¿Está la IA disponible? Ya no depende de ninguna clave en el cliente, solo de
 * que exista el cliente de Supabase; el error real (si lo hay) llega del server.
 */
export function hayClaveGemini() {
  return Boolean(supabase);
}

/**
 * Llama a la Edge Function. Devuelve el texto plano de la respuesta del modelo.
 *
 * @param {object} peticion { contents, systemInstruction?, generationConfig? }
 * @returns {Promise<{texto: string, modeloUsado: string}>}
 */
async function generarConFallback(peticion) {
  const { data, error } = await supabase.functions.invoke(FUNCION, {
    body: { ...peticion, modelos: MODELOS }
  });

  if (error) {
    // El cuerpo de error de la función trae el detalle legible
    let detalle = error.message || 'Error desconocido';
    try {
      const cuerpo = await error.context?.json?.();
      if (cuerpo?.error) detalle = cuerpo.error;
    } catch {
      // Sin cuerpo JSON: se queda el mensaje genérico
    }
    throw new Error(detalle);
  }

  if (data?.error) throw new Error(data.error);
  if (!data?.texto) throw new Error('La IA no devolvió respuesta.');

  return { texto: data.texto, modeloUsado: data.modeloUsado };
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
  if (!file) return { datos: null, error: 'Adjunta primero la imagen o el PDF del comprobante.' };

  try {
    const parte = await archivoAParteInline(file);
    const { texto, modeloUsado } = await generarConFallback({
      contents: [{ role: 'user', parts: [{ text: PROMPT_FACTURA }, parte] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0 }
    });

    const json = parsearJSON(texto);
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

    const { texto: salida, modeloUsado } = await generarConFallback({
      contents,
      systemInstruction: { role: 'system', parts: [{ text: SISTEMA_CHAT }] }
    });

    return { texto: salida.trim(), modeloUsado, error: null };
  } catch (err) {
    return { texto: null, error: err?.message || 'No se pudo contactar con la IA.' };
  }
}
