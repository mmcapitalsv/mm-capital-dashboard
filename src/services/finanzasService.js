import { supabase } from '../supabaseClient';
import { esIdValidoDeSupabase } from './storageService';
import { aNumeroSeguro, redondearDinero, sumarDinero } from '../lib/numeros';

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

/**
 * Costo Ejecutado del proyecto, con sus tres orígenes sumados:
 *   facturas registradas + hitos del checklist ya marcados + ajuste manual.
 * Nunca baja de cero: un ajuste negativo excesivo deja la cifra en 0, no en rojo.
 */
export function componerCostoEjecutado({ facturas = 0, hitos = 0, ajuste = 0 } = {}) {
  const total = aNumero(facturas) + aNumero(hitos) + aAjuste(ajuste);
  return Math.max(0, redondearDinero(total));
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
  { presupuesto, anticipo, cuota, costoEjecutado, ajusteManual, ejecucionMensual, nombre, ubicacion }
) {
  if (!esIdValidoDeSupabase(proyectoId)) {
    return {
      success: false,
      error: 'Este proyecto no existe en Supabase (ID de demostración), así que no se puede guardar.'
    };
  }

  const valores = {
    presupuesto_total: aNumero(presupuesto),
    anticipo: aNumero(anticipo),
    cuota_asignada: aNumero(cuota)
  };

  // El costo ejecutado se COMPONE: facturas + hitos marcados + ajuste manual.
  // `costo_ejecutado` guarda el total ya calculado (lo leen reportes y vistas
  // antiguas) y `ajuste_costo_manual` guarda solo la parte escrita a mano, que
  // es lo único que la aplicación no puede recalcular por su cuenta.
  // Ambas y la ejecución mensual se escriben solo si quien llama las manda
  // explícitamente (así un guardado normal no pisa la columna con ceros).
  if (costoEjecutado !== undefined) valores.costo_ejecutado = aNumero(costoEjecutado);
  if (ajusteManual !== undefined) valores.ajuste_costo_manual = aAjuste(ajusteManual);
  if (ejecucionMensual !== undefined) valores.ejecucion_mensual = normalizarEjecucionMensual(ejecucionMensual);

  // Identidad del proyecto: solo se toca si llegó algo escrito.
  // El nombre nunca se vacía: un título en blanco dejaría la tarjeta sin rótulo.
  if (typeof nombre === 'string' && nombre.trim()) valores.nombre = nombre.trim();
  if (typeof ubicacion === 'string') valores.ubicacion = ubicacion.trim();

  const actualizar = (cuerpo) => supabase
    .from('proyectos')
    .update(cuerpo)
    .eq('id', proyectoId)
    .select()
    .single();

  let { data, error } = await actualizar(valores);

  // La migración 010 todavía no se ha corrido: se guarda todo lo demás y se
  // avisa qué falta, en vez de perder también el presupuesto y el anticipo.
  if (faltaAjusteManual(error)) {
    const { ajuste_costo_manual: _sinColumna, ...resto } = valores;
    const reintento = await actualizar(resto);
    if (!reintento.error) {
      return { success: false, valores: reintento.data, error: AVISO_MIGRACION_010, requiereMigracion: true };
    }
    ({ data, error } = reintento);
  }

  if (error) {
    if (columnaFaltante(error)) return { success: false, error: AVISO_MIGRACION, requiereMigracion: true };
    return { success: false, error: error.message };
  }

  return { success: true, valores: data };
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

/** Lista las facturas/gastos registrados para un proyecto. */
export async function getFacturas(proyectoId) {
  if (!esIdValidoDeSupabase(proyectoId)) return { facturas: [], error: null };

  // Se ordena por `created_at`: la tabla `gastos` no tiene columna `fecha`,
  // y el instante de registro es justamente el orden que interesa.
  const { data, error } = await supabase
    .from('gastos')
    .select('*')
    .eq('proyecto_id', proyectoId)
    .order('created_at', { ascending: false });

  if (error) return { facturas: [], error: error.message };

  const facturas = (data || []).map(g => ({
    id: g.id,
    proveedor: g.proveedor || g.descripcion || 'Proveedor sin nombre',
    concepto: g.concepto || g.descripcion || '',
    monto: Number(g.monto) || 0,
    comprobante: g.comprobante || '',
    fecha: g.created_at ? String(g.created_at).slice(0, 10) : ''
  }));

  return { facturas, error: null };
}

/** Registra una factura de proveedor en `gastos`. */
export async function crearFactura(proyectoId, { proveedor, concepto, monto, comprobante }) {
  if (!esIdValidoDeSupabase(proyectoId)) {
    return { success: false, error: 'Este proyecto no existe en Supabase, así que no se puede registrar la factura.' };
  }

  // `descripcion` es la columna original de la tabla y en varios reportes es
  // lo único que se lee: se rellena con el concepto para no dejarla vacía.
  const fila = {
    proyecto_id: proyectoId,
    proveedor: String(proveedor || '').trim(),
    concepto: String(concepto || '').trim(),
    descripcion: String(concepto || proveedor || '').trim(),
    comprobante: String(comprobante || '').trim(),
    monto: aNumero(monto)
  };

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

  const valores = {
    proveedor: String(proveedor || '').trim(),
    concepto: String(concepto || '').trim(),
    monto: aNumero(monto)
  };
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
  const { facturas, error } = await getFacturas(proyectoId);
  return { total: sumarGastos(facturas), facturas, error };
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
