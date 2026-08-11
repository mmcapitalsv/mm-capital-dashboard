import React from 'react';
import { usePrefs } from '../context/usePrefs';
import PortadaProyecto from './ui/PortadaProyecto';
import MetricasProyecto from './ui/MetricasProyecto';
import { etiquetaEstado } from '../i18n/diccionario';
import { ID_INPUT_PORTADA } from '../lib/portada';
import {
  Building2, Camera, ChevronLeft, ChevronRight, Edit2, Loader2, Plus
} from 'lucide-react';

/**
 * Color de la etiqueta de estado, mapeado por los valores CANÓNICOS que emite
 * `estadoPorAvance` en useProyectos.js.
 *
 * Antes esto buscaba subcadenas ('ejecución', 'activo', 'entregado',
 * 'completado') que el hook NO produce nunca: los tres valores reales son
 * 'Planificación', 'En progreso' y 'Finalizado'. Ninguno coincidía, así que
 * las tres ramas de color se resolvían siempre en la de reserva y TODOS los
 * proyectos salían azules, terminado o sin empezar.
 */
const COLOR_ESTADO = {
  'Planificación': 'bg-slate-100 dark:bg-zinc-700 text-slate-600 dark:text-zinc-200 border-slate-200 dark:border-zinc-600',
  'En progreso':   'bg-mm-oro-lavado dark:bg-amber-500/10 text-mm-oro-tinta dark:text-mm-oro-claro border-mm-oro-borde dark:border-amber-500/30',
  'Finalizado':    'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30'
};

const colorEstado = (estado) =>
  COLOR_ESTADO[estado] || COLOR_ESTADO['Planificación'];

/**
 * Listado completo de proyectos del portafolio.
 *
 * Salió de Dashboard.jsx tal cual: mismo marcado, mismas clases y mismos
 * textos. Lo único que cambia es dónde vive.
 */
