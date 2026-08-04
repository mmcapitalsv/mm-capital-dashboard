import { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { normalizeHito, calcularAvance } from '../services/checklistService';
import { getChecklistSeed } from '../data/checklistSeeds';
import { getCapitalTotal, guardarCapitalTotal } from '../services/configuracionService';

const DEFAULT_PROJECTS = [
  {
    id: '1',
    nombre: 'Proyecto San Martín',
    title: 'Proyecto San Martín',
    ubicacion: 'Colonia Santa María, San Martín',
    location: 'Colonia Santa María, San Martín',
    descripcion: 'Desarrollo residencial de lujo con acabados premium y amenidades exclusivas.',
    estado: 'En Progreso',
    status: 'EN PROGRESO',
    tag: 'Desarrollo Residencial',
    presupuesto_total: 1480000,
    totalGastado: 527000,
    presupuesto: '$1.48M',
    fecha_entrega: '2025-11-30',
    entrega: '30 Nov 2025',
    imagen_url: 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=800&q=80',
    img: 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=800&q=80'
  },
  {
    id: '2',
    nombre: 'Proyecto Chalchuapa',
    title: 'Proyecto Chalchuapa',
    ubicacion: 'Chalchuapa, Santa Ana',
    location: 'Chalchuapa',
    descripcion: 'Complejo residencial accesible. Terreno adquirido por $32,000 USD (100% pagado e inyectado en gastos ejecutados). Tarea crítica: Registro CNR y factibilidad de agua/luz.',
    estado: 'En Ejecución',
    status: 'EN EJECUCIÓN',
    tag: 'Residencial Accesible',
    presupuesto_total: 850000,
    costo_terreno: 32000,
    terreno_pagado: true,
    totalGastado: 590000,
    tarea_critica: 'Registro del terreno en el CNR y validación de permisos de agua y luz',
    presupuesto: '$850K',
    fecha_entrega: '2025-12-15',
    entrega: '15 Dic 2025',
    imagen_url: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=800&q=80',
    img: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=800&q=80'
  },
  {
    id: '3',
    nombre: 'Proyecto San Juan Opico',
    title: 'Proyecto San Juan Opico',
    ubicacion: 'San Juan Opico, La Libertad',
    location: 'San Juan Opico',
    descripcion: 'Desarrollo industrial y comercial estratégico. Terreno: $55,000 USD (Anticipo de $5,000 USD pagado). ¡ALERTA CRÍTICA! Saldo pendiente de $50,000 USD vence el 2 de agosto de 2026.',
    estado: 'Fase Inicial',
    status: 'FASE INICIAL',
    tag: 'Industrial / Comercial',
    presupuesto_total: 100000,
    costo_terreno: 55000,
    anticipo_terreno: 5000,
    saldo_terreno: 50000,
    fecha_vencimiento_saldo: '2026-08-02',
    alerta_critica: '🔴 ¡ALERTA CRÍTICA! Plazo para pagar el saldo restante del terreno ($50,000 USD) vence el 2 de agosto de 2026.',
    totalGastado: 55000,
    presupuesto: '$100K',
    fecha_entrega: '2026-03-30',
    entrega: '30 Mar 2026',
    imagen_url: 'https://images.unsplash.com/photo-1503387762-592deb58ef4e?auto=format&fit=crop&w=800&q=80',
    img: 'https://images.unsplash.com/photo-1503387762-592deb58ef4e?auto=format&fit=crop&w=800&q=80'
  }
];

/**
 * Estado del proyecto derivado del avance real de hitos.
 * 0% (o sin hitos) = Planificación · 1–99% = En progreso · 100% = Finalizado.
 * Se devuelve el valor canónico que entiende `etiquetaEstado()`.
 */
export function estadoPorAvance(porcentaje, totalHitos = 1) {
  const pct = Math.max(0, Math.min(100, Math.round(Number(porcentaje) || 0)));
  if (!totalHitos || pct === 0) return 'Planificación';
  if (pct >= 100) return 'Finalizado';
  return 'En progreso';
}

function formatMoney(amount) {
  const n = Number(amount);
  if (isNaN(n) || n === 0) return '$0';
  if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return '$' + (n / 1_000).toFixed(0) + 'K';
  return '$' + n.toLocaleString('es-SV');
}

export function useProyectos(user) {
  const [proyectos, setProyectos] = useState(DEFAULT_PROJECTS);
  const [gastos, setGastos] = useState([]);
  const [hitos, setHitos] = useState([]);
  const [archivos, setArchivos] = useState([]);
  // Aportaciones de los inversionistas: son el origen ÚNICO de los egresos
  // totales del panel (nada de cifras escritas a mano).
  const [aportaciones, setAportaciones] = useState([]);
  const [capitalConfigurado, setCapitalConfigurado] = useState(null);
  const [loading, setLoading] = useState(true);
  const [rol, setRol] = useState(null);
  const [perfil, setPerfil] = useState(null);

  const fetchData = async () => {
    try {
      setLoading(true);

      // 1. Ficha del usuario autenticado: nombre, cargo y rol reales.
      //    De aquí salen el saludo, la tarjeta del sidebar y los permisos.
      const esAdminPorCorreo =
        user?.email === 'luisp.bomel@gmail.com' || user?.email === 'luis@mmcapital.com';

      if (user?.id) {
        try {
          const { data: userData, error: userError } = await supabase
            .from('usuarios')
            .select('*')
            .eq('id', user.id)
            .maybeSingle();

          if (!userError && userData) {
            setPerfil(userData);
            if (userData.rol) setRol(esAdminPorCorreo ? 'admin' : userData.rol);
          }
        } catch (e) {
          console.warn("User profile fetch warning:", e);
        }
      }

      if (esAdminPorCorreo) setRol('admin');

      // 2. Fetch Projects from Supabase
      const { data: proyectosData, error: proyectosError } = await supabase
        .from('proyectos')
        .select('*');

      if (!proyectosError && Array.isArray(proyectosData) && proyectosData.length > 0) {
        setProyectos(proyectosData);
      } else {
        setProyectos(DEFAULT_PROJECTS);
      }

      // 3. Fetch Gastos from Supabase
      const { data: gastosData, error: gastosError } = await supabase
        .from('gastos')
        .select('*');

      if (!gastosError && Array.isArray(gastosData)) {
        setGastos(gastosData);
      } else {
        setGastos([]);
      }

      // 4. Fetch Hitos from Supabase
      const { data: hitosData, error: hitosError } = await supabase
        .from('checklist_hitos')
        .select('*');

      if (!hitosError && Array.isArray(hitosData)) {
        setHitos(hitosData);
      } else {
        setHitos([]);
      }

      // 5. Fetch Archivos from Supabase
      const { data: archivosData, error: archivosError } = await supabase
        .from('archivos')
        .select('*');

      if (!archivosError && Array.isArray(archivosData)) {
        setArchivos(archivosData);
      } else {
        setArchivos([]);
      }

      // 6. Aportaciones (Inversionistas) -> egresos totales del portafolio
      const { data: aportacionesData, error: aportacionesError } = await supabase
        .from('aportaciones')
        .select('id, usuario_id, proyecto_id, monto, fecha, nota');

      if (!aportacionesError && Array.isArray(aportacionesData)) {
        setAportaciones(aportacionesData);
      } else {
        setAportaciones([]);
      }

      // 7. Capital total configurable (tabla `configuracion`, migración 005)
      const { monto } = await getCapitalTotal();
      setCapitalConfigurado(Number.isFinite(monto) ? monto : null);

    } catch (error) {
      console.error("Error fetching data from Supabase:", error);
      setProyectos(DEFAULT_PROJECTS);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  /**
   * Reactividad "tipo Excel": Supabase Realtime avisa de cualquier INSERT /
   * UPDATE / DELETE en las tablas del portafolio y la interfaz se recarga sola,
   * sin que el usuario tenga que refrescar la página.
   */
  useEffect(() => {
    if (!user?.id) return;

    // Un guardado masivo (p. ej. 11 hitos) emite un evento por fila:
    // se agrupan en una sola recarga para no saturar la red.
    let temporizador = null;
    const recargarAgrupado = () => {
      clearTimeout(temporizador);
      temporizador = setTimeout(fetchData, 400);
    };

    const canal = supabase.channel('portafolio-mmcapital');
    for (const tabla of [
      'proyectos', 'checklist_hitos', 'gastos', 'archivos', 'usuarios',
      // Una inversión nueva o editada recalcula los egresos del Dashboard al
      // instante, sin recargar la página.
      'aportaciones', 'configuracion'
    ]) {
      canal.on('postgres_changes', { event: '*', schema: 'public', table: tabla }, recargarAgrupado);
    }
    canal.subscribe();

    return () => {
      clearTimeout(temporizador);
      supabase.removeChannel(canal);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Safe collections
  const safeProyectos = Array.isArray(proyectos) && proyectos.length > 0 ? proyectos : DEFAULT_PROJECTS;
  const safeGastos = Array.isArray(gastos) ? gastos : [];
  const safeHitos = Array.isArray(hitos) ? hitos : [];
  const safeArchivos = Array.isArray(archivos) ? archivos : [];
  const safeAportaciones = Array.isArray(aportaciones) ? aportaciones : [];

  // Derived Data: Normalize fields and calculate financial metrics
  const proyectosConFinanzas = safeProyectos.map((proyecto) => {
    if (!proyecto) return DEFAULT_PROJECTS[0];

    const pIdStr = String(proyecto.id || '');
    const gastosProyecto = safeGastos.filter(g => g && String(g.proyecto_id || '') === pIdStr);
    const gastosSumados = gastosProyecto.reduce((sum, g) => sum + (Number(g?.monto) || 0), 0);
    // El costo ejecutado es DINÁMICO: siempre la suma real de `gastos` del
    // proyecto. La columna `proyectos.costo_ejecutado` ya no manda, así cada
    // factura registrada mueve la métrica en Dashboard y Resumen al instante.
    const costoEjecutado = gastosSumados;
    const totalGastado = costoEjecutado;
    const presupuestoTotal = Number(proyecto.presupuesto_total || proyecto.presupuesto || 0);
    const balance = presupuestoTotal - totalGastado;
    const calcPct = presupuestoTotal > 0 ? (totalGastado / presupuestoTotal) * 100 : 0;
    const porcentajeGastado = Number(proyecto.porcentajeGastado || proyecto.porcentaje_manual || calcPct);

    // ── Avance FÍSICO de obra: se lee del checklist real guardado en Supabase ──
    // Prioridad: filas de `checklist_hitos` > columna JSON `proyectos.checklist` > semilla local.
    const hitosProyecto = safeHitos.filter(h => h && String(h.proyecto_id || '') === pIdStr);
    let checklistFinal = [];
    if (hitosProyecto.length > 0) {
      checklistFinal = hitosProyecto
        .map((h, i) => normalizeHito(h, i))
        .filter(Boolean)
        .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
    } else if (Array.isArray(proyecto.checklist) && proyecto.checklist.length > 0) {
      checklistFinal = proyecto.checklist.map((h, i) => normalizeHito(h, i)).filter(Boolean);
    } else {
      checklistFinal = getChecklistSeed(pIdStr, proyecto.nombre || proyecto.title).map((h, i) => normalizeHito(h, i)).filter(Boolean);
    }
    const avanceFisico = checklistFinal.length > 0
      ? calcularAvance(checklistFinal)
      : Math.round(Number(proyecto.porcentaje_avance) || 0);

    const nombreFinal = proyecto.nombre || proyecto.title || 'Proyecto';
    const ubicacionFinal = proyecto.ubicacion || proyecto.location || '';
    // El estado NO es texto fijo: sale del % de hitos completados.
    // 0% = Planificación · 1–99% = En progreso · 100% = Finalizado.
    const estadoFinal = estadoPorAvance(avanceFisico, checklistFinal.length);
    const imagenFinal = proyecto.imagen_url || proyecto.img || 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=800&q=80';
    const fechaFinal = proyecto.fecha_entrega || proyecto.entrega || '2025-11-30';

    return {
      ...proyecto,
      id: proyecto.id || '1',
      nombre: nombreFinal,
      title: nombreFinal,
      ubicacion: ubicacionFinal,
      location: ubicacionFinal,
      descripcion: proyecto.descripcion || 'Desarrollo inmobiliario exclusivo.',
      estado: estadoFinal,
      status: estadoFinal,
      tag: proyecto.tag || estadoFinal,
      imagen_url: imagenFinal,
      img: imagenFinal,
      presupuesto_total: presupuestoTotal,
      presupuesto: formatMoney(presupuestoTotal),
      fecha_entrega: fechaFinal,
      entrega: fechaFinal,
      // Cifras financieras reales de Supabase (editables por el Administrador)
      costo_ejecutado: costoEjecutado,
      gastosSumados,
      ejecucion_mensual: Array.isArray(proyecto.ejecucion_mensual) ? proyecto.ejecucion_mensual : [],
      totalGastado,
      ejecutado: formatMoney(totalGastado),
      balance,
      porcentajeGastado: porcentajeGastado,
      progress: porcentajeGastado.toFixed(0),
      ejecutadoPct: `${porcentajeGastado.toFixed(0)}%`,
      // Avance físico de obra (checklist), independiente del avance financiero
      checklist: checklistFinal,
      avanceFisico,
      avanceObra: `${avanceFisico}%`,
      hitosCompletados: checklistFinal.filter(h => h && h.done).length,
      hitosTotales: checklistFinal.length
    };
  });

  // Derived Data: Notifications for close milestones (<= 7 days)
  const today = new Date();
  const notificaciones = safeHitos
    .filter(hito => {
      if (!hito || !hito.fecha_vencimiento) return false;
      try {
        const dueDate = new Date(hito.fecha_vencimiento);
        if (isNaN(dueDate.getTime())) return false;
        const diffTime = dueDate.getTime() - today.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        // La columna real es `completado` (bool), no `estado`
        return diffDays >= 0 && diffDays <= 7 && !hito.completado;
      } catch (e) {
        return false;
      }
    })
    // Se resuelve aquí el nombre del proyecto y el título del hito para que la
    // UI nunca tenga que pintar un UUID crudo.
    .map(hito => {
      const proyecto = safeProyectos.find(p => p && String(p.id) === String(hito.proyecto_id)) || null;
      return {
        ...hito,
        tarea: hito.titulo || hito.tarea || 'Hito sin título',
        proyectoNombre: proyecto?.nombre || proyecto?.title || '',
        proyecto
      };
    });

  /* ── Finanzas globales del portafolio ────────────────────────────────────
     Egresos totales = suma de TODAS las inversiones registradas en la sección
     de Inversionistas. Nunca es un número escrito a mano: si se agrega o se
     modifica una aportación, Realtime recarga y esta cifra cambia sola. */
  const egresosTotales = safeAportaciones
    .reduce((suma, a) => suma + (Number(a?.monto) || 0), 0);

  // Capital total: el valor editado por el Administrador manda; si nunca se
  // configuró, se cae a la suma de los presupuestos de los proyectos.
  const capitalPresupuestado = proyectosConFinanzas
    .reduce((suma, p) => suma + (Number(p?.presupuesto_total) || 0), 0);
  const capitalTotal = Number.isFinite(capitalConfigurado) && capitalConfigurado !== null
    ? capitalConfigurado
    : capitalPresupuestado;

  const capitalDisponible = capitalTotal - egresosTotales;
  const pctEjecutado = capitalTotal > 0
    ? Math.min(100, Math.max(0, (egresosTotales / capitalTotal) * 100))
    : 0;
  const pctDisponible = capitalTotal > 0 ? Math.max(0, 100 - pctEjecutado) : 0;

  /** Guarda el capital total y lo refleja al momento (sin esperar a Realtime). */
  const actualizarCapitalTotal = async (monto) => {
    const resultado = await guardarCapitalTotal(monto);
    if (resultado.success) {
      const importe = Number(String(monto).replace(/[^\d.-]/g, ''));
      setCapitalConfigurado(Number.isFinite(importe) ? importe : null);
    }
    return resultado;
  };

  return {
    proyectos: proyectosConFinanzas,
    gastos: safeGastos,
    hitos: safeHitos,
    archivos: safeArchivos,
    aportaciones: safeAportaciones,
    rol,
    perfil,
    loading,
    notificaciones,
    refetchData: fetchData,
    // Finanzas reactivas del portafolio
    capitalTotal,
    capitalPresupuestado,
    capitalConfigurado,
    egresosTotales,
    capitalDisponible,
    pctEjecutado,
    pctDisponible,
    actualizarCapitalTotal,
    isAdmin: ['admin', 'socio_administrador'].includes(rol),
    isInvestorOrPartner: ['inversionista', 'socio_director'].includes(rol)
  };
}
