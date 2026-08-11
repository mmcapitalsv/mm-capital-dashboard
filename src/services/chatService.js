import { supabase } from '../supabaseClient';
import { BUCKET_ARCHIVOS, firmarUrl, firmarUrls } from '../lib/urlFirmada';

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

const AVISO_MIGRACION_006 =
  'Falta la tabla `mensajes`. Ejecuta ' +
  'supabase/migrations/006_chat_socios.sql en el SQL Editor de Supabase.';

const AVISO_MIGRACION_009 =
  'Falta la columna `receptor_id`. Ejecuta ' +
  'supabase/migrations/009_mensajes_directos.sql en el SQL Editor de Supabase.';

export const AVISO_MIGRACION_010 =
  'No se pudo editar el mensaje: falta el permiso de edición en la base. ' +
  'Ejecuta supabase/migrations/010_valor_hitos_y_chat_editable.sql en el ' +
  'SQL Editor de Supabase.';

const AVISO_MIGRACION_012 =
  'No se pudo enviar el archivo: faltan las columnas de adjuntos. ' +
  'Ejecuta supabase/migrations/012_adjuntos_chat.sql en el ' +
  'SQL Editor de Supabase.';

/** Solo el Administrador puede vaciar el historial del canal General. */
export function puedeLimpiarChat(rol) {
  return String(rol || '') === 'admin';
}

/**
 * Columnas que pinta la interfaz. Se une la ficha del remitente para traer su
 * foto: así cada burbuja muestra el avatar real y no solo la inicial.
 */
const CAMPOS = 'id, canal, usuario_id, receptor_id, autor, contenido, created_at';

/** `editado_en` la agrega la migración 010; puede no existir todavía. */
const CAMPOS_CON_EDICION = `${CAMPOS}, editado_en`;

/** Las columnas del adjunto las agrega la 012; también pueden faltar. */
const CAMPOS_ADJUNTO = 'adjunto_url, adjunto_nombre, adjunto_tipo, adjunto_tamano';
const CAMPOS_COMPLETOS = `${CAMPOS_CON_EDICION}, ${CAMPOS_ADJUNTO}`;

const UNION_REMITENTE =
  ', remitente:usuarios!mensajes_usuario_id_fkey ( id, nombre_completo, avatar_url )';

/**
 * Juegos de columnas del más completo al más básico. Se prueban en orden: si
 * la unión con `usuarios` no está declarada, o si `editado_en` aún no existe,
 * la consulta cae al siguiente juego en vez de fallar.
 */
const VARIANTES = [
  CAMPOS_COMPLETOS + UNION_REMITENTE,
  CAMPOS_COMPLETOS,
  CAMPOS_CON_EDICION + UNION_REMITENTE,
  CAMPOS_CON_EDICION,
  CAMPOS + UNION_REMITENTE,
  CAMPOS
];

function falloDeUnion(error) {
  if (!error) return false;
  const msg = `${error.message || ''} ${error.details || ''} ${error.hint || ''}`;
  return /relationship|foreign key|mensajes_usuario_id_fkey|PGRST200/i.test(`${error.code} ${msg}`);
}

/** ¿El error se debe a que `editado_en` todavía no existe en la tabla? */
function faltaColumnaEdicion(error) {
  if (!error) return false;
  const msg = `${error.message || ''} ${error.details || ''}`;
  return /editado_en/i.test(msg);
}

/** ¿El error se debe a que las columnas de adjunto todavía no existen? */
function faltaColumnaAdjunto(error) {
  if (!error) return false;
  const msg = `${error.message || ''} ${error.details || ''}`;
  return /adjunto_/i.test(msg);
}

/**
 * Ejecuta una consulta probando los juegos de columnas hasta que uno funcione.
 * Solo reintenta ante fallos de esquema; cualquier otro error se devuelve tal cual.
 */
/* Juego de columnas que funcionó la última vez. Sin esta memoria, una base a
   la que le falte una migración paga los MISMOS intentos fallidos en cada
   consulta: con la 012 sin aplicar eran 3 peticiones por consulta (dos 400 y
   la buena), y el chat se consulta varias veces por carga. Recordando el
   índice, solo la primera consulta de la sesión hace el descarte.
   Se reinicia al recargar la página, que es justo cuando conviene volver a
   probar el juego completo: es lo que pasa después de aplicar una migración. */
let indicePreferido = 0;

function esFalloDeEsquema(error) {
  return falloDeUnion(error) || faltaColumnaEdicion(error) || faltaColumnaAdjunto(error);
}

