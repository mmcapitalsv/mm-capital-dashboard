import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  ChevronLeft, Hash, MessageSquare, Paperclip, Search, Send, Users
} from 'lucide-react';
import { usePrefs } from '../context/PreferenciasContext';
import { useChat } from '../context/ChatContext';

/**
 * Chat interno corporativo.
 *
 * Layout de tres zonas: canales a la izquierda, conversación al centro,
 * compositor abajo. Los mensajes son mock por ahora, pero el estado y el
 * `onSubmit` ya están estructurados como los necesitará Supabase Realtime:
 * enviar hace un "optimistic append" y la suscripción solo tendría que
 * empujar mensajes nuevos al mismo arreglo.
 */

const CANALES = [
  { id: 'general',   claveNombre: 'chat.canalGeneral',   icono: Hash,           miembros: 8 },
  { id: 'obra',      claveNombre: 'chat.canalObra',      icono: Hash,           miembros: 5 },
  { id: 'finanzas',  claveNombre: 'chat.canalFinanzas',  icono: Hash,           miembros: 4 },
  { id: 'socios',    claveNombre: 'chat.canalSocios',    icono: Users,          miembros: 3 }
];

export default function ChatModule({ onBack }) {
  const { t } = usePrefs();

  const [canalActivo, setCanalActivo] = useState('general');
  const { mensajes, enviarMensaje } = useChat();
  const [borrador, setBorrador] = useState('');
  const [busqueda, setBusqueda] = useState('');

  const finRef = useRef(null);

  const canalesFiltrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return CANALES;
    return CANALES.filter(c => t(c.claveNombre).toLowerCase().includes(q));
  }, [busqueda, t]);

  const hilo = mensajes[canalActivo] || [];

  // Mantener la vista al final al cambiar de canal o llegar mensajes
  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [hilo.length, canalActivo]);

  /**
   * Envío. Hoy solo añade al estado local; cuando exista la tabla `mensajes`
   * bastará con hacer el insert aquí y dejar que Realtime confirme.
   */
  const handleEnviar = (e) => {
    e.preventDefault();
    // El contexto es la única fuente: el Sidebar ve el mismo arreglo al instante
    if (enviarMensaje(borrador, canalActivo)) setBorrador('');
  };

  const canalActual = CANALES.find(c => c.id === canalActivo);

  return (
    <main className="flex-1 flex flex-col overflow-hidden bg-[#F5F6F8] dark:bg-zinc-900">

      {/* Cabecera */}
      <div className="flex items-center gap-3 px-6 md:px-8 py-5 border-b border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 flex-shrink-0">
        <button
          onClick={onBack}
          className="w-8 h-8 rounded-full border border-gray-200 dark:border-zinc-700 flex items-center justify-center text-slate-400 dark:text-zinc-400 hover:text-slate-700 dark:hover:text-white transition-all"
        >
          <ChevronLeft size={18} />
        </button>
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-2xl bg-[#0B1B2C] flex items-center justify-center text-[#C5A059] shadow-sm">
            <MessageSquare size={20} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">{t('chat.interno')}</h2>
            <p className="text-xs text-slate-500 dark:text-zinc-400 font-medium">{t('chat.subtitulo')}</p>
          </div>
        </div>
      </div>

      <div className="flex-1 flex min-h-0">

        {/* ── Canales ── */}
        <aside className="w-56 lg:w-64 hidden md:flex flex-col border-r border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 flex-shrink-0">
          <div className="p-3 border-b border-gray-100 dark:border-zinc-700">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-zinc-500" />
              <input
                type="text"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder={t('chat.buscarCanal')}
                className="w-full bg-slate-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg py-2 pl-8 pr-3 text-xs text-slate-700 dark:text-zinc-200 placeholder-slate-400 dark:placeholder-zinc-500 focus:outline-none focus:border-[#C5A059]"
              />
            </div>
          </div>

          <nav className="flex-1 overflow-y-auto p-2 space-y-1">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-zinc-500 px-2 py-1.5">
              {t('chat.canales')}
            </p>

            {canalesFiltrados.map(canal => {
              const Icono = canal.icono;
              const activo = canal.id === canalActivo;
              return (
                <button
                  key={canal.id}
                  onClick={() => setCanalActivo(canal.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-colors ${
                    activo
                      ? 'bg-[#C5A059]/15 text-[#8B6914] dark:text-[#E3C77B] font-bold border border-[#C5A059]/30'
                      : 'text-slate-600 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-700/50 border border-transparent font-medium'
                  }`}
                >
                  <Icono size={15} className={activo ? 'text-[#C5A059]' : 'text-slate-400 dark:text-zinc-500'} />
                  <span className="text-[13px] flex-1 truncate">{t(canal.claveNombre)}</span>
                  <span className="text-[10px] text-slate-400 dark:text-zinc-500 font-semibold">{canal.miembros}</span>
                </button>
              );
            })}

            {canalesFiltrados.length === 0 && (
              <p className="text-xs text-slate-400 dark:text-zinc-500 text-center py-6">{t('chat.sinResultados')}</p>
            )}
          </nav>
        </aside>

        {/* ── Conversación ── */}
        <section className="flex-1 flex flex-col min-w-0">

          <div className="px-5 py-3 border-b border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-2">
              <Hash size={16} className="text-[#C5A059]" />
              <span className="text-sm font-bold text-slate-900 dark:text-white">{t(canalActual?.claveNombre || 'chat.canalGeneral')}</span>
            </div>
            <span className="text-[11px] text-slate-400 dark:text-zinc-500 font-semibold flex items-center gap-1.5">
              <Users size={12} /> {canalActual?.miembros ?? 0} {t('chat.miembros')}
            </span>
          </div>

          {/* Historial: el único elemento con scroll */}
          <div className="flex-1 overflow-y-auto px-5 py-5 space-y-3 min-h-0">
            {hilo.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center">
                <MessageSquare size={28} className="text-slate-300 dark:text-zinc-600 mb-2" />
                <p className="text-sm font-bold text-slate-500 dark:text-zinc-400">{t('chat.sinMensajes')}</p>
              </div>
            ) : hilo.map(m => (
              <div key={m.id} className={`flex ${m.propio ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 shadow-sm ${
                  m.propio
                    ? 'bg-[#0B1B2C] text-white'
                    : 'bg-white dark:bg-zinc-800 border border-gray-100 dark:border-zinc-700 text-slate-800 dark:text-zinc-100'
                }`}>
                  {!m.propio && (
                    <p className="text-[11px] font-bold text-[#C5A059] mb-0.5">{m.autor}</p>
                  )}
                  {/* claveTexto = mensaje de ejemplo (traducible);
                      texto = lo que escribió el usuario (se muestra tal cual) */}
                  <p className="text-sm leading-relaxed break-words">
                    {m.claveTexto ? t(m.claveTexto) : m.texto}
                  </p>
                  <p className={`text-[10px] mt-1 ${m.propio ? 'text-white/50' : 'text-slate-400 dark:text-zinc-500'}`}>
                    {m.hora}
                  </p>
                </div>
              </div>
            ))}
            <div ref={finRef} />
          </div>

          {/* Compositor */}
          <form
            onSubmit={handleEnviar}
            className="p-4 border-t border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 flex items-center gap-2 flex-shrink-0"
          >
            <button
              type="button"
              title={t('nav.adjuntar')}
              className="p-2.5 text-slate-400 dark:text-zinc-500 hover:text-[#C5A059] rounded-xl hover:bg-slate-50 dark:hover:bg-zinc-700 transition-colors flex-shrink-0"
            >
              <Paperclip size={17} />
            </button>

            <input
              type="text"
              value={borrador}
              onChange={(e) => setBorrador(e.target.value)}
              placeholder={t('chat.escribeMensaje')}
              className="flex-1 min-w-0 bg-slate-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-slate-800 dark:text-zinc-100 placeholder-slate-400 dark:placeholder-zinc-500 focus:outline-none focus:border-[#C5A059]"
            />

            <button
              type="submit"
              disabled={!borrador.trim()}
              className="flex items-center gap-2 bg-[#0B1B2C] text-white px-4 py-2.5 rounded-xl text-xs font-bold hover:bg-slate-800 transition-colors disabled:opacity-40 flex-shrink-0"
            >
              <Send size={15} className="text-[#C5A059]" />
              <span className="hidden sm:inline">{t('comun.enviar')}</span>
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
