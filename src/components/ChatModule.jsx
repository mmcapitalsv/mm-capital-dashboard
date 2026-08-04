import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  AlertTriangle, ChevronLeft, Lock, MessageSquare, Paperclip, Send, User, Users
} from 'lucide-react';
import { usePrefs } from '../context/PreferenciasContext';
import { useChat } from '../context/ChatContext';
import { getUsuarios } from '../services/inversionesService';
import {
  listarMensajesDirectos, enviarMensajeDirecto, suscribirDirectos
} from '../services/chatService';

/**
 * Chat interno corporativo.
 *
 * Dos pestañas sobre la MISMA tabla `mensajes` de Supabase:
 *   · General  — canal 'socios' (receptor_id null), solo admin y socios.
 *   · Directos — conversación 1 a 1 mediante la columna `receptor_id`.
 * Todo llega por Realtime, así que esta vista y el recuadro del Sidebar
 * muestran exactamente lo mismo, al instante.
 */

export default function ChatModule({ onBack }) {
  const { t } = usePrefs();
  const {
    mensajes, enviarMensaje, marcarLeido, cargando, error, tieneAcceso, miembros,
    uid, nombreAutor, avatarDe
  } = useChat();

  const [pestana, setPestana] = useState('general');   // 'general' | 'directos'
  const [usuarios, setUsuarios] = useState([]);
  const [destinatario, setDestinatario] = useState(null);
  const [directos, setDirectos] = useState([]);
  const [cargandoDirectos, setCargandoDirectos] = useState(false);
  const [errorDirectos, setErrorDirectos] = useState(null);

  const [borrador, setBorrador] = useState('');
  const [enviando, setEnviando] = useState(false);
  const finRef = useRef(null);
  const composerRef = useRef(null);

  const enDirectos = pestana === 'directos';
  const conversacion = enDirectos ? directos : mensajes;
  const cargandoConv = enDirectos ? cargandoDirectos : cargando;
  const errorConv = enDirectos ? errorDirectos : error;

  const nombreDe = useCallback(
    (u) => u?.nombre_completo || u?.email || t('fb.sinNombre'),
    [t]
  );

  /**
   * Avatar circular reutilizable: foto real si la hay, inicial dorada si no.
   * El borde y el fondo son idénticos en ambos casos para que la lista no
   * "salte" mientras cargan las imágenes.
   */
  const Avatar = ({ url, nombre, className = 'w-10 h-10', tamanoTexto = 'text-[13px]' }) => (
    <span className={`${className} rounded-full bg-[#0B1B2C] border border-[#C5A059]/50 flex items-center justify-center flex-shrink-0 overflow-hidden`}>
      {url
        ? <img src={url} alt="" className="w-full h-full object-cover" />
        : (
          <span className={`${tamanoTexto} font-bold text-[#C5A059]`}>
            {String(nombre || '?').trim().charAt(0).toUpperCase()}
          </span>
        )}
    </span>
  );

  // Abrir el canal cuenta como leerlo: apaga el punto rojo de la campana
  useEffect(() => {
    if (tieneAcceso) marcarLeido();
  }, [tieneAcceso, mensajes.length, marcarLeido]);

  // ── Personas con las que se puede conversar en privado ──────────────────
  useEffect(() => {
    let vivo = true;
    getUsuarios().then(({ usuarios: lista }) => {
      if (!vivo) return;
      setUsuarios((lista || []).filter(u => u?.id && String(u.id) !== String(uid)));
    });
    return () => { vivo = false; };
  }, [uid]);

  // ── Historial privado con la persona elegida ────────────────────────────
  useEffect(() => {
    let vivo = true;
    if (!uid || !destinatario?.id) { setDirectos([]); return; }

    setCargandoDirectos(true);
    listarMensajesDirectos(uid, destinatario.id).then(({ mensajes: filas, error: err }) => {
      if (!vivo) return;
      setDirectos(filas);
      setErrorDirectos(err);
      setCargandoDirectos(false);
    });

    return () => { vivo = false; };
  }, [uid, destinatario?.id]);

  // ── Realtime de la conversación privada ─────────────────────────────────
  useEffect(() => {
    if (!uid || !destinatario?.id) return;
    return suscribirDirectos(uid, destinatario.id, (nuevo) => {
      setDirectos(prev => (prev.some(m => m.id === nuevo.id) ? prev : [...prev, nuevo]));
    });
  }, [uid, destinatario?.id]);

  // Mantener la vista al final al llegar mensajes
  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [conversacion.length, pestana, destinatario?.id]);

  const handleEnviar = async (e) => {
    e.preventDefault();
    if (!borrador.trim() || enviando) return;
    setEnviando(true);

    let ok = false;
    if (enDirectos) {
      const { mensaje, error: err } = await enviarMensajeDirecto({
        texto: borrador, uid, autor: nombreAutor, receptorId: destinatario?.id
      });
      if (err) setErrorDirectos(err);
      if (mensaje) {
        setErrorDirectos(null);
        setDirectos(prev => (prev.some(m => m.id === mensaje.id) ? prev : [...prev, mensaje]));
        ok = true;
      }
    } else {
      ok = await enviarMensaje(borrador);
    }

    setEnviando(false);
    if (ok) {
      setBorrador('');
      // El textarea crece con el texto: al vaciarlo vuelve a una sola línea
      if (composerRef.current) composerRef.current.style.height = 'auto';
    }
  };

  /* Pestañas General / Directos: las mismas dos en escritorio y en móvil. */
  const Pestanas = ({ className = '' }) => (
    <div className={`flex items-center gap-1 p-1 rounded-2xl bg-slate-100 dark:bg-zinc-900 ${className}`}>
      {[
        { id: 'general',  etiqueta: t('chat.pestanaGeneral'),  icono: Users },
        { id: 'directos', etiqueta: t('chat.pestanaDirectos'), icono: User },
      ].map(p => {
        const Icono = p.icono;
        const activa = pestana === p.id;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => setPestana(p.id)}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-bold transition-colors ${
              activa
                ? 'bg-white dark:bg-zinc-800 text-[#8B6914] dark:text-[#E3C77B] shadow-sm border border-[#C5A059]/30'
                : 'text-slate-500 dark:text-zinc-300 hover:text-slate-800 dark:hover:text-zinc-100'
            }`}
          >
            <Icono size={14} className={activa ? 'text-[#C5A059]' : ''} />
            {p.etiqueta}
          </button>
        );
      })}
    </div>
  );

  /* Lista de personas disponibles para conversar en privado. */
  const ListaUsuarios = ({ compacta = false }) => (
    <div className={compacta ? 'space-y-2' : 'space-y-1'}>
      {usuarios.length === 0 ? (
        <p className="text-[11px] text-slate-400 dark:text-zinc-300 px-3 py-2">{t('chat.sinUsuarios')}</p>
      ) : usuarios.map(u => {
        const activo = String(destinatario?.id) === String(u.id);
        return (
          <button
            key={u.id}
            type="button"
            onClick={() => setDestinatario(u)}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-colors ${
              activo
                ? 'bg-[#C5A059]/15 border border-[#C5A059]/30 text-[#8B6914] dark:text-[#E3C77B] font-bold'
                : 'hover:bg-slate-50 dark:hover:bg-zinc-700/50 text-slate-700 dark:text-zinc-200'
            }`}
          >
            <Avatar url={u.avatar_url || avatarDe(u.id)} nombre={nombreDe(u)} />
            <span className="text-[13px] flex-1 truncate">{nombreDe(u)}</span>
          </button>
        );
      })}
    </div>
  );

  // El General exige ser socio; una conversación privada la tiene cualquiera
  const bloqueado = !enDirectos && !tieneAcceso;
  const faltaDestinatario = enDirectos && !destinatario;

  return (
    /* `min-h-0` es lo que permite que el historial sea el ÚNICO que hace
       scroll y que el compositor quede siempre anclado abajo, a la vista. */
    <main className="flex-1 flex flex-col overflow-hidden min-h-0 bg-[#F5F6F8] dark:bg-zinc-900">

      {/* Cabecera: compacta en móvil para no robarle alto a la conversación */}
      <div className="flex items-center gap-3 px-4 md:px-8 py-3 md:py-5 border-b border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 flex-shrink-0">
        <button
          onClick={onBack}
          className="w-9 h-9 rounded-full border border-gray-200 dark:border-zinc-700 flex items-center justify-center text-slate-400 dark:text-zinc-200 hover:text-slate-700 dark:hover:text-white transition-all flex-shrink-0 active:scale-95"
        >
          <ChevronLeft size={18} />
        </button>
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 md:w-10 md:h-10 rounded-2xl bg-amber-100/80 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-500/30 flex items-center justify-center flex-shrink-0">
            <MessageSquare size={18} className="text-[#8B6914] dark:text-[#E3C77B]" />
          </div>
          <div className="min-w-0">
            <h2 className="text-[17px] md:text-xl font-bold text-slate-900 dark:text-white truncate">{t('chat.interno')}</h2>
            <p className="text-[11px] md:text-xs text-slate-500 dark:text-zinc-200 font-medium truncate">{t('chat.subtitulo')}</p>
          </div>
        </div>
      </div>

      <div className="flex-1 flex min-h-0">

        {/* ── Barra lateral: pestañas + canal o lista de personas ── */}
        {/* Ancho holgado (w-72): con avatares de 40 px el nombre completo entra
            sin truncarse en la lista de Mensajes Directos. */}
        <aside className="w-72 lg:w-80 hidden md:flex flex-col border-r border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 flex-shrink-0">
          <div className="p-2 border-b border-gray-100 dark:border-zinc-700">
            <Pestanas />
          </div>
          <nav className="flex-1 overflow-y-auto p-2 space-y-1">
            {enDirectos ? (
              <>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-zinc-300 px-2 py-1.5">
                  {t('chat.directos')}
                </p>
                <ListaUsuarios />
              </>
            ) : (
              <>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-zinc-300 px-2 py-1.5">
                  {t('chat.canales')}
                </p>

                <div className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-[#C5A059]/15 text-[#8B6914] dark:text-[#E3C77B] font-bold border border-[#C5A059]/30">
                  <Users size={15} className="text-[#C5A059]" />
                  <span className="text-[13px] flex-1 truncate">{t('chat.canalSocios')}</span>
                  <span className="text-[10px] text-slate-400 dark:text-zinc-300 font-semibold">{miembros}</span>
                </div>

                <p className="text-[10px] text-slate-400 dark:text-zinc-300 px-3 pt-3 leading-relaxed">
                  {t('chat.soloSocios')}
                </p>
              </>
            )}
          </nav>
        </aside>

        {/* ── Conversación ── */}
        <section className="flex-1 flex flex-col min-w-0">

          {/* En móvil no hay barra lateral: las pestañas van aquí */}
          <div className="md:hidden px-3 py-2 border-b border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 flex-shrink-0">
            <Pestanas />
          </div>

          <div className="px-4 md:px-5 py-2 md:py-3 border-b border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              {enDirectos
                ? <User size={15} className="text-[#C5A059] flex-shrink-0" />
                : <Users size={15} className="text-[#C5A059] flex-shrink-0" />}
              <span className="text-[14px] font-bold text-slate-900 dark:text-white truncate">
                {enDirectos
                  ? (destinatario ? nombreDe(destinatario) : t('chat.directos'))
                  : t('chat.canalSocios')}
              </span>
            </div>
            {!enDirectos && (
              <span className="text-[11px] text-slate-400 dark:text-zinc-300 font-semibold flex items-center gap-1.5 flex-shrink-0">
                <Users size={12} /> {miembros} {t('chat.miembros')}
              </span>
            )}
          </div>

          {bloqueado ? (
            /* Acceso restringido: el canal General es solo de admin y socios */
            <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
              <Lock size={30} className="text-slate-300 dark:text-zinc-600 mb-3" />
              <p className="text-sm font-bold text-slate-600 dark:text-zinc-300">{t('chat.sinAcceso')}</p>
              <p className="text-xs text-slate-400 dark:text-zinc-300 mt-1 max-w-sm">{t('chat.sinAccesoDetalle')}</p>
            </div>
          ) : faltaDestinatario ? (
            /* Sin persona elegida: en móvil esta es la única lista visible */
            <div className="flex-1 overflow-y-auto px-4 py-5 min-h-0">
              <p className="text-[13px] font-bold text-slate-600 dark:text-zinc-200 mb-3">{t('chat.eligeUsuario')}</p>
              <ListaUsuarios compacta />
            </div>
          ) : (
            <>
              {/* Historial: el ÚNICO elemento con scroll. Burbujas grandes y
                  redondeadas, con aire entre ellas, al estilo iMessage. */}
              <div className="flex-1 overflow-y-auto px-4 md:px-5 py-4 md:py-5 space-y-3 min-h-0">
                {cargandoConv ? (
                  <p className="text-[13px] text-slate-400 dark:text-zinc-300 text-center py-6">{t('comun.cargando')}</p>
                ) : conversacion.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center">
                    <MessageSquare size={30} className="text-slate-300 dark:text-zinc-600 mb-2" />
                    <p className="text-[15px] font-bold text-slate-500 dark:text-zinc-200">
                      {enDirectos ? t('chat.sinMensajesDirectos') : t('chat.sinMensajes')}
                    </p>
                  </div>
                ) : conversacion.map(m => (
                  <div key={m.id} className={`flex items-end gap-2 ${m.propio ? 'justify-end' : 'justify-start'}`}>
                    {/* Avatar del autor: grande y legible en la vista principal
                        del Chat (el recuadro del Dashboard conserva el suyo). */}
                    {!m.propio && (
                      <Avatar
                        url={m.avatarUrl || avatarDe(m.usuarioId)}
                        nombre={m.autor}
                        className="w-11 h-11 mb-1"
                        tamanoTexto="text-[15px]"
                      />
                    )}
                    <div className={`max-w-[78%] px-4 py-2.5 shadow-sm ${
                      m.propio
                        ? 'bg-[#0B1B2C] text-white rounded-[20px] rounded-br-md'
                        : 'bg-white dark:bg-zinc-800 border border-gray-100 dark:border-zinc-700 text-slate-800 dark:text-zinc-100 rounded-[20px] rounded-bl-md'
                    }`}>
                      {!m.propio && (
                        <p className="text-[12px] font-bold text-[#C5A059] mb-0.5">{m.autor}</p>
                      )}
                      <p className="text-[15px] leading-[1.45] break-words">{m.texto}</p>
                      <p className={`text-[11px] mt-1 ${m.propio ? 'text-white/50' : 'text-slate-400 dark:text-zinc-300'}`}>
                        {m.hora}
                      </p>
                    </div>
                  </div>
                ))}
                <div ref={finRef} />
              </div>

              {errorConv && (
                <div className="mx-4 mb-2 flex items-start gap-2 rounded-xl border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 px-3 py-2 flex-shrink-0">
                  <AlertTriangle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-[12px] text-red-600 dark:text-red-300 leading-relaxed">{errorConv}</p>
                </div>
              )}

              {/* Compositor tipo iMessage: SIEMPRE anclado abajo (flex-shrink-0
                  fuera de la zona de scroll), nunca hay que desplazarse para
                  escribir. El input va a 16px: por debajo de eso iOS hace zoom
                  automático al enfocarlo. */}
              <form
                onSubmit={handleEnviar}
                className="px-3 py-2.5 md:p-4 border-t border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 flex items-end gap-2 flex-shrink-0"
              >
                <button
                  type="button"
                  title={t('nav.adjuntar')}
                  className="w-10 h-10 flex items-center justify-center text-slate-400 dark:text-zinc-300 hover:text-[#C5A059] rounded-full hover:bg-slate-50 dark:hover:bg-zinc-700 transition-colors flex-shrink-0 active:scale-90"
                >
                  <Paperclip size={19} />
                </button>

                {/* Textarea, no input: Enter inserta un salto de línea y el
                    mensaje se envía ÚNICAMENTE con el botón de la derecha.
                    El alto crece con el texto hasta un tope y luego hace scroll. */}
                <textarea
                  ref={composerRef}
                  rows={1}
                  value={borrador}
                  onChange={(e) => setBorrador(e.target.value)}
                  onFocus={() => finRef.current?.scrollIntoView({ block: 'end' })}
                  onInput={(e) => {
                    e.target.style.height = 'auto';
                    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
                  }}
                  placeholder={t('chat.escribeMensaje')}
                  enterKeyHint="enter"
                  autoComplete="off"
                  className="flex-1 min-w-0 resize-none bg-slate-100 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-3xl px-4 py-3 text-[16px] leading-snug text-slate-800 dark:text-zinc-100 placeholder-slate-400 dark:placeholder-zinc-400 focus:outline-none focus:border-[#C5A059] max-h-[120px]"
                />

                <button
                  type="submit"
                  disabled={!borrador.trim() || enviando}
                  title={t('comun.enviar')}
                  className="w-11 h-11 flex items-center justify-center bg-[#C5A059] text-white rounded-full shadow-sm hover:bg-[#b08f4a] transition-all disabled:opacity-30 disabled:hover:bg-[#C5A059] flex-shrink-0 active:scale-90"
                >
                  <Send size={18} />
                </button>
              </form>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