async function consultarTolerante(hacer) {
  let ultimo = { data: null, error: null };
  const indices = VARIANTES.map((_, i) => i);
  // Se arranca por el juego recordado; si ninguno de ahí en adelante sirve,
  // se da la vuelta y se prueban los anteriores.
  const orden = [...indices.slice(indicePreferido), ...indices.slice(0, indicePreferido)];

  for (const i of orden) {
    ultimo = await hacer(VARIANTES[i]);
    if (!ultimo.error) {
      indicePreferido = i;
      return ultimo;
    }
    if (!esFalloDeEsquema(ultimo.error)) return ultimo;
  }
  return ultimo;
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
function normalizarMensaje(fila, uid) {
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
    /* `adjunto` es null cuando el mensaje es solo texto, que es lo normal.
       Así la burbuja decide con un simple `if` y no tiene que mirar cuatro
       columnas sueltas. */
    adjunto: fila?.adjunto_url
      ? {
          url: fila.adjunto_url,
          nombre: fila.adjunto_nombre || 'archivo',
          tipo: fila.adjunto_tipo || '',
          tamano: fila.adjunto_tamano ?? null
        }
      : null,
    editadoEn: fila?.editado_en || null,
    creadoEn: fila?.created_at || new Date().toISOString(),
    hora: fecha.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  };
}

/* ── Adjuntos: el bucket es privado (migración 018) ───────────────────────
   `mensajes.adjunto_url` guarda el enlace que se firmó al subir el archivo, y
   una firma dura una hora: un mensaje de ayer trae una URL muerta. Antes de
   pintar nada se re-firma a partir de la ruta que va dentro de esa misma URL.
   Los mensajes sin adjunto —la inmensa mayoría— no cuestan ni una petición. */

/** Re-firma el adjunto de UN mensaje ya normalizado. */
async function firmarAdjunto(mensaje) {
  if (!mensaje?.adjunto?.url) return mensaje;
  const url = await firmarUrl(mensaje.adjunto.url, { bucket: BUCKET_ARCHIVOS });
  return { ...mensaje, adjunto: { ...mensaje.adjunto, url: url || mensaje.adjunto.url } };
}

/** Re-firma los adjuntos de una lista, en una sola petición al bucket. */
async function firmarAdjuntos(mensajes) {
  const conAdjunto = mensajes.filter(m => m?.adjunto?.url);
  if (conAdjunto.length === 0) return mensajes;

  const firmadas = await firmarUrls(
    conAdjunto.map(m => m.adjunto.url), { bucket: BUCKET_ARCHIVOS }
  );

  return mensajes.map(m => (
    m?.adjunto?.url
      ? { ...m, adjunto: { ...m.adjunto, url: firmadas.get(m.adjunto.url) || m.adjunto.url } }
      : m
  ));
}

/** Historial completo del canal General, del más antiguo al más reciente. */
export async function listarMensajes(uid) {
  const { data, error } = await consultarTolerante((columnas) => supabase
    .from(TABLA)
    .select(columnas)
    .eq('canal', CANAL_SOCIOS)
    .is('receptor_id', null)
    .order('created_at', { ascending: true })
    .limit(300));

  if (error) {
    if (faltaTabla(error)) return { mensajes: [], error: AVISO_MIGRACION_006 };
    if (faltaColumna(error)) return { mensajes: [], error: AVISO_MIGRACION_009 };
    return { mensajes: [], error: error.message };
  }
  const mensajes = await firmarAdjuntos((data || []).map(f => normalizarMensaje(f, uid)));
  return { mensajes, error: null };
}

/**
 * Columnas del adjunto listas para el insert. Devuelve un objeto vacío cuando
 * no hay archivo, para que el mensaje de solo texto se siga insertando igual
 * en una base donde la migración 012 todavía no se ejecutó.
 */
function columnasAdjunto(adjunto) {
  if (!adjunto?.url) return {};
  return {
    adjunto_url: adjunto.url,
    adjunto_nombre: adjunto.nombre || 'archivo',
    adjunto_tipo: adjunto.tipo || '',
    adjunto_tamano: adjunto.tamano ?? null
  };
}

/** Inserta un mensaje. Devuelve el mensaje ya normalizado. */
export async function enviarMensajeSocios({ texto, uid, autor, adjunto = null }) {
  const contenido = String(texto || '').trim();
  // Con adjunto el texto es opcional: mandar solo una foto es válido.
  if (!contenido && !adjunto?.url) return { mensaje: null, error: null };
  if (!uid) return { mensaje: null, error: 'Sesión no válida.' };

  const { data, error } = await consultarTolerante((columnas) => supabase
    .from(TABLA)
    .insert({
      canal: CANAL_SOCIOS,
      usuario_id: uid,
      autor: autor || '',
      contenido,
      ...columnasAdjunto(adjunto)
    })
    .select(columnas)
    .single());

  if (error) {
    if (faltaTabla(error)) return { mensaje: null, error: AVISO_MIGRACION_006 };
    if (faltaColumnaAdjunto(error)) return { mensaje: null, error: AVISO_MIGRACION_012 };
    if (String(error.code) === '42501') {
      return { mensaje: null, error: 'Solo los socios pueden escribir en este canal.' };
    }
    return { mensaje: null, error: error.message };
  }
  return { mensaje: normalizarMensaje(data, uid), error: null };
}

