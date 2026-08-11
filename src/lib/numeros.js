/**
 * Aritmética de dinero y porcentajes de la aplicación, en UN SOLO sitio.
 *
 * Antes cada vista repetía su propia versión de `reduce((s, x) => s + Number(x))`
 * y su propia división `parte / total`, y no todas se comportaban igual: una
 * redondeaba a centavos, otra no; una dividía entre `total || 1` —que convierte
 * un presupuesto de 0 en 1 y produce cifras absurdas como "500000%"—, otra
 * devolvía `NaN`. Aquí hay una sola respuesta para cada operación.
 */

/**
 * Número finito o `porDefecto`. NO usa `||`: un 0 legítimo (cero dólares
 * gastados) es un dato, no un hueco, y debe sobrevivir intacto.
 */
export function aNumeroSeguro(valor, porDefecto = 0) {
  if (valor === null || valor === undefined || valor === '') return porDefecto;
  const n = typeof valor === 'number' ? valor : Number(String(valor).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : porDefecto;
}

/**
 * Error de una entrada contable que NO se puede interpretar como dinero.
 * Se distingue por clase para que la capa de servicios lo convierta en un
 * mensaje para el usuario y no en un fallo genérico.
 */
export class MontoInvalidoError extends Error {
  constructor(mensaje, { campo, valor } = {}) {
    super(mensaje);
    this.name = 'MontoInvalidoError';
    this.campo = campo;
    this.valorRecibido = valor;
  }
}

/**
 * Parseo ESTRICTO de una cifra contable (P2-18).
 *
 * `aNumeroSeguro` está pensado para pintar: ante basura devuelve 0 y la vista
 * sigue funcionando. Eso es exactamente lo que NO debe pasar al ESCRIBIR en la
 * contabilidad: una factura de "12.OO" (con letras O) o "1.2.3" se guardaba
 * como $0.00 y el descuadre aparecía semanas después, sin rastro de la causa.
 * Aquí un formato corrupto lanza `MontoInvalidoError` y el guardado se aborta.
 *
 * Acepta lo que el usuario realmente teclea: separadores de millar, símbolo de
 * moneda, espacios y hasta dos decimales. Rechaza todo lo demás.
 *
 * @param {*} valor
 * @param {{campo?: string, permitirNegativo?: boolean, permitirVacio?: boolean}} [opciones]
 * @returns {number} importe redondeado a centavos
 * @throws {MontoInvalidoError}
 */
export function parsearMontoEstricto(valor, opciones = {}) {
  const { campo = 'El monto', permitirNegativo = false, permitirVacio = false } = opciones;
  const fallar = (motivo) => {
    throw new MontoInvalidoError(`${campo}: ${motivo}`, { campo, valor });
  };

  if (valor === null || valor === undefined || (typeof valor === 'string' && valor.trim() === '')) {
    if (permitirVacio) return 0;
    fallar('está vacío. Escribe una cifra.');
  }

  if (typeof valor === 'number') {
    if (!Number.isFinite(valor)) fallar('no es un número válido.');
    if (!permitirNegativo && valor < 0) fallar('no puede ser negativo.');
    return redondearDinero(valor);
  }

  if (typeof valor !== 'string') fallar('no es una cifra.');

  const bruto = valor.trim();
  // Se tolera lo cosmético: "$", espacios (incluido el fino de los miles) y
  // el separador de millar. Nada más — ni letras, ni dos puntos decimales.
  const limpio = bruto.replace(/[$\s  ]/g, '').replace(/,/g, '');

  if (!/^-?\d+(\.\d{1,2})?$/.test(limpio)) {
    fallar(`"${bruto}" no tiene un formato de cifra válido. Usa por ejemplo 1,480.50`);
  }

  const n = Number(limpio);
  if (!Number.isFinite(n)) fallar(`"${bruto}" no es un número válido.`);
  if (!permitirNegativo && n < 0) fallar('no puede ser negativo.');

  return redondearDinero(n);
}

/** Redondeo a centavos: el dinero no arrastra decimales binarios. */
export function redondearDinero(valor) {
  const n = aNumeroSeguro(valor);
  return Math.round(n * 100) / 100;
}

/**
 * Suma de dinero de una lista, redondeada a centavos.
 * `selector` dice de dónde sale el monto de cada elemento (por defecto `.monto`).
 * Una lista que no es lista, o vacía, suma 0.
 *
 * @param {Array} lista
 * @param {(item: any) => any} [selector]
 */
export function sumarDinero(lista, selector = (item) => item?.monto) {
  if (!Array.isArray(lista)) return 0;
  const total = lista.reduce((suma, item) => suma + aNumeroSeguro(selector(item)), 0);
  return redondearDinero(total);
}

/**
 * Promedio de una lista, con la misma regla que el porcentaje: una lista vacía
 * no promedia 0 por accidente ni devuelve `NaN`, devuelve 0 a propósito.
 */
export function promedioSeguro(lista, selector = (item) => item) {
  if (!Array.isArray(lista) || lista.length === 0) return 0;
  const total = lista.reduce((suma, item) => suma + aNumeroSeguro(selector(item)), 0);
  return total / lista.length;
}

/**
 * Porcentaje `parte / total * 100` blindado contra el divisor cero.
 *
 * Un total de 0 —o nulo, o negativo— significa "no hay base para comparar", y
 * la respuesta honesta es 0, no una división entre 1 disfrazada. `limitar`
 * recorta a 0-100 para las barras y anillos que no pueden pasarse de la vuelta;
 * el sobregiro se muestra con su cifra real donde importa (>100% es un dato).
 */
export function porcentajeSeguro(parte, total, { limitar = false } = {}) {
  const base = aNumeroSeguro(total);
  if (!Number.isFinite(base) || base <= 0) return 0;
  const pct = (aNumeroSeguro(parte) / base) * 100;
  if (!Number.isFinite(pct)) return 0;
  return limitar ? Math.min(100, Math.max(0, pct)) : pct;
}

/** El mismo porcentaje ya redondeado a entero, que es como se pinta en la UI. */
export function porcentajeEntero(parte, total, opciones) {
  return Math.round(porcentajeSeguro(parte, total, opciones));
}
