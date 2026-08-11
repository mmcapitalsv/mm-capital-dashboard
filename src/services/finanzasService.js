import { supabase } from '../supabaseClient';
import { esIdValidoDeSupabase } from './storageService';
import {
  aNumeroSeguro, redondearDinero, sumarDinero,
  parsearMontoEstricto, MontoInvalidoError
} from '../lib/numeros';
import { leerTablaCompleta } from '../lib/supabasePaginado';
import { BUCKET_FACTURAS, firmarCampo } from '../lib/urlFirmada';

/**
 * Edición de las cifras financieras del proyecto.
 * Columnas: presupuesto_total (existía) + anticipo y cuota_asignada (migración 002).
 */

const AVISO_MIGRACION =
  'Faltan columnas financieras (anticipo, cuota_asignada, costo_ejecutado o ' +
  'ejecucion_mensual). Ejecuta supabase/migrations/002_fase2_finanzas_galeria.sql y ' +
  'supabase/migrations/007_finanzas_reales_y_hilo_reportes.sql en el SQL Editor de Supabase.';

export const AVISO_MIGRACION_010 =
  'Falta la columna `ajuste_costo_manual`, así que la corrección a mano del ' +
  'Costo Ejecutado no se pudo guardar. Ejecuta ' +
  'supabase/migrations/010_valor_hitos_y_chat_editable.sql en el SQL Editor de Supabase.';

function columnaFaltante(error) {
  if (!error) return false;
  const code = String(error.code || '');
  const msg = `${error.message || ''} ${error.details || ''}`;
  return code === '42703' || code === 'PGRST204' || /could not find the .* column/i.test(msg);
}

/** true si el error se queja específicamente de la columna del ajuste manual. */
function faltaAjusteManual(error) {
  if (!columnaFaltante(error)) return false;
  return /ajuste_costo_manual/i.test(`${error.message || ''} ${error.details || ''}`);
}

/** true si falta `updated_at` (migración 016 sin aplicar): sin testigo no hay bloqueo. */
function faltaUpdatedAt(error) {
  if (!columnaFaltante(error)) return false;
  return /updated_at/i.test(`${error.message || ''} ${error.details || ''}`);
}

/** Convierte lo que el usuario escribió a un número válido y no negativo. */
export function aNumero(valor) {
  // Acepta "1,480,000" y "1480000.50" (ver `aNumeroSeguro`).
  return Math.max(0, aNumeroSeguro(valor));
}

/**
 * Igual que `aNumero` pero CONSERVA el signo: el ajuste manual es negativo
 * cuando el Administrador escribe un total menor que facturas + hitos.
 */
export function aAjuste(valor) {
  return redondearDinero(valor);
}

/* ─────────────────── Entrada contable estricta (P2-18) ─────────────────────
   `aNumero` sigue siendo el parseo TOLERANTE que usan los `onChange` mientras
   se teclea. Al PERSISTIR se usan estos, que se niegan a degradar una cifra
   corrupta a 0: prefieren abortar el guardado con un mensaje entendible. */

/** Importe contable no negativo. Lanza `MontoInvalidoError` si no es cifra. */
export function aMontoContable(valor, campo) {
  return parsearMontoEstricto(valor, { campo });
}

/** Igual, pero admite el signo (el ajuste manual puede ser negativo). */
export function aAjusteContable(valor, campo) {
  return parsearMontoEstricto(valor, { campo, permitirNegativo: true });
}

/**
 * Ejecuta un parseo estricto y traduce el fallo a la forma de respuesta que ya
 * consume la UI (`{success:false, error}`), en vez de reventar la vista.
 */
function conMontosValidados(construir) {
  try {
    return { ok: true, valores: construir() };
  } catch (err) {
    if (err instanceof MontoInvalidoError) return { ok: false, error: err.message };
    throw err;
  }
}

/** Mensaje único del choque de guardados simultáneos (P2-17). */
export const AVISO_CONFLICTO_CONCURRENCIA =
  'Otro administrador guardó cambios en este proyecto mientras editabas. ' +
  'Para no sobrescribir sus cifras, tus cambios NO se guardaron: recarga el ' +
  'proyecto, revisa los valores actuales y vuelve a aplicarlos.';