/**
 * Suscripción Realtime al canal. `alMensaje` recibe cada mensaje nuevo ya
 * normalizado; `alEditar` y `alBorrar` (opcionales) reflejan al instante lo
 * que otro socio corrige o elimina. Devuelve la función de limpieza.
 */
export function suscribirMensajes(uid, alMensaje, { alEditar, alBorrar } = {}) {
  const canal = supabase
    .channel('chat-socios-mmcapital')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: TABLA, filter: `canal=eq.${CANAL_SOCIOS}` },
      // Realtime entrega la fila cruda: el adjunto se firma aquí, no en la vista.
      (payload) => { firmarAdjunto(normalizarMensaje(payload.new, uid)).then(alMensaje); }
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: TABLA, filter: `canal=eq.${CANAL_SOCIOS}` },
      (payload) => {
        if (alEditar) firmarAdjunto(normalizarMensaje(payload.new, uid)).then(alEditar);
      }
    )
    .on(
      // El borrado no admite filtro por canal (la fila ya no existe): se
      // reenvía el id y la vista descarta el que no tenga.
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: TABLA },
      (payload) => { if (alBorrar && payload.old?.id) alBorrar(payload.old.id); }
    )
    .subscribe();

  return () => { supabase.removeChannel(canal); };
}

/**
 * Corrige el texto de un mensaje. La RLS (migración 010) solo deja hacerlo al
 * autor: si alguien intenta editar un mensaje ajeno no hay error, hay CERO
 * filas afectadas, y por eso se comprueba `data.length` antes de dar por buena
 * la operación.
 */
export async function editarMensaje({ id, texto, uid }) {
  const contenido = String(texto || '').trim();
  if (!id) return { mensaje: null, error: 'Falta el mensaje a editar.' };
  if (!contenido) return { mensaje: null, error: 'El mensaje no puede quedar vacío.' };

  const { data, error } = await consultarTolerante((columnas) => supabase
    .from(TABLA)
    .update({ contenido, editado_en: new Date().toISOString() })
    .eq('id', id)
    .eq('usuario_id', uid)
    .select(columnas));

  if (error) {
    if (faltaTabla(error)) return { mensaje: null, error: AVISO_MIGRACION_006 };
    if (/editado_en/i.test(`${error.message || ''} ${error.details || ''}`)) {
      return { mensaje: null, error: AVISO_MIGRACION_010 };
    }
    return { mensaje: null, error: error.message };
  }
  if (!data || data.length === 0) return { mensaje: null, error: AVISO_MIGRACION_010 };

  return { mensaje: normalizarMensaje(data[0], uid), error: null };
}

/**
 * Borra un mensaje. La política "mensajes_borrado" (migraciones 006 y 017) deja
 * hacerlo al autor o al Administrador; sin permiso se borran cero filas.
 *
 * `esAdmin` levanta el filtro por autor: un moderador borra el mensaje de
 * cualquiera. Para el resto se mantiene, así el borrado ajeno ni sale a la red.
 */
export async function eliminarMensaje({ id, uid, esAdmin = false }) {
  if (!id) return { success: false, error: 'Falta el mensaje a eliminar.' };

  let consulta = supabase.from(TABLA).delete().eq('id', id);
  if (!esAdmin) consulta = consulta.eq('usuario_id', uid);

  const { data, error } = await consulta.select('id');

  if (error) return { success: false, error: error.message };
  if (!data || data.length === 0) {
    return {
      success: false,
      error: esAdmin
        ? 'No se pudo eliminar el mensaje. Ejecuta supabase/migrations/' +
          '017_bucket_chat_y_moderacion_admin.sql en el SQL Editor de Supabase.'
        : 'Solo puedes eliminar tus propios mensajes.'
    };
  }
  return { success: true, error: null };
}

/**
 * Vacía el historial COMPLETO del canal General. Acción exclusiva del
 * Administrador: la política "mensajes_borrado" solo deja borrar mensajes
 * ajenos a quien cumple `public.es_admin()`, así que para cualquier otro esto
 * borraría únicamente los suyos. Por eso la interfaz ni siquiera ofrece el
 * botón y aquí se verifica que la limpieza fuera realmente total.
 *
 * Los mensajes directos NO se tocan: `receptor_id is null` los deja fuera.
 */
