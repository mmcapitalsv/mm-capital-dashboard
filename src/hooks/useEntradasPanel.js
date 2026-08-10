import React from 'react';
import { montoCorto, sinNumeracion } from '../lib/formato';

/**
 * Las tres listas del panel: actividad reciente, próximos hitos y tareas
 * críticas.
 *
 * Vive fuera de la vista porque tiene DOS consumidores: las tarjetas del
 * Dashboard (que enseñan las primeras filas) y el modal "Ver todos", que se
 * abre también desde la campana estando en cualquier otra pantalla. Calcularlas
 * dentro de la vista obligaría a duplicarlas.
 */
export function useEntradasPanel({ proyectos, gastos, hitos, archivos, vencimientos, t, locale }) {
  const PROJECTS = Array.isArray(proyectos) ? proyectos : [];

  // Hitos pendientes reales: la columna es `completado` (bool), no `estado`
  const hitosPendientesTodos = React.useMemo(() => (Array.isArray(hitos) ? hitos : [])
    .filter(h => h && !h.completado)
    .sort((a, b) => {
      const fa = a.fecha_vencimiento ? new Date(a.fecha_vencimiento).getTime() : Infinity;
      const fb = b.fecha_vencimiento ? new Date(b.fecha_vencimiento).getTime() : Infinity;
      return fa - fb;
    }), [hitos]);

  /* "Hoy", fijado al inicio del día y UNA sola vez. Con `new Date()` dentro del
     cálculo, cada render producía un instante distinto: las listas dependientes
     no podían memorizarse y los días restantes se recalculaban en cascada sin
     que hubiera cambiado ningún dato. Un plazo de obra se mide en días, no en
     milisegundos. */
  const inicioDeHoy = React.useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, []);

  /** Devuelve el proyecto completo a partir de un proyecto_id (uuid). */
  const buscarProyecto = (id) => PROJECTS.find(x => String(x.id) === String(id)) || null;

  /** Traduce un proyecto_id (uuid) a su nombre legible. */
  const nombreProyecto = (id) => buscarProyecto(id)?.nombre || t('inv.proyectoNoDisponible');

  /* Las tres listas van memoizadas. Sin esto se recalculaban —con su `.sort()`
     y una búsqueda de proyecto por elemento— en CADA render, y el reloj fuerza
     uno cada 15 segundos aunque no haya cambiado ningún dato. */
  /* ── Actividad reciente ────────────────────────────────────────────────────
     Antes solo leía la tabla `gastos`, así que un proyecto con obra avanzada
     pero sin facturas cargadas mostraba "Todavía no hay movimientos" — y
     parecía que no había pasado nada, cuando sí había pasado.

     Ahora reúne los TRES tipos de suceso que ya están guardados: pagos, hitos
     terminados y documentos subidos. Nada de esto es inventado ni de ejemplo;
     si la lista sale vacía es porque de verdad no hay nada registrado. */
  const entradasActividad = React.useMemo(() => {
    const sucesos = [];

    // 1. Pagos y facturas
    for (const [i, g] of (Array.isArray(gastos) ? gastos : []).entries()) {
      const proyecto = buscarProyecto(g?.proyecto_id);
      sucesos.push({
        id: g?.id ?? `gasto-${i}`,
        cuando: g?.fecha || g?.created_at || '',
        icono: g?.tipo === 'documento' ? 'documento' : 'actividad',
        titulo: g?.descripcion || g?.concepto || t('act.pagoRegistrado'),
        proyecto,
        proyectoNombre: proyecto?.nombre || nombreProyecto(g?.proyecto_id),
        detalle: g?.fecha ? new Date(g.fecha).toLocaleDateString(locale) : '',
        valor: g?.monto ? montoCorto(g.monto, locale) : null,
        tono: 'text-emerald-600'
      });
    }

    // 2. Hitos del checklist ya terminados: son avance real de obra
    for (const [i, h] of (Array.isArray(hitos) ? hitos : []).entries()) {
      if (!h?.completado) continue;
      const proyecto = buscarProyecto(h?.proyecto_id);
      sucesos.push({
        id: h?.id ?? `hito-hecho-${i}`,
        cuando: h?.updated_at || h?.fecha_vencimiento || h?.created_at || '',
        icono: 'hito',
        titulo: sinNumeracion(h?.titulo || h?.tarea || t('proy.hitoSinTitulo')),
        proyecto,
        proyectoNombre: proyecto?.nombre || nombreProyecto(h?.proyecto_id),
        detalle: t('act.hitoCompletado'),
        valor: null,
        tono: 'text-mm-2'
      });
    }

    // 3. Documentos subidos al proyecto
    for (const [i, a] of (Array.isArray(archivos) ? archivos : []).entries()) {
      if (!a?.proyecto_id || a.proyecto_id === 'global_vault') continue;
      const proyecto = buscarProyecto(a.proyecto_id);
      sucesos.push({
        id: a?.id ?? `archivo-${i}`,
        cuando: a?.created_at || '',
        icono: 'documento',
        titulo: a?.nombre_archivo || t('act.docSubido'),
        proyecto,
        proyectoNombre: proyecto?.nombre || nombreProyecto(a.proyecto_id),
        detalle: t('act.docSubido'),
        valor: null,
        tono: 'text-mm-2'
      });
    }

    // Lo más reciente primero. Sin fecha se va al final, no al principio.
    return sucesos.sort((a, b) => {
      const fa = a.cuando ? new Date(a.cuando).getTime() : -Infinity;
      const fb = b.cuando ? new Date(b.cuando).getTime() : -Infinity;
      return fb - fa;
    });
  },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gastos, hitos, archivos, PROJECTS, locale, t]);

  const entradasHitos = React.useMemo(() => hitosPendientesTodos.map((h, i) => {
    const proyecto = buscarProyecto(h?.proyecto_id);
    const dias = h?.fecha_vencimiento
      ? Math.ceil((new Date(h.fecha_vencimiento).getTime() - inicioDeHoy) / (1000 * 60 * 60 * 24))
      : null;
    return {
      id: h?.id ?? `hito-${i}`,
      icono: 'hito',
      titulo: h?.titulo || t('proy.hitoSinTitulo'),
      proyecto,
      proyectoNombre: proyecto?.nombre || nombreProyecto(h?.proyecto_id),
      detalle: h?.fecha_vencimiento || '',
      valor: dias !== null ? t('act.enDiasCorto', { dias }) : null,
      tono: dias !== null && dias <= 7 ? 'text-red-500' : 'text-mm-3'
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [hitosPendientesTodos, PROJECTS, t, inicioDeHoy]);

  /* Tareas críticas: NUNCA agrupadas ("2 pagos pendientes"). Cada hito viene ya
     clasificado por el hook con su `grado` (vencido / urgente), que es el mismo
     criterio que enciende la campana: un solo concepto, no dos. */
  const entradasTareas = React.useMemo(() => (Array.isArray(vencimientos) ? vencimientos : [])
    .map((h, i) => ({
      id: h?.id ?? `tarea-${i}`,
      icono: 'tarea',
      titulo: h?.titulo || h?.tarea || t('proy.hitoSinTitulo'),
      proyecto: h?.proyecto || buscarProyecto(h?.proyecto_id),
      proyectoNombre: h?.proyectoNombre || nombreProyecto(h?.proyecto_id),
      detalle: h?.fecha_vencimiento ? `${t('notif.vence')} ${h.fecha_vencimiento}` : '',
      valor: h?.grado === 'vencido' ? t('notif.vencido') : t('notif.urgente'),
      tono: h?.grado === 'vencido' ? 'text-red-600' : 'text-amber-600',
      dias: h?.dias
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vencimientos, PROJECTS, t]);

  return { entradasActividad, entradasHitos, entradasTareas };
}
