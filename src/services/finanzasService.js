import { supabase } from '../supabaseClient';
import { esIdValidoDeSupabase } from './storageService';

/**
 * Edición de las cifras financieras del proyecto.
 * Columnas: presupuesto_total (existía) + anticipo y cuota_asignada (migración 002).
 */

const AVISO_MIGRACION =
  'Faltan las columnas anticipo y cuota_asignada. Ejecuta ' +
  'supabase/migrations/002_fase2_finanzas_galeria.sql en el SQL Editor de Supabase.';

function columnaFaltante(error) {
  if (!error) return false;
  const code = String(error.code || '');
  const msg = `${error.message || ''} ${error.details || ''}`;
  return code === '42703' || code === 'PGRST204' || /could not find the .* column/i.test(msg);
}

/** Convierte lo que el usuario escribió a un número válido y no negativo. */
export function aNumero(valor) {
  if (valor === '' || valor === null || valor === undefined) return 0;
  // Acepta "1,480,000" y "1480000.50"
  const limpio = String(valor).replace(/[^\d.-]/g, '');
  const n = Number(limpio);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, n);
}

/**
 * Guarda las cifras financieras del proyecto.
 * @returns {Promise<{success: boolean, valores?: object, error?: string}>}
 */
export async function guardarFinanzas(proyectoId, { presupuesto, anticipo, cuota }) {
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

  const { data, error } = await supabase
    .from('proyectos')
    .update(valores)
    .eq('id', proyectoId)
    .select()
    .single();

  if (error) {
    if (columnaFaltante(error)) return { success: false, error: AVISO_MIGRACION, requiereMigracion: true };
    return { success: false, error: error.message };
  }

  return { success: true, valores: data };
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
    const monto = Number(f.monto) || 0;

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
      total: Math.round(x.total * 100) / 100,
      cantidad: x.cantidad
    }));
}

/** Formatea un monto como moneda con dos decimales: $12,450.00 */
export function formatearMoneda(valor) {
  const n = Number(valor) || 0;
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
