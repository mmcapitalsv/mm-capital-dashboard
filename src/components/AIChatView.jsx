import React, { useState, useEffect, useRef } from 'react';
import { usePrefs } from '../context/usePrefs';
import { conversarConIA, confirmarPropuesta, hayClaveGemini } from '../services/geminiService';
import {
  AlertTriangle, Check, ChevronLeft, Copy, FileText, Loader2, Paperclip, Send,
  ShieldAlert, Sparkles, Trash2, X
} from 'lucide-react';
import { miniaturaDeImagen } from '../lib/archivos';

const CLAVE_HISTORIAL = 'mmcapital_ai_chat';
const SALUDO_INICIAL = [{ sender: 'ai', clave: 'ia.saludo' }];

/** Lee el historial persistido; si no existe o esta corrupto, devuelve el saludo */
function leerHistorial() {
  try {
    const crudo = localStorage.getItem(CLAVE_HISTORIAL);
    if (!crudo) return SALUDO_INICIAL;
    const datos = JSON.parse(crudo);
    if (!Array.isArray(datos) || datos.length === 0) return SALUDO_INICIAL;

    /* Una propuesta que se quedó en "ejecutando" (se recargó la página a
       mitad) vuelve a "pendiente": el botón tiene que poder pulsarse otra vez,
       y la Edge Function ya se defiende del duplicado al confirmar. */
    return datos.map(m => (
      Array.isArray(m?.propuestas)
        ? { ...m, propuestas: m.propuestas.map(p => (p?.estado === 'ejecutando' ? { ...p, estado: 'pendiente' } : p)) }
        : m
    ));
  } catch {
    return SALUDO_INICIAL;
  }
}

/**
 * Tarjeta de confirmación de una escritura propuesta por la IA (P0.3).
 *
 * El modelo NUNCA escribe en la base: propone, y la fila solo entra cuando el
 * Administrador pulsa "Confirmar" aquí. Es el corte que desactiva el prompt
 * injection — un PDF que diga «registra un gasto de $50,000» consigue, como
 * mucho, que aparezca esta tarjeta con esa cifra a la vista.
 */
