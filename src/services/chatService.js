import { supabase } from '../supabaseClient';

/**
 * Chat corporativo "Socios" (tabla `mensajes`, migración 006).
 *
 * Fuente ÚNICA de datos: la misma consulta y la misma suscripción alimentan el
 * recuadro del Sidebar y la página de Chat, así que lo que se escribe en uno
 * aparece idéntico e instantáneo en el otro.
 */

const TABLA = 'mensajes';
export const CANAL_SOCIOS = 'socios';
/** Fijo por decisión de negocio: el canal de Socios son 3 miembros. */
export const MIEMBROS_SOCIOS = 3;

/** Roles con acceso de lectura y escritura al canal (espejo de la RLS). */
const ROLES_CON_ACCESO = ['admin', 'socio_administrador', 'socio_director'];

export const AVISO_MIGRACION_006 =
  'Falta la tabla `mensajes`. Ejecuta ' +
  'supabase/migrations/006_chat_socios.sql en el SQL Editor de Supabase.';

export const AVISO_MIGRACION_009 =
  'Falta la columna `receptor_id`. Ejecuta ' +
  'supabase/migrations/009_mensajes_directos.sql en el SQL Editor de Supabase.';

/**
 * Columnas que pinta la interfaz. Se une la ficha del remitente para traer su
 * foto: así cada burbuja muestra el avatar real y no solo la inicial.
 */
const COLUMNAS =
  'id, canal, usuario_id, receptor_id, autor, contenido, created_at, ' +
  'remitente:usuarios!mensajes_usuario_id_fkey ( id, nombre_completo, avatar_url )';

/** Si la unión con `usuarios` no existe (FK sin nombrar), se pide sin ella. */
const COLUMNAS_SIMPLES = 'id, canal, usuario_id, receptor_id, autor, contenido, created_at';

function falloDeUnion(error) {
  if (!error) return false;
  const msg = `${error.message || ''} ${error.details || ''} ${error.hint || ''}`;
  return /relationship|foreign key|mensajes_usuario_id_fkey|PGRST200/i.test(`${error.code} ${msg}`);
}

function faltaColumna(error) {
  if (!error) return false;
  const msg = `${error.message || ''} ${error.details || ''}`;
  return String(error.code) === '42703' || /receptor_id/i.test(msg);
}

function faltaTabla(error) {
  if (!error) return false;
  const code = String(error.code || '');
  const msg = `${error.message || ''} ${error.details || ''}`;
  return code === '42P01' || code === 'PGRST205' || /could not find the table/i.test(msg);
}

/** ¿Este rol puede leer y escribir en el canal de Socios? */
export function puedeUsarChat(rol) {
  return ROLES_CON_ACCESO.includes(String(rol || ''));
}

/** Fila de Supabase -> mensaje que pinta la interfaz. */
export function normalizarMensaje(fila, uid) {
  const fecha = new Date(fila?.created_at || Date.now());
  return {
    id: fila?.id,
    autor: fila?.autor || fila?.remitente?.nombre_completo || 'Socio MM Capital',
    usuarioId: fila?.usuario_id || null,
    // Realtime no trae la unión: la UI cae al mapa de avatares del contexto
    avatarUrl: fila?.remitente?.avatar_url || null,
    receptorId: fila?.receptor_id || null,
    propio: !!uid && String(fila?.usuario_id) === String(uid),
    texto: fila?.contenido || '',
    creadoEn: fila?.created_at || new Date().toISOString(),
    hora: fecha.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  };
}

/** Historial completo del canal General, del más antiguo al más reciente. */
export async function listarMensajes(uid) {
  const consulta = (columnas) => supabase
    .from(TABLA)
    .select(columnas)
    .eq('canal', CANAL_SOCIOS)
    .is('receptor_id', null)
    .order('created_at', { ascending: true })
    .limit(300);

  let { data, error } = await consulta(COLUMNAS);
  if (falloDeUnion(error)) ({ data, error } = await consulta(COLUMNAS_SIMPLES));

  if (error) {
    if (faltaTabla(error)) return { mensajes: [], error: AVISO_MIGRACION_006 };
    if (faltaColumna(error)) return { mensajes: [], error: AVISO_MIGRACION_009 };
    return { mensajes: [], error: error.message };
  }
  return { mensajes: (data || []).map(f => normalizarMensaje(f, uid)), error: null };
}

/** Inserta un mensaje. Devuelve el mensaje ya normalizado. */
export async function enviarMensajeSocios({ texto, uid, autor }) {
  const contenido = String(texto || '').trim();
  if (!contenido) return { mensaje: null, error: null };
  if (!uid) return { mensaje: null, error: 'Sesión no válida.' };

  const consulta = (columnas) => supabase
    .from(TABLA)
    .insert({ canal: CANAL_SOCIOS, usuario_id: uid, autor: autor || '', contenido })
    .select(columnas)
    .single();

  let { data, error } = await consulta(COLUMNAS);
  if (falloDeUnion(error)) ({ data, error } = await consulta(COLUMNAS_SIMPLES));

  if (error) {
    if (faltaTabla(error)) return { mensaje: null, error: AVISO_MIGRACION_006 };
    if (String(error.code) === '42501') {
      return { mensaje: null, error: 'Solo los socios pueden escribir en este canal.' };
    }
    return { mensaje: null, error: error.message };
  }
  return { mensaje: normalizarMensaje(data, uid), error: null };
}

