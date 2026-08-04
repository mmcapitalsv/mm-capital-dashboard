/**
 * Compresión de imágenes en el navegador (canvas nativo, sin dependencias).
 *
 * Se ejecuta ANTES de subir a Supabase Storage: una foto de móvil de 8–12 MB
 * viaja como un JPEG de ~150 KB, así la subida no muere por tiempo de espera
 * ni choca con el límite de tamaño del bucket, y a la vista se ve igual (se
 * mantiene la relación de aspecto y se redimensiona con suavizado alto).
 */

/** Lado máximo por defecto: de sobra para un avatar o una portada. */
const LADO_MAX = 1280;
const CALIDAD_INICIAL = 0.9;
const CALIDAD_MINIMA = 0.5;
const PESO_OBJETIVO_KB = 400;

/** Formatos que no conviene tocar: perderían la animación o la transparencia. */
const SIN_COMPRIMIR = ['image/gif', 'image/svg+xml'];

/** Carga un File/Blob como HTMLImageElement, liberando la URL temporal. */
function cargarImagen(archivo) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(archivo);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo leer la imagen.'));
    };
    img.src = url;
  });
}

/** Promesa sobre canvas.toBlob (que solo trabaja con callback). */
function aBlob(canvas, tipo, calidad) {
  return new Promise((resolve) => canvas.toBlob(resolve, tipo, calidad));
}

/**
 * Devuelve una versión comprimida de la imagen. Si algo falla (navegador sin
 * canvas, formato raro, imagen corrupta) devuelve el archivo original: la
 * compresión es una mejora, nunca un motivo para no poder subir la foto.
 *
 * @param {File|Blob} archivo
 * @param {{ladoMax?: number, calidad?: number, pesoObjetivoKB?: number, nombre?: string}} opciones
 * @returns {Promise<File|Blob>}
 */
export async function comprimirImagen(archivo, opciones = {}) {
  const {
    ladoMax = LADO_MAX,
    calidad = CALIDAD_INICIAL,
    pesoObjetivoKB = PESO_OBJETIVO_KB,
    nombre
  } = opciones;

  if (!archivo || SIN_COMPRIMIR.includes(archivo.type)) return archivo;
  if (typeof document === 'undefined') return archivo;

  try {
    const img = await cargarImagen(archivo);

    // Solo se reduce; nunca se amplía una foto pequeña (se vería pixelada).
    const escala = Math.min(1, ladoMax / Math.max(img.width, img.height));
    const ancho = Math.max(1, Math.round(img.width * escala));
    const alto = Math.max(1, Math.round(img.height * escala));

    // Ya es pequeña y ligera: no hay nada que ganar recodificándola.
    if (escala === 1 && archivo.size <= pesoObjetivoKB * 1024) return archivo;

    const canvas = document.createElement('canvas');
    canvas.width = ancho;
    canvas.height = alto;

    const ctx = canvas.getContext('2d');
    if (!ctx) return archivo;

    // Los JPEG no tienen canal alfa: fondo blanco para que un PNG transparente
    // no termine con bordes negros.
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, ancho, alto);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, ancho, alto);

    // Baja la calidad de medio punto en medio punto hasta alcanzar el peso
    // objetivo. Se corta en CALIDAD_MINIMA para no destrozar la imagen.
    let q = calidad;
    let blob = await aBlob(canvas, 'image/jpeg', q);
    while (blob && blob.size > pesoObjetivoKB * 1024 && q > CALIDAD_MINIMA) {
      q = Math.max(CALIDAD_MINIMA, q - 0.1);
      blob = await aBlob(canvas, 'image/jpeg', q);
    }

    if (!blob) return archivo;
    // Si el original ya pesaba menos (imágenes muy optimizadas), se respeta.
    if (blob.size >= archivo.size && escala === 1) return archivo;

    const nombreFinal = (nombre || archivo.name || 'imagen.jpg').replace(/\.[^.]+$/, '') + '.jpg';
    return new File([blob], nombreFinal, { type: 'image/jpeg', lastModified: Date.now() });
  } catch {
    return archivo;
  }
}

/** Tamaño legible para los mensajes de la interfaz ("1.4 MB"). */
export function pesoLegible(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}
