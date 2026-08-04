import { supabase } from '../supabaseClient';

/**
 * Cifras editables del panel (tabla `configuracion`, migración 005).
 *
 * Hoy solo guarda el capital total del portafolio, que el Administrador puede
 * cambiar desde el MODO EDICIÓN del Dashboard. Es clave/valor para que añadir
 * otra cifra no requiera otra migración.
 */

const TABLA = 'configuracion';
export const CLAVE_CAPITAL = 'capital_total';

export const AVISO_MIGRACION_005 =
  'Falta la tabla `configuracion`. Ejecuta ' +
  'supabase/migrations/005_storage_avatares_y_configuracion.sql en el SQL Editor de Supabase.';

function faltaTabla(error) {
  if (!error) return false;
  const code = String(error.code || '');
  const msg = `${error.message || ''} ${error.details || ''}`;
  return code === '42P01' || code === 'PGRST205' || /could not find the table/i.test(msg);
}

/** Lee un valor de configuración. Devuelve `null` si no existe. */
export async function getConfiguracion(clave) {
  const { data, error } = await supabase
    .from(TABLA)
    .select('clave, valor')
    .eq('clave', clave)
    .maybeSingle();

  if (error) {
    return { valor: null, error: faltaTabla(error) ? AVISO_MIGRACION_005 : error.message };
  }
  return { valor: data?.valor ?? null, error: null };
}

/** Escribe (o crea) un valor de configuración. Solo administradores por RLS. */
export async function guardarConfiguracion(clave, valor) {
  const { error } = await supabase
    .from(TABLA)
    .upsert(
      { clave, valor, actualizado_en: new Date().toISOString() },
      { onConflict: 'clave' }
    );

  if (error) {
    if (faltaTabla(error)) return { success: false, error: AVISO_MIGRACION_005 };
    // 42501 = RLS: la fila existe pero quien escribe no es administrador
    if (String(error.code) === '42501') {
      return { success: false, error: 'Solo un administrador puede cambiar esta cifra.' };
    }
    return { success: false, error: error.message };
  }
  return { success: true, error: null };
}

/** Capital total del portafolio en número (null si no está configurado). */
export async function getCapitalTotal() {
  const { valor, error } = await getConfiguracion(CLAVE_CAPITAL);
  const monto = Number(valor?.monto);
  return { monto: Number.isFinite(monto) ? monto : null, error };
}

/** Guarda el capital total del portafolio. */
export async function guardarCapitalTotal(monto) {
  const importe = Number(String(monto).replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(importe) || importe < 0) {
    return { success: false, error: 'El capital debe ser un número mayor o igual que cero.' };
  }
  return guardarConfiguracion(CLAVE_CAPITAL, { monto: importe });
}
