import React, { useState, useEffect, useRef } from 'react';
import { usePrefs } from '../context/PreferenciasContext';
import { conversarConIA, confirmarPropuesta, hayClaveGemini } from '../services/geminiService';
import {
  AlertTriangle, Check, ChevronLeft, Copy, Loader2, Paperclip, Send, ShieldAlert,
  Sparkles, Trash2, X
} from 'lucide-react';

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

  return (
    <div className="mt-3 rounded-xl border border-amber-300 dark:border-amber-500/40 bg-amber-50/70 dark:bg-amber-500/10 p-3">
      <div className="flex items-center gap-2 text-xs font-bold text-amber-700 dark:text-amber-300">
        <ShieldAlert size={14} />
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
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-mm-navy text-white text-xs font-bold hover:bg-slate-800 transition-colors disabled:opacity-50"
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
  const finIARef = useRef(null);
  const copiaTimerRef = useRef(null);

  useEffect(() => () => clearTimeout(copiaTimerRef.current), []);

  // Persiste el historial en cada cambio
  useEffect(() => {
    try {
      localStorage.setItem(CLAVE_HISTORIAL, JSON.stringify(messages));
    } catch { /* cuota llena o modo privado: el chat sigue funcionando en memoria */ }
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

  const agregarAdjuntos = (lista) => {
    const nuevos = Array.from(lista || []);
    if (nuevos.length === 0) return;
    setAdjuntos(prev => [...prev, ...nuevos]);
    setErrorIA(null);
  };

  const quitarAdjunto = (idx) => setAdjuntos(prev => prev.filter((_, i) => i !== idx));

  const handleSend = async (e) => {
    e.preventDefault();
    if (pensando) return;
    if (!inputMsg.trim() && adjuntos.length === 0) return;

    const texto = inputMsg;
    const archivos = adjuntos;
    const historial = messages.map(m => ({
      sender: m.sender,
      text: m.clave ? t(m.clave) : m.text
    }));

    setMessages(prev => [...prev, {
      sender: 'user',
      text: texto,
      adjuntos: archivos.map(f => f.name)
    }]);
    setInputMsg('');
    setAdjuntos([]);
    if (clipRef.current) clipRef.current.value = '';
    setPensando(true);
    setErrorIA(null);

    const { texto: respuesta, propuestas, error } = await conversarConIA({ texto, archivos, historial });
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
              {m.sender === 'ai' && (
                <button
                  type="button"
                  onClick={() => copiarMensaje(textoMsg, idx)}
                  title={t('comun.copiar')}
                  className="absolute top-2.5 right-2.5 flex items-center gap-1 rounded-lg px-1.5 py-1 text-[10px] font-semibold text-slate-400 dark:text-zinc-400 hover:text-slate-700 dark:hover:text-zinc-100 hover:bg-slate-100 dark:hover:bg-zinc-700 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-all active:scale-95"
                >
                  {copiadoIdx === idx
                    ? <><Check size={12} className="text-emerald-500" /> {t('comun.copiado')}</>
                    : <Copy size={12} />}
                </button>
              )}
              {/* `clave` = texto de la app (se traduce); `text` = lo que
                  escribió el usuario (se muestra tal cual) */}
              <p className="whitespace-pre-wrap break-words">{textoMsg}</p>
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
              {/* Nombres de los archivos que acompañaron al mensaje */}
              {Array.isArray(m.adjuntos) && m.adjuntos.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {m.adjuntos.map((nombre, i) => (
                    <span key={i} className="flex items-center gap-1 text-[11px] font-semibold bg-white/15 px-2 py-0.5 rounded-full">
                      <Paperclip size={10} /> {nombre}
                    </span>
                  ))}
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

          {adjuntos.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {adjuntos.map((f, i) => (
                <span key={`${f.name}-${i}`} className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 dark:text-zinc-200 bg-slate-100 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 pl-2.5 pr-1.5 py-1 rounded-full">
                  <Paperclip size={11} className="text-mm-3" />
                  <span className="max-w-[180px] truncate">{f.name}</span>
                  <button
                    type="button"
                    onClick={() => quitarAdjunto(i)}
                    className="w-4 h-4 flex items-center justify-center rounded-full text-slate-400 hover:text-red-500"
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
          )}

          <form onSubmit={handleSend} className="flex gap-3">
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
              className="w-12 flex items-center justify-center rounded-xl border border-gray-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 text-slate-400 dark:text-zinc-300 hover:text-mm-oro hover:border-mm-oro/40 transition-colors flex-shrink-0 active:scale-95"
            >
              <Paperclip size={18} />
            </button>

            <input
              type="text"
              value={inputMsg}
              onChange={(e) => setInputMsg(e.target.value)}
              placeholder={t('ia.placeholder')}
              className="flex-1 min-w-0 bg-slate-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-3 text-sm text-gray-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-zinc-500 caret-mm-oro focus:outline-none focus:border-slate-400 dark:focus:border-mm-oro/50 focus:bg-white dark:focus:bg-zinc-900 transition-colors"
            />
            <button
              type="submit"
              disabled={pensando || (!inputMsg.trim() && adjuntos.length === 0)}
              className="bg-mm-navy text-white px-6 py-3 rounded-xl font-bold text-sm hover:bg-slate-800 transition-colors flex items-center gap-2 disabled:opacity-40 flex-shrink-0"
            >
              {pensando
                ? <Loader2 size={14} className="animate-spin text-mm-3" />
                : <>{t('comun.enviar')} <Send size={14} /></>}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}

export default AIChatView;