export default function AllProjectsView({
  projects, onCardClick, onBack, isEditMode, isAdmin, onNuevoProyecto,
  onCambiarPortada, subiendoPortadaId, portadaMsg
}) {
  const { t } = usePrefs();
  /* La edición real de un proyecto vive en su ficha (ProjectDetails). Con el
     Modo Edición encendido, cada tarjeta muestra un acceso EXPLÍCITO a esa
     ficha: en móvil no hay hover, así que el control va siempre visible. */
  const puedeEditar = isAdmin && isEditMode;
  return (
    <main className="flex-1 flex flex-col overflow-hidden bg-transparent">
      <div className="flex items-center gap-4 px-6 md:px-8 py-5 border-b border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800">
        <button onClick={onBack} className="w-8 h-8 rounded-full border border-gray-200 dark:border-zinc-700 flex items-center justify-center text-slate-400 dark:text-zinc-200 hover:text-slate-700 dark:hover:text-zinc-100 hover:border-gray-300 dark:hover:border-zinc-600 transition-all">
          <ChevronLeft size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">{t('proys.titulo')}</h2>
          <p className="text-[11px] text-slate-400 dark:text-zinc-200 font-medium">{t('proys.subtitulo')}</p>
        </div>
        {puedeEditar && (
          <span className="flex items-center gap-1.5 text-[11px] font-bold text-white bg-mm-oro px-2.5 py-1.5 rounded-lg flex-shrink-0 uppercase tracking-wide">
            <Edit2 size={12} /> {t('dash.edicionActiva')}
          </span>
        )}
      </div>
      {portadaMsg && (
        <div className={`mx-4 md:mx-8 mt-3 text-[11px] font-bold px-3 py-2 rounded-xl border ${
          portadaMsg.tipo === 'exito'
            ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30'
            : 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 border-red-200 dark:border-red-500/30'
        }`}>
          {portadaMsg.texto}
        </div>
      )}
      <div className="flex-1 overflow-y-auto p-4 md:p-8">
        {/* Crear proyecto: solo el Administrador y solo en Modo Edición */}
        {puedeEditar && (
          <button
            onClick={onNuevoProyecto}
            className="w-full mb-4 flex items-center justify-center gap-2 bg-mm-navy dark:bg-zinc-800 text-white rounded-2xl py-3.5 text-[13px] font-bold shadow-md border border-mm-oro/30 active:scale-[0.98] transition-transform"
          >
            <Plus size={17} className="text-mm-3" /> {t('proyNuevo.titulo')}
          </button>
        )}
        {!projects || projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <Building2 size={40} className="text-slate-200" />
            <p className="text-slate-400 dark:text-zinc-200 text-sm font-medium">{t('proys.vacio')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {projects.map(p => (
              <div
                key={p.id}
                onClick={() => onCardClick(p)}
                className="bg-white dark:bg-zinc-800 rounded-[20px] border border-gray-100 dark:border-zinc-700 shadow-sm p-5 cursor-pointer hover:shadow-[0_8px_32px_rgba(0,0,0,0.10)] transition-all group"
              >
                {/* La portada también se cambia desde aquí, no solo desde el
                    Proyecto Destacado del panel: mismo control en móvil y en
                    escritorio, siempre visible (nada de hover). */}
                <div className="relative w-full h-36 rounded-xl overflow-hidden mb-4 bg-slate-100 dark:bg-zinc-700">
                  <PortadaProyecto
                    url={p.imagen_url}
                    alt={p.nombre}
                    claseImg="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    tamanoIcono={36}
                    claseIcono="text-slate-300 dark:text-zinc-200"
                  />
                  {puedeEditar && typeof onCambiarPortada === 'function' && (
                    <label
                      htmlFor={ID_INPUT_PORTADA}
                      onClick={(e) => { e.stopPropagation(); onCambiarPortada(p.id); }}
                      className="absolute bottom-2 right-2 flex items-center gap-1.5 bg-black/60 backdrop-blur-sm text-white text-[11px] font-bold px-2.5 py-1.5 rounded-lg active:scale-95 transition-transform cursor-pointer"
                    >
                      {subiendoPortadaId === p.id
                        ? <Loader2 size={12} className="animate-spin" />
                        : <Camera size={12} className="text-mm-oro" />}
                      {subiendoPortadaId === p.id ? t('comun.subiendo') : t('dash.cambiarPortada')}
                    </label>
                  )}
                </div>
                <div className={`inline-flex px-2.5 py-1 rounded-md text-[11px] font-bold tracking-wide uppercase border mb-2 ${colorEstado(p.estado)}`}>
                  {etiquetaEstado(p.estado, t) || t('fb.sinEstado')}
                </div>
                <h3 className="font-bold text-slate-900 dark:text-white text-sm mb-3 uppercase group-hover:text-mm-oro-tinta dark:group-hover:text-mm-oro-claro transition-colors">{p.nombre}</h3>

                {/* Las dos métricas, separadas y con nombre. Antes aquí solo
                    había un "35% ejecutado" suelto, sin decir de qué. */}
                <MetricasProyecto proyecto={p} compacta />

                <div className="mt-3 pt-3 border-t border-gray-100 dark:border-zinc-700 flex justify-end items-center gap-2">
                  {/* Con el Modo Edición encendido, el acceso a editar la ficha
                      es un botón real y tocable, no un efecto de hover. */}
                  {puedeEditar ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); onCardClick(p); }}
                      className="flex items-center gap-1.5 text-[11px] font-bold text-white bg-mm-oro px-3 py-2 rounded-xl flex-shrink-0 active:scale-95 transition-transform"
                    >
                      <Edit2 size={13} /> {t('comun.editar')}
                    </button>
                  ) : (
                    <span className="flex items-center gap-1 text-[11px] font-bold text-mm-oro-tinta dark:text-mm-oro-claro flex-shrink-0">
                      {t('dash.verProyectoCorto')} <ChevronRight size={13} />
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