/**
 * Costo Ejecutado del proyecto: FUENTE ÚNICA, la suma real de `gastos`.
 *
 * Antes sumaba tres orígenes —facturas + valor de los hitos marcados + ajuste
 * manual— y contaba el mismo dinero dos veces: la factura del proveedor que
 * ejecutó el hito ya estaba registrada, y marcar el hito volvía a sumar su
 * `valor`. El resultado era un sobrecosto inventado que crecía con cada hito
 * cerrado, y encima requería que alguien lo corrigiera a mano una y otra vez.
 *
 * Los parámetros `hitos` y `ajuste` se aceptan y se IGNORAN a propósito: las
 * llamadas antiguas siguen compilando, pero ya no inflan la cifra.
 */
export function componerCostoEjecutado({ facturas = 0 } = {}) {
  return Math.max(0, redondearDinero(aNumero(facturas)));
}

/**
 * Meses del año tal como se guardan en `proyectos.ejecucion_mensual`.
 * La clave es fija (es) y la UI la traduce; así el JSON no depende del idioma.
 */
export const MESES_EJECUCION = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

/**
 * Normaliza la ejecución mensual que viene de Supabase a los 12 meses.
 * Nunca inventa cifras: lo que no está guardado vale 0.
 *
 * @returns {Array<{name: string, value: number}>}
 */
export function normalizarEjecucionMensual(bruto) {
  const previos = new Map();

  if (Array.isArray(bruto)) {
    for (const fila of bruto) {
      if (!fila) continue;
      const nombre = String(fila.name ?? fila.mes ?? '').trim();
      if (!nombre) continue;
      previos.set(nombre.slice(0, 3).toLowerCase(), aNumero(fila.value ?? fila.valor ?? fila.monto));
    }
  }

  return MESES_EJECUCION.map(mes => ({
    name: mes,
    value: previos.get(mes.toLowerCase()) ?? 0
  }));
}

/**
 * Guarda las cifras financieras del proyecto.
 * Incluye el costo ejecutado (sobrescribible por el Administrador) y la
 * ejecución financiera mensual editada mes a mes.
 *
 * `nombre` y `ubicacion` son opcionales: viajan en el MISMO UPDATE cuando el
 * Administrador edita el título o el subtítulo del proyecto desde el header.
 *
 * @returns {Promise<{success: boolean, valores?: object, error?: string}>}
 */
