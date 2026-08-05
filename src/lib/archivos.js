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
