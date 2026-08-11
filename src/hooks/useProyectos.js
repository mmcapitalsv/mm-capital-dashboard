import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { normalizeHito, calcularAvance, sumarValoresCompletados } from '../services/checklistService';
import { getCapitalTotal, guardarCapitalTotal } from '../services/configuracionService';
import { montoCorto } from '../lib/formato';
import { aNumeroSeguro, redondearDinero, sumarDinero, porcentajeSeguro } from '../lib/numeros';
import { parchearLista, afectaFila } from '../lib/realtime';
import { leerTablaCompleta } from '../lib/supabasePaginado';
import { useDiaActual } from './useDiaActual';

/**
 * Estado del proyecto derivado del avance real de hitos.
 * 0% (o sin hitos) = Planificación · 1–99% = En progreso · 100% = Finalizado.
 * Se devuelve el valor canónico que entiende `etiquetaEstado()`.
 */
export function estadoPorAvance(porcentaje, totalHitos = 1) {
  const pct = Math.max(0, Math.min(100, Math.round(aNumeroSeguro(porcentaje))));
  if (!totalHitos || pct === 0) return 'Planificación';
  if (pct >= 100) return 'Finalizado';
  return 'En progreso';
}

export function useProyectos(user) {
  const [proyectos, setProyectos] = useState([]);
  // Mensaje de error real de Supabase: la interfaz lo muestra en vez de
  // fingir que hay datos cuando la lectura falló.
  const [errorCarga, setErrorCarga] = useState(null);
  const [gastos, setGastos] = useState([]);
  const [hitos, setHitos] = useState([]);
  const [archivos, setArchivos] = useState([]);
  // Aportaciones de los inversionistas: son el origen ÚNICO de los egresos
  // totales del panel (nada de cifras escritas a mano).
  const [aportaciones, setAportaciones] = useState([]);
  const [capitalConfigurado, setCapitalConfigurado] = useState(null);
  // Tablas que llegaron recortadas por el techo de PostgREST: sus sumas serían
  // parciales, así que la interfaz debe decirlo en vez de presentarlas como
  // definitivas (ver `lib/supabasePaginado.js`).
  const [datosParciales, setDatosParciales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [rol, setRol] = useState(null);
  const [perfil, setPerfil] = useState(null);

  /* ── Carrera entre lecturas ───────────────────────────────────────────────
     Cambiar de usuario (o pedir un `refetchData` mientras otro sigue en vuelo)
     dejaba dos lecturas compitiendo: la que respondiera ÚLTIMA pintaba, aunque
     fuera la más vieja. Cada lectura se sella con un número; solo la última
     emitida tiene derecho a escribir en el estado, y ninguna escribe después
     de desmontar. */
  const lecturaActual = useRef(0);
  const montado = useRef(true);
  useEffect(() => {
    montado.current = true;
    return () => { montado.current = false; };
  }, []);

  const fetchData = useCallback(async () => {
    const sello = ++lecturaActual.current;
    const vigente = () => montado.current && sello === lecturaActual.current;

    try {
      setLoading(true);

      /* 1. Ficha del usuario autenticado: nombre, cargo y rol reales.
            De aquí salen el saludo, la tarjeta del sidebar y los permisos.

            El rol sale ÚNICAMENTE de la columna `usuarios.rol`. Antes había una
            lista de correos escrita aquí que concedía `admin`: eso viajaba en el
            paquete publicado (cualquiera podía leer los correos) y además decidía
            un permiso en el navegador, que es territorio del usuario. Quien manda
            es la base de datos, y las políticas RLS la respaldan del lado del
            servidor. */
      if (user?.id) {
        try {
          const { data: userData, error: userError } = await supabase
            .from('usuarios')
            .select('*')
            .eq('id', user.id)
            .maybeSingle();

          if (!userError && userData && vigente()) {
            setPerfil(userData);
            if (userData.rol) setRol(userData.rol);
          }
        } catch (e) {
          console.warn("User profile fetch warning:", e);
        }
      }

      /* ── Lecturas del portafolio ──────────────────────────────────────────
         Un error de lectura NO se traga. Antes, `gastos`, `hitos`, `archivos`
         y `aportaciones` fallaban en silencio y se quedaban en `[]`:
         consecuencia práctica, si RLS bloqueaba `aportaciones` o se caía la
         red a media carga, el panel anunciaba "Egresos totales: $0" con toda
         naturalidad. Un cero por fallo de lectura es indistinguible de un cero
         real, y sobre esa cifra se toman decisiones de dinero.

         Ahora cada error se recoge y se lanza: la interfaz enseña el aviso de
         fallo en lugar de un dato falso. Es la misma regla que ya se aplicaba
         a `proyectos` y la razón por la que se eliminaron los proyectos de
         ejemplo.

         Y no se leen «las primeras mil filas»: PostgREST recorta en 1,000 sin
         avisar (200 OK, lista corta), y sobre `gastos` o `aportaciones` eso es
         una cifra de dinero equivocada con pinta de exacta. `leerTablaCompleta`
         pide el conteo exacto y pagina hasta traerlas todas; lo que aun así
         quede fuera se reporta como dato parcial. */
      const parciales = [];
      const leer = async (tabla, columnas = '*') => {
        const { filas, truncado } = await leerTablaCompleta(tabla, columnas);
        if (truncado) parciales.push(tabla);
        return filas;
      };

      const [
        proyectosData, gastosData, hitosData, archivosData, aportacionesData, capital
      ] = await Promise.all([
        leer('proyectos'),
        leer('gastos'),
        leer('checklist_hitos'),
        leer('archivos'),
        leer('aportaciones', 'id, usuario_id, proyecto_id, monto, fecha, nota'),
        // El capital configurable ya devuelve su propio fallo controlado
        getCapitalTotal()
      ]);

      // Respuesta de una lectura ya superada: se descarta en silencio.
      if (!vigente()) return;

      setErrorCarga(null);
      setDatosParciales(parciales);
      setProyectos(proyectosData);
      setGastos(gastosData);
      setHitos(hitosData);
      setArchivos(archivosData);
      setAportaciones(aportacionesData);
      setCapitalConfigurado(Number.isFinite(capital?.monto) ? capital.monto : null);

    } catch (error) {
      console.error("Error fetching data from Supabase:", error);
      if (!vigente()) return;
      /* Un fallo se dice, no se disimula. Y se vacía TODO, no solo los
         proyectos: dejar las colecciones anteriores en pie mientras se muestra
         un aviso de error produce lo peor de los dos mundos — cifras viejas
         con pinta de vigentes junto a un cartel rojo. */
      /* Clave del diccionario, no texto: este hook no tiene traductor y el
         aviso salía siempre en español. La vista lo pasa por `t(...)`, que
         devuelve la cadena intacta cuando lo que llega es el mensaje técnico
         de Supabase. */
      setErrorCarga(error?.message || 'err.sinConexion');
      setProyectos([]);
      setGastos([]);
      setHitos([]);
      setArchivos([]);
      setAportaciones([]);
      setCapitalConfigurado(null);
      setDatosParciales([]);
    } finally {
      if (vigente()) setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  /**
   * Reactividad "tipo Excel": Supabase Realtime avisa de cualquier INSERT /
   * UPDATE / DELETE en las tablas del portafolio y la interfaz se pone al día
   * sola, sin que el usuario tenga que refrescar la página.
   *
   * El evento se aplica SOBRE la lista que ya está en memoria (ver
   * `lib/realtime.js`). Antes cualquier cambio —hasta corregir el monto de una
   * factura— disparaba las siete consultas del portafolio completo; con un
   * guardado de 11 hitos eso eran once ráfagas agrupadas de recarga total. Se
   * queda la recarga solo donde una fila suelta no alcanza a describir el
   * cambio (`configuracion`, que redefine el capital de todo el panel).
   */
  useEffect(() => {
    if (!user?.id) return;

    const canal = supabase.channel('portafolio-mmcapital');

    const enTabla = (tabla, manejar) => {
      canal.on('postgres_changes', { event: '*', schema: 'public', table: tabla }, manejar);
    };

    const parchear = (setter, opciones) => (payload) => {
      if (!montado.current) return;
      setter(parchearLista(payload, opciones));
    };

    enTabla('proyectos', parchear(setProyectos));
    enTabla('checklist_hitos', parchear(setHitos, { insertarEn: 'fin' }));
    enTabla('gastos', parchear(setGastos));
    enTabla('archivos', parchear(setArchivos));
    // Una inversión nueva o editada recalcula los egresos del Dashboard al
    // instante, sin recargar la página.
    enTabla('aportaciones', parchear(setAportaciones));

    /* La ficha propia sí importa fila a fila: si el Administrador cambia el rol
       de este usuario, los permisos de la sesión deben moverse en el acto. */
    enTabla('usuarios', (payload) => {
      if (!montado.current || !afectaFila(payload, user.id)) return;
      const fila = payload?.new;
      if (payload?.eventType === 'DELETE' || !fila) return;
      setPerfil(fila);
      if (fila.rol) setRol(fila.rol);
    });

    /* `configuracion` no es una lista: es el capital total del portafolio, y su
       lectura pasa por `getCapitalTotal()` con su propio fallo controlado. Aquí
       sí se relee, agrupando ráfagas para no encadenar lecturas. */
    let temporizador = null;
    enTabla('configuracion', () => {
      clearTimeout(temporizador);
      temporizador = setTimeout(() => { if (montado.current) fetchData(); }, 400);
    });

    /* ── Resincronización al (re)conectar ─────────────────────────────────
       Realtime NO reenvía lo que ocurrió mientras el canal estuvo caído: si el
       socket se cae —suspensión del equipo, cambio de red, pestaña en segundo
       plano— los INSERT/UPDATE/DELETE de ese rato se pierden PARA SIEMPRE y la
       lista en memoria se queda corta. Sobre `aportaciones` eso es exactamente
       lo que se veía en el panel: una aportación registrada en la base que el
       Dashboard nunca sumaba, con una cifra estancada por debajo del total real
       hasta recargar la página a mano.

       Cada vez que el canal vuelve a quedar SUBSCRIBED se releen las tablas
       enteras. La primera alta no cuenta: ahí `fetchData()` acaba de correr. */
    let primeraAlta = true;
    canal.subscribe((estado) => {
      if (estado !== 'SUBSCRIBED') return;
      if (primeraAlta) { primeraAlta = false; return; }
      if (montado.current) fetchData();
    });

    return () => {
      clearTimeout(temporizador);
      supabase.removeChannel(canal);
    };
  }, [user?.id, fetchData]);

  /* ── Vuelta al primer plano ────────────────────────────────────────────────
     Misma razón que la resincronización del canal, por el otro flanco: el
     navegador congela las pestañas de fondo y corta el socket, y al volver el
     usuario mira cifras de dinero de hace una hora sin ninguna señal de que lo
     son. Al recuperar visibilidad o red se releen los datos.

     Es una lectura completa, no un parche: barata comparada con una suma de
     capital equivocada. */
  useEffect(() => {
    if (!user?.id) return;

    const resincronizar = () => {
      if (document.visibilityState !== 'visible') return;
      if (montado.current) fetchData();
    };

    document.addEventListener('visibilitychange', resincronizar);
    window.addEventListener('online', resincronizar);

    return () => {
      document.removeEventListener('visibilitychange', resincronizar);
      window.removeEventListener('online', resincronizar);
    };
  }, [user?.id, fetchData]);

  // Safe collections
  // Una lista vacía se queda vacía: es una respuesta válida, no un fallo.
  const safeProyectos = useMemo(() => (Array.isArray(proyectos) ? proyectos : []), [proyectos]);
  const safeGastos = useMemo(() => (Array.isArray(gastos) ? gastos : []), [gastos]);
  const safeHitos = useMemo(() => (Array.isArray(hitos) ? hitos : []), [hitos]);
  const safeArchivos = useMemo(() => (Array.isArray(archivos) ? archivos : []), [archivos]);
  const safeAportaciones = useMemo(() => (Array.isArray(aportaciones) ? aportaciones : []), [aportaciones]);

  /* ── Datos derivados: normalización y finanzas de cada proyecto ────────────
     Es el cálculo más caro del hook —recorre proyectos × (hitos + gastos)— y
     antes se rehacía en CADA render del panel, incluyendo los que solo abren un
     menú. Ahora solo se rehace cuando cambian las filas de las que depende. */
  const proyectosConFinanzas = useMemo(() => safeProyectos.filter(Boolean).map((proyecto) => {
    const pIdStr = String(proyecto.id || '');

    // ── Avance FÍSICO de obra: se lee del checklist real guardado en Supabase ──
    // Prioridad: filas de `checklist_hitos` > columna JSON `proyectos.checklist` > semilla local.
    // Va primero porque el costo ejecutado necesita el dinero de sus hitos.
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
      /* SIN semilla. El panel resume el portafolio entero: aquí una plantilla
         de ejemplo no es una sugerencia, es una mentira que se propaga al
         avance de obra, al estado del proyecto y al KPI "Avance promedio".
         La plantilla sigue existiendo, pero solo en la ficha del proyecto,
         donde se muestra rotulada como "plantilla inicial" y el administrador
         decide si la guarda. Ver la nota en data/checklistSeeds.js. */
      checklistFinal = [];
    }
    /* Sin hitos reales manda el dato GUARDADO en la fila, no una estimación:
       `porcentaje_avance` es lo último que alguien escribió a conciencia. */
    const avanceFisico = checklistFinal.length > 0
      ? calcularAvance(checklistFinal)
      : Math.round(aNumeroSeguro(proyecto.porcentaje_avance));

    const gastosProyecto = safeGastos.filter(g => g && String(g.proyecto_id || '') === pIdStr);
    const gastosSumados = sumarDinero(gastosProyecto, g => g?.monto);
    /* ── Costo ejecutado: facturas + obra cerrada ──────────────────────────
       Dos orígenes, ambos dinero ya ejecutado: la suma real de `gastos` (el
       pago documentado al proveedor) y el valor de los hitos completados (la
       obra que ya se dio por cerrada). El ajuste manual NO entra: el total se
       mueve registrando una factura o cerrando un hito, nunca escribiéndolo.
       La ficha del proyecto muestra las dos cifras por separado. */
    const valorHitosHechos = sumarValoresCompletados(checklistFinal);
    const costoEjecutado = Math.max(0, redondearDinero(gastosSumados + valorHitosHechos));
    const totalGastado = costoEjecutado;
    /* `??` y no `||`: un presupuesto guardado como 0 es una decisión del
       Administrador ("aún no se asigna"), no un hueco que haya que rellenar
       con el siguiente campo. */
    const presupuestoTotal = aNumeroSeguro(proyecto.presupuesto_total ?? proyecto.presupuesto);
    const balance = presupuestoTotal - totalGastado;
    /* División blindada: con presupuesto 0 el resultado es 0, NO "totalGastado
       / 1" — que es lo que producía porcentajes como "500000%". */
    const calcPct = porcentajeSeguro(totalGastado, presupuestoTotal);
    /* Mismo motivo con `??`: 0% gastado es una cifra legítima y no debe caer al
       siguiente candidato de la cadena. */
    const porcentajeGastado = aNumeroSeguro(
      proyecto.porcentajeGastado ?? proyecto.porcentaje_manual ?? calcPct
    );

    const nombreFinal = proyecto.nombre || proyecto.title || 'Proyecto';
    const ubicacionFinal = proyecto.ubicacion || proyecto.location || '';
    // El estado NO es texto fijo: sale del % de hitos completados.
    // 0% = Planificación · 1–99% = En progreso · 100% = Finalizado.
    const estadoFinal = estadoPorAvance(avanceFisico, checklistFinal.length);
    /* Sin portada NO se pone una foto de archivo: `null` y la interfaz dibuja
       su propio marcador de marca. Antes todos los proyectos sin foto salían
       con la misma imagen de Unsplash, que además no funciona sin conexión. */
    const imagenFinal = proyecto.imagen_url || proyecto.img || null;
    // Sin fecha cargada no se inventa una: la interfaz mostrará "—".
    const fechaFinal = proyecto.fecha_entrega || proyecto.entrega || null;

    return {
      ...proyecto,
      id: proyecto.id,
      nombre: nombreFinal,
      title: nombreFinal,
      ubicacion: ubicacionFinal,
      location: ubicacionFinal,
      descripcion: proyecto.descripcion || '',
      estado: estadoFinal,
      status: estadoFinal,
      tag: proyecto.tag || estadoFinal,
      imagen_url: imagenFinal,
      img: imagenFinal,
      presupuesto_total: presupuestoTotal,
      presupuesto: montoCorto(presupuestoTotal),
      fecha_entrega: fechaFinal,
      entrega: fechaFinal,
      // Cifras financieras reales de Supabase (editables por el Administrador)
      costo_ejecutado: costoEjecutado,
      gastosSumados,
      // Obra cerrada, medida en dinero. NO es gasto: es avance valorizado, y
      // por eso viaja aparte del costo ejecutado.
      valorHitosCompletados: valorHitosHechos,
      ejecucion_mensual: Array.isArray(proyecto.ejecucion_mensual) ? proyecto.ejecucion_mensual : [],
      totalGastado,
      ejecutado: montoCorto(totalGastado),
      balance,
      /* ── Las DOS métricas del proyecto, deliberadamente separadas ──────────
         No miden lo mismo y no deben presentarse juntas:
         · avanceFisico     = % de hitos del checklist completados (obra)
         · porcentajeGastado = % del presupuesto consumido (dinero)
         Mezclarlas hacía que "Ejecutado $32K (15%)" se leyera como si $32K
         fueran el 15% del presupuesto, cuando en realidad eran el 40%. */
      porcentajeGastado,
      progress: porcentajeGastado.toFixed(0),
      ejecutadoPct: `${porcentajeGastado.toFixed(0)}%`,
      checklist: checklistFinal,
      avanceFisico,
      avanceObra: `${avanceFisico}%`,
      hitosCompletados: checklistFinal.filter(h => h && h.done).length,
      hitosTotales: checklistFinal.length
    };
  }), [safeProyectos, safeGastos, safeHitos]);

  /* ── Vencimientos: UN SOLO criterio para toda la aplicación ───────────────
     Antes había dos. La campana filtraba `diffDays >= 0`, así que lo ya
     vencido —justo lo urgente— nunca avisaba; y "Tareas Críticas" no tenía
     límite inferior, así que iba acumulando hitos vencidos hace años mezclados
     con los de esta semana. Ahora ambos leen de aquí, con grado explícito. */
  const MS_DIA = 1000 * 60 * 60 * 24;
  // Un hito vencido deja de ser accionable pasado un tiempo: más allá de este
  // margen ya no es una alerta, es historia.
  const DIAS_GRACIA_VENCIDO = 30;

  /* "Hoy", anclado al inicio del día y renovado al cruzar la medianoche.
     `new Date()` en el cuerpo del hook daba un instante distinto en cada render
     y ningún `useMemo` aguantaba; fijarlo una sola vez arreglaba eso pero dejaba
     la PWA del teléfono —que puede pasar días abierta sin recargarse— midiendo
     los plazos contra la fecha de anteayer. `useDiaActual` hace las dos cosas.
     Ver la explicación completa en `hooks/useDiaActual.js`. */
  const inicioDeHoy = useDiaActual();

  /** Hitos pendientes que merecen atención: vencidos (recientes) o ≤7 días. */
  const vencimientos = useMemo(() => {
    const diasHasta = (fecha) => {
      if (!fecha) return null;
      const d = new Date(fecha);
      if (isNaN(d.getTime())) return null;
      return Math.ceil((d.getTime() - inicioDeHoy) / MS_DIA);
    };

    const conProyecto = (hito) => {
      const proyecto = safeProyectos.find(p => p && String(p.id) === String(hito.proyecto_id)) || null;
      const dias = diasHasta(hito.fecha_vencimiento);
      return {
        ...hito,
        /* Sin título NO se rellena aquí: el texto de relleno es cosa de la
           vista, que sí sabe en qué idioma está (`t('proy.hitoSinTitulo')`). */
        tarea: hito.titulo || hito.tarea || '',
        proyectoNombre: proyecto?.nombre || proyecto?.title || '',
        proyecto,
        dias,
        // Grado explícito: la interfaz pinta el color a partir de esto, no
        // recalculando el umbral por su cuenta en cada tarjeta.
        grado: dias === null ? 'sin_fecha' : dias < 0 ? 'vencido' : dias <= 7 ? 'urgente' : 'al_dia'
      };
    };

    return safeHitos
      .filter(h => h && !h.completado && h.fecha_vencimiento)
      .map(conProyecto)
      .filter(h => h.dias !== null && h.dias <= 7 && h.dias >= -DIAS_GRACIA_VENCIDO)
      .sort((a, b) => a.dias - b.dias);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeHitos, safeProyectos, inicioDeHoy]);

  // La campana muestra lo mismo que "Tareas Críticas": un solo concepto.
  const notificaciones = vencimientos;

  /* ── Finanzas globales del portafolio ────────────────────────────────────
     TRES cifras distintas que antes se mezclaban en una sola llamada "Egresos
     totales", que además sumaba aportaciones — es decir, dinero que ENTRA
     presentado como dinero que SALE. Separadas:

       · Capital comprometido   — suma de los presupuestos de los proyectos.
                                  Es una promesa de gasto, no un movimiento.
       · Aportaciones recibidas — suma REAL de `aportaciones`. Dinero que entró.
       · Egresos ejecutados     — facturas (`gastos`) + obra cerrada (valor de
                                  los hitos completados). Dinero que salió.

     De ahí salen dos disponibles, y tampoco son lo mismo:
       · `capitalDisponible`   = capital total − egresos ejecutados (del fondo)
       · `liquidezDisponible`  = aportaciones recibidas − egresos ejecutados
                                 (caja real; en negativo se está gastando más
                                 de lo que los socios han puesto). */
  const finanzasPortafolio = useMemo(() => {
    const aportacionesRecibidas = sumarDinero(safeAportaciones, a => a?.monto);
    /* Egresos = facturas + obra cerrada, exactamente el mismo criterio que el
       Costo Ejecutado de cada ficha. Si el portafolio sumara solo `gastos`, la
       cifra del panel y la de la ficha del proyecto no cuadrarían. */
    const totalFacturasPortafolio = sumarDinero(safeGastos, g => g?.monto);
    const totalObraCerrada = sumarDinero(proyectosConFinanzas, p => p?.valorHitosCompletados);
    const egresosEjecutados = redondearDinero(totalFacturasPortafolio + totalObraCerrada);

    // Capital total: el valor editado por el Administrador manda; si nunca se
    // configuró, se cae a la suma de los presupuestos de los proyectos.
    const capitalComprometido = sumarDinero(proyectosConFinanzas, p => p?.presupuesto_total);
    const capitalTotal = Number.isFinite(capitalConfigurado) && capitalConfigurado !== null
      ? capitalConfigurado
      : capitalComprometido;

    const capitalDisponible = redondearDinero(capitalTotal - egresosEjecutados);
    const liquidezDisponible = redondearDinero(aportacionesRecibidas - egresosEjecutados);
    const pctEjecutado = porcentajeSeguro(egresosEjecutados, capitalTotal, { limitar: true });
    const pctDisponible = capitalTotal > 0 ? Math.max(0, 100 - pctEjecutado) : 0;
    /* Salud del capital: la interfaz elige color y flecha a partir de esto, en
       vez de pintar siempre una flecha verde hacia arriba pasara lo que pasara.
       Un sobregiro de caja (se gastó más de lo aportado) también es sobregiro,
       aunque el fondo configurado dé de sobra. */
    const saludCapital = capitalTotal <= 0
      ? 'sin_dato'
      : (capitalDisponible < 0 || liquidezDisponible < 0)
        ? 'sobregiro'
        : pctDisponible < 20
          ? 'ajustado'
          : 'holgado';

    return {
      aportacionesRecibidas, egresosEjecutados, capitalComprometido, capitalTotal,
      capitalDisponible, liquidezDisponible, pctEjecutado, pctDisponible, saludCapital
    };
  }, [safeAportaciones, safeGastos, proyectosConFinanzas, capitalConfigurado]);

  const {
    aportacionesRecibidas, egresosEjecutados, capitalComprometido, capitalTotal,
    capitalDisponible, liquidezDisponible, pctEjecutado, pctDisponible, saludCapital
  } = finanzasPortafolio;

  /** Guarda el capital total y lo refleja al momento (sin esperar a Realtime). */
  const actualizarCapitalTotal = useCallback(async (monto) => {
    const resultado = await guardarCapitalTotal(monto);
    if (resultado.success && montado.current) {
      const importe = Number(String(monto).replace(/[^\d.-]/g, ''));
      setCapitalConfigurado(Number.isFinite(importe) ? importe : null);
    }
    return resultado;
  }, []);

  return {
    proyectos: proyectosConFinanzas,
    gastos: safeGastos,
    hitos: safeHitos,
    archivos: safeArchivos,
    aportaciones: safeAportaciones,
    rol,
    perfil,
    loading,
    errorCarga,
    // Tablas recortadas por el techo de PostgREST (lista de nombres, vacía si
    // todo llegó completo). Las sumas de dinero dependen de esto.
    datosParciales,
    notificaciones,
    vencimientos,
    refetchData: fetchData,
    // Finanzas reactivas del portafolio
    capitalTotal,
    capitalComprometido,
    // Nombre anterior de `capitalComprometido`, conservado por compatibilidad
    capitalPresupuestado: capitalComprometido,
    capitalConfigurado,
    aportacionesRecibidas,
    egresosEjecutados,
    capitalDisponible,
    liquidezDisponible,
    pctEjecutado,
    pctDisponible,
    saludCapital,
    actualizarCapitalTotal,
    isAdmin: ['admin', 'socio_administrador'].includes(rol),
    isInvestorOrPartner: ['inversionista', 'socio_director'].includes(rol)
  };
}