export async function guardarFinanzas(
  proyectoId,
  { presupuesto, anticipo, cuota, costoEjecutado, ajusteManual, ejecucionMensual, nombre, ubicacion, updatedAt }
) {
  if (!esIdValidoDeSupabase(proyectoId)) {
    return {
      success: false,
      error: 'Este proyecto no existe en Supabase (ID de demostración), así que no se puede guardar.'
    };
  }

  // P2-18: si alguna cifra llega corrupta se aborta ANTES de tocar la base.
  const parseo = conMontosValidados(() => {
    const v = {
      presupuesto_total: aMontoContable(presupuesto, 'El presupuesto total'),
      anticipo: aMontoContable(anticipo, 'El anticipo'),
      cuota_asignada: aMontoContable(cuota, 'La cuota asignada')
    };

    // El costo ejecutado se COMPONE: facturas + hitos marcados + ajuste manual.
    // `costo_ejecutado` guarda el total ya calculado (lo leen reportes y vistas
    // antiguas) y `ajuste_costo_manual` guarda solo la parte escrita a mano, que
    // es lo único que la aplicación no puede recalcular por su cuenta.
    // Ambas y la ejecución mensual se escriben solo si quien llama las manda
    // explícitamente (así un guardado normal no pisa la columna con ceros).
    if (costoEjecutado !== undefined) v.costo_ejecutado = aMontoContable(costoEjecutado, 'El costo ejecutado');
    if (ajusteManual !== undefined) v.ajuste_costo_manual = aAjusteContable(ajusteManual, 'El ajuste manual');
    if (ejecucionMensual !== undefined) v.ejecucion_mensual = normalizarEjecucionMensual(ejecucionMensual);

    return v;
  });

  if (!parseo.ok) return { success: false, error: parseo.error, montoInvalido: true };

  const valores = parseo.valores;

  // Identidad del proyecto: solo se toca si llegó algo escrito.
  // El nombre nunca se vacía: un título en blanco dejaría la tarjeta sin rótulo.
  if (typeof nombre === 'string' && nombre.trim()) valores.nombre = nombre.trim();
  if (typeof ubicacion === 'string') valores.ubicacion = ubicacion.trim();

  /* P2-17 · Bloqueo optimista.
     `updatedAt` es el testigo de versión que el cliente leyó al abrir la ficha
     (columna `proyectos.updated_at`, migración 016). Al viajar en el WHERE, si
     otro administrador guardó entretanto el testigo ya cambió, el UPDATE afecta
     CERO filas y aquí se rechaza. Antes, el último clic ganaba en silencio y el
     presupuesto del compañero desaparecía sin dejar rastro.
     `maybeSingle()` en vez de `single()`: cero filas es un resultado esperado
     de esta consulta, no un error de la petición. */
  const testigo = typeof updatedAt === 'string' && updatedAt ? updatedAt : null;

  const actualizar = (cuerpo, { conTestigo = !!testigo } = {}) => {
    let q = supabase.from('proyectos').update(cuerpo).eq('id', proyectoId);
    if (conTestigo && testigo) q = q.eq('updated_at', testigo);
    return q.select().maybeSingle();
  };

  let { data, error } = await actualizar(valores);

  // La migración 016 aún no se ha corrido: no hay columna `updated_at` que
  // comparar, así que se guarda sin bloqueo optimista en vez de fallar.
  if (error && faltaUpdatedAt(error)) {
    ({ data, error } = await actualizar(valores, { conTestigo: false }));
  }

  // La migración 010 todavía no se ha corrido: se guarda todo lo demás y se
  // avisa qué falta, en vez de perder también el presupuesto y el anticipo.
  if (faltaAjusteManual(error)) {
    const { ajuste_costo_manual: _sinColumna, ...resto } = valores;
    const reintento = await actualizar(resto);
    if (!reintento.error && reintento.data) {
      return { success: false, valores: reintento.data, error: AVISO_MIGRACION_010, requiereMigracion: true };
    }
    ({ data, error } = reintento);
  }

  if (error) {
    if (columnaFaltante(error)) return { success: false, error: AVISO_MIGRACION, requiereMigracion: true };
    return { success: false, error: error.message };
  }

  // Cero filas con testigo: o alguien guardó antes, o RLS bloqueó la escritura.
  // Se distinguen releyendo la fila; sin esa consulta el aviso mentiría en uno
  // de los dos casos.
  if (!data) {
    if (!testigo) {
      return {
        success: false,
        error: 'No se pudo guardar: el proyecto ya no existe o no tienes permiso de escritura.'
      };
    }

    const { data: actual } = await supabase
      .from('proyectos')
      .select('updated_at')
      .eq('id', proyectoId)
      .maybeSingle();

    if (actual && actual.updated_at !== testigo) {
      return {
        success: false,
        conflicto: true,
        error: AVISO_CONFLICTO_CONCURRENCIA,
        updatedAtRemoto: actual.updated_at
      };
    }

    return {
      success: false,
      error: 'No se pudo guardar: el proyecto ya no existe o no tienes permiso de escritura.'
    };
  }

  return { success: true, valores: data, updatedAt: data.updated_at ?? null };
}

/* ─────────────── Facturas de proveedores REALES (tabla `gastos`) ───────────
   Las columnas `proveedor`, `concepto` y `comprobante` ya existen en la base
   (migración 007), así que aquí no hay avisos de migración: se lee y escribe
   directo.

   `comprobante` guarda la URL pública del archivo subido al bucket `facturas`.
   Las filas antiguas pueden traer texto suelto ("Factura #F-9482"); por eso
   `esComprobanteArchivo` distingue una cosa de la otra. */

/** true si `comprobante` es un enlace a un archivo y no una referencia escrita. */
export function esComprobanteArchivo(valor) {
  return /^https?:\/\//i.test(String(valor || '').trim());
}

/** true si el comprobante es un PDF (se visualiza en iframe, no en <img>). */
export function esComprobantePdf(valor) {
  return /\.pdf(\?|#|$)/i.test(String(valor || '').trim());
}

/** Nombre de archivo sugerido al descargar el comprobante de una factura. */
export function nombreArchivoFactura(factura) {
  const proveedor = String(factura?.proveedor || 'factura').replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 40);
  const extension = esComprobantePdf(factura?.comprobante) ? 'pdf' : 'jpg';
  return `${proveedor}_${factura?.fecha || ''}.${extension}`.replace(/_+\./, '.');
}

/**
 * Lista las facturas/gastos registrados para un proyecto.
 *
 * Pagina con conteo exacto: un proyecto con más de 1,000 facturas devolvería
 * solo las primeras mil —sin error— y el "Costo ejecutado" saldría corto.
 * Se ordena por `created_at`: la tabla `gastos` no tiene columna `fecha`, y el
 * instante de registro es justamente el orden que interesa.
 */
