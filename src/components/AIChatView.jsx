import React, { useState, useEffect, useRef } from 'react';
import { usePrefs } from '../context/PreferenciasContext';
import { conversarConIA, hayClaveGemini } from '../services/geminiService';
import {
  AlertTriangle, ChevronLeft, Loader2, Paperclip, Send, Sparkles, X
} from 'lucide-react';

/**
 * Chat IA del Administrador conectado a Gemini (`gemini-1.5-flash`).
 * Acepta texto y adjuntos (imágenes o documentos), que viajan en Base64
 * inline junto al mensaje, y pinta la respuesta REAL del modelo.
 */
function AIChatView({ onBack }) {
  const { t } = usePrefs();
  const [messages, setMessages] = useState([
    { sender: 'ai', clave: 'ia.saludo' }
  ]);
  const [inputMsg, setInputMsg] = useState('');
  const [adjuntos, setAdjuntos] = useState([]);
  const [pensando, setPensando] = useState(false);
  const [errorIA, setErrorIA] = useState(hayClaveGemini() ? null : t('ia.sinClave'));
  const clipRef = useRef(null);
  const finIARef = useRef(null);

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

    const { texto: respuesta, error } = await conversarConIA({ texto, archivos, historial });
    setPensando(false);

    if (error || !respuesta) {
      setErrorIA(error || t('msg.errorSupabase'));
      return;
    }
    setMessages(prev => [...prev, { sender: 'ai', text: respuesta }]);
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
      </div>

      {/* Area del chat */}
      <div className="flex-1 overflow-y-auto p-8 space-y-4 max-w-4xl mx-auto w-full">
        {messages.map((m, idx) => (
          <div key={idx} className={`flex ${m.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-2xl p-4 shadow-sm text-sm leading-relaxed ${
              m.sender === 'user' ? 'bg-mm-navy text-white' : 'bg-white dark:bg-zinc-800 border border-gray-100 dark:border-zinc-700 text-slate-800 dark:text-zinc-100'
            }`}>
              {m.sender === 'ai' && (
                <div className="flex items-center gap-1.5 text-xs font-bold text-mm-oro-tinta dark:text-mm-oro-claro mb-1.5">
                  <Sparkles size={12} /> IA MM Capital
                </div>
              )}
              {/* `clave` = texto de la app (se traduce); `text` = lo que
                  escribió el usuario (se muestra tal cual) */}
              <p className="whitespace-pre-wrap break-words">{m.clave ? t(m.clave) : m.text}</p>
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
        ))}

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
              className="flex-1 min-w-0 bg-slate-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-slate-400 focus:bg-white transition-colors text-slate-800 dark:text-zinc-100"
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
