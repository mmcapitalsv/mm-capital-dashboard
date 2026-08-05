/**
 * Formateo de texto para pantalla.
 *
 * La base de datos guarda los valores como los escribió quien los cargó
 * ("GIOVANNI MORALES", "en_progreso"). Aquí se convierten a una tipografía
 * uniforme antes de pintarlos, sin tocar el dato original.
 */

/** Partículas que van en minúscula salvo al inicio del nombre. */
const PARTICULAS = new Set([
  'de', 'del', 'la', 'las', 'los', 'y', 'e', 'da', 'das', 'do', 'dos',
  'van', 'von', 'di', 'du', 'el', 'al', 'a'
]);

/** Se dejan en mayúscula sostenida (números romanos y siglas de uso común). */
const SIGLAS = new Set(['ii', 'iii', 'iv', 'v', 'vi', 'jr', 'sr.', 'mba', 'msc', 'phd', 'sa', 'sv']);

/** Capitaliza un fragmento simple: "MORALES" -> "Morales". */
function capitalizar(fragmento) {
  if (!fragmento) return fragmento;
  return fragmento.charAt(0).toUpperCase() + fragmento.slice(1).toLowerCase();
}

/**
 * Capitaliza una palabra respetando guiones y apóstrofos:
 * "JOSÉ-MARÍA" -> "José-María", "D'ANGELO" -> "D'Angelo".
 */
function capitalizarPalabra(palabra, esPrimera) {
  const limpia = palabra.toLowerCase();
  const sinPunto = limpia.replace(/[.,]/g, '');

  // Números romanos y siglas: "iii" -> "III"
  if (SIGLAS.has(sinPunto)) return limpia.toUpperCase();

  // Partículas en minúscula, menos si abren el nombre ("De la Rosa" vs "Ana de la Rosa")
  if (!esPrimera && PARTICULAS.has(sinPunto)) return limpia;

  return limpia
    .split('-').map(t => t.split("'").map(capitalizar).join("'")).join('-');
}

/**
 * Título tipográfico para nombres propios.
 * "ING. GIOVANNI MORALES" -> "Ing. Giovanni Morales"
 * "juan melendez de la cruz" -> "Juan Melendez de la Cruz"
 */
export function tituloCase(texto) {
  const bruto = String(texto ?? '').replace(/\s+/g, ' ').trim();
  if (!bruto) return '';
  return bruto
    .split(' ')
    .map((palabra, i) => capitalizarPalabra(palabra, i === 0))
    .join(' ');
}

/**
 * Da formato de dólar a lo que se está ESCRIBIENDO en una casilla de dinero:
 * coma para los miles y punto para los centavos.
 *
 *   "5000"      -> "5,000"
 *   "5000.5"    -> "5,000.5"      (se respeta el decimal a medio teclear)
 *   "1234567.8" -> "1,234,567.8"
 *
 * Se conserva el punto final mientras se escribe ("5000." sigue siendo "5,000.")
 * para que no sea imposible teclear los centavos, y se limitan a dos dígitos.
 * El texto resultante lo entienden `aNumero`, `aAjuste` y `aMonto`, que quitan
 * las comas antes de guardar: a la base de datos siempre viaja un número.
 */
export function formatearMontoEntrada(entrada) {
  if (entrada === null || entrada === undefined || entrada === '') return '';

  const bruto = String(entrada);
  const negativo = bruto.trim().startsWith('-');
  const limpio = bruto.replace(/[^\d.]/g, '');
  if (!limpio) return negativo ? '-' : '';

  const tieneDecimal = limpio.includes('.');
  const [primero, ...resto] = limpio.split('.');
  const decimales = resto.join('').slice(0, 2);

  // Sin ceros a la izquierda ("007" -> "7"), pero "0.5" conserva su cero
  const entero = (primero.replace(/^0+(?=\d)/, '') || '0');
  const conComas = entero.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  return `${negativo ? '-' : ''}${conComas}${tieneDecimal ? `.${decimales}` : ''}`;
}

/**
 * Estado legible: quita guiones bajos y deja solo la primera letra en mayúscula.
 * "en_progreso" -> "En progreso" · "FASE-INICIAL" -> "Fase inicial"
 */
export function formatearEstado(estado) {
  const bruto = String(estado ?? '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!bruto) return '';
  const minuscula = bruto.toLowerCase();
  return minuscula.charAt(0).toUpperCase() + minuscula.slice(1);
}