export async function getFacturas(proyectoId) {
  if (!esIdValidoDeSupabase(proyectoId)) return { facturas: [], error: null, truncado: false };

  try {
    const { filas, truncado } = await leerTablaCompleta('gastos', '*', {
      orden: 'created_at',
      ascendente: false,
      filtrar: (q) => q.eq('proyecto_id', proyectoId)
    });
    /* El bucket `facturas` es privado (migración 018): la URL guardada en
       `gastos.comprobante` es pública antigua o una firma caducada, y en
       ninguno de los dos casos abre. Se re-firma toda la lista de una vez. */
    const facturas = await firmarCampo(
      filas.map(normalizarFactura), 'comprobante',
      { bucket: BUCKET_FACTURAS, soloUrls: true }
    );
    return { facturas, error: null, truncado };
  } catch (err) {
    return { facturas: [], error: err.message || 'No se pudieron leer las facturas.', truncado: false };
  }
}

/**
 * Fila cruda de `gastos` -> factura tal como la pinta la ficha del proyecto.
 * Se exporta porque Realtime entrega filas crudas y la vista necesita darles
 * exactamente esta forma para insertarlas en su lista sin releer nada.
 */
export function normalizarFactura(g) {
  return {
    id: g?.id,
    proveedor: g?.proveedor || g?.descripcion || 'Proveedor sin nombre',
    concepto: g?.concepto || g?.descripcion || '',
    monto: aNumeroSeguro(g?.monto),
    comprobante: g?.comprobante || '',
    fecha: g?.created_at ? String(g.created_at).slice(0, 10) : ''
  };
}

/** Registra una factura de proveedor en `gastos`. */
export async function crearFactura(proyectoId, { proveedor, concepto, monto, comprobante }) {
  if (!esIdValidoDeSupabase(proyectoId)) {
    return { success: false, error: 'Este proyecto no existe en Supabase, así que no se puede registrar la factura.' };
  }

  // `descripcion` es la columna original de la tabla y en varios reportes es
  // lo único que se lee: se rellena con el concepto para no dejarla vacía.
  const parseo = conMontosValidados(() => ({
    proyecto_id: proyectoId,
    proveedor: String(proveedor || '').trim(),
    concepto: String(concepto || '').trim(),
    descripcion: String(concepto || proveedor || '').trim(),
    comprobante: String(comprobante || '').trim(),
    // P2-18: "12.OO" o "1.2.3" ya no se guardan como $0.00 en la contabilidad.
    monto: aMontoContable(monto, 'El monto de la factura')
  }));

  if (!parseo.ok) return { success: false, error: parseo.error, montoInvalido: true };

  const fila = parseo.valores;

  if (!fila.proveedor) return { success: false, error: 'Indica el proveedor.' };
  if (fila.monto <= 0) return { success: false, error: 'Indica un monto mayor que cero.' };

  const { data, error } = await supabase.from('gastos').insert([fila]).select().single();

  if (error) return { success: false, error: error.message };

  return { success: true, factura: data };
}

/**
 * Actualiza los datos de una factura ya registrada.
 * El comprobante no se toca: se edita el texto y el monto, no el archivo.
 */
export async function actualizarFactura(facturaId, { proveedor, concepto, monto }) {
  if (!esIdValidoDeSupabase(facturaId)) {
    return { success: false, error: 'Esta factura no existe en Supabase, así que no se puede editar.' };
  }

  const parseo = conMontosValidados(() => ({
    proveedor: String(proveedor || '').trim(),
    concepto: String(concepto || '').trim(),
    monto: aMontoContable(monto, 'El monto de la factura')
  }));

  if (!parseo.ok) return { success: false, error: parseo.error, montoInvalido: true };

  const valores = parseo.valores;
  // `descripcion` acompaña siempre al concepto (ver crearFactura).
  valores.descripcion = valores.concepto || valores.proveedor;

  if (!valores.proveedor) return { success: false, error: 'Indica el proveedor.' };
  if (valores.monto <= 0) return { success: false, error: 'Indica un monto mayor que cero.' };

  const { data, error } = await supabase
    .from('gastos')
    .update(valores)
    .eq('id', facturaId)
    .select()
    .single();

  if (error) return { success: false, error: error.message };

  return { success: true, factura: data };
}

