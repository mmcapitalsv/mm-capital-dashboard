/**
 * Notificaciones leídas, guardadas en Supabase (tabla `avisos_leidos`).
 *
 * Antes esto vivía solo en `localStorage`, así que la campana se reiniciaba al
 * entrar desde otro equipo o al limpiar los datos del navegador. Ahora la
 * marca viaja con la persona.
 *
 * `localStorage` NO desaparece: se queda como copia de arranque y como red de
 * seguridad. Sirve para dos cosas concretas:
 *   · Pintar el estado correcto en el primer fotograma, antes de que responda
 *     la consulta — si no, la campana parpadearía en rojo en cada carga.
 *   · Que la aplicación siga funcionando sin conexión, o si la migración 013
 *     todavía no se ha ejecutado en el proyecto de Supabase.
 * Por eso ninguna función de aquí lanza: un fallo de red deja la marca local
 * puesta y se reintenta al siguiente clic.
 */

import { supabase } from '../supabaseClient';

const CLAVE_LOCAL = 'mmcapital:avisosVistos:';

/* ── Copia local ─────────────────────────────────────────────────────────── */

export function leerAvisosLocales(usuarioId) {
  if (!usuarioId) return [];
  try {
    const crudo = localStorage.getItem(CLAVE_LOCAL + usuarioId);
    const lista = crudo ? JSON.parse(crudo) : [];
    return Array.isArray(lista) ? lista.map(String) : [];
  } catch {
    return [];   // localStorage bloqueado o JSON corrupto: se empieza de cero
  }
}

export function guardarAvisosLocales(usuarioId, ids) {
  if (!usuarioId) return;
  try {
    localStorage.setItem(CLAVE_LOCAL + usuarioId, JSON.stringify(ids));
  } catch {
    /* Sin almacenamiento disponible se pierde entre sesiones, pero la campana
       sigue funcionando dentro de la sesión actual. */
  }
}

/* ── Base de datos ───────────────────────────────────────────────────────── */

/**
 * Ids de los avisos que este usuario ya leyó, según la base.
 * Devuelve `null` —no una lista vacía— si la consulta falla: quien llama
 * necesita distinguir "no ha leído ninguno" de "no se pudo preguntar", porque
 * en el segundo caso lo correcto es conservar la copia local.
 */
export async function leerAvisosLeidos(usuarioId) {
  if (!usuarioId) return [];
  try {
    const { data, error } = await supabase
      .from('avisos_leidos')
      .select('aviso_id')
      .eq('usuario_id', usuarioId);

    if (error) return null;
    return (data || []).map(f => String(f.aviso_id));
  } catch {
    return null;
  }
}

/** Marca un aviso como leído. `true` si la base lo confirmó. */
export async function marcarAvisoLeidoEnBD(usuarioId, avisoId) {
  const id = String(avisoId ?? '');
  if (!usuarioId || !id) return false;
  try {
    const { error } = await supabase
      .from('avisos_leidos')
      // `upsert`: volver a pulsar un aviso ya leído no puede reventar por la
      // clave primaria (usuario_id, aviso_id).
      .upsert({ usuario_id: usuarioId, aviso_id: id }, { onConflict: 'usuario_id,aviso_id' });
    return !error;
  } catch {
    return false;
  }
}

/** Marca varios de una vez ("Marcar leídas"). */
export async function marcarAvisosLeidosEnBD(usuarioId, avisoIds) {
  const ids = (Array.isArray(avisoIds) ? avisoIds : [])
    .map(v => String(v ?? '')).filter(Boolean);
  if (!usuarioId || ids.length === 0) return false;
  try {
    const { error } = await supabase
      .from('avisos_leidos')
      .upsert(
        ids.map(aviso_id => ({ usuario_id: usuarioId, aviso_id })),
        { onConflict: 'usuario_id,aviso_id' }
      );
    return !error;
  } catch {
    return false;
  }
}
