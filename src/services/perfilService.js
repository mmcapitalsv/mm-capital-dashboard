import { supabase } from '../supabaseClient';

/**
 * Acciones de cuenta del perfil: credenciales de Auth, datos bancarios y
 * reportes de soporte ejecutivo.
 */

const TABLA_REPORTES = 'reportes_soporte';

export const AVISO_MIGRACION_004 =
  'Falta la tabla `reportes_soporte`. Ejecuta ' +
  'supabase/migrations/004_reportes_soporte.sql en el SQL Editor de Supabase.';

function faltaTabla(error) {
  if (!error) return false;
  const code = String(error.code || '');
  const msg = `${error.message || ''} ${error.details || ''}`;
  return code === '42P01' || code === 'PGRST205' || /could not find the table/i.test(msg);
}

/* ─────────────────────────── Credenciales (Auth) ─────────────────────────── */

/**
 * Cambia el correo de acceso. Supabase envía un correo de confirmación a la
 * dirección nueva; el cambio no es efectivo hasta que se confirma.
 */
export async function cambiarCorreo(nuevoCorreo) {
  const correo = String(nuevoCorreo || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) {
    return { success: false, error: 'Escribe un correo electrónico válido.' };
  }

  const { error } = await supabase.auth.updateUser({ email: correo });
  if (error) return { success: false, error: error.message };

  return { success: true, requiereConfirmacion: true };
}

/** Cambia la contraseña de acceso. */
export async function cambiarPassword(nueva, repetida) {
  const pass = String(nueva || '');
  if (pass.length < 8) {
    return { success: false, error: 'La contraseña debe tener al menos 8 caracteres.' };
  }
  if (pass !== String(repetida || '')) {
    return { success: false, error: 'Las contraseñas no coinciden.' };
  }

  const { error } = await supabase.auth.updateUser({ password: pass });
  if (error) return { success: false, error: error.message };

  return { success: true };
}

/* ───────────────────────────── Datos bancarios ───────────────────────────── */

/** Lee los datos bancarios guardados en user_metadata. */
export function leerDatosBancarios(user) {
  const d = user?.user_metadata?.datos_bancarios;
  return {
    banco: d?.banco || '',
    numeroCuenta: d?.numero_cuenta || '',
    tipoCuenta: d?.tipo_cuenta || 'ahorro'
  };
}

/** Guarda los datos bancarios en user_metadata. */
export async function guardarDatosBancarios({ banco, numeroCuenta, tipoCuenta }) {
  const b = String(banco || '').trim();
  const n = String(numeroCuenta || '').trim();
  if (!b) return { success: false, error: 'Indica el nombre del banco.' };
  if (!n) return { success: false, error: 'Indica el número de cuenta.' };

  const { error } = await supabase.auth.updateUser({
    data: {
      datos_bancarios: {
        banco: b,
        numero_cuenta: n,
        tipo_cuenta: tipoCuenta || 'ahorro',
        actualizado_en: new Date().toISOString()
      }
    }
  });

  if (error) return { success: false, error: error.message };
  return { success: true };
}

/* ────────────────────────── Reportes de soporte ──────────────────────────── */

/** Envía un reporte de soporte. `usuario_id` debe ser el propio (lo exige RLS). */
export async function enviarReporte(usuarioId, mensaje) {
  const texto = String(mensaje || '').trim();
  if (texto.length < 10) {
    return { success: false, error: 'Describe tu problema con al menos 10 caracteres.' };
  }
  if (!usuarioId) {
    return { success: false, error: 'No se pudo identificar tu usuario.' };
  }

  const { data, error } = await supabase
    .from(TABLA_REPORTES)
    .insert([{ usuario_id: usuarioId, mensaje: texto }])
    .select()
    .single();

  if (error) {
    if (faltaTabla(error)) return { success: false, error: AVISO_MIGRACION_004, requiereMigracion: true };
    // 23503 = el usuario no tiene ficha en `usuarios`
    if (String(error.code) === '23503') {
      return { success: false, error: 'Tu cuenta aún no tiene ficha en la tabla usuarios. Ejecuta la migración 001.' };
    }
    return { success: false, error: error.message };
  }

  return { success: true, reporte: data };
}

/** Lista los reportes con el remitente resuelto (admin ve todos; RLS filtra). */
export async function getReportes() {
  const { data, error } = await supabase
    .from(TABLA_REPORTES)
    .select('id, mensaje, estado, created_at, usuario_id, usuarios ( nombre_completo, email, avatar_url )')
    .order('created_at', { ascending: false });

  if (error) {
    if (faltaTabla(error)) return { reportes: [], error: AVISO_MIGRACION_004, requiereMigracion: true };
    return { reportes: [], error: error.message };
  }

  const reportes = (data || []).map(r => ({
    id: r.id,
    mensaje: r.mensaje,
    estado: r.estado,
    fecha: r.created_at,
    autor: r.usuarios?.nombre_completo || r.usuarios?.email || 'Usuario',
    email: r.usuarios?.email || '',
    avatarUrl: r.usuarios?.avatar_url || null
  }));

  return { reportes, error: null };
}

/** Cambia el estado de un reporte (solo administrador, lo exige RLS). */
export async function actualizarEstadoReporte(id, estado) {
  if (!id) return { success: false, error: 'El reporte no tiene identificador.' };
  const { error } = await supabase.from(TABLA_REPORTES).update({ estado }).eq('id', id);
  if (error) return { success: false, error: error.message };
  return { success: true };
}