export async function vaciarCanalSocios() {
  const { data, error } = await supabase
    .from(TABLA)
    .delete()
    .eq('canal', CANAL_SOCIOS)
    .is('receptor_id', null)
    .select('id');

  if (error) {
    if (faltaTabla(error)) return { success: false, borrados: 0, error: AVISO_MIGRACION_006 };
    return { success: false, borrados: 0, error: error.message };
  }

  return { success: true, borrados: (data || []).length, error: null };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Mensajes Directos (1 a 1)

   Un directo es una fila de `mensajes` con `receptor_id` distinto de null: la
   RLS de la migración 009 hace que solo lo vean su autor y su destinatario.
   ═══════════════════════════════════════════════════════════════════════════ */

const CANAL_DIRECTO = 'directo';

/** Conversación privada completa entre `uid` y `otroId`. */
export async function listarMensajesDirectos(uid, otroId) {
  if (!uid || !otroId) return { mensajes: [], error: null };

  const { data, error } = await consultarTolerante((columnas) => supabase
    .from(TABLA)
    .select(columnas)
    .not('receptor_id', 'is', null)
    .or(
      `and(usuario_id.eq.${uid},receptor_id.eq.${otroId}),` +
      `and(usuario_id.eq.${otroId},receptor_id.eq.${uid})`
    )
    .order('created_at', { ascending: true })
    .limit(300));

  if (error) {
    if (faltaTabla(error)) return { mensajes: [], error: AVISO_MIGRACION_006 };
    if (faltaColumna(error)) return { mensajes: [], error: AVISO_MIGRACION_009 };
    return { mensajes: [], error: error.message };
  }
  const mensajes = await firmarAdjuntos((data || []).map(f => normalizarMensaje(f, uid)));
  return { mensajes, error: null };
}

/** Inserta un mensaje privado dirigido a `receptorId`. */
export async function enviarMensajeDirecto({ texto, uid, autor, receptorId, adjunto = null }) {
  const contenido = String(texto || '').trim();
  // Con adjunto el texto es opcional: mandar solo una foto es válido.
  if (!contenido && !adjunto?.url) return { mensaje: null, error: null };
  if (!uid) return { mensaje: null, error: 'Sesión no válida.' };
  if (!receptorId) return { mensaje: null, error: 'Falta el destinatario del mensaje.' };

  const { data, error } = await consultarTolerante((columnas) => supabase
    .from(TABLA)
    .insert({
      canal: CANAL_DIRECTO,
      usuario_id: uid,
      receptor_id: receptorId,
      autor: autor || '',
      contenido,
      ...columnasAdjunto(adjunto)
    })
    .select(columnas)
    .single());

  if (error) {
    if (faltaTabla(error)) return { mensaje: null, error: AVISO_MIGRACION_006 };
    if (faltaColumnaAdjunto(error)) return { mensaje: null, error: AVISO_MIGRACION_012 };
    if (faltaColumna(error)) return { mensaje: null, error: AVISO_MIGRACION_009 };
    return { mensaje: null, error: error.message };
  }
  return { mensaje: normalizarMensaje(data, uid), error: null };
}

/**
 * Realtime de los directos: entrega solo los mensajes de la conversación con
 * `otroId`. Devuelve la función de limpieza.
 */
export function suscribirDirectos(uid, otroId, alMensaje, { alEditar, alBorrar } = {}) {
  const dePareja = (fila) =>
    (String(fila?.usuario_id) === String(uid) && String(fila?.receptor_id) === String(otroId)) ||
    (String(fila?.usuario_id) === String(otroId) && String(fila?.receptor_id) === String(uid));

  const canal = supabase
    .channel(`chat-directo-${uid}-${otroId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: TABLA, filter: `canal=eq.${CANAL_DIRECTO}` },
      (payload) => {
        if (dePareja(payload.new)) firmarAdjunto(normalizarMensaje(payload.new, uid)).then(alMensaje);
      }
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: TABLA, filter: `canal=eq.${CANAL_DIRECTO}` },
      (payload) => {
        if (alEditar && dePareja(payload.new)) {
          firmarAdjunto(normalizarMensaje(payload.new, uid)).then(alEditar);
        }
      }
    )
    .on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: TABLA },
      (payload) => { if (alBorrar && payload.old?.id) alBorrar(payload.old.id); }
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

  // Los avatares viven en el bucket privado: se firman todos de una vez.
  const firmadas = await firmarUrls(
    (data || []).map(u => u?.avatar_url), { bucket: BUCKET_ARCHIVOS }
  );

  return (data || []).reduce((mapa, u) => {
    if (u?.id && u.avatar_url) mapa[String(u.id)] = firmadas.get(u.avatar_url) || u.avatar_url;
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
