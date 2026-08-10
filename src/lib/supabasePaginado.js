import { supabase } from '../supabaseClient';

/**
 * Lectura completa de una tabla, a prueba del techo de PostgREST.
 *
 * PostgREST corta TODA respuesta en `db-max-rows` (1,000 filas por defecto en
 * Supabase) y no avisa: devuelve 200, sin error, con la lista recortada. Sobre
 * `gastos` o `aportaciones` eso no es un detalle de rendimiento, es una cifra
 * de dinero incorrecta presentada como buena — el panel sumaría las primeras
 * mil facturas y llamaría a eso "Egresos ejecutados".
 *
 * Aquí se pide `count: 'exact'` y se pagina con `range()` hasta traer las
 * `count` filas. Si aun así falta alguna (tope de páginas), se devuelve
 * `truncado: true` para que quien llame lo diga en pantalla en vez de sumar
 * una parte y callar.
 */

/** Techo por respuesta de PostgREST en Supabase. */
export const LIMITE_POSTGREST = 1000;

/** Tope de seguridad: 50 páginas = 50,000 filas. Más que eso no se pinta. */
export const MAX_PAGINAS = 50;

/**
 * @param {string} tabla
 * @param {string} columnas
 * @param {{orden?: string, ascendente?: boolean, filtrar?: (q: any) => any}} [opciones]
 *   `orden` DEBE ser una columna estable (por defecto `id`): paginar sin ORDER
 *   BY permite que Postgres devuelva filas repetidas o se salte otras.
 * @returns {Promise<{filas: Array, total: number, truncado: boolean}>}
 * @throws {Error} si Supabase responde con error (nunca se traga un fallo)
 */
export async function leerTablaCompleta(tabla, columnas = '*', opciones = {}) {
  const { orden = 'id', ascendente = true, filtrar } = opciones;

  const filas = [];
  let total = null;

  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    const desde = pagina * LIMITE_POSTGREST;

    let consulta = supabase
      .from(tabla)
      .select(columnas, { count: 'exact' })
      .order(orden, { ascending: ascendente })
      .range(desde, desde + LIMITE_POSTGREST - 1);

    if (typeof filtrar === 'function') consulta = filtrar(consulta);

    const { data, error, count } = await consulta;
    if (error) {
      throw new Error(`No se pudo leer «${tabla}»: ${error.message || 'error desconocido'}`);
    }

    if (Number.isFinite(count)) total = count;

    const lote = Array.isArray(data) ? data : [];
    filas.push(...lote);

    // Última página: el lote vino incompleto o ya se juntó el conteo exacto.
    if (lote.length < LIMITE_POSTGREST) break;
    if (total !== null && filas.length >= total) break;
  }

  const esperadas = total ?? filas.length;
  return { filas, total: esperadas, truncado: filas.length < esperadas };
}