/** Borra la fila de la factura en `gastos`. El archivo del bucket se conserva. */
export async function eliminarFactura(facturaId) {
  if (!esIdValidoDeSupabase(facturaId)) {
    return { success: false, error: 'Esta factura no existe en Supabase, así que no se puede eliminar.' };
  }

  // `.select()` devuelve lo borrado: si RLS bloquea la operación no hay error,
  // solo cero filas, y sin esto el borrado parecería haber funcionado.
  const { data, error } = await supabase.from('gastos').delete().eq('id', facturaId).select();

  if (error) return { success: false, error: error.message };
  if (!data || data.length === 0) {
    return { success: false, error: 'No se pudo eliminar la factura. Solo el Administrador puede borrar registros de gastos.' };
  }

  return { success: true };
}

/* ───────────────── Agrupación de gastos por mes para la gráfica ───────────── */

const MESES_CORTOS = {
  es: ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
};

/**
 * Convierte un valor de fecha a Date en hora LOCAL.
 *
 * `new Date('2025-08-01')` se interpreta como medianoche UTC; en El Salvador
 * (UTC-6) eso retrocede al 31 de julio y la factura se contaría en el mes
 * anterior. Por eso las fechas de solo día se construyen componente a
 * componente. Los timestamps completos sí llevan zona horaria y se parsean
 * como vienen.
 */
function aFechaLocal(valor) {
  if (!valor) return null;

  const soloDia = String(valor).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (soloDia) {
    return new Date(Number(soloDia[1]), Number(soloDia[2]) - 1, Number(soloDia[3]));
  }

  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Agrupa facturas/gastos por mes y suma sus montos, en orden cronológico.
 * Blindado contra arreglos vacíos, fechas inválidas y montos no numéricos.
 *
 * @returns {Array<{name: string, total: number, cantidad: number}>}
 */
export function agruparGastosPorMes(facturas, idioma = 'es') {
  if (!Array.isArray(facturas) || facturas.length === 0) return [];

  const meses = MESES_CORTOS[idioma] || MESES_CORTOS.es;
  const acumulado = new Map();

  for (const f of facturas) {
    if (!f) continue;
    const fecha = aFechaLocal(f.fecha || f.created_at);
    if (!fecha) continue;

    const clave = `${fecha.getFullYear()}-${String(fecha.getMonth()).padStart(2, '0')}`;
    const monto = aNumeroSeguro(f.monto);

    const previo = acumulado.get(clave) || {
      clave,
      anio: fecha.getFullYear(),
      mes: fecha.getMonth(),
      total: 0,
      cantidad: 0
    };
    previo.total += monto;
    previo.cantidad += 1;
    acumulado.set(clave, previo);
  }

  return [...acumulado.values()]
    .sort((a, b) => (a.anio - b.anio) || (a.mes - b.mes))
    .map(x => ({
      name: `${meses[x.mes]} ${String(x.anio).slice(2)}`,
      total: redondearDinero(x.total),
      cantidad: x.cantidad
    }));
}

/**
 * Suma REAL de los montos registrados en `gastos`.
 * Es el único origen del "Costo Ejecutado": no hay cifras de relleno.
 */
export function sumarGastos(facturas) {
  return sumarDinero(facturas, (f) => f?.monto);
}

/**
 * Consulta `gastos` por `proyecto_id` y devuelve el total ejecutado junto con
 * las filas, para que la vista arme la gráfica sin una segunda consulta.
 *
 * @returns {Promise<{total: number, facturas: Array, error: string|null}>}
 */
export async function getTotalEjecutado(proyectoId) {
  const { facturas, error, truncado } = await getFacturas(proyectoId);
  return { total: sumarGastos(facturas), facturas, error, truncado };
}

/**
 * Serie de la gráfica "Ejecución financiera mensual" construida ESTRICTAMENTE
 * con las sumas reales de cada mes. Sin meses inventados ni ceros de relleno.
 *
 * @returns {Array<{name: string, value: number, cantidad: number}>}
 */
export function ejecucionMensualReal(facturas, idioma = 'es') {
  return agruparGastosPorMes(facturas, idioma).map(m => ({
    name: m.name,
    value: m.total,
    cantidad: m.cantidad
  }));
}

/** Formatea un monto como moneda con dos decimales: $12,450.00 */
export function formatearMoneda(valor) {
  const n = Number(valor) || 0;
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
