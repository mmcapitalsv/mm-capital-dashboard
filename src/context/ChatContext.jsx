import React, {
  createContext, useContext, useState, useMemo, useCallback, useEffect, useRef
} from 'react';
import { supabase } from '../supabaseClient';
import { nombreSimple } from '../lib/perfilUsuario';
import {
  CANAL_SOCIOS, MIEMBROS_SOCIOS, listarMensajes, enviarMensajeSocios,
  suscribirMensajes, leerMarcaLectura, marcarCanalLeido, puedeUsarChat,
  listarAvataresUsuarios, editarMensaje, eliminarMensaje, vaciarCanalSocios,
  puedeLimpiarChat
} from '../services/chatService';

/**
 * Estado compartido del chat corporativo "Socios".
 *
 * Hay UN solo canal y UNA sola fuente de datos: la tabla `mensajes` de
 * Supabase. El recuadro del Sidebar y la página de Chat consumen este mismo
 * contexto, así que lo que se escribe en uno se ve idéntico e instantáneo en
 * el otro. Realtime (`supabase.channel`) empuja los mensajes de los demás sin
 * recargar la página.
 *
 * `hayNoLeidos` alimenta el punto rojo de la campana del header: se enciende
 * cuando llega un mensaje ajeno posterior a la última lectura del usuario.
 */

const ChatContext = createContext(null);

