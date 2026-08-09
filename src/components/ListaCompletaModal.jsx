import React from 'react';
import {
  Activity, AlertTriangle, ArrowUpRight, Building2, DollarSign, FileText, MapPin, X
} from 'lucide-react';
import { usePrefs } from '../context/PreferenciasContext';

/**
 * "Ver todos" de las tarjetas inferiores del Dashboard.
 *
 * Muestra la lista COMPLETA de actividad, hitos o tareas críticas. Cada fila
 * dice a qué proyecto pertenece y viaja a su detalle al hacer clic; las que no
 * tienen proyecto asociado se pintan sin enlace, no como enlaces rotos.
 */

const ICONO = {
  actividad: { Icono: DollarSign, fondo: 'bg-emerald-50 dark:bg-emerald-500/10', color: 'text-emerald-500' },
  documento: { Icono: FileText, fondo: 'bg-blue-50 dark:bg-blue-500/10', color: 'text-blue-500' },
  hito: { Icono: MapPin, fondo: 'bg-slate-100 dark:bg-zinc-700', color: 'text-slate-500 dark:text-zinc-300' },
  tarea: { Icono: AlertTriangle, fondo: 'bg-red-50 dark:bg-red-500/10', color: 'text-red-500' },
  otro: { Icono: Activity, fondo: 'bg-amber-50 dark:bg-amber-500/10', color: 'text-amber-500' }
};

export default function ListaCompletaModal({ abierto, titulo, entradas = [], onCerrar, onAbrirProyecto }) {
  const { t } = usePrefs();
  if (!abierto) return null;

  const lista = Array.isArray(entradas) ? entradas.filter(Boolean) : [];

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onCerrar}
    >
      <div
        className="bg-white dark:bg-zinc-800 rounded-3xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl border border-gray-100 dark:border-zinc-700"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-zinc-700 flex-shrink-0">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white">{titulo}</h3>
            <p className="text-[11px] text-slate-400 dark:text-zinc-200 font-medium">
              {lista.length} {t('lista.registros')}
            </p>
          </div>
          <button
            onClick={onCerrar}
            className="w-8 h-8 rounded-full border border-gray-200 dark:border-zinc-700 flex items-center justify-center text-slate-400 dark:text-zinc-200 hover:text-slate-700 dark:hover:text-white transition-colors"
            title={t('comun.cerrar')}
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {lista.length === 0 ? (
            <div className="py-14 text-center">
              <Building2 size={26} className="text-slate-300 dark:text-zinc-600 mx-auto mb-3" />
              <p className="text-sm font-bold text-slate-500 dark:text-zinc-300">{t('lista.vacio')}</p>
            </div>
          ) : lista.map((e, i) => {
            const { Icono, fondo, color } = ICONO[e.icono] || ICONO.otro;
            const navegable = !!e.proyecto && typeof onAbrirProyecto === 'function';

            const contenido = (
              <>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${fondo}`}>
                  <Icono size={14} className={color} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-slate-800 dark:text-zinc-100 truncate">{e.titulo}</p>
                  <p className="text-[11px] text-slate-400 dark:text-zinc-200 truncate flex items-center gap-1">
                    <Building2 size={10} className="flex-shrink-0 text-mm-oro" />
                    {e.proyectoNombre || t('inv.proyectoNoDisponible')}
                    {e.detalle ? ` · ${e.detalle}` : ''}
                  </p>
                </div>
                {e.valor && (
                  <span className={`text-[11px] font-bold flex-shrink-0 ${e.tono || 'text-slate-500 dark:text-zinc-300'}`}>
                    {e.valor}
                  </span>
                )}
                {navegable && <ArrowUpRight size={14} className="text-mm-oro flex-shrink-0" />}
              </>
            );

            return navegable ? (
              <button
                key={e.id ?? i}
                onClick={() => { onAbrirProyecto(e.proyecto); onCerrar?.(); }}
                className="w-full text-left flex items-center gap-3 p-3 rounded-2xl border border-gray-100 dark:border-zinc-700 bg-white dark:bg-zinc-800 hover:bg-slate-50 dark:hover:bg-zinc-700/50 hover:border-mm-oro/40 transition-colors"
                title={t('dash.verProyecto')}
              >
                {contenido}
              </button>
            ) : (
              <div
                key={e.id ?? i}
                className="w-full flex items-center gap-3 p-3 rounded-2xl border border-gray-100 dark:border-zinc-700 bg-white dark:bg-zinc-800"
              >
                {contenido}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
