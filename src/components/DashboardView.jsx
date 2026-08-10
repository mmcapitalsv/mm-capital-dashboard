import React, { useState, useEffect, useRef, useCallback } from 'react';
import { usePrefs } from '../context/PreferenciasContext';
import NombreAjustado from './ui/NombreAjustado';
import { HyperText } from './ui/hyper-text';
import PortadaProyecto from './ui/PortadaProyecto';
import InputMonto from './ui/InputMonto';
import MetricasProyecto from './ui/MetricasProyecto';
import { ID_INPUT_PORTADA } from '../lib/portada';
import { etiquetaEstado } from '../i18n/diccionario';
import { montoCorto, montoExacto, sinNumeracion } from '../lib/formato';
import { aNumeroSeguro, promedioSeguro } from '../lib/numeros';
import {
  Activity, AlertTriangle, ArrowUp, Building2, Calendar, Camera, ChevronLeft,
  ChevronRight, DollarSign, Edit2, FileText, Loader2, MapPin, Save,
  TrendingUp, TrendingDown, Wallet, X
} from 'lucide-react';
import { Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

/* Colores de las gráficas. Recharts pinta con atributos SVG, no con clases de
   Tailwind, así que necesita el valor literal.
   El verde es el mismo `emerald-500` de la barra de Ejecución financiera: el
   anillo y la barra representan el mismo dato y deben compartir color. */
const COLOR_ORO = '#C5A059';
const COLOR_VERDE = '#10b981';

/**
 * Colores de gráfica según el tema activo.
 *
 * Recharts pinta con atributos SVG, no con clases de Tailwind, así que no
 * entiende `dark:` y hay que darle valores concretos.
 *
 * Se derivan de `modoOscuro` en JavaScript y NO se leen del DOM con
 * `getComputedStyle`: ese fue el primer intento y estaba mal, porque el
 * `useMemo` corre durante el render mientras la clase `.dark` la aplica un
 * efecto POSTERIOR, así que siempre leía el tema anterior.
 */
const PALETA_GRAFICA = {
  claro:  { pendiente: '#E2E8F0', fondo: '#ffffff', borde: '#e5e7eb', texto: '#0f172a' },
  oscuro: { pendiente: '#3f3f46', fondo: '#18222D', borde: '#3f3f46', texto: '#f4f4f5' }
};

function useColoresGrafica(modoOscuro) {
  return React.useMemo(() => {
    const p = PALETA_GRAFICA[modoOscuro ? 'oscuro' : 'claro'];
    return {
      colorPendiente: p.pendiente,
      estiloTooltip: {
        background: p.fondo,
        border: `1px solid ${p.borde}`,
        borderRadius: '12px',
        color: p.texto,
        fontSize: '12px',
        fontWeight: 600
      }
    };
  }, [modoOscuro]);
}

/**
 * Sección operacional: título, filete y filas. SIN tarjeta.
 *
 * Antes cada una de estas tres listas vivía dentro de su propio rectángulo
 * blanco con borde y sombra. Tres cajas iguales, una al lado de otra, con el
 * mismo peso visual que el proyecto destacado: nada mandaba y el conjunto
 * parecía un panel administrativo.
 *
 * Aquí respiran directamente sobre el lienzo y las filas se separan con
 * filetes, no con aire ni con bordes. Es la lectura de un libro de registros,
 * que es justo lo que son.
 */
function SeccionOperacional({ titulo, textoAccion, onAccion, children }) {
  /* Se probó quitarles la tarjeta y dejarlas respirar sobre el lienzo, con la
     idea de reducir "carditis". El resultado fue peor: sin contenedor las tres
     listas flotan y el bloque deja de leerse como un dossier organizado. La
     tarjeta aquí SÍ hace un trabajo — agrupa. Lo que sobraba era el borde
     grueso y la sombra fuerte, no el contenedor.

     Las filas se separan con filetes, no con aire: lectura de libro de
     registros, que es lo que estas listas son. */
  return (
    <section className="min-w-0 bg-white dark:bg-zinc-800 rounded-[20px] border border-gray-100/80 dark:border-zinc-700/80 shadow-[var(--mm-sombra)] p-5">
      <div className="flex items-baseline justify-between gap-3 pb-3 mb-1 border-b border-gray-100 dark:border-zinc-700">
        <h3 className="text-[11px] font-bold text-slate-900 dark:text-white tracking-[0.12em] uppercase truncate">{titulo}</h3>
        {onAccion && (
          <button
            onClick={onAccion}
            className="text-[11px] font-semibold text-mm-oro-tinta dark:text-mm-oro-claro hover:underline flex-shrink-0"
          >
            {textoAccion}
          </button>
        )}
      </div>
      <div className="divide-y divide-gray-100 dark:divide-zinc-700/70">{children}</div>
    </section>
  );
}

/** Fila de una sección operacional: icono discreto, texto, valor a la derecha. */
function FilaOperacional({ icono, tonoIcono, titulo, subtitulo, valor, tonoValor, onClick, tituloAcceso }) {
  const Contenido = (
    <>
      <span className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${tonoIcono}`}>
        {icono}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[13px] font-medium text-mm-1 leading-snug break-words">{titulo}</span>
        {subtitulo && <span className="block t-meta text-mm-3 mt-0.5 break-words">{subtitulo}</span>}
      </span>
      {valor && (
        <span className={`text-[13px] font-semibold flex-shrink-0 tabular-nums self-center ${tonoValor || 'text-mm-2'}`}>
          {valor}
        </span>
      )}
    </>
  );

  if (!onClick) {
    return <div className="w-full flex items-start gap-3 py-3">{Contenido}</div>;
  }
  return (
    <button
      onClick={onClick}
      title={tituloAcceso}
      className="w-full text-left flex items-start gap-3 py-3 -mx-2 px-2 rounded-lg hover:bg-black/[0.025] dark:hover:bg-white/[0.03] transition-colors"
    >
      {Contenido}
    </button>
  );
}

/** Estado vacío sobrio: dice qué falta, sin botones que no llevan a nada. */
function VacioSeccion({ texto }) {
  return <p className="t-meta text-mm-3 py-6 text-center">{texto}</p>;
}

/**
 * Vista Portfolio: el panel propiamente dicho.
 *
 * Salió de Dashboard.jsx sin tocar una sola clase: saludo, tarjetas de
 * resumen, proyecto destacado (carrusel de escritorio y carrusel táctil
 * móvil), la dona de avance y las tres secciones operacionales. Con ella se
 * fueron sus estados —los dos carruseles y la edición del Capital Total—,
 * que no los necesitaba nadie más.
 *
 * Lo que se queda en el orquestador es lo que de verdad comparten TODAS las
 * pantallas: la identidad, la navegación, la campana y el selector de portada.
 */
export default function DashboardView({
  proyectos, loading, errorCarga, refetchData,
  isAdmin, isEditMode,
  saludo, nombreUsuario, timeCST, timePDT,
  cifrasNoFiables, capitalTotal, capitalComprometido, aportacionesRecibidas,
  egresosEjecutados, liquidezDisponible, pctDisponible, saludCapital, datosParciales,
  actualizarCapitalTotal,
  entradasActividad, entradasHitos, entradasTareas,
  changeView, handleCardClick, abrirProyectoDeItem, setModalLista,
  portadaMsg, subiendoPortadaId, pedirPortadaProyecto
}) {
  // Preferencias de interfaz (tema e idioma) compartidas por toda la app
  const { modoOscuro, t, locale } = usePrefs();
  // Colores de las gráficas: recharts no entiende `dark:`, hay que dárselos
  const { colorPendiente, estiloTooltip } = useColoresGrafica(modoOscuro);

  // Usa los proyectos reales de Supabase
  const PROJECTS = proyectos;

  /* ── KPIs calculados desde Supabase ────────────────────────────────────────
     Tres cifras distintas, y se nombran distinto:
       · `capitalTotal`          — capital comprometido: lo editado por el
                                   Administrador, o la suma de presupuestos.
       · `aportacionesRecibidas` — suma real de `aportaciones` (dinero que ENTRA).
       · `egresosEjecutados`     — suma real de `gastos` (dinero que SALE).
     Antes el KPI "Egresos totales" mostraba las aportaciones: enseñaba el
     ingreso rotulado como gasto. */
  const totalCapital = capitalTotal;

  const [featuredIndex, setFeaturedIndex] = useState(0);

  /* 1. Auto-slide del Proyecto Destacado.
     `reinicioCarrusel` se incrementa en cada navegación manual: al cambiar la
     dependencia, React limpia el intervalo anterior y arranca uno nuevo, así
     el slide recién elegido dura los 6 s completos en vez de saltar enseguida. */
  const DURACION_SLIDE = 6000;
  const [reinicioCarrusel, setReinicioCarrusel] = useState(0);
  /* Con el cursor encima manda quien está leyendo, no el temporizador. Antes
     la tarjeta se cambiaba sola a mitad de la descripción del proyecto: el
     carrusel móvil ya pausaba con el dedo, pero el de escritorio no tenía
     equivalente. */
  const [carruselPausado, setCarruselPausado] = useState(false);

  useEffect(() => {
    if (!proyectos || proyectos.length < 2) return;
    if (carruselPausado) return;
    // Respeta a quien pidió menos movimiento en su sistema
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    const timer = setInterval(() => {
      setFeaturedIndex((prevIndex) => (prevIndex + 1) % proyectos.length);
    }, DURACION_SLIDE);
    return () => clearInterval(timer);
  }, [proyectos.length, reinicioCarrusel, carruselPausado]);

  /** Navegación manual: fija el slide y reinicia el temporizador desde cero. */
  const irASlide = (indice) => {
    const total = proyectos.length;
    if (total === 0) return;
    setFeaturedIndex(((indice % total) + total) % total);
    setReinicioCarrusel(n => n + 1);
  };

  // Índice del proyecto centrado en el carrusel táctil móvil: manda sobre la
  // gráfica de "Avance de Obra Ejecutado" de esa misma vista.
  const [indiceMovil, setIndiceMovil] = useState(0);
  /* El carrusel se monta DESPUÉS de que llegan los proyectos (antes hay un
     spinner), así que un `useRef` normal seguiría en null cuando corre el
     efecto del auto-avance y este no volvería a ejecutarse. Con un ref por
     callback guardado en estado, el efecto se dispara justo cuando el nodo
     aparece — y se limpia cuando desaparece al cambiar de vista. */
  const [carruselMovil, setCarruselMovil] = useState(null);
  const refCarruselMovil = useCallback((nodo) => setCarruselMovil(nodo), []);


  /* Auto-avance del carrusel táctil móvil.
     Mismo ritmo que el escritorio (6 s) pero desplazando el propio contenedor,
     así el gesto del dedo y el automático comparten la misma animación suave.
     `indiceMovil` va en las dependencias a propósito: en cuanto el usuario
     desliza a otro proyecto, el intervalo se limpia y ese slide vuelve a durar
     los 6 s completos, en vez de saltar enseguida. */
  /* Marca de tiempo del último gesto, NO un booleano "tocando": un
     `touchstart` que se queda sin su `touchend` dejaría el carrusel congelado
     para siempre. Con la marca, la pausa caduca sola. */
  const ultimoGestoRef = useRef(0);
  const PAUSA_TRAS_GESTO = 1500;

  useEffect(() => {
    if (!carruselMovil || proyectos.length < 2) return;
    // Respeta a quien pidió menos movimiento en su sistema
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    const timer = setInterval(() => {
      // Con el dedo encima manda el usuario, no el temporizador
      if (Date.now() - ultimoGestoRef.current < PAUSA_TRAS_GESTO) return;
      const hijo = carruselMovil.children[(indiceMovil + 1) % proyectos.length];
      if (!hijo) return;
      const rc = carruselMovil.getBoundingClientRect();
      const rh = hijo.getBoundingClientRect();
      const delta = (rh.left + rh.width / 2) - (rc.left + rc.width / 2);
      carruselMovil.scrollTo({ left: carruselMovil.scrollLeft + delta, behavior: 'smooth' });
    }, DURACION_SLIDE);

    return () => clearInterval(timer);
  }, [carruselMovil, proyectos.length, indiceMovil]);

  const safeIndex = PROJECTS.length > 0 ? featuredIndex % PROJECTS.length : 0;
  const fp = PROJECTS[safeIndex] || null;

  // Avance FÍSICO promedio: promedio del % de checklist real de cada proyecto (Supabase)
  const avanceProm = React.useMemo(
    () => promedioSeguro(proyectos, p => p?.avanceFisico).toFixed(0),
    [proyectos]
  );

  // Avance físico del proyecto activo del carrusel (0-100), blindado contra nulos
  const avanceProyectoActivo = fp
    ? Math.max(0, Math.min(100, Math.round(aNumeroSeguro(fp.avanceFisico))))
    : 0;
  const hitosHechos = aNumeroSeguro(fp?.hitosCompletados);
  const hitosTotales = aNumeroSeguro(fp?.hitosTotales);

  /* ── Proyecto visible en el carrusel táctil móvil ────────────────────────
     No se mezcla con `featuredIndex` (que rota solo cada 6 s en escritorio):
     en móvil manda el dedo, así que el índice lo fija el propio scroll. */
  const indiceMovilSeguro = PROJECTS.length > 0
    ? Math.min(Math.max(indiceMovil, 0), PROJECTS.length - 1)
    : 0;
  const fpMovil = PROJECTS[indiceMovilSeguro] || null;
  const avanceMovil = fpMovil
    ? Math.max(0, Math.min(100, Math.round(aNumeroSeguro(fpMovil.avanceFisico))))
    : 0;
  const hitosHechosMovil = aNumeroSeguro(fpMovil?.hitosCompletados);
  const hitosTotalesMovil = aNumeroSeguro(fpMovil?.hitosTotales);
  /* Ejecución financiera del proyecto centrado. Se lee de `porcentajeGastado`,
     la MISMA fuente que usa la barra verde de la tarjeta: si se recalculara
     aquí a mano, el anillo y la barra podrían acabar diciendo cifras distintas
     del mismo dato. */
  const pctFinancieroMovil = fpMovil
    ? Math.max(0, Math.min(100, Math.round(aNumeroSeguro(fpMovil.porcentajeGastado))))
    : 0;

  /* Lo mismo para el proyecto del carrusel de escritorio, que rota por su
     cuenta cada 6 s y no tiene por qué coincidir con el del móvil. */
  const pctFinancieroActivo = fp
    ? Math.max(0, Math.min(100, Math.round(aNumeroSeguro(fp.porcentajeGastado))))
    : 0;

  /* ── Bucle del carrusel táctil ─────────────────────────────────────────────
     Es un contenedor de scroll nativo, así que físicamente no se puede
     arrastrar más allá de la última tarjeta: el dedo se topa con el final y no
     pasa nada. Aquí se detecta ese intento — estás al final Y deslizas para
     avanzar — y se salta al principio, para que se pueda seguir a la derecha
     indefinidamente. Lo mismo al revés desde la primera. */
  const inicioGestoX = useRef(0);

  const alEmpezarGesto = (e) => {
    ultimoGestoRef.current = Date.now();
    inicioGestoX.current = e.touches?.[0]?.clientX ?? 0;
  };

  const alSoltarGesto = (e) => {
    ultimoGestoRef.current = Date.now();
    const cont = carruselMovil;
    if (!cont || PROJECTS.length < 2) return;

    const finX = e.changedTouches?.[0]?.clientX ?? 0;
    const recorrido = finX - inicioGestoX.current;
    if (Math.abs(recorrido) < 40) return;   // roce, no gesto

    const margen = 4;   // el scroll rara vez cae en el píxel exacto
    const alFinal = cont.scrollLeft >= cont.scrollWidth - cont.clientWidth - margen;
    const alInicio = cont.scrollLeft <= margen;

    // Deslizar hacia la izquierda = querer avanzar
    if (recorrido < 0 && alFinal) {
      cont.scrollTo({ left: 0, behavior: 'smooth' });
    } else if (recorrido > 0 && alInicio) {
      cont.scrollTo({ left: cont.scrollWidth, behavior: 'smooth' });
    }
  };

  /** Detecta qué tarjeta quedó centrada tras soltar el swipe. */
  const alScrollCarruselMovil = (e) => {
    const cont = e.currentTarget;
    if (!cont) return;
    const centro = cont.scrollLeft + cont.clientWidth / 2;
    let mejor = 0;
    let mejorDist = Infinity;
    Array.from(cont.children).forEach((hijo, i) => {
      const dist = Math.abs((hijo.offsetLeft + hijo.offsetWidth / 2) - centro);
      if (dist < mejorDist) { mejorDist = dist; mejor = i; }
    });
    setIndiceMovil(prev => (prev === mejor ? prev : mejor));
  };
  /* ── Edición del Capital Total (solo Administrador en MODO EDICIÓN) ────── */
  const [editandoCapital, setEditandoCapital] = useState(false);
  const [capitalBorrador, setCapitalBorrador] = useState('');
  const [guardandoCapital, setGuardandoCapital] = useState(false);
  const [capitalMsg, setCapitalMsg] = useState(null);

  // Al salir del modo edición se cierra el formulario del capital
  useEffect(() => {
    if (!isEditMode) { setEditandoCapital(false); setCapitalMsg(null); }
  }, [isEditMode]);

  const abrirEdicionCapital = () => {
    setCapitalBorrador(String(Math.round(aNumeroSeguro(capitalTotal))));
    setCapitalMsg(null);
    setEditandoCapital(true);
  };

  const guardarCapital = async (e) => {
    e?.preventDefault?.();
    setGuardandoCapital(true);
    const { success, error } = await actualizarCapitalTotal(capitalBorrador);
    setGuardandoCapital(false);

    if (success) {
      setEditandoCapital(false);
      setCapitalMsg({ tipo: 'exito', texto: t('dash.capitalGuardado') });
      setTimeout(() => setCapitalMsg(null), 4000);
    } else {
      setCapitalMsg({ tipo: 'error', texto: error });
    }
  };

  return (
            <main className="flex-1 flex flex-col overflow-hidden bg-transparent">

              {/* La barra superior móvil ya no vive aquí: subió al contenedor
                  principal para acompañar a todas las vistas. */}
              <div className="flex-1 overflow-y-auto custom-scrollbar w-full pb-6 md:pb-20 bg-transparent">

                {/* ── Saludo móvil + reloj dual ──
                    El reloj bajó aquí desde la barra azul: aprovecha el hueco
                    de la derecha y deja la cabecera despejada. */}
                {/* Mismo criterio que en escritorio: el nombre en dorado es la
                    marca, no un adorno. El reloj recupera su cápsula para no
                    quedar suelto contra el saludo. */}
                {/* El reloj comparte fila con el SALUDO, no con el nombre.
                    "Buenas noches," es corto y le deja sitio de sobra; el
                    nombre baja a la línea siguiente y aprovecha todo el ancho.
                    Así el reloj vuelve a ser horizontal (apilado ocupaba dos
                    renglones para nada) y el nombre no tiene que encogerse. */}
                <header className="md:hidden px-4 pt-5 pb-3 w-full">
                  <div className="flex items-center justify-between gap-3">
                    <h1 className="text-[21px] font-bold text-slate-900 dark:text-white tracking-tight leading-tight min-w-0 truncate">
                      {t(saludo)}
                    </h1>
                    <div className="flex items-center gap-1 bg-white dark:bg-zinc-800 border border-gray-100 dark:border-zinc-700 rounded-lg px-1.5 py-1 shadow-sm flex-shrink-0 whitespace-nowrap">
                      {/* La hora es dato de apoyo, no protagonista: se queda en
                          el mínimo legible (11px) y el rótulo del huso baja a
                          10px, que al ser dos letras en mayúscula se sigue
                          leyendo sin esfuerzo. */}
                      <span className="flex items-center gap-0.5 text-[10px] font-bold tracking-normal text-slate-400 dark:text-zinc-300 uppercase leading-none">
                        SV <span className="text-[11px] text-slate-900 dark:text-white tracking-normal tabular-nums">{timeCST || '--:--'}</span>
                      </span>
                      <span className="w-px h-3 bg-gray-200 dark:bg-zinc-600" />
                      <span className="flex items-center gap-0.5 text-[10px] font-bold tracking-normal text-slate-400 dark:text-zinc-300 uppercase leading-none">
                        US <span className="text-[11px] text-slate-900 dark:text-white tracking-normal tabular-nums">{timePDT || '--:--'}</span>
                      </span>
                    </div>
                  </div>

                  {/* El nombre ocupa la fila entera: `NombreAjustado` solo tiene
                      que encogerlo si es larguísimo. */}
                  <NombreAjustado
                    texto={nombreUsuario}
                    descifrar
                    esperando={loading}
                    max={21}
                    min={14}
                    className="text-mm-oro-tinta dark:text-mm-oro-claro font-bold tracking-tight leading-tight mt-0.5"
                  />
                  <p className="text-slate-500 dark:text-zinc-300 text-[13px] mt-1 font-medium truncate">
                    {t('dash.panelEjecutivo')}
                  </p>
                </header>

                {/* ── KPIs móvil (bloque oscuro) ── */}
                <section className="px-4 md:px-8 py-2 md:py-4 w-full">
                  {/* Bloque navy = superficie de realce. Es lo único que se
                      permite destacar así en la pantalla, por eso las tarjetas
                      de abajo ya no compiten con él. */}
                  <div className="md:hidden bg-mm-navy dark:bg-zinc-800 rounded-[20px] p-4 text-white shadow-xl">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-lg bg-mm-oro flex items-center justify-center">
                          <Activity size={16} className="text-mm-navy" />
                        </div>
                        <div>
                          <h2 className="text-sm font-bold">{t('dash.resumen')}</h2>
                          <p className="text-[11px] text-white/70">{t('dash.resumenSub')}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-400"></div>
                        <span className="text-[11px] text-white/80">{t('dash.enLinea')}</span>
                      </div>
                    </div>
                    {/* Las 4 tarjetas SIEMPRE a la vista, en 2×2.
                        Antes iban en una sola fila de cuatro: a 375px cada
                        celda quedaba en ~80px y las etiquetas había que
                        bajarlas a 7px para que cupieran. Con dos columnas hay
                        el doble de ancho y la letra vuelve a ser legible. */}
                    {/* Las CUATRO a la vista en una fila. Se probó 2×2 para
                        ganar sitio tras subir el piso tipográfico, pero el
                        bloque perdió la lectura de "resumen de un vistazo" y
                        duplicó su alto. La solución era estrechar la celda, no
                        partir la rejilla. */}
                    <div className="grid grid-cols-4 gap-1.5 mt-2">
                      {[
                        { icono: Building2, valor: cifrasNoFiables ? '–' : String(PROJECTS.length), etiqueta: t('dash.proyectosActivos') },
                        // El Capital Total es la ÚNICA cifra escrita a mano de
                        // este bloque, así que es la única con lápiz.
                        { icono: DollarSign, valor: cifrasNoFiables ? '–' : montoCorto(totalCapital, locale), exacto: montoExacto(totalCapital, locale), etiqueta: t('dash.capitalTotal'), editable: true },
                        { icono: TrendingUp, valor: cifrasNoFiables ? '–' : `${avanceProm}%`, etiqueta: t('dash.avancePromedioMin') },
                        // Mismo dato que el KPI 4 del escritorio: la suma real
                        // de `gastos`, el dinero efectivamente pagado.
                        { icono: Wallet, valor: cifrasNoFiables ? '–' : montoCorto(egresosEjecutados, locale), exacto: montoExacto(egresosEjecutados, locale), etiqueta: t('dash.egresosEjecutados') }
                      ].map((kpi, i) => {
                        const puedeEditarKpi = kpi.editable && isAdmin && isEditMode;
                        return (
                          /* Apilado vertical: con cuatro columnas en 390px cada
                             celda queda en ~77px y el icono al lado del texto
                             no cabe. Centrado, el icono arriba y la cifra
                             debajo entran de sobra. */
                          <div
                            key={i}
                            className="relative min-w-0 bg-mm-navy-alto dark:bg-zinc-700 rounded-xl px-1.5 py-2.5 flex flex-col items-center text-center border border-white/5 dark:border-zinc-600"
                          >
                            {puedeEditarKpi && (
                              <button
                                onClick={abrirEdicionCapital}
                                aria-label={t('dash.editarCapital')}
                                className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-mm-oro text-mm-navy flex items-center justify-center shadow-md active:scale-90 transition-transform z-10"
                              >
                                <Edit2 size={12} />
                              </button>
                            )}
                            <div className="w-7 h-7 rounded-full border border-mm-oro/30 flex items-center justify-center flex-shrink-0 mb-1.5">
                              <kpi.icono size={13} className="text-mm-oro" />
                            </div>
                            <p
                              title={kpi.exacto}
                              className="text-[15px] font-bold leading-none mb-1 w-full truncate tabular-nums"
                            >
                              {kpi.valor}
                            </p>
                            {/* Sin `truncate`: "Proyectos acti…" no dice nada.
                                La etiqueta baja de línea antes que recortarse. */}
                            <p className="text-[11px] text-white/80 leading-[1.2]">{kpi.etiqueta}</p>
                          </div>
                        );
                      })}
                    </div>

                    {/* Edición del Capital Total en móvil (misma función que en
                        escritorio: `guardarCapital` escribe en configuración). */}
                    {editandoCapital && (
                      <form onSubmit={guardarCapital} className="mt-3 flex items-center gap-2 bg-mm-navy-alto dark:bg-zinc-700 border border-mm-oro/50 rounded-xl px-2.5 py-2">
                        <span className="text-xs font-bold text-white/70 flex-shrink-0">{t('dash.capitalTotal')}</span>
                        <span className="text-sm font-black text-white/80">$</span>
                        <InputMonto
                          autoFocus
                          value={capitalBorrador}
                          onChange={setCapitalBorrador}
                          className="flex-1 min-w-0 bg-transparent border-b border-mm-oro text-sm font-bold text-white focus:outline-none"
                        />
                        <button
                          type="submit"
                          disabled={guardandoCapital}
                          aria-label={t('comun.guardar')}
                          className="p-1.5 rounded-lg text-emerald-300 active:bg-white/10 disabled:opacity-40 flex-shrink-0"
                        >
                          {guardandoCapital ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditandoCapital(false)}
                          aria-label={t('comun.cancelar')}
                          className="p-1.5 rounded-lg text-white/60 active:bg-white/10 flex-shrink-0"
                        >
                          <X size={16} />
                        </button>
                      </form>
                    )}

                    {capitalMsg && (
                      <p className={`mt-2 text-[11px] font-bold ${
                        capitalMsg.tipo === 'exito' ? 'text-emerald-400' : 'text-red-400'
                      }`}>
                        {capitalMsg.texto}
                      </p>
                    )}
                  </div>

                  {/* Los botones "Nuevo Proyecto" / "Todos los Proyectos" se
                      eliminaron en móvil: esos accesos ya viven en la barra
                      inferior fija. En escritorio siguen intactos. */}

                  {/* ══════════════════════════════════════════════
                      MÓVIL · Proyectos destacados (carrusel táctil)
                  ══════════════════════════════════════════════ */}
                  <div className="md:hidden mt-5">
                    {/* El aviso de "portada actualizada" también en móvil: antes
                        solo existía en el bloque de escritorio y desde el
                        teléfono la subida no daba señal de vida. */}
                    {portadaMsg && (
                      <div className={`mb-2.5 text-[11px] font-bold px-3 py-2 rounded-xl border ${
                        portadaMsg.tipo === 'exito'
                          ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30'
                          : 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 border-red-200 dark:border-red-500/30'
                      }`}>
                        {portadaMsg.texto}
                      </div>
                    )}
                    <div className="flex items-center justify-between mb-3">
                      <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                         {t('dash.proyectoDestacado')}
                      </h2>
                      <button
                        onClick={() => changeView('all-projects')}
                        className="text-[11px] font-semibold text-mm-oro-tinta dark:text-mm-oro-claro flex items-center gap-0.5"
                      >
                        {t('comun.verTodos')} <ChevronRight size={13} />
                      </button>
                    </div>

                    {loading ? (
                      <div className="h-52 flex items-center justify-center bg-white dark:bg-zinc-800 rounded-[20px] border border-gray-100 dark:border-zinc-700">
                        <div className="w-7 h-7 border-2 border-mm-oro border-t-transparent rounded-full animate-spin" />
                      </div>
                    ) : PROJECTS.length === 0 ? (
                      <div className="h-40 flex flex-col items-center justify-center gap-2 bg-white dark:bg-zinc-800 rounded-[20px] border border-gray-100 dark:border-zinc-700">
                        <Building2 size={32} className="text-slate-200 dark:text-zinc-600" />
                        <p className="text-xs text-slate-400 dark:text-zinc-200 font-medium">{t('dash.sinProyectos')}</p>
                      </div>
                    ) : (
                      <>
                        {/* Sin flechas: el gesto manda. Cada tarjeta ocupa 90vw
                            y se ancla al centro al soltar el dedo. */}
                        <div
                          ref={refCarruselMovil}
                          onScroll={alScrollCarruselMovil}
                          onTouchStart={alEmpezarGesto}
                          onTouchMove={() => { ultimoGestoRef.current = Date.now(); }}
                          onTouchEnd={alSoltarGesto}
                          className="flex overflow-x-auto snap-x snap-mandatory hide-scrollbar gap-3 -mx-4 px-[5vw] scroll-px-[5vw]"
                        >
                          {PROJECTS.map((p) => {
                            /* El % ya viene calculado en el hook (`avanceFisico`
                               y `porcentajeGastado`): no se recalcula aquí para
                               que la tarjeta no pueda discrepar de la ficha. */
                            return (
                              <article
                                key={p.id}
                                onClick={() => handleCardClick(p)}
                                className="w-[90vw] shrink-0 snap-center bg-white dark:bg-zinc-800 rounded-[20px] border border-gray-100 dark:border-zinc-700 shadow-[0_2px_16px_rgba(0,0,0,0.06)] p-3 active:scale-[0.98] transition-transform"
                              >
                                {/* Imagen a la IZQUIERDA, detalle a la DERECHA */}
                                <div className="flex gap-3">
                                  {/* Del 38% al 46% de ancho. El problema no era
                                      el alto sino la proporción: a 38% quedaba
                                      una franja estrecha y alargada donde una
                                      foto de terreno no se distingue. Ahora
                                      acompaña el alto del texto y sale casi
                                      cuadrada, que es como se lee bien. */}
                                  {/* `mt-7`: la foto arranca a la altura del
                                      TÍTULO, no del badge de estado. Empezando
                                      arriba del todo quedaba demasiado alta y
                                      estrecha, y una foto de terreno en formato
                                      vertical no se lee. */}
                                  <div className="w-[46%] flex-shrink-0 rounded-2xl overflow-hidden bg-slate-100 dark:bg-zinc-700 mt-7 relative">
                                    <PortadaProyecto
                                      url={p.imagen_url}
                                      alt={p.nombre}
                                      claseImg="absolute inset-0 w-full h-full object-cover"
                                      claseRespaldo="absolute inset-0"
                                      tamanoIcono={30}
                                      claseIcono="text-slate-300 dark:text-zinc-300"
                                    />
                                    {/* Cambiar la portada DESDE EL TELÉFONO. Sin hover
                                        que valga: con el Modo Edición encendido el
                                        control está siempre a la vista y es tocable.
                                        `stopPropagation` para que tocarlo no abra
                                        además la ficha del proyecto. */}
                                    {isEditMode && (
                                      <label
                                        htmlFor={ID_INPUT_PORTADA}
                                        onClick={(e) => { e.stopPropagation(); pedirPortadaProyecto(p.id); }}
                                        aria-label={t('dash.cambiarPortada')}
                                        className="absolute inset-0 bg-black/45 flex flex-col items-center justify-center gap-1.5 active:bg-black/60 transition-colors cursor-pointer"
                                      >
                                        <span className="bg-white/90 p-2 rounded-full text-slate-900">
                                          {subiendoPortadaId === p.id
                                            ? <Loader2 size={16} className="animate-spin" />
                                            : <Camera size={16} />}
                                        </span>
                                        <span className="text-[11px] font-bold text-white tracking-wide px-1 text-center leading-tight">
                                          {subiendoPortadaId === p.id ? t('comun.subiendo') : t('dash.cambiarPortada')}
                                        </span>
                                      </label>
                                    )}
                                  </div>

                                  <div className="flex-1 min-w-0 flex flex-col">
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-mm-oro-lavado dark:bg-amber-500/10 text-mm-oro-tinta dark:text-mm-oro-claro border border-mm-oro-borde dark:border-amber-500/30 w-fit mb-2">
                                      {etiquetaEstado(p.estado, t)}
                                    </span>

                                    <h3 className="text-sm font-bold text-slate-900 dark:text-white leading-tight uppercase break-words">{p.nombre}</h3>

                                    {p.ubicacion && (
                                      <p className="text-[11px] text-mm-2 flex items-center gap-1 mt-1 font-medium min-w-0">
                                        <MapPin size={11} className="text-mm-3 flex-shrink-0" />
                                        <span className="truncate">{p.ubicacion}</span>
                                      </p>
                                    )}

                                    {p.descripcion && (
                                      <p className="text-[11px] text-mm-2 leading-snug line-clamp-2 mt-1.5">
                                        {p.descripcion}
                                      </p>
                                    )}

                                    {/* Las DOS métricas, cada una con su nombre.
                                        Antes había un "%" grande sin contexto
                                        arriba y un "(15%)" pegado al dinero
                                        abajo — el mismo número significando
                                        dos cosas distintas. */}
                                    <div className="mt-auto pt-2.5">
                                      <MetricasProyecto proyecto={p} compacta />
                                    </div>
                                  </div>
                                </div>

                                {/* Fila inferior: SOLO la fecha de entrega.
                                    "Inversión total" y "Ejecutado" se quitaron
                                    porque la barra de Ejecución financiera de
                                    arriba ya dice exactamente lo mismo
                                    ("$5.0K de $100.0K"), y repetir la cifra dos
                                    veces en la misma tarjeta no añade nada. */}
                                <div className="flex items-center justify-between gap-2.5 pt-2.5 mt-2.5 border-t border-gray-100 dark:border-zinc-700">
                                  <div className="min-w-0 flex items-center gap-1.5">
                                    <Calendar size={13} className="text-mm-3 flex-shrink-0" />
                                    <span className="text-[11px] text-mm-2 font-medium">{t('dash.entregaEstimada')}</span>
                                    <span className="text-[13px] font-bold text-slate-900 dark:text-white truncate">
                                      {p.fecha_entrega
                                        ? new Date(p.fecha_entrega).toLocaleDateString(locale, { day: '2-digit', month: 'short', year: '2-digit' })
                                        : '—'}
                                    </span>
                                  </div>
                                  <span className="px-2.5 py-1.5 bg-mm-oro-lavado dark:bg-amber-500/10 text-mm-oro-tinta dark:text-mm-oro-claro rounded-lg text-[11px] font-bold flex items-center gap-0.5 border border-mm-oro-borde dark:border-amber-500/30 whitespace-nowrap flex-shrink-0">
                                    {t('dash.verProyectoCorto')} <ChevronRight size={12} />
                                  </span>
                                </div>
                              </article>
                            );
                          })}
                        </div>

                        {/* Puntos de posición: sustituyen a las flechas */}
                        {PROJECTS.length > 1 && (
                          <div className="flex items-center justify-center gap-1.5 mt-3">
                            {PROJECTS.map((p, i) => (
                              <span
                                key={p.id ?? i}
                                className={`h-1.5 rounded-full transition-all ${
                                  i === indiceMovilSeguro ? 'w-5 bg-mm-oro' : 'w-1.5 bg-slate-300 dark:bg-zinc-600'
                                }`}
                              />
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {/* ══════════════════════════════════════════════
                      MÓVIL · Fila intermedia a DOS columnas:
                      Actividad reciente | Avance de Obra (dona)
                  ══════════════════════════════════════════════ */}
                  {/* `items-stretch` + `h-full`: las dos tarjetas terminan a la
                      misma altura, sin que una quede corta al lado de la otra. */}
                  <div className="md:hidden mt-5 grid grid-cols-2 gap-3 items-stretch">

                    {/* Actividad reciente */}
                    <div className="h-full flex flex-col bg-white dark:bg-zinc-800 rounded-[18px] border border-gray-100 dark:border-zinc-700 shadow-[0_1px_8px_rgba(0,0,0,0.05)] p-3">
                      <div className="flex items-center justify-between gap-1 mb-2.5">
                        <h3 className="text-[11px] font-bold text-slate-900 dark:text-white tracking-tight uppercase min-w-0 leading-tight">{t('dash.actividadReciente')}</h3>
                        <button
                          onClick={() => setModalLista('actividad')}
                          className="text-[11px] text-mm-oro-tinta dark:text-mm-oro-claro font-semibold flex-shrink-0"
                        >
                          {t('dash.verTodas')}
                        </button>
                      </div>
                      <div className="space-y-2.5 flex-1">
                        {loading ? (
                          <p className="text-[11px] text-slate-400 dark:text-zinc-200">{t('comun.cargando')}</p>
                        ) : entradasActividad.length > 0 ? entradasActividad.slice(0, 4).map((e, i) => (
                          <button
                            key={e.id ?? i}
                            onClick={() => abrirProyectoDeItem(e.proyecto)}
                            disabled={!e.proyecto}
                            className="w-full text-left flex items-start gap-2 rounded-lg active:bg-slate-50 dark:active:bg-zinc-700/40 transition-colors"
                          >
                            <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
                              e.icono === 'actividad' ? 'bg-emerald-50 dark:bg-emerald-500/10' : e.icono === 'documento' ? 'bg-blue-50 dark:bg-blue-500/10' : 'bg-amber-50 dark:bg-amber-500/10'
                            }`}>
                              {e.icono === 'actividad' ? <DollarSign size={10} className="text-emerald-500" /> :
                               e.icono === 'documento' ? <FileText size={10} className="text-blue-500" /> :
                               <Activity size={10} className="text-amber-500" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[11px] font-semibold text-slate-800 dark:text-zinc-100 leading-tight line-clamp-2">{e.titulo}</p>
                              <p className="text-[11px] text-slate-400 dark:text-zinc-200 leading-tight mt-0.5 break-words">{e.proyectoNombre}</p>
                            </div>
                          </button>
                        )) : (
                          <p className="text-[11px] text-slate-400 dark:text-zinc-300 py-4 text-center">{t('dash.sinActividad')}</p>
                        )}
                      </div>
                    </div>

                    {/* ── Avance del proyecto: DOS anillos concéntricos ──
                        Fuera, en dorado, el avance de obra; dentro, en verde,
                        la ejecución financiera. Separarlas en dos cifras fue
                        el arreglo de fondo; ponerlas concéntricas es lo que
                        permite COMPARARLAS de un vistazo: si el verde va muy
                        por delante del dorado, se está gastando más rápido de
                        lo que se construye.

                        Se quitó la insignia "SINCRONIZADO" (era evidente y
                        recortaba el título con puntos suspensivos) y la
                        etiqueta "AVANCE FÍSICO" del centro, que repetía lo que
                        ya dice la cabecera de la tarjeta. */}
                    <div className="h-full flex flex-col bg-white dark:bg-zinc-800 rounded-[18px] border border-gray-100 dark:border-zinc-700 shadow-[0_1px_8px_rgba(0,0,0,0.05)] p-3">
                      <h3 className="text-[11px] font-bold text-slate-900 dark:text-white tracking-tight uppercase leading-tight">
                        {t('dash.avanceProyecto')}
                      </h3>
                      {/* El nombre del proyecto baja de línea antes que
                          recortarse: "PROYECTO SAN MAR…" no dice cuál es. */}
                      <p className="text-[11px] font-bold text-slate-700 dark:text-zinc-200 leading-tight mt-0.5 break-words uppercase">
                        {fpMovil ? fpMovil.nombre : t('dash.proyectoActivo')}
                      </p>

                      <div className="h-[114px] relative flex items-center justify-center mt-1">
                        {loading || !fpMovil ? (
                          <div className="w-5 h-5 border-2 border-mm-oro border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              {/* Anillo exterior · avance de obra */}
                              <Pie
                                data={[
                                  { name: t('metrica.avanceObra'), value: avanceMovil },
                                  { name: t('dash.pendiente'), value: Math.max(100 - avanceMovil, 0) }
                                ]}
                                cx="50%" cy="50%"
                                innerRadius={40} outerRadius={51}
                                startAngle={90} endAngle={-270}
                                dataKey="value" stroke="none" isAnimationActive={false}
                              >
                                <Cell key="obra-1" fill={COLOR_ORO} />
                                <Cell key="obra-0" fill={colorPendiente} />
                              </Pie>
                              {/* Anillo interior · ejecución financiera */}
                              <Pie
                                data={[
                                  { name: t('metrica.ejecucionFinanciera'), value: pctFinancieroMovil },
                                  { name: t('dash.pendiente'), value: Math.max(100 - pctFinancieroMovil, 0) }
                                ]}
                                cx="50%" cy="50%"
                                innerRadius={25} outerRadius={36}
                                startAngle={90} endAngle={-270}
                                dataKey="value" stroke="none" isAnimationActive={false}
                              >
                                <Cell key="fin-1" fill={COLOR_VERDE} />
                                <Cell key="fin-0" fill={colorPendiente} />
                              </Pie>
                            </PieChart>
                          </ResponsiveContainer>
                        )}
                      </div>

                      {fpMovil && (
                        <div className="pt-2 mt-auto border-t border-gray-100 dark:border-zinc-700 space-y-1.5">
                          {/* Leyenda: sin ella dos anillos no dicen cuál es cuál */}
                          <div className="space-y-1">
                            <div className="flex items-center justify-between gap-1.5">
                              <span className="flex items-center gap-1.5 min-w-0">
                                <span className="w-2 h-2 rounded-full bg-mm-oro flex-shrink-0" />
                                <span className="text-[11px] font-semibold text-slate-600 dark:text-zinc-300 leading-tight">{t('metrica.avanceObra')}</span>
                              </span>
                              <span className="text-[13px] font-bold text-mm-oro-tinta dark:text-mm-oro-claro tabular-nums flex-shrink-0">{avanceMovil}%</span>
                            </div>
                            <div className="flex items-center justify-between gap-1.5">
                              <span className="flex items-center gap-1.5 min-w-0">
                                <span className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
                                <span className="text-[11px] font-semibold text-slate-600 dark:text-zinc-300 leading-tight">{t('metrica.ejecucionFinancieraCorta')}</span>
                              </span>
                              <span className="text-[13px] font-bold text-emerald-700 dark:text-emerald-400 tabular-nums flex-shrink-0">{pctFinancieroMovil}%</span>
                            </div>
                          </div>
                          <p className="text-[11px] text-slate-400 dark:text-zinc-300 font-medium text-center leading-tight pt-0.5">
                            {hitosTotalesMovil > 0
                              ? `${hitosHechosMovil} / ${hitosTotalesMovil} ` + t('dash.hitosCompletados')
                              : t('dash.sinHitos')}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ══════════════════════════════════════════════
                      MÓVIL · Próximos Hitos y Tareas Críticas
                  ══════════════════════════════════════════════ */}
                  {/* Mismo tratamiento que en escritorio: secciones sobre el
                      lienzo, no dos tarjetas más apiladas. */}
                  <div className="md:hidden mt-4 space-y-3">

                    {/* Próximos Hitos */}
                    <SeccionOperacional
                      titulo={t('dash.proximosHitos')}
                      textoAccion={t('comun.verTodos')}
                      onAccion={() => setModalLista('hitos')}
                    >
                      {loading ? (
                        <VacioSeccion texto={t('comun.cargando')} />
                      ) : entradasHitos.length > 0 ? entradasHitos.slice(0, 3).map((e, i) => (
                        <FilaOperacional
                          key={e.id ?? i}
                          icono={<MapPin size={13} className="text-mm-2" />}
                          tonoIcono="bg-black/[0.04] dark:bg-white/[0.06]"
                          titulo={sinNumeracion(e.titulo)}
                          subtitulo={e.proyectoNombre}
                          valor={e.valor}
                          tonoValor={e.tono}
                          onClick={e.proyecto ? () => abrirProyectoDeItem(e.proyecto) : null}
                        />
                      )) : (
                        <VacioSeccion texto={t('dash.sinHitosPendientes')} />
                      )}
                    </SeccionOperacional>

                    {/* Tareas Críticas */}
                    <SeccionOperacional
                      titulo={t('dash.tareasCriticas')}
                      textoAccion={t('dash.verTodas')}
                      onAccion={() => setModalLista('tareas')}
                    >
                      {loading ? (
                        <VacioSeccion texto={t('comun.cargando')} />
                      ) : entradasTareas.length > 0 ? entradasTareas.slice(0, 3).map((e, i) => (
                        <FilaOperacional
                          key={e.id ?? i}
                          icono={<AlertTriangle size={13} className={e.dias < 0 ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'} />}
                          tonoIcono={e.dias < 0 ? 'bg-red-500/10' : 'bg-amber-500/10'}
                          titulo={sinNumeracion(e.titulo)}
                          subtitulo={e.proyectoNombre}
                          valor={e.valor}
                          tonoValor={e.dias < 0 ? 'text-red-700 dark:text-red-400' : 'text-amber-700 dark:text-amber-400'}
                          onClick={e.proyecto ? () => abrirProyectoDeItem(e.proyecto) : null}
                        />
                      )) : (
                        <VacioSeccion texto={t('dash.sinTareasCriticas')} />
                      )}
                    </SeccionOperacional>
                  </div>
{/* ── Desktop: Saludo + KPIs ── */}
                  <div className="hidden md:flex flex-col w-full">
                    <div className="px-8 mt-6 mb-8">
                      {/* El reloj dual se movió al header superior; este bloque
                          ya no necesita ser flex de dos columnas. */}
                      {/* Saludo y nombre en UNA línea, con el nombre en dorado.
                          Se probó partirlo en dos (eyebrow gris + nombre en
                          blanco) y quedaba frío: el dorado sobre el navy es lo
                          que da la calidez de marca, y aquí es donde más
                          trabaja. No es dorado decorativo, es identidad. */}
                      <div className="mb-8">
                        <h1 className="text-[32px] lg:text-4xl font-bold text-slate-900 dark:text-white tracking-tight leading-tight">
                          {/* El nombre se descifra en vez de cambiar de golpe.
                              Antes, al recargar, se leía durante un instante el
                              nombre sacado del correo ("Ing. Pana") y acto
                              seguido saltaba al de la ficha de `usuarios`: un
                              parpadeo que parecía un fallo. Ahora, mientras la
                              consulta viaja, las letras giran sin resolverse
                              —nunca se llega a leer el provisional— y cuando
                              llega el nombre real se descifra encima.
                              Tamaño y color son los de siempre: los hereda del
                              `<span>` dorado que lo envuelve. */}
                          {t(saludo)}{' '}
                          <span className="text-mm-oro-tinta dark:text-mm-oro-claro">
                            <HyperText text={nombreUsuario} esperando={loading} />
                          </span>
                        </h1>
                        <p className="text-slate-500 dark:text-zinc-200 text-sm mt-1 font-medium flex items-center gap-2">
                          {t('dash.panelEjec')} <span className="text-slate-300 dark:text-zinc-500">•</span> {t('dash.accesoSocios')}
                        </p>
                      </div>

                  {/* 4 tarjetas KPI de escritorio.
                      LAS CUATRO EN UNA FILA SIEMPRE, igual que en el celular.
                      Antes iban 2×2 por debajo de `lg`, y en un monitor
                      vertical (1080 px físicos al 125% = 864 px CSS, o sea
                      `md`) eso partía el resumen en dos filas altas que
                      empujaban el proyecto destacado fuera de la pantalla.

                      Lo que impedía la fila de cuatro era la tarjeta en
                      horizontal —círculo de 44px + texto al lado—, que por
                      debajo de ~110px se rompía. Por eso aquí la tarjeta pasa
                      a vertical (icono arriba, cifra debajo) hasta `xl`: es la
                      misma solución del bloque móvil, que mete cuatro en
                      375px. A partir de `xl` vuelve la tarjeta horizontal
                      grande, exactamente como estaba. */}

                  {/* Una tabla recortada por el techo de PostgREST se DICE: sus
                      sumas serían parciales y aquí se toman decisiones de
                      dinero sobre ellas. */}
                  {datosParciales?.length > 0 && (
                    <div className="mb-4 p-3 rounded-2xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 flex items-start gap-2 text-xs font-semibold text-mm-oro-tinta dark:text-mm-oro-claro">
                      <AlertTriangle size={15} className="flex-shrink-0 mt-px" />
                      <span>{t('dash.datosParciales')} ({datosParciales.join(', ')})</span>
                    </div>
                  )}

                  <div className="grid grid-cols-4 gap-2 xl:gap-5">

                    {/* Proyectos en portafolio */}
                    <div className="bg-white dark:bg-zinc-800 rounded-[20px] p-3 xl:p-7 border border-gray-100/80 dark:border-zinc-700/80 shadow-[var(--mm-sombra)] flex flex-col items-start gap-2 xl:flex-row xl:items-center xl:gap-4 min-w-0 hover:shadow-[var(--mm-sombra-alta)] transition-shadow">
                      <div className="w-9 h-9 xl:w-[44px] xl:h-[44px] rounded-full bg-mm-navy flex items-center justify-center flex-shrink-0">
                        <Building2 size={18} className="text-mm-oro" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] text-slate-400 dark:text-zinc-300 font-bold tracking-wide mb-1 truncate">{t('dash.proyectosActivosMay')}</p>
                        {/* Sin `|| 3`: cero proyectos es una respuesta válida
                            y hay que mostrarla, no inventar un tres. */}
                        <p className="text-[clamp(19px,1.9vw,28px)] font-bold text-slate-900 dark:text-white mb-0.5 leading-none truncate tabular-nums">
                          {cifrasNoFiables ? '–' : PROJECTS.length}
                        </p>
                        <p className="text-slate-400 dark:text-zinc-300 text-[11px] font-medium flex items-center gap-1 mt-1.5 truncate">{t('dash.enPortafolio')}</p>
                      </div>
                    </div>

                    {/* Capital total — la única cifra editable a mano */}
                    <div className="bg-white dark:bg-zinc-800 rounded-[20px] p-3 xl:p-7 border border-gray-100/80 dark:border-zinc-700/80 shadow-[var(--mm-sombra)] flex flex-col items-start gap-2 xl:flex-row xl:items-center xl:gap-4 min-w-0 hover:shadow-[var(--mm-sombra-alta)] transition-shadow">
                      <div className="w-9 h-9 xl:w-[44px] xl:h-[44px] rounded-full bg-mm-navy flex items-center justify-center flex-shrink-0">
                        <DollarSign size={18} className="text-mm-oro" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 mb-1">
                          <p className="text-[11px] text-slate-400 dark:text-zinc-300 font-bold tracking-wide truncate">{t('dash.capitalTotalMay')}</p>
                          {isAdmin && isEditMode && !editandoCapital && (
                            <button
                              onClick={abrirEdicionCapital}
                              title={t('dash.editarCapital')}
                              className="p-1 rounded-lg text-mm-oro hover:bg-mm-oro-lavado dark:hover:bg-amber-500/10 transition-colors flex-shrink-0"
                            >
                              <Edit2 size={12} />
                            </button>
                          )}
                        </div>

                        {editandoCapital ? (
                          <form onSubmit={guardarCapital} className="flex items-center gap-1.5">
                            <span className="text-sm font-black text-slate-500 dark:text-zinc-300">$</span>
                            <InputMonto
                              autoFocus
                              value={capitalBorrador}
                              onChange={setCapitalBorrador}
                              className="w-full min-w-0 bg-slate-50 dark:bg-zinc-900 border border-mm-oro rounded-lg px-2 py-1 text-sm font-bold text-slate-900 dark:text-white tabular-nums focus:outline-none"
                            />
                            <button
                              type="submit"
                              disabled={guardandoCapital}
                              title={t('comun.guardar')}
                              className="p-1.5 rounded-lg text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 disabled:opacity-40 flex-shrink-0"
                            >
                              {guardandoCapital ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditandoCapital(false)}
                              title={t('comun.cancelar')}
                              className="p-1.5 rounded-lg text-slate-400 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-700 flex-shrink-0"
                            >
                              <X size={14} />
                            </button>
                          </form>
                        ) : (
                          /* `title` con el importe completo: "$250.0K" esconde
                             hasta $99 de diferencia, y en un panel de capital
                             la cifra exacta debe estar siempre a un hover. */
                          <p title={`${montoExacto(capitalTotal, locale)} · ${t('dash.capitalComprometido')}: ${montoExacto(capitalComprometido, locale)}`} className="text-[clamp(19px,1.9vw,28px)] font-bold text-slate-900 dark:text-white mb-0.5 leading-none truncate tabular-nums">
                            {cifrasNoFiables ? '–' : montoCorto(capitalTotal, locale)}
                          </p>
                        )}

                        {capitalMsg ? (
                          <p className={`text-[11px] font-bold mt-1.5 truncate ${
                            capitalMsg.tipo === 'exito' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                          }`}>
                            {capitalMsg.texto}
                          </p>
                        ) : (
                          /* La flecha sigue al SIGNO. Antes había una flecha
                             verde fija en el marcado que celebraba incluso con
                             el capital en sobregiro. */
                          <p className={`text-[11px] font-bold flex items-center gap-1 mt-1.5 min-w-0 ${
                            saludCapital === 'sobregiro' ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'
                          }`}>
                            {saludCapital === 'sobregiro'
                              ? <TrendingDown size={11} className="flex-shrink-0" />
                              : <ArrowUp size={11} className="flex-shrink-0" />}
                            <span className="text-slate-400 dark:text-zinc-300 font-medium truncate tabular-nums">
                              {saludCapital === 'sobregiro'
                                ? t('dash.sobregirado')
                                : `${pctDisponible.toFixed(0)}% ${t('dash.disponible')}`}
                            </span>
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Avance promedio de obra */}
                    <div className="bg-white dark:bg-zinc-800 rounded-[20px] p-3 xl:p-7 border border-gray-100/80 dark:border-zinc-700/80 shadow-[var(--mm-sombra)] flex flex-col items-start gap-2 xl:flex-row xl:items-center xl:gap-4 min-w-0 hover:shadow-[var(--mm-sombra-alta)] transition-shadow">
                      <div className="w-9 h-9 xl:w-[44px] xl:h-[44px] rounded-full bg-mm-navy flex items-center justify-center flex-shrink-0">
                        <TrendingUp size={18} className="text-mm-oro" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] text-slate-400 dark:text-zinc-300 font-bold tracking-wide mb-1 truncate">{t('dash.avancePromedio')}</p>
                        <p className="text-[clamp(19px,1.9vw,28px)] font-bold text-slate-900 dark:text-white mb-0.5 leading-none truncate tabular-nums">
                          {cifrasNoFiables ? '–' : `${avanceProm}%`}
                        </p>
                        <p className="text-slate-400 dark:text-zinc-300 text-[11px] font-medium flex items-center gap-1 mt-1.5 truncate">{t('dash.avanceSufijo')}</p>
                      </div>
                    </div>

                    {/* Egresos ejecutados — suma REAL de `gastos`.
                        Debajo, las aportaciones recibidas: son el otro lado del
                        movimiento y juntas explican la liquidez. Nunca se
                        presentan como la misma cifra. */}
                    <div className="bg-white dark:bg-zinc-800 rounded-[20px] p-3 xl:p-7 border border-gray-100/80 dark:border-zinc-700/80 shadow-[var(--mm-sombra)] flex flex-col items-start gap-2 xl:flex-row xl:items-center xl:gap-4 min-w-0 hover:shadow-[var(--mm-sombra-alta)] transition-shadow">
                      <div className="w-9 h-9 xl:w-[44px] xl:h-[44px] rounded-full bg-mm-navy flex items-center justify-center flex-shrink-0">
                        <Wallet size={18} className="text-mm-oro" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] text-slate-400 dark:text-zinc-300 font-bold tracking-wide mb-1 truncate">{t('dash.egresosEjecutados')}</p>
                        <p title={montoExacto(egresosEjecutados, locale)} className="text-[clamp(19px,1.9vw,28px)] font-bold text-slate-900 dark:text-white mb-0.5 leading-none truncate tabular-nums">
                          {cifrasNoFiables ? '–' : montoCorto(egresosEjecutados, locale)}
                        </p>
                        <button
                          onClick={() => changeView('investors')}
                          title={`${t('dash.aportacionesRecibidas')}: ${montoExacto(aportacionesRecibidas, locale)} · ${t('dash.liquidez')}: ${montoExacto(liquidezDisponible, locale)}`}
                          className="text-slate-400 dark:text-zinc-300 text-[11px] font-medium flex items-center gap-1 mt-1.5 truncate hover:text-mm-oro-tinta dark:hover:text-mm-oro-claro transition-colors"
                        >
                          {cifrasNoFiables
                            ? t('dash.egresosAuto')
                            : `${t('dash.aportacionesRecibidas')}: ${montoCorto(aportacionesRecibidas, locale)}`}
                        </button>
                      </div>
                    </div>

                  </div>
                </div>

                {/* ── Layout central: Proyecto Destacado + Gráfica ── */}
                {/* Una sola columna hasta XL, antes hasta lg. El corte estaba
                    mal puesto para el monitor VERTICAL: 1080 px de ancho entra
                    en `lg` (1024), así que se partía en dos columnas y, con el
                    sidebar de 230 px descontado, al destacado le quedaban unos
                    470 px — la fotografía se estripaba. A partir de `xl`
                    (1280) hay sitio de sobra y el escritorio horizontal se
                    queda exactamente como está. */}
                {/* El panel de la gráfica cede ancho al destacado: la dona se
                    lee igual de bien en menos sitio, y la fotografía de la
                    propiedad es lo que de verdad tiene que resaltar. */}
                <div className="px-8 grid grid-cols-1 xl:grid-cols-[1.9fr_1fr] gap-6 lg:gap-7 mb-7">

                  {/* Proyecto Destacado */}
                  {(() => {
                    if (loading) return (
                      <div className="bg-white dark:bg-zinc-800 rounded-[24px] border border-gray-100 dark:border-zinc-700 p-6 flex items-center justify-center min-h-[340px] shadow-sm">
                        <div className="flex flex-col items-center gap-3">
                          <div className="w-8 h-8 border-2 border-mm-oro border-t-transparent rounded-full animate-spin" />
                          <p className="text-slate-400 dark:text-zinc-200 text-xs">{t('dash.cargandoProyectos')}</p>
                        </div>
                      </div>
                    );
                    /* Estos dos estados ANTES eran inalcanzables: el hook caía
                       a tres proyectos de ejemplo, así que la lista nunca
                       llegaba vacía y este código no se veía jamás. Ahora sí
                       se muestran, y un fallo se dice con todas las letras en
                       vez de disfrazarse de datos. */
                    if (errorCarga) return (
                      <div className="bg-white dark:bg-zinc-800 rounded-[24px] border border-red-200 dark:border-red-500/30 p-6 flex items-center justify-center min-h-[340px] shadow-sm">
                        <div className="text-center max-w-sm">
                          <AlertTriangle size={38} className="text-red-500 mx-auto mb-3" />
                          <p className="text-slate-900 dark:text-white text-sm font-bold">{t('dash.errorCarga')}</p>
                          <p className="text-mm-2 text-xs mt-1.5 break-words">{errorCarga}</p>
                          <button
                            onClick={refetchData}
                            className="mt-4 px-4 py-2 rounded-xl bg-mm-navy text-white text-xs font-bold hover:bg-slate-800 transition-colors"
                          >
                            {t('dash.reintentar')}
                          </button>
                        </div>
                      </div>
                    );
                    if (!fp) return (
                      <div className="bg-white dark:bg-zinc-800 rounded-[24px] border border-gray-100 dark:border-zinc-700 p-6 flex items-center justify-center min-h-[340px] shadow-sm">
                        <div className="text-center">
                          <Building2 size={40} className="text-slate-300 dark:text-zinc-600 mx-auto mb-3" />
                          <p className="text-mm-2 text-sm font-medium">{t('dash.sinProyectos')}</p>
                          <p className="text-mm-3 text-xs mt-1">{t('dash.verificaConexion')}</p>
                        </div>
                      </div>
                    );
                    /* El avance sale del hook, no se recalcula aquí: así la
                       tarjeta destacada, la dona y la ficha del proyecto no
                       pueden mostrar tres números distintos del mismo dato. */
                    return (
                      <div
                        key={fp.id || safeIndex}
                        onMouseEnter={() => setCarruselPausado(true)}
                        onMouseLeave={() => setCarruselPausado(false)}
                        onFocusCapture={() => setCarruselPausado(true)}
                        onBlurCapture={() => setCarruselPausado(false)}
                        /* Se probó la foto a sangre arriba y el detalle
                           apilado debajo. Se veía bien la imagen, pero la ficha
                           dejó de leerse de un vistazo: el nombre y el % de
                           avance quedaron uno debajo de otro en vez de juntos,
                           que es donde se comparan. Vuelve la composición a dos
                           columnas. */
                        className="bg-white dark:bg-zinc-800 rounded-[24px] shadow-[var(--mm-sombra)] border border-gray-100 dark:border-zinc-700 flex flex-col p-6 transition-opacity duration-1000 ease-in-out animate-fadeIn"
                      >

                        {/* Encabezado */}
                        <div className="flex justify-between items-center gap-3 mb-4">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-mm-oro text-base">★</span>
                            <h2 className="text-base font-bold text-slate-900 dark:text-white truncate">{t('dash.proyectoDestacado')}</h2>
                            {portadaMsg && (
                              <span className={`text-[11px] font-bold px-2 py-1 rounded-lg border ${
                                portadaMsg.tipo === 'exito'
                                  ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30'
                                  : 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 border-red-200 dark:border-red-500/30'
                              }`}>
                                {portadaMsg.texto}
                              </span>
                            )}
                          </div>
                          {/* La navegación del carrusel vive ahora sobre la imagen */}
                          <div className="flex items-center gap-2">
                            {/* `changeView`, no `setCurrentView`: era el único
                                punto del archivo que saltaba el ayudante, así
                                que no actualizaba la URL y el botón Atrás del
                                navegador sacaba al usuario de la aplicación. */}
                            <button
                              onClick={() => changeView('all-projects')}
                              className="text-xs font-semibold text-mm-oro-tinta dark:text-mm-oro-claro hover:underline flex items-center gap-0.5"
                            >
                              {t('comun.verTodos')} <ChevronRight size={14} />
                            </button>
                          </div>
                        </div>

                        {/* Contenido Principal: Imagen + Detalles con transición suave.
                            flex-wrap: si la tarjeta se estrecha, la imagen pasa
                            arriba y los detalles ocupan el ancho completo en vez
                            de comprimirse hasta romperse. */}
                        <div className="flex flex-wrap items-stretch gap-5 mb-5">
                          {/* El selector de portada vive en la raíz del Dashboard:
                              lo comparten escritorio y móvil. */}

                          {/* Imagen a la izquierda: deja el nombre y el % de
                              avance juntos a la derecha, que es donde se
                              comparan de un vistazo. */}
                          <div
                            onClick={() => handleCardClick(fp)}
                            /* `self-stretch` + alto mínimo en vez de alto fijo:
                               la imagen llega hasta abajo, a la altura de las
                               flechas del carrusel. Antes tenía 190/220px
                               clavados mientras la columna de texto crecía con
                               la descripción y las dos barras, así que la foto
                               terminaba muy por encima y se veía pequeña. */
                            /* El reparto a dos columnas empieza en `xl`, no en
                               `sm`. Este bloque solo existe de `md` en adelante
                               (el móvil tiene su propia tarjeta), así que un
                               corte en `sm` significaba "siempre al 46%": en
                               monitor vertical la foto quedaba en una columna
                               estrecha y alargada. Hasta `xl` va a lo ancho y
                               apilada, como en el móvil.

                               Y apilada necesita FRENOS. Con solo `w-full`, en
                               un monitor vertical la foto se comía ~570px de
                               ancho por todo el alto que le diera la gana: la
                               miniatura pasaba a ser un cartel. `max-w` la
                               deja en una proporción parecida a la del móvil,
                               `mx-auto` la centra ahora que no llena la fila, y
                               `max-h` le pone techo. Los tres se anulan en `xl`,
                               donde vuelve a ser la columna del 46%. */
                            className="w-full max-w-[520px] mx-auto max-h-[240px] xl:max-w-none xl:mx-0 xl:max-h-none xl:w-[46%] xl:min-w-[210px] xl:self-stretch min-h-[220px] rounded-2xl overflow-hidden flex-shrink-0 cursor-pointer group bg-slate-100 dark:bg-zinc-700 relative shadow-sm"
                          >
                            <PortadaProyecto
                              url={fp.imagen_url}
                              alt={fp.nombre}
                              claseImg="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 ease-out"
                              tamanoIcono={44}
                            />
                            {/* Cambiar la portada del proyecto: sube a Storage y
                                actualiza proyectos.imagen_url */}
                            {isEditMode && (
                              <label
                                htmlFor={ID_INPUT_PORTADA}
                                onClick={(e) => { e.stopPropagation(); pedirPortadaProyecto(fp.id); }}
                                className="absolute inset-0 bg-black/45 flex flex-col items-center justify-center gap-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 focus:opacity-100 transition-opacity cursor-pointer"
                                title={t('dash.cambiarPortada')}
                              >
                                <span className="bg-white/90 p-2.5 rounded-full text-slate-900">
                                  {subiendoPortadaId === fp.id
                                    ? <Loader2 size={18} className="animate-spin" />
                                    : <Camera size={18} />}
                                </span>
                                <span className="text-[11px] font-bold text-white tracking-wide">
                                  {subiendoPortadaId === fp.id ? t('comun.subiendo') : t('dash.cambiarPortada')}
                                </span>
                              </label>
                            )}
                          </div>

                          {/* Detalles del proyecto */}
                          <div className="flex-1 min-w-0 basis-[260px] flex flex-col py-0.5">
                            {/* Estado en cápsula dorada: es el único badge de
                                la tarjeta, así que aquí el dorado sí distingue
                                algo en vez de competir con otros cinco. */}
                            <div className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[11px] font-bold bg-mm-oro-lavado dark:bg-amber-500/10 text-mm-oro-tinta dark:text-mm-oro-claro mb-2.5 w-fit border border-mm-oro-borde dark:border-amber-500/30">
                              <span className="text-[11px]">★</span> {etiquetaEstado(fp.estado, t).toUpperCase()}
                            </div>

                            {/* Nombre y % de avance JUNTOS: el porcentaje es lo
                                que se busca primero y necesita estar a la
                                altura del título, no debajo de todo. */}
                            <div className="flex items-start justify-between flex-wrap gap-x-3 gap-y-1 mb-1">
                              <h3
                                onClick={() => handleCardClick(fp)}
                                className="text-[clamp(17px,1.9vw,24px)] font-bold text-slate-900 dark:text-white leading-tight uppercase cursor-pointer hover:text-mm-oro-tinta dark:hover:text-mm-oro-claro transition-colors flex-1 min-w-0 basis-[150px] break-words"
                              >
                                {fp.nombre}
                              </h3>
                              <div className="text-right flex-shrink-0">
                                <p className="text-[clamp(26px,3vw,36px)] font-bold text-slate-900 dark:text-white leading-none tabular-nums">
                                  {avanceProyectoActivo}%
                                </p>
                                <p className="text-[11px] text-slate-400 dark:text-zinc-300 font-medium whitespace-nowrap">{t('dash.avanceObraCorto')}</p>
                              </div>
                            </div>

                            {/* Ubicación */}
                            {fp.ubicacion && (
                              <p className="text-xs text-slate-500 dark:text-zinc-300 flex items-center gap-1 mb-2 font-medium">
                                <MapPin size={13} className="flex-shrink-0" /> {fp.ubicacion}
                              </p>
                            )}

                            {/* Descripción */}
                            {fp.descripcion && (
                              <p className="text-xs text-slate-500 dark:text-zinc-300 leading-relaxed line-clamp-2 mb-4">
                                {fp.descripcion}
                              </p>
                            )}

                            {/* Las DOS métricas, separadas y etiquetadas.
                                Antes aquí había una sola barra dorada sin
                                nombre y el % de obra vivía pegado al dinero. */}
                            <div className="mt-auto pt-1">
                              <MetricasProyecto proyecto={fp} />

                              {PROJECTS.length > 1 && (
                                <div className="flex items-center justify-end gap-2 mt-3">
                                  <button
                                    onClick={(e) => { e.stopPropagation(); irASlide(safeIndex - 1); }}
                                    aria-label={t('dash.anteriorProyecto')}
                                    title={t('dash.anteriorProyecto')}
                                    className="w-8 h-8 rounded-full bg-white/80 dark:bg-zinc-900/70 hover:bg-white dark:hover:bg-zinc-900 backdrop-blur-md border border-gray-200 dark:border-zinc-600 text-mm-2 flex items-center justify-center shadow-sm transition-all hover:scale-110 active:scale-95"
                                  >
                                    <ChevronLeft size={16} />
                                  </button>
                                  <span className="text-[11px] font-bold text-mm-3 tabular-nums px-1">
                                    {safeIndex + 1}/{PROJECTS.length}
                                  </span>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); irASlide(safeIndex + 1); }}
                                    aria-label={t('dash.siguienteProyecto')}
                                    title={t('dash.siguienteProyecto')}
                                    className="w-8 h-8 rounded-full bg-white/80 dark:bg-zinc-900/70 hover:bg-white dark:hover:bg-zinc-900 backdrop-blur-md border border-gray-200 dark:border-zinc-600 text-mm-2 flex items-center justify-center shadow-sm transition-all hover:scale-110 active:scale-95"
                                  >
                                    <ChevronRight size={16} />
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Fila de métricas inferior (con estilo del mock) */}
                        {/* 2 columnas hasta xl: en tablet, cuatro celdas en fila
                            dejaban ~90px cada una y el botón chocaba con la
                            fecha de entrega. */}
                        {/* Solo cifras de DINERO: aquí ya no se cuela ningún
                            porcentaje de obra disfrazado de porcentaje de gasto. */}
                        {/* Ficha de inversión: tres cifras alineadas a una
                            retícula, sin iconos ni cajas. El calendario que
                            acompañaba a la fecha era decoración. */}
                        <div className="grid grid-cols-2 xl:grid-cols-4 items-center gap-x-4 gap-y-4 pt-4 border-t border-gray-100 dark:border-zinc-700">
                          <div className="min-w-0">
                            <p className="text-[11px] text-slate-400 dark:text-zinc-300 font-medium mb-0.5 truncate">{t('dash.inversionTotal')}</p>
                            <p
                              title={montoExacto(fp.presupuesto_total, locale)}
                              className="text-base lg:text-lg font-bold text-slate-900 dark:text-white truncate tabular-nums"
                            >
                              {montoCorto(fp.presupuesto_total, locale)}
                            </p>
                          </div>
                          <div className="min-w-0">
                            <p className="text-[11px] text-slate-400 dark:text-zinc-300 font-medium mb-0.5 truncate">{t('dash.ejecutado')}</p>
                            <p
                              title={montoExacto(fp.totalGastado, locale)}
                              className="text-base lg:text-lg font-bold text-slate-900 dark:text-white truncate tabular-nums"
                            >
                              {montoCorto(fp.totalGastado, locale)}
                            </p>
                          </div>
                          <div className="min-w-0">
                            <p className="text-[11px] text-slate-400 dark:text-zinc-300 font-medium mb-0.5 truncate">{t('dash.entregaEstimada')}</p>
                            <p className="text-base lg:text-lg font-bold text-slate-900 dark:text-white truncate tabular-nums">
                              {fp.fecha_entrega
                                ? new Date(fp.fecha_entrega).toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' })
                                : '—'}
                            </p>
                          </div>
                          <div className="flex justify-end min-w-0">
                            {/* Este es el sitio donde el dorado SÍ manda: la
                                acción principal de la pieza central. Al
                                haberlo quitado de iconos y bordes, aquí vuelve
                                a significar algo. */}
                            <button
                              onClick={() => handleCardClick(fp)}
                              className="px-4 xl:px-5 py-2.5 bg-mm-oro-lavado dark:bg-amber-500/10 text-mm-oro-tinta dark:text-mm-oro-claro rounded-xl text-xs font-bold hover:bg-mm-oro-hover dark:hover:bg-amber-500/20 transition-colors flex items-center gap-1 border border-mm-oro-borde dark:border-amber-500/30 whitespace-nowrap"
                            >
                              {t('dash.verProyecto')} <ChevronRight size={14} className="flex-shrink-0" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Gráfica Sincronizada con el Carrusel Activo (PieChart / Donut) */}
                  {/* Panel de apoyo: acompaña a la pieza central, no compite
                      con ella. La insignia "SINCRONIZADO" perdió su cápsula
                      dorada con borde — era un adorno que gritaba más que el
                      propio dato. */}
                  <div className="bg-white dark:bg-zinc-800 rounded-[20px] shadow-[var(--mm-sombra)] border border-gray-100/80 dark:border-zinc-700/80 flex flex-col p-5 lg:p-6 justify-between">
                    <div>
                      <div className="flex justify-between items-center flex-wrap gap-x-2 gap-y-1 mb-2">
                        <h2 className="text-[11px] font-bold text-slate-900 dark:text-white tracking-[0.12em] uppercase min-w-0">{t('dash.avanceObra')}</h2>
                        <span className="text-[11px] font-extrabold bg-mm-oro-lavado dark:bg-amber-500/10 text-mm-oro-tinta dark:text-mm-oro-claro px-2.5 py-1 rounded-full border border-mm-oro-borde dark:border-amber-500/30 uppercase whitespace-nowrap">
                          {t('dash.sincronizado')}
                        </span>
                      </div>
                      <p className="text-xs font-bold text-slate-800 dark:text-zinc-100 uppercase flex items-center gap-1 truncate mb-3">
                        <Building2 size={13} className="text-mm-oro" /> {fp ? fp.nombre : t('dash.proyectoActivo')}
                      </p>
                    </div>

                    {/* `flex-1`: la dona se centra en el alto sobrante en vez
                        de dejar un hueco muerto bajo el título. La tarjeta de
                        al lado creció al poner la foto a sangre, y sin esto el
                        panel quedaba con un vacío enorme arriba. */}
                    <div className="h-44 lg:h-48 relative flex items-center justify-center">
                      {loading || !fp ? (
                        <div className="h-full flex items-center justify-center">
                          <div className="w-6 h-6 border-2 border-mm-oro border-t-transparent rounded-full animate-spin" />
                        </div>
                      ) : (
                        <>
                          {/* `minHeight` + `isAnimationActive={false}`: sin
                              esto, si el contenedor mide 0×0 en el primer
                              montaje (recharts avisa con "width(0) and
                              height(0)"), la animación arranca con un radio
                              inválido y la dona ya no vuelve a dibujarse. Es el
                              mismo patrón que la dona móvil, que nunca falló. */}
                          <ResponsiveContainer width="100%" height="100%" minHeight={240}>
                            <PieChart>
                              {/* Anillo exterior · avance de obra (dorado) */}
                              <Pie
                                data={[
                                  { name: t('metrica.avanceObra'), value: avanceProyectoActivo },
                                  { name: t('dash.pendiente'), value: Math.max(100 - avanceProyectoActivo, 0) }
                                ]}
                                cx="50%" cy="50%"
                                innerRadius={74} outerRadius={96}
                                startAngle={90} endAngle={-270}
                                dataKey="value" stroke="none" isAnimationActive={false}
                              >
                                <Cell key="obra-1" fill={COLOR_ORO} />
                                {/* Antes era "#E2E8F0" fijo: en modo noche
                                    quedaba una placa de luminancia 91% sobre
                                    una tarjeta del 27%, lo más brillante de la
                                    pantalla, y desviaba la mirada justo a lo
                                    que NO está hecho. Ahora sigue al tema. */}
                                <Cell key="obra-0" fill={colorPendiente} />
                              </Pie>
                              {/* Anillo interior · ejecución financiera (verde) */}
                              <Pie
                                data={[
                                  { name: t('metrica.ejecucionFinanciera'), value: pctFinancieroActivo },
                                  { name: t('dash.pendiente'), value: Math.max(100 - pctFinancieroActivo, 0) }
                                ]}
                                cx="50%" cy="50%"
                                innerRadius={46} outerRadius={68}
                                startAngle={90} endAngle={-270}
                                dataKey="value" stroke="none" isAnimationActive={false}
                              >
                                <Cell key="fin-1" fill={COLOR_VERDE} />
                                <Cell key="fin-0" fill={colorPendiente} />
                              </Pie>
                              <Tooltip
                                formatter={(value, name) => [`${Number(value || 0).toFixed(0)}%`, name]}
                                contentStyle={estiloTooltip}
                                itemStyle={{ color: 'var(--grafica-texto)' }}
                              />
                            </PieChart>
                          </ResponsiveContainer>
                        </>
                      )}
                    </div>

                    {/* Leyenda: sin ella, dos anillos concéntricos no dicen
                        cuál es cuál. El color de cada punto es el del anillo
                        que nombra. */}
                    {fp && (
                      <div className="pt-4 mt-1 border-t border-gray-100 dark:border-zinc-700 space-y-3">
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="flex items-center gap-2 min-w-0">
                              <span className="w-2.5 h-2.5 rounded-full bg-mm-oro flex-shrink-0" />
                              <span className="text-[13px] font-semibold text-slate-600 dark:text-zinc-300">{t('metrica.avanceObra')}</span>
                            </span>
                            <span className="text-base font-bold text-mm-oro-tinta dark:text-mm-oro-claro tabular-nums flex-shrink-0">{avanceProyectoActivo}%</span>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="flex items-center gap-2 min-w-0">
                              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 flex-shrink-0" />
                              <span className="text-[13px] font-semibold text-slate-600 dark:text-zinc-300">{t('metrica.ejecucionFinanciera')}</span>
                            </span>
                            <span className="text-base font-bold text-emerald-700 dark:text-emerald-400 tabular-nums flex-shrink-0">{pctFinancieroActivo}%</span>
                          </div>
                        </div>
                        <p className="text-[11px] text-mm-3 font-medium text-center tabular-nums pt-1 border-t border-gray-100 dark:border-zinc-700">
                          {hitosTotales > 0
                            ? `${hitosHechos} / ${hitosTotales} ` + t('dash.hitosCompletados')
                            : t('dash.sinHitos')}
                        </p>
                      </div>
                    )}
                  </div>

                </div>
              </div>{/* fin hidden md:flex */}

              {/* ── Información operacional (escritorio) ──
                  Sin tarjetas: tres columnas que respiran sobre el lienzo,
                  separadas por su propio filete. El aire entre ellas es
                  generoso a propósito, porque ahora no hay bordes que hagan
                  ese trabajo.
                  Las tres columnas empiezan en `xl`. Antes arrancaban en `md`:
                  en monitor vertical eran tres columnas de ~250 px y cada fila
                  —tarea, proyecto y fecha— se partía en varios renglones. Por
                  debajo de `xl` van una debajo de otra, como en el móvil. */}
              <div className="hidden md:grid grid-cols-1 xl:grid-cols-3 gap-6 px-8 pb-8 mt-2">

                {/* Actividad Reciente */}
                <SeccionOperacional
                  titulo={t('dash.actividadReciente')}
                  textoAccion={t('dash.verTodas')}
                  onAccion={() => setModalLista('actividad')}
                >
                  {loading ? (
                    <VacioSeccion texto={t('comun.cargando')} />
                  ) : entradasActividad.length > 0 ? entradasActividad.slice(0, 4).map((e, i) => (
                    /* Cada movimiento viaja al proyecto al que pertenece */
                    <FilaOperacional
                      key={e.id ?? i}
                      icono={e.icono === 'actividad' ? <DollarSign size={13} className="text-emerald-600 dark:text-emerald-400" /> :
                             e.icono === 'documento' ? <FileText size={13} className="text-mm-2" /> :
                             <Activity size={13} className="text-mm-2" />}
                      tonoIcono={e.icono === 'actividad' ? 'bg-emerald-500/10' : 'bg-black/[0.04] dark:bg-white/[0.06]'}
                      titulo={e.titulo}
                      subtitulo={`${e.proyectoNombre}${e.detalle ? ` · ${e.detalle}` : ''}`}
                      valor={e.valor ? `+${e.valor}` : null}
                      tonoValor="text-emerald-700 dark:text-emerald-400"
                      onClick={e.proyecto ? () => abrirProyectoDeItem(e.proyecto) : null}
                      tituloAcceso={t('dash.verProyecto')}
                    />
                  )) : (
                    /* Sin datos reales se muestra el vacío, nunca ejemplos
                       agrupados que se confundan con movimientos verdaderos. */
                    <VacioSeccion texto={t('dash.sinActividad')} />
                  )}
                </SeccionOperacional>

                {/* Próximos Hitos */}
                <SeccionOperacional
                  titulo={t('dash.proximosHitos')}
                  textoAccion={t('comun.verTodos')}
                  onAccion={() => setModalLista('hitos')}
                >
                  {loading ? (
                    <VacioSeccion texto={t('comun.cargando')} />
                  ) : entradasHitos.length > 0 ? entradasHitos.slice(0, 4).map((e, i) => (
                    <FilaOperacional
                      key={e.id ?? i}
                      icono={<MapPin size={13} className="text-mm-2" />}
                      tonoIcono="bg-black/[0.04] dark:bg-white/[0.06]"
                      titulo={sinNumeracion(e.titulo)}
                      subtitulo={e.proyectoNombre}
                      valor={e.valor}
                      tonoValor={e.tono}
                      onClick={e.proyecto ? () => abrirProyectoDeItem(e.proyecto) : null}
                      tituloAcceso={t('dash.verProyecto')}
                    />
                  )) : (
                    <VacioSeccion texto={t('dash.sinHitosPendientes')} />
                  )}
                </SeccionOperacional>

                {/* Tareas Críticas */}
                <SeccionOperacional
                  titulo={t('dash.tareasCriticas')}
                  textoAccion={t('dash.verTodas')}
                  onAccion={() => setModalLista('tareas')}
                >
                  {loading ? (
                    <VacioSeccion texto={t('comun.cargando')} />
                  ) : entradasTareas.length > 0 ? entradasTareas.slice(0, 4).map((e, i) => (
                    /* El rojo solo para lo VENCIDO. Lo que vence esta semana va
                       en ámbar: si todo se pinta de rojo, el rojo deja de ser
                       una señal y pasa a ser decoración. */
                    <FilaOperacional
                      key={e.id ?? i}
                      icono={<AlertTriangle size={13} className={e.dias < 0 ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'} />}
                      tonoIcono={e.dias < 0 ? 'bg-red-500/10' : 'bg-amber-500/10'}
                      titulo={sinNumeracion(e.titulo)}
                      subtitulo={`${e.proyectoNombre}${e.detalle ? ` · ${e.detalle}` : ''}`}
                      valor={e.valor}
                      tonoValor={e.dias < 0 ? 'text-red-700 dark:text-red-400' : 'text-amber-700 dark:text-amber-400'}
                      onClick={e.proyecto ? () => abrirProyectoDeItem(e.proyecto) : null}
                      tituloAcceso={t('dash.verProyecto')}
                    />
                  )) : (
                    /* Nada de "2 pagos pendientes": o hay tareas reales, una
                       por una, o se dice claramente que no hay ninguna. */
                    <VacioSeccion texto={t('dash.sinTareasCriticas')} />
                  )}
                </SeccionOperacional>

              </div>
            </section>

          </div>
        </main>
  );
}