export function ChatProvider({ children, user }) {
  const uid = user?.id || null;

  const [perfil, setPerfil] = useState(null);
  const [mensajes, setMensajes] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [leidoHasta, setLeidoHasta] = useState(null);
  // Directorio { usuarioId: avatar_url } para las burbujas que llegan por Realtime
  const [avatares, setAvatares] = useState({});

  // Se usa dentro de la suscripción sin reabrirla en cada cambio de lectura
  const leidoRef = useRef(null);
  useEffect(() => { leidoRef.current = leidoHasta; }, [leidoHasta]);

  const rol = perfil?.rol || null;
  const tieneAcceso = puedeUsarChat(rol);
  // Vaciar el historial completo es solo del Administrador (rol 'admin'),
  // el mismo candado que ya gobierna los checks de avance de los proyectos.
  const esAdmin = puedeLimpiarChat(rol);
  const nombreAutor = nombreSimple(user, perfil) || 'Socio MM Capital';

  // ── Ficha del usuario: rol (permiso), nombre del autor y foto de perfil.
  //    El avatar se trae en el mismo arranque de sesión, así que todas las
  //    vistas (chat, sidebar, header) lo tienen desde el primer render.
  useEffect(() => {
    let vivo = true;
    if (!uid) { setPerfil(null); setAvatares({}); return; }

    supabase
      .from('usuarios')
      .select('id, email, nombre_completo, rol, avatar_url')
      .eq('id', uid)
      .maybeSingle()
      .then(({ data }) => { if (vivo) setPerfil(data || null); });

    listarAvataresUsuarios().then(mapa => { if (vivo) setAvatares(mapa); });

    return () => { vivo = false; };
  }, [uid]);

  /** Foto de un usuario por id (null si no tiene o aún no cargó). */
  const avatarDe = useCallback(
    (usuarioId) => (usuarioId ? avatares[String(usuarioId)] || null : null),
    [avatares]
  );

  // ── Historial + marca de lectura ────────────────────────────────────────
  useEffect(() => {
    let vivo = true;
    if (!uid || !tieneAcceso) {
      setMensajes([]);
      setCargando(false);
      return;
    }

    setCargando(true);
    (async () => {
      const [{ mensajes: filas, error: errListado }, marca] = await Promise.all([
        listarMensajes(uid),
        leerMarcaLectura(uid)
      ]);
      if (!vivo) return;
      setMensajes(filas);
      setLeidoHasta(marca);
      setError(errListado);
      setCargando(false);
    })();

    return () => { vivo = false; };
  }, [uid, tieneAcceso]);

  // ── Tiempo real: una foto de perfil nueva se ve sin recargar ────────────
  useEffect(() => {
    if (!uid) return;
    const canal = supabase
      .channel('avatares-usuarios-mmcapital')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'usuarios' },
        () => { listarAvataresUsuarios().then(setAvatares); }
      )
      .subscribe();
    return () => { supabase.removeChannel(canal); };
  }, [uid]);

  // ── Tiempo real: los mensajes de los demás entran solos ─────────────────
  useEffect(() => {
    if (!uid || !tieneAcceso) return;

    return suscribirMensajes(
      uid,
      (nuevo) => {
        setMensajes(prev => (prev.some(m => m.id === nuevo.id) ? prev : [...prev, nuevo]));
      },
      {
        alEditar: (editado) => {
          setMensajes(prev => prev.map(m => (m.id === editado.id ? editado : m)));
        },
        alBorrar: (id) => {
          setMensajes(prev => prev.filter(m => String(m.id) !== String(id)));
        }
      }
    );
  }, [uid, tieneAcceso]);

  /**
   * Corrige un mensaje propio. La comprobación de autoría se hace aquí y otra
   * vez en la base (RLS): la interfaz puede equivocarse, la RLS no.
   */
  const editarMensajePropio = useCallback(async (id, texto) => {
    const limpio = String(texto || '').trim();
    if (!limpio || !uid) return false;

    const { mensaje, error: errEdicion } = await editarMensaje({ id, texto: limpio, uid });
    if (errEdicion) { setError(errEdicion); return false; }
    if (mensaje) {
      setError(null);
      setMensajes(prev => prev.map(m => (m.id === mensaje.id ? mensaje : m)));
    }
    return true;
  }, [uid]);

  /** Elimina un mensaje del canal: el propio, o cualquiera si modera un admin. */
  const eliminarMensajePropio = useCallback(async (id) => {
    if (!id || !uid) return false;

    const { success, error: errBorrado } = await eliminarMensaje({ id, uid, esAdmin });
    if (!success) { setError(errBorrado); return false; }

    setError(null);
    setMensajes(prev => prev.filter(m => String(m.id) !== String(id)));
    return true;
  }, [uid, esAdmin]);

  /**
   * Vacía el historial del canal General. Exclusivo del Administrador: aquí se
   * corta antes de tocar la red, y la RLS lo vuelve a exigir en la base.
   * Los mensajes directos no se ven afectados.
   */
  const limpiarHistorial = useCallback(async () => {
    if (!esAdmin) return false;

    const { success, error: errLimpieza } = await vaciarCanalSocios();
    if (!success) { setError(errLimpieza); return false; }

    setError(null);
    setMensajes([]);
    return true;
  }, [esAdmin]);

  /**
   * Envía un mensaje al canal. Se pinta al instante con la fila que devuelve
   * Supabase; si Realtime lo repite, el filtro por id evita el duplicado.
   * @returns {Promise<boolean>} false si el texto estaba vacío o hubo error
   */
  const enviarMensaje = useCallback(async (texto, adjunto = null) => {
    const limpio = String(texto || '').trim();
    // Con adjunto el texto puede ir vacío: se manda solo el archivo.
    if ((!limpio && !adjunto?.url) || !uid || !tieneAcceso) return false;

    const { mensaje, error: errEnvio } = await enviarMensajeSocios({
      texto: limpio, uid, autor: nombreAutor, adjunto
    });

    if (errEnvio) { setError(errEnvio); return false; }
    if (mensaje) {
      setError(null);
      setMensajes(prev => (prev.some(m => m.id === mensaje.id) ? prev : [...prev, mensaje]));
    }
    return true;
  }, [uid, tieneAcceso, nombreAutor]);

  /** Apaga el punto rojo: el usuario ya vio el canal. */
  const marcarLeido = useCallback(async () => {
    if (!uid || !tieneAcceso) return;
    /* `marcarCanalLeido` arroja si la base rechaza el upsert. Se atrapa aquí:
       la marca local NO se mueve —el punto rojo sigue encendido, que es la
       verdad— y el fallo no revienta como promesa sin capturar. */
    try {
      const ahora = await marcarCanalLeido(uid);
      if (ahora) setLeidoHasta(ahora);
    } catch (err) {
      console.error('No se pudo marcar el canal como leído:', err);
    }
  }, [uid, tieneAcceso]);

  // Hay novedades si el último mensaje ajeno es posterior a la última lectura
  const hayNoLeidos = useMemo(() => {
    if (!tieneAcceso) return false;
    const ajenos = mensajes.filter(m => !m.propio);
    if (ajenos.length === 0) return false;
    const ultimo = ajenos[ajenos.length - 1];
    if (!leidoHasta) return true;
    return new Date(ultimo.creadoEn).getTime() > new Date(leidoHasta).getTime();
  }, [mensajes, leidoHasta, tieneAcceso]);

  const noLeidos = useMemo(() => {
    if (!tieneAcceso || !hayNoLeidos) return 0;
    const corte = leidoHasta ? new Date(leidoHasta).getTime() : 0;
    return mensajes.filter(m => !m.propio && new Date(m.creadoEn).getTime() > corte).length;
  }, [mensajes, leidoHasta, tieneAcceso, hayNoLeidos]);

  const valor = useMemo(() => ({
    canal: CANAL_SOCIOS,
    miembros: MIEMBROS_SOCIOS,
    // El módulo de Chat los necesita para las conversaciones privadas
    uid,
    nombreAutor,
    // Foto del usuario en sesión y directorio del resto (avatares del chat)
    avatarUrl: perfil?.avatar_url || null,
    avatares,
    avatarDe,
    mensajes,
    cargando,
    error,
    tieneAcceso,
    esAdmin,
    rol,
    enviarMensaje,
    editarMensajePropio,
    eliminarMensajePropio,
    limpiarHistorial,
    marcarLeido,
    hayNoLeidos,
    noLeidos
  }), [uid, nombreAutor, perfil?.avatar_url, avatares, avatarDe, mensajes, cargando, error, tieneAcceso, esAdmin, rol, enviarMensaje, editarMensajePropio, eliminarMensajePropio, limpiarHistorial, marcarLeido, hayNoLeidos, noLeidos]);

  return <ChatContext.Provider value={valor}>{children}</ChatContext.Provider>;
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat debe usarse dentro de <ChatProvider>');
  return ctx;
}