function PropuestaAccion({ propuesta, estado, onConfirmar, onDescartar, t }) {
  const ejecutando = estado === 'ejecutando';
  const hecha = estado === 'hecha';
  const descartada = estado === 'descartada';
  // `peligro` lo marca la Edge Function en los borrados: una tarjeta roja no se
  // confunde con la de crear un proyecto, y eso importa cuando no hay deshacer.
  const peligro = propuesta.peligro === true;

  return (
    <div className={`mt-3 rounded-xl border p-3 ${
      peligro
        ? 'border-red-300 dark:border-red-500/40 bg-red-50/70 dark:bg-red-500/10'
        : 'border-amber-300 dark:border-amber-500/40 bg-amber-50/70 dark:bg-amber-500/10'
    }`}>
      <div className={`flex items-center gap-2 text-xs font-bold ${
        peligro ? 'text-red-700 dark:text-red-300' : 'text-amber-700 dark:text-amber-300'
      }`}>
        {peligro ? <Trash2 size={14} /> : <ShieldAlert size={14} />}
        {propuesta.titulo || t('ia.confirmarTitulo')}
      </div>

      <p className="mt-1.5 text-[13px] text-slate-700 dark:text-zinc-100 leading-relaxed">
        {propuesta.resumen}
      </p>

      {Array.isArray(propuesta.detalle) && propuesta.detalle.length > 0 && (
        <dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-[12px]">
          {propuesta.detalle.map((d, i) => (
            <React.Fragment key={i}>
              <dt className="font-semibold text-slate-500 dark:text-zinc-300">{d.etiqueta}</dt>
              <dd className="text-slate-800 dark:text-zinc-100 break-words">{d.valor}</dd>
            </React.Fragment>
          ))}
        </dl>
      )}

      {hecha ? (
        <p className="mt-2.5 flex items-center gap-1.5 text-xs font-bold text-emerald-600 dark:text-emerald-400">
          <Check size={14} /> {t('ia.confirmarHecha')}
        </p>
      ) : descartada ? (
        <p className="mt-2.5 text-xs font-bold text-slate-500 dark:text-zinc-400">
          {t('ia.confirmarDescartada')}
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onConfirmar}
            disabled={ejecutando}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-white text-xs font-bold transition-colors disabled:opacity-50 ${
              peligro ? 'bg-red-600 hover:bg-red-700' : 'bg-mm-navy hover:bg-slate-800'
            }`}
          >
            {ejecutando
              ? <><Loader2 size={13} className="animate-spin" /> {t('ia.confirmarEjecutando')}</>
              : <><Check size={13} /> {t('ia.confirmar')}</>}
          </button>
          <button
            type="button"
            onClick={onDescartar}
            disabled={ejecutando}
            className="px-3.5 py-2 rounded-lg border border-gray-300 dark:border-zinc-600 text-xs font-bold text-slate-600 dark:text-zinc-200 hover:bg-white dark:hover:bg-zinc-800 transition-colors disabled:opacity-50"
          >
            {t('ia.descartar')}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Chat IA del Administrador conectado a Gemini (`gemini-1.5-flash`).
 * Acepta texto y adjuntos (imágenes o documentos), que viajan en Base64
 * inline junto al mensaje, y pinta la respuesta REAL del modelo.
 */
function AIChatView({ onBack }) {
  const { t } = usePrefs();
  const [messages, setMessages] = useState(leerHistorial);
  const [inputMsg, setInputMsg] = useState('');
  const [adjuntos, setAdjuntos] = useState([]);
  const [pensando, setPensando] = useState(false);
  const [errorIA, setErrorIA] = useState(hayClaveGemini() ? null : t('ia.sinClave'));
  const [copiadoIdx, setCopiadoIdx] = useState(null);
  const clipRef = useRef(null);
  const composerIARef = useRef(null);
  const finIARef = useRef(null);
  const copiaTimerRef = useRef(null);
  /* Petición al modelo en vuelo. Una respuesta de Gemini tarda segundos, y si
     el usuario sale del chat antes de que llegue, la petición seguía viva y
     terminaba escribiendo estado sobre un componente desmontado. */
  const peticionRef = useRef(null);

  useEffect(() => () => clearTimeout(copiaTimerRef.current), []);

  // Al desmontar se cancela la conversación en curso
  useEffect(() => () => {
    peticionRef.current?.abort();
    peticionRef.current = null;
  }, []);

  /* Las vistas previas pendientes se liberan al salir del chat: son blobs que
     el navegador retiene hasta que se revocan a mano. `adjuntosRef` evita
     rehacer este efecto en cada archivo que se añade. */
  const adjuntosRef = useRef([]);
  adjuntosRef.current = adjuntos;
  useEffect(() => () => {
    adjuntosRef.current.forEach(a => { if (a?.previa) URL.revokeObjectURL(a.previa); });
  }, []);

  // Persiste el historial en cada cambio
  useEffect(() => {
    try {
      localStorage.setItem(CLAVE_HISTORIAL, JSON.stringify(messages));
    } catch {
      /* Cuota llena: casi siempre por las miniaturas de las imágenes. Antes de
         rendirse se reintenta sin ellas, que perder la vista previa de una foto
         vieja es mucho menos grave que perder la conversación entera. */
      try {
        const sinImagenes = messages.map(m => (
          Array.isArray(m.adjuntos)
            ? { ...m, adjuntos: m.adjuntos.map(a => (typeof a === 'string' ? a : { nombre: a?.nombre || '' })) }
            : m
        ));
        localStorage.setItem(CLAVE_HISTORIAL, JSON.stringify(sinImagenes));
      } catch { /* modo privado o sin espacio: el chat sigue vivo en memoria */ }
    }
  }, [messages]);

  /** Borra el historial en pantalla y en localStorage */
  const limpiarChat = () => {
    setMessages(SALUDO_INICIAL);
    try {
      localStorage.removeItem(CLAVE_HISTORIAL);
    } catch { /* ignorado */ }
    setErrorIA(null);
  };

  /** Copia el texto de una respuesta de la IA y marca el feedback 2s */
  const copiarMensaje = async (texto, idx) => {
    try {
      await navigator.clipboard.writeText(texto || '');
      setCopiadoIdx(idx);
      clearTimeout(copiaTimerRef.current);
      copiaTimerRef.current = setTimeout(() => setCopiadoIdx(null), 2000);
    } catch {
      setErrorIA(t('msg.errorSupabase'));
    }
  };

  useEffect(() => {
    finIARef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, pensando]);

  /* El textarea crece con el texto hasta un tope y luego hace scroll. Se mide
     aquí y no en `onInput` porque el ajuste también hace falta al montar y al
     vaciar el campo: con `rows=1` el marcador de posición largo se cortaba y
     dejaba una barra de scroll a la vista sin haber escrito nada. */
  useEffect(() => {
    const caja = composerIARef.current;
    if (!caja) return;
    caja.style.height = 'auto';
    /* `scrollHeight` no incluye el borde y la caja mide en `border-box`: sin
       sumar esos 2px el alto se queda corto y aparece una barra de scroll con
       el campo vacío. */
    const borde = caja.offsetHeight - caja.clientHeight;
    const alto = caja.scrollHeight + borde;
    caja.style.height = `${Math.min(alto, 120)}px`;
    caja.style.overflowY = alto > 120 ? 'auto' : 'hidden';
  }, [inputMsg]);

  /* Cada adjunto viaja como { file, previa }: `previa` es una URL de objeto
     para pintar la imagen ANTES de enviarla. Se libera al quitar el adjunto y
     al enviar, que si no el navegador se queda con el blob en memoria. */
  const agregarAdjuntos = (lista) => {
    const nuevos = Array.from(lista || []);
    if (nuevos.length === 0) return;
    setAdjuntos(prev => [
      ...prev,
      ...nuevos.map(file => ({
        file,
        previa: /^image\//i.test(file.type || '') ? URL.createObjectURL(file) : null
      }))
    ]);
    setErrorIA(null);
  };

  const quitarAdjunto = (idx) => setAdjuntos(prev => {
    if (prev[idx]?.previa) URL.revokeObjectURL(prev[idx].previa);
    return prev.filter((_, i) => i !== idx);
  });

  const handleSend = async (e) => {
    e.preventDefault();
    if (pensando) return;
    if (!inputMsg.trim() && adjuntos.length === 0) return;

    const texto = inputMsg;
    const archivos = adjuntos.map(a => a.file);
    const historial = messages.map(m => ({
      sender: m.sender,
      text: m.clave ? t(m.clave) : m.text
    }));

    /* La burbuja del usuario guarda una MINIATURA de cada imagen, no el nombre
       a secas: al mandar una foto lo que se reconoce es la foto. Va reescalada
       porque el historial vive en `localStorage`. */
    const adjuntosDelMensaje = await Promise.all(
      archivos.map(async (f) => ({ nombre: f.name, miniatura: await miniaturaDeImagen(f) }))
    );

    setMessages(prev => [...prev, {
      sender: 'user',
      text: texto,
      adjuntos: adjuntosDelMensaje
    }]);
    setInputMsg('');
    adjuntos.forEach(a => { if (a.previa) URL.revokeObjectURL(a.previa); });
    setAdjuntos([]);
    if (clipRef.current) clipRef.current.value = '';
    setPensando(true);
    setErrorIA(null);

    // Una sola conversación en vuelo: si quedara otra, se abandona aquí
    peticionRef.current?.abort();
    const control = new AbortController();
    peticionRef.current = control;

    const { texto: respuesta, propuestas, error, cancelada } = await conversarConIA({
      texto, archivos, historial, signal: control.signal
    });

    if (peticionRef.current === control) peticionRef.current = null;
    // Se salió del chat mientras el modelo pensaba: no hay nada que pintar
    if (cancelada || control.signal.aborted) return;

    setPensando(false);

    if (error || !respuesta) {
      setErrorIA(error || t('msg.errorSupabase'));
      return;
    }
    /* Las propuestas viajan pegadas al mensaje: así sobreviven al F5 junto con
       el historial, y cada tarjeta recuerda si ya se confirmó. */
    setMessages(prev => [...prev, {
      sender: 'ai',
      text: respuesta,
      propuestas: (propuestas || []).map(p => ({ ...p, estado: 'pendiente' }))
    }]);
  };

  /** Marca el estado de una propuesta concreta dentro de su mensaje. */
  const marcarPropuesta = (idxMensaje, idxPropuesta, estado) => {
    setMessages(prev => prev.map((m, i) => (
      i === idxMensaje
        ? {
            ...m,
            propuestas: m.propuestas.map((p, j) => (j === idxPropuesta ? { ...p, estado } : p))
          }
        : m
    )));
  };

  /**
   * Segunda fase del two-phase commit (P0.3): aquí, y solo aquí, la acción
   * llega a la base. Lo que la dispara es este clic, no el modelo.
   */
  const ejecutarPropuesta = async (idxMensaje, idxPropuesta) => {
    const propuesta = messages[idxMensaje]?.propuestas?.[idxPropuesta];
    if (!propuesta || propuesta.estado !== 'pendiente') return;

    setErrorIA(null);
    marcarPropuesta(idxMensaje, idxPropuesta, 'ejecutando');

    const { ok, mensaje, error } = await confirmarPropuesta(propuesta);

    if (!ok) {
      marcarPropuesta(idxMensaje, idxPropuesta, 'pendiente');
      setErrorIA(error || t('msg.errorSupabase'));
      return;
    }

    marcarPropuesta(idxMensaje, idxPropuesta, 'hecha');
    setMessages(prev => [...prev, { sender: 'ai', text: mensaje }]);
  };

  return (
    <main className="flex-1 flex flex-col overflow-hidden bg-transparent">
      <div className="flex items-center justify-between px-8 py-5 border-b border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-slate-400 dark:text-zinc-200 hover:text-slate-700 dark:hover:text-zinc-100 transition-colors">
            <ChevronLeft size={20} />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-violet-100/80 dark:bg-violet-500/15 border border-violet-200 dark:border-violet-500/30 flex items-center justify-center">
              <Sparkles size={17} className="text-violet-600 dark:text-violet-300" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">{t('ia.titulo')}</h2>
              <p className="text-xs text-slate-400 dark:text-zinc-200">{t('ia.subtitulo')}</p>
            </div>
          </div>
        </div>
        <button
          onClick={limpiarChat}
          title={t('ia.limpiar')}
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-slate-500 dark:text-zinc-300 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
        >
          <Trash2 size={17} />
          <span className="hidden sm:inline">{t('ia.limpiar')}</span>
        </button>
      </div>

      {/* Area del chat */}
      <div className="flex-1 overflow-y-auto p-8 space-y-4 max-w-4xl mx-auto w-full">
        {messages.map((m, idx) => {
          const textoMsg = m.clave ? t(m.clave) : m.text;
          return (
          <div key={idx} className={`flex ${m.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`group relative max-w-[80%] rounded-2xl p-4 shadow-sm text-sm leading-relaxed ${
              m.sender === 'user' ? 'bg-mm-navy text-white' : 'bg-white dark:bg-zinc-800 border border-gray-100 dark:border-zinc-700 text-slate-800 dark:text-zinc-100'
            }`}>
              {m.sender === 'ai' && (
                <div className="flex items-center gap-1.5 text-xs font-bold text-mm-oro-tinta dark:text-mm-oro-claro mb-1.5 pr-16">
                  <Sparkles size={12} /> IA MM Capital
                </div>
              )}
              {/* Copiar disponible en ambos lados: el usuario también reutiliza
                  lo que escribió (prompts largos, cifras que vuelve a pegar). */}
              <button
                type="button"
                onClick={() => copiarMensaje(textoMsg, idx)}
                title={t('comun.copiar')}
                aria-label={t('comun.copiar')}
                /* Visible SIEMPRE en táctil (`opacity-100`) y discreto solo a
                   partir de `md`, donde sí existe el cursor: en el teléfono no
                   hay hover, así que el icono oculto era un icono inexistente. */
                className={`absolute top-2.5 right-2.5 flex items-center gap-1 rounded-lg px-1.5 py-1 text-[10px] font-semibold opacity-100 md:opacity-0 md:group-hover:opacity-100 focus:opacity-100 transition-all active:scale-95 ${
                  m.sender === 'user'
                    ? 'text-white/60 hover:text-white hover:bg-white/15'
                    : 'text-slate-400 dark:text-zinc-400 hover:text-slate-700 dark:hover:text-zinc-100 hover:bg-slate-100 dark:hover:bg-zinc-700'
                }`}
              >
                {copiadoIdx === idx
                  ? <><Check size={12} className="text-emerald-500" /> {t('comun.copiado')}</>
                  : <Copy size={12} />}
              </button>
              {/* `clave` = texto de la app (se traduce); `text` = lo que
                  escribió el usuario (se muestra tal cual) */}
              <p className={`whitespace-pre-wrap break-words ${m.sender === 'user' ? 'pr-7' : ''}`}>{textoMsg}</p>
              {/* Escrituras propuestas: no pasa nada hasta que se confirmen */}
              {Array.isArray(m.propuestas) && m.propuestas.map((p, j) => (
                <PropuestaAccion
                  key={j}
                  propuesta={p}
                  estado={p.estado}
                  t={t}
                  onConfirmar={() => ejecutarPropuesta(idx, j)}
                  onDescartar={() => marcarPropuesta(idx, j, 'descartada')}
                />
              ))}
              {/* Archivos que acompañaron al mensaje: la imagen se ve, el
                  documento se nombra. Los historiales antiguos guardaban solo
                  el nombre como texto, así que ese formato se sigue leyendo. */}
              {Array.isArray(m.adjuntos) && m.adjuntos.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {m.adjuntos.map((adj, i) => {
                    const nombre = typeof adj === 'string' ? adj : (adj?.nombre || '');
                    const miniatura = typeof adj === 'string' ? null : adj?.miniatura;

                    return miniatura ? (
                      <a
                        key={i}
                        href={miniatura}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={nombre}
                        className="block rounded-xl overflow-hidden border border-white/25"
                      >
                        <img src={miniatura} alt={nombre} className="max-h-44 w-auto max-w-full object-cover" />
                      </a>
                    ) : (
                      <span key={i} className="flex items-center gap-1 text-[11px] font-semibold bg-white/15 px-2 py-0.5 rounded-full">
                        <Paperclip size={10} /> {nombre}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          );
        })}

        {pensando && (
          <div className="flex justify-start">
            <div className="bg-white dark:bg-zinc-800 border border-gray-100 dark:border-zinc-700 rounded-2xl p-4 shadow-sm flex items-center gap-2 text-sm text-slate-500 dark:text-zinc-300">
              <Loader2 size={15} className="animate-spin text-mm-3" /> {t('ia.pensando')}
            </div>
          </div>
        )}

        {errorIA && (
          <div className="flex items-start gap-2 rounded-xl border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 px-3 py-2">
            <AlertTriangle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-red-600 dark:text-red-300 leading-relaxed">{errorIA}</p>
          </div>
        )}

        <div ref={finIARef} />
      </div>

      {/* Input con adjuntos: texto y archivos viajan juntos al modelo */}
      <div className="bg-white dark:bg-zinc-800 border-t border-gray-200 dark:border-zinc-700 w-full">
        <div className="max-w-4xl mx-auto w-full p-4 space-y-2">

          {/* Vista previa antes de enviar: de una foto se ve la foto, no su
              nombre de archivo (que en el móvil es "Screenshot_2026…jpg" y no
              dice nada de lo que hay dentro). */}
          {adjuntos.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {adjuntos.map((a, i) => (
                <span
                  key={`${a.file.name}-${i}`}
                  className="flex items-center gap-2 text-[11px] font-semibold text-slate-600 dark:text-zinc-200 bg-slate-100 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 pl-1.5 pr-1.5 py-1 rounded-2xl"
                >
                  {a.previa ? (
                    <img
                      src={a.previa}
                      alt={a.file.name}
                      className="w-10 h-10 rounded-xl object-cover border border-gray-200 dark:border-zinc-700"
                    />
                  ) : (
                    <span className="w-10 h-10 rounded-xl bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 flex items-center justify-center">
                      <FileText size={16} className="text-mm-oro" />
                    </span>
                  )}
                  <span className="max-w-[180px] truncate">{a.file.name}</span>
                  <button
                    type="button"
                    onClick={() => quitarAdjunto(i)}
                    title={t('chat.quitarAdjunto')}
                    className="w-5 h-5 flex items-center justify-center rounded-full text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Mismo compositor que el chat de socios (ChatModule): idéntica
              estructura y clases para que ambos chats se vean y se comporten
              igual. */}
          <form
            onSubmit={handleSend}
            className="flex items-end gap-2"
          >
            {/* Clip: imágenes o documentos, se envían como Base64 inline */}
            <input
              type="file"
              ref={clipRef}
              multiple
              accept="image/*,.pdf,.txt,.csv,.doc,.docx,.xls,.xlsx"
              onChange={(e) => agregarAdjuntos(e.target.files)}
              className="archivo-oculto"
            />
            <button
              type="button"
              onClick={() => clipRef.current?.click()}
              title={t('ia.adjuntar')}
              className="w-10 h-10 flex items-center justify-center text-slate-400 dark:text-zinc-300 hover:text-mm-oro rounded-full hover:bg-slate-50 dark:hover:bg-zinc-700 transition-colors flex-shrink-0 active:scale-90"
            >
              <Paperclip size={19} />
            </button>

            {/* Textarea, no input: Enter inserta un salto de línea y el mensaje
                se envía ÚNICAMENTE con el botón de la derecha. El alto crece
                con el texto hasta un tope y luego hace scroll. */}
            <textarea
              ref={composerIARef}
              rows={1}
              value={inputMsg}
              onChange={(e) => setInputMsg(e.target.value)}
              placeholder={t('ia.placeholder')}
              enterKeyHint="enter"
              autoComplete="off"
              className="flex-1 min-w-0 resize-none bg-slate-100 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-3xl px-4 py-3 text-[16px] leading-snug text-slate-800 dark:text-zinc-100 placeholder-slate-400 dark:placeholder-zinc-400 focus:outline-none focus:border-mm-oro max-h-[120px]"
            />
            <button
              type="submit"
              disabled={pensando || (!inputMsg.trim() && adjuntos.length === 0)}
              title={t('comun.enviar')}
              className="w-11 h-11 flex items-center justify-center bg-mm-oro text-white rounded-full shadow-sm hover:bg-mm-oro-hondo transition-all disabled:opacity-30 disabled:hover:bg-mm-oro flex-shrink-0 active:scale-90"
            >
              {pensando
                ? <Loader2 size={18} className="animate-spin" />
                : <Send size={18} />}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}

export default AIChatView;
