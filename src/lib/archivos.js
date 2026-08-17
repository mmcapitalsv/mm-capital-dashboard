/**
 * Qué CLASE de archivo es cada registro de la bóveda.
 *
 * La tabla `archivos` guarda en `tipo` la CATEGORÍA documental que eligió el
 * administrador ("Legal Corporativo", "Fiscal y Tributario"...), no el formato
 * del archivo. Sin esto, una fotografía subida a la bóveda se pintaba con el
 * mismo icono azul de documento que una escritura en PDF y no había forma de
 * saber, desde la lista, que era una imagen.
 *
 * El formato se deduce de la extensión del nombre (o de la URL pública si el
 * nombre no la trae), así que funciona también con todo lo que ya estaba
 * subido: no hace falta migración ni columna nueva.
 */

const EXT_IMAGEN = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp', 'heic', 'heif', 'svg'];
const EXT_PDF = ['pdf'];

/** Extensión en minúsculas y sin punto: "Escritura.PDF" -> "pdf". */
export function extensionArchivo(nombre) {
  const limpio = String(nombre || '').split(/[?#]/)[0].trim();
  const punto = limpio.lastIndexOf('.');
  if (punto === -1 || punto === limpio.length - 1) return '';
  return limpio.slice(punto + 1).toLowerCase();
}

/**
 * Formato del archivo: 'imagen' | 'pdf' | 'documento'.
 * Se mira primero el nombre guardado y, si no tiene extensión, la URL.
 */
export function formatoArchivo(nombre, url = '') {
  const ext = extensionArchivo(nombre) || extensionArchivo(url);
  if (EXT_IMAGEN.includes(ext)) return 'imagen';
  if (EXT_PDF.includes(ext)) return 'pdf';
  return 'documento';
}

/** true si el archivo se puede mostrar en un `<img>`. */
export function esImagen(nombre, url = '') {
  return formatoArchivo(nombre, url) === 'imagen';
}

/**
 * ¿Este adjunto de chat se puede pintar dentro de un `<img>`?
 *
 * Se mira PRIMERO el tipo MIME que guardó la subida (`image/jpeg`...) y solo
 * después la extensión: un archivo llegado desde la cámara del móvil puede
 * traer un nombre sin extensión, y con él la extensión sola daba 'documento' y
 * la miniatura no se llegaba a renderizar nunca.
 *
 * Vive aquí, y no en una vista, porque la usan los DOS sitios que pintan el
 * canal: el recuadro del Sidebar y la pestaña de Chat.
 */
export function esImagenAdjunta(adjunto) {
  if (!adjunto?.url) return false;
  if (/^image\//i.test(String(adjunto.tipo || ''))) return true;
  return esImagen(adjunto.nombre, adjunto.url);
}

/**
 * Miniatura cuadrada de una imagen local, como data URL lista para un `<img>`.
 *
 * Se reescala en un canvas antes de guardarla: el chat de la IA persiste su
 * historial en `localStorage` (5 MB), así que meter ahí la foto original de un
 * teléfono (varios MB en Base64) reventaría la cuota y dejaría el chat sin
 * historial. 320 px y JPEG 0.7 pesan unas decenas de KB.
 *
 * Devuelve `null` si el archivo no es una imagen o si el navegador no puede
 * decodificarla: quien llame debe seguir mostrando el nombre como respaldo.
 */
export function miniaturaDeImagen(file, lado = 320) {
  return new Promise((resolve) => {
    if (!file || !/^image\//i.test(file.type || '')) { resolve(null); return; }

    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      try {
        const escala = Math.min(1, lado / Math.max(img.width, img.height));
        const lienzo = document.createElement('canvas');
        lienzo.width = Math.max(1, Math.round(img.width * escala));
        lienzo.height = Math.max(1, Math.round(img.height * escala));
        lienzo.getContext('2d').drawImage(img, 0, 0, lienzo.width, lienzo.height);
        resolve(lienzo.toDataURL('image/jpeg', 0.7));
      } catch {
        resolve(null);
      } finally {
        URL.revokeObjectURL(url);
      }
    };

    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

/** Clave de traducción de la etiqueta del formato. */
export function claveFormato(formato) {
  if (formato === 'imagen') return 'vault.formatoImagen';
  if (formato === 'pdf') return 'vault.formatoPdf';
  return 'vault.formatoDocumento';
}

/** Extensiones que acepta la bóveda, para el atributo `accept` del input. */
export const ACEPTA_BOVEDA =
  '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,' +
  '.png,.jpg,.jpeg,.webp,.gif,.avif,.heic';