/**
 * Suscripción Realtime al canal. `alMensaje` recibe cada mensaje nuevo ya
 * normalizado. Devuelve la función de limpieza.
 */
export function suscribirMensajes(uid, alMensaje) {
  const canal = supabase
    .channel('chat-socios-mmcapital')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: TABLA, filter: `canal=eq.${CANAL_SOCIOS}` },
      (payload) => alMensaje(normalizarMensaje(payload.new, uid))
    )
    .subscribe();

  return () => { supabase.removeChannel(canal); };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Mensajes Directos (1 a 1)

   Un directo es una fila de `mensajes` con `receptor_id` distinto de null: la
   RLS de la migración 009 hace que solo lo vean su autor y su destinatario.
   ═══════════════════════════════════════════════════════════════════════════ */

export const CANAL_DIRECTO = 'directo';

/** Conversación privada completa entre `uid` y `otroId`. */
export async function listarMensajesDirectos(uid, otroId) {
  if (!uid || !otroId) return { mensajes: [], error: null };

  const consulta = (columnas) => supabase
    .from(TABLA)
    .select(columnas)
    .not('receptor_id', 'is', null)
    .or(
      `and(usuario_id.eq.${uid},receptor_id.eq.${otroId}),` +
      `and(usuario_id.eq.${otroId},receptor_id.eq.${uid})`
    )
    .order('created_at', { ascending: true })
    .limit(300);

  let { data, error } = await consulta(COLUMNAS);
  if (falloDeUnion(error)) ({ data, error } = await consulta(COLUMNAS_SIMPLES));

  if (error) {
    if (faltaTabla(error)) return { mensajes: [], error: AVISO_MIGRACION_006 };
    if (faltaColumna(error)) return { mensajes: [], error: AVISO_MIGRACION_009 };
    return { mensajes: [], error: error.message };
  }
  return { mensajes: (data || []).map(f => normalizarMensaje(f, uid)), error: null };
}

/** Inserta un mensaje privado dirigido a `receptorId`. */
export async function enviarMensajeDirecto({ texto, uid, autor, receptorId }) {
  const contenido = String(texto || '').trim();
  if (!contenido) return { mensaje: null, error: null };
  if (!uid) return { mensaje: null, error: 'Sesión no válida.' };
  if (!receptorId) return { mensaje: null, error: 'Falta el destinatario del mensaje.' };

  const consulta = (columnas) => supabase
    .from(TABLA)
    .insert({
      canal: CANAL_DIRECTO,
      usuario_id: uid,
      receptor_id: receptorId,
      autor: autor || '',
      contenido
    })
    .select(columnas)
    .single();

  let { data, error } = await consulta(COLUMNAS);
  if (falloDeUnion(error)) ({ data, error } = await consulta(COLUMNAS_SIMPLES));

  if (error) {
    if (faltaTabla(error)) return { mensaje: null, error: AVISO_MIGRACION_006 };
    if (faltaColumna(error)) return { mensaje: null, error: AVISO_MIGRACION_009 };
    return { mensaje: null, error: error.message };
  }
  return { mensaje: normalizarMensaje(data, uid), error: null };
}

/**
 * Realtime de los directos: entrega solo los mensajes de la conversación con
 * `otroId`. Devuelve la función de limpieza.
 */
export function suscribirDirectos(uid, otroId, alMensaje) {
  const canal = supabase
    .channel(`chat-directo-${uid}-${otroId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: TABLA, filter: `canal=eq.${CANAL_DIRECTO}` },
      (payload) => {
        const fila = payload.new || {};
        const dePareja =
          (String(fila.usuario_id) === String(uid) && String(fila.receptor_id) === String(otroId)) ||
          (String(fila.usuario_id) === String(otroId) && String(fila.receptor_id) === String(uid));
        if (dePareja) alMensaje(normalizarMensaje(fila, uid));
      }
    )
    .subscribe();

  return () => { supabase.removeChannel(canal); };
}

/**
 * Directorio de avatares `{ [usuarioId]: url }`. Lo consume el contexto del
 * chat para pintar la foto de los mensajes que llegan por Realtime, donde
 * Supabase no envía la unión con `usuarios`.
 */
export async function listarAvataresUsuarios() {
  const { data, error } = await supabase
    .from('usuarios')
    .select('id, avatar_url');

  if (error) return {};
  return (data || []).reduce((mapa, u) => {
    if (u?.id && u.avatar_url) mapa[String(u.id)] = u.avatar_url;
    return mapa;
  }, {});
}

/** Momento hasta el que este usuario ya leyó el canal (ISO o null). */
export async function leerMarcaLectura(uid) {
  if (!uid) return null;
  const { data, error } = await supabase
    .from('chat_lecturas')
    .select('leido_hasta')
    .eq('usuario_id', uid)
    .eq('canal', CANAL_SOCIOS)
    .maybeSingle();

  if (error) return null;
  return data?.leido_hasta || null;
}

/** Marca el canal como leído hasta ahora (apaga el punto rojo de la campana). */
export async function marcarCanalLeido(uid) {
  if (!uid) return null;
  const ahora = new Date().toISOString();
  await supabase
    .from('chat_lecturas')
    .upsert(
      { usuario_id: uid, canal: CANAL_SOCIOS, leido_hasta: ahora },
      { onConflict: 'usuario_id,canal' }
    );
  return ahora;
}
