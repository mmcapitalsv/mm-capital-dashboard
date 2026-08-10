import React, { useState, useEffect, useRef } from 'react';
import { useProyectos } from '../hooks/useProyectos';
import { usePrefs } from '../context/PreferenciasContext';
import InvestorsView from './InvestorsView';
/* La bóveda documental se fue a su propio archivo: era el bloque más grande de
   este componente y no comparte estado con el resto del panel. */
import VaultView from './VaultView';
/* El perfil también salió por su cuenta: era el bloque más grande que quedaba
   y solo necesita la identidad ya resuelta que le pasa el panel. */
import ProfileView from './ProfileView';
import ChatModule from './ChatModule';
/* Administración de usuarios y chat de IA: dos vistas completas, cada una con
   su propio estado y sus propios servicios, que no comparten nada con el
   panel más allá de la identidad y el botón de volver. */
import AdminUsersView from './AdminUsersView';
import AIChatView from './AIChatView';
/* Limpieza final: el listado de proyectos y el panel propiamente dicho —con
   sus dos carruseles, sus KPIs y la edición del Capital Total— también viven
   ya en su propio archivo. Lo que queda aquí es el ORQUESTADOR: identidad,
   navegación, campana, selector de portada y el reparto de vistas. */
import AllProjectsView from './AllProjectsView';
import DashboardView from './DashboardView';
import NombreAjustado from './ui/NombreAjustado';
import { VideoBackground } from './ui/VideoBackground';
import AvatarUsuario from './ui/AvatarUsuario';
import { useChat } from '../context/ChatContext';
import { motion } from 'framer-motion';

/** Dorado de marca para el resaltado del menú lateral. */
const NAV_DORADO = '#C5A059';

/* El id del selector de portada vive en `lib/portada.js`: el `<input>` real
   está aquí abajo, pero las etiquetas que lo abren están repartidas entre el
   panel y la lista de proyectos. */
import { ID_INPUT_PORTADA } from '../lib/portada';

/* ── Avisos ya revisados ────────────────────────────────────────────────────
   La marca de lectura vive en Supabase (`avisos_leidos`, migración 013), no en
   el navegador: antes se guardaba solo en `localStorage` y entrar desde el
   teléfono o desde otro equipo devolvía todos los avisos a "sin leer".
   `localStorage` sigue como copia de arranque y red de seguridad — el porqué
   está explicado en services/avisosService.js. */

import {
  leerAvisosLocales, guardarAvisosLocales,
  leerAvisosLeidos, marcarAvisoLeidoEnBD, marcarAvisosLeidosEnBD
} from '../services/avisosService';
/* Las tres listas del panel (actividad, hitos y tareas) se calculan fuera: las
   comparten las tarjetas del Dashboard y el modal "Ver todos", que se abre
   desde la campana estando en cualquier pantalla. */
import { useEntradasPanel } from '../hooks/useEntradasPanel';
import ProjectDetails from './ProjectDetails';
import ListaCompletaModal from './ListaCompletaModal';
import {
  AlertTriangle, Bell, Building2, Briefcase, ChevronDown, ChevronLeft,
  Edit2, FolderLock, Globe, LayoutDashboard, Loader2, Lock, LogOut,
  MessageSquare, Moon, Send, Sun, UserCheck, Users
} from 'lucide-react';
import {
  getAvatarUsuario, leerAvatarCache, guardarAvatarCache, subirPortadaProyecto
} from '../services/storageService';
import {
  claveSaludo, nombreMostrado, inicialesUsuario, cargoUsuario
} from '../lib/perfilUsuario';
// ─── Vistas secundarias ───────────────────────────────────────────────────────


function NewProjectView({ onBack }) {
  const { t } = usePrefs();
  return (
    <main className="flex-1 flex flex-col overflow-hidden bg-transparent">
      <div className="flex items-center gap-3 px-8 py-5 border-b border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800">
        <button onClick={onBack} className="text-slate-400 dark:text-zinc-200 hover:text-slate-700 dark:hover:text-zinc-100 transition-colors">
          <ChevronLeft size={20} />
        </button>
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">{t('proyNuevo.titulo')}</h2>
      </div>
      <div className="flex-1 flex items-center justify-center">
        <p className="text-slate-500 dark:text-zinc-200 font-medium">{t('comun.moduloDesarrollo')}</p>
      </div>
    </main>
  );
}



// ─── Helpers ──────────────────────────────────────────────────────────────────

/* `formatMoney` se eliminó: había DOS versiones distintas (esta con un decimal
   y otra en useProyectos.js con dos), así que el mismo importe se veía
   diferente según la pantalla, y $1,480,000 se mostraba como "$1.5M". Ahora
   todo pasa por `montoCorto` / `montoExacto` de lib/formato.js. */

/* ─── Piezas compartidas escritorio / móvil ───────────────────────────────────
   El menú del avatar y la bandeja de notificaciones son IDÉNTICOS en ambas
   resoluciones: se extraen aquí para que el móvil no sea una copia paralela
   que se desincronice con el escritorio. */

function PanelNotificaciones({
  t, notificaciones, idsLeidos = [], chatNoLeido, noLeidosChat,
  marcarChatLeido, onAbrirNotificacion, onAbrirChat, onVerTodas, className = ''
}) {
  return (
    <div className={`bg-white dark:bg-zinc-800 rounded-xl shadow-xl border border-gray-100 dark:border-zinc-700 z-50 overflow-hidden ${className}`}>
      <div className="px-4 py-3 border-b border-gray-100 dark:border-zinc-700 flex justify-between items-center bg-gray-50 dark:bg-zinc-900">
        <span className="text-xs font-bold text-slate-800 dark:text-zinc-100">{t('notif.titulo')}</span>
        <button onClick={marcarChatLeido} className="text-[11px] text-mm-oro-tinta dark:text-mm-oro-claro font-semibold hover:underline">
          {t('notif.marcarLeidas')}
        </button>
      </div>
      <div className="max-h-60 overflow-y-auto">
        {chatNoLeido && (
          <button
            onClick={onAbrirChat}
            className="w-full text-left px-4 py-3 border-b border-gray-50 dark:border-zinc-700 hover:bg-gray-50 dark:hover:bg-zinc-700/50 cursor-pointer transition-colors"
          >
            <p className="text-[11px] font-bold text-mm-oro-tinta dark:text-mm-oro-claro flex items-center gap-1.5">
              <MessageSquare size={12} /> {t('notif.chatNuevo')}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-zinc-200 mt-0.5">
              {t('notif.chatNuevoDetalle', { cantidad: noLeidosChat })}
            </p>
          </button>
        )}
        {notificaciones && notificaciones.length > 0 ? notificaciones.map(n => {
          /* No leída = fondo resaltado. Leída = fondo neutro. La diferencia es
             lo único que distingue "esto es nuevo" de "esto ya lo revisaste"
             ahora que abrir la bandeja dejó de marcarlas todas. */
          const leida = idsLeidos.includes(String(n.id));
          return (
            <button
              key={n.id}
              onClick={() => onAbrirNotificacion(n)}
              className={`w-full text-left px-4 py-3 border-b border-gray-50 dark:border-zinc-700 cursor-pointer transition-colors ${
                leida
                  ? 'bg-white dark:bg-zinc-800 hover:bg-gray-50 dark:hover:bg-zinc-700/50'
                  : 'bg-mm-oro-lavado dark:bg-amber-500/10 hover:bg-mm-oro-lavado/70 dark:hover:bg-amber-500/20'
              }`}
            >
              <p className={`text-[11px] font-bold flex items-center gap-1.5 ${leida ? 'text-slate-400 dark:text-zinc-400' : 'text-red-500'}`}>
                <AlertTriangle size={12} /> {t('notif.vencimientoCritico')}
              </p>
              <p className={`text-[11px] mt-0.5 ${leida ? 'text-slate-400 dark:text-zinc-400' : 'text-slate-600 dark:text-zinc-100 font-semibold'}`}>
                {t('notif.tareaProyecto', { tarea: n.tarea, proyecto: n.proyectoNombre || t('inv.proyectoNoDisponible') })}
              </p>
              <p className="text-[11px] text-slate-400 dark:text-zinc-300 mt-1">{t('notif.vence')} {n.fecha_vencimiento}</p>
            </button>
          );
        }) : !chatNoLeido && (
          <div className="px-4 py-3 text-center text-xs text-slate-500 dark:text-zinc-200">{t('notif.sinNotificaciones')}</div>
        )}
      </div>
      {/* El pie "Ver todas" era un <span> con `cursor-pointer` y efecto hover
          pero SIN acción: parecía un botón y no hacía nada. Ahora abre de
          verdad la lista completa de vencimientos. */}
      {onVerTodas && (
        <div className="border-t border-gray-100 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-900">
          <button
            onClick={onVerTodas}
            className="w-full px-4 py-2.5 text-center text-[11px] font-semibold text-mm-oro-tinta dark:text-mm-oro-claro hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors"
          >
            {t('dash.verTodas')}
          </button>
        </div>
      )}
    </div>
  );
}


/** Interruptor visual reutilizado por las filas de tipo toggle del menú. */
function Interruptor({ activo }) {
  return (
    <span
      aria-hidden="true"
      className={`w-9 h-5 rounded-full flex items-center px-0.5 transition-colors flex-shrink-0 ${
        activo ? 'bg-mm-oro justify-end' : 'bg-slate-200 dark:bg-zinc-600 justify-start'
      }`}
    >
      <span className="w-4 h-4 rounded-full bg-white shadow-sm" />
    </span>
  );
}

/**
 * Menú desplegable del avatar. `onToggleEditMode` solo llega desde el header
 * móvil: ahí el "Modo Edición" vive dentro del menú para no robarle ancho a
 * la barra superior. En escritorio sigue siendo un botón propio del header.
 */
function MenuAvatar({
  t, nombreUsuario, cargo, iniciales, userAvatarUrl,
  modoOscuro, alternarTema, language, alternarIdioma,
  onPerfil, onInversores, onLogout, isAdmin, isEditMode, onToggleEditMode, className = ''
}) {
  const filaBase = 'w-full px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-zinc-200 hover:bg-gray-50 dark:hover:bg-zinc-700/50 hover:text-mm-oro-tinta dark:hover:text-mm-oro-claro transition-colors flex items-center gap-2.5';

  return (
    <div
      role="menu"
      className={`bg-white dark:bg-zinc-800 rounded-2xl shadow-2xl border border-gray-100 dark:border-zinc-700 z-50 overflow-hidden ${className}`}
    >
      {/* Cabecera con la identidad real del usuario */}
      <div className="px-4 py-3 border-b border-gray-100 dark:border-zinc-700 bg-slate-50/70 dark:bg-zinc-900/50 flex items-center gap-3">
        <AvatarUsuario
          url={userAvatarUrl}
          iniciales={iniciales}
          nombre={nombreUsuario}
          className="w-9 h-9"
          claseContenedor="bg-mm-navy border border-mm-oro"
          claseIniciales="text-mm-oro"
        />
        <div className="min-w-0 flex-1">
          <NombreAjustado texto={nombreUsuario} max={13} min={9} className="font-bold text-slate-900 dark:text-white leading-tight" />
          <NombreAjustado texto={cargo.texto || t(cargo.clave)} max={10} min={6.5} className="text-mm-oro-tinta dark:text-mm-oro-claro font-semibold leading-tight mt-0.5" />
        </div>
      </div>

      {/* 1) Mi perfil y configuración */}
      <button role="menuitem" onClick={onPerfil} className={filaBase}>
        <UserCheck size={15} className="text-mm-3 flex-shrink-0" />
        {t('menu.miPerfilConfig')}
      </button>

      {/* 1b) Inversores: bajó aquí desde la barra inferior, que con seis
              destinos quedaba por debajo del objetivo táctil mínimo. */}
      {onInversores && (
        <button role="menuitem" onClick={onInversores} className={filaBase}>
          <Briefcase size={15} className="text-mm-3 flex-shrink-0" />
          {t('nav.inversionistas')}
        </button>
      )}

      {/* 2) Modo Edición: SOLO Administrador y solo donde se pidió el toggle */}
      {isAdmin && onToggleEditMode && (
        <button
          role="menuitem"
          onClick={onToggleEditMode}
          aria-pressed={isEditMode}
          className={`${filaBase} justify-between`}
        >
          <span className="flex items-center gap-2.5">
            <Edit2 size={15} className={isEditMode ? 'text-mm-oro flex-shrink-0' : 'text-slate-400 dark:text-zinc-200 flex-shrink-0'} />
            {isEditMode ? t('dash.edicionActiva') : t('dash.modoEdicion')}
          </span>
          <Interruptor activo={isEditMode} />
        </button>
      )}

      {/* 3) Modo oscuro (toggle) */}
      <button role="menuitem" onClick={alternarTema} aria-pressed={modoOscuro} className={`${filaBase} justify-between`}>
        <span className="flex items-center gap-2.5">
          {modoOscuro
            ? <Sun size={15} className="text-mm-oro flex-shrink-0" />
            : <Moon size={15} className="text-slate-400 dark:text-zinc-200 flex-shrink-0" />}
          {t('menu.modoOscuro')}
        </span>
        <Interruptor activo={modoOscuro} />
      </button>

      {/* 4) Ver en inglés (toggle) */}
      <button role="menuitem" onClick={alternarIdioma} aria-pressed={language === 'en'} className={`${filaBase} justify-between`}>
        <span className="flex items-center gap-2.5">
          <Globe size={15} className="text-slate-400 dark:text-zinc-200 flex-shrink-0" />
          {/* Estando en español ofrece el inglés y viceversa */}
          {language === 'es' ? t('menu.verIngles') : t('pref.verEspanol')}
        </span>
        <Interruptor activo={language === 'en'} />
      </button>

      {/* 5) Cerrar sesión */}
      <div className="border-t border-gray-100 dark:border-zinc-700">
        <button
          role="menuitem"
          onClick={onLogout}
          className="w-full px-4 py-3 text-left text-xs font-bold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors flex items-center gap-2.5"
        >
          <LogOut size={15} className="flex-shrink-0" />
          {t('menu.cerrarSesion')}
        </button>
      </div>
    </div>
  );
}

// ─── Componente Principal ─────────────────────────────────────────────────────

export default function Dashboard({ user, onLogout }) {
  const {
    proyectos,
    gastos,
    hitos,
    archivos,
    // Aportaciones de los socios: son el "Capital Inyectado" de cada ficha.
    aportaciones,
    loading,
    notificaciones,
    isAdmin,
    rol,
    perfil,
    refetchData,
    // Finanzas del portafolio: el capital lo edita el Administrador y los
    // egresos se suman solos desde las inversiones de los socios.
    capitalTotal,
    egresosTotales,
    pctDisponible,
    saludCapital,
    errorCarga,
    vencimientos,
    actualizarCapitalTotal
  } = useProyectos(user);

  // Identidad real del usuario autenticado (nada codificado a mano)
  const nombreUsuario = nombreMostrado(user, perfil);
  const iniciales = inicialesUsuario(user, perfil);
  const cargo = cargoUsuario(rol, perfil, user);

  // Se hidrata de localStorage en el primer render: sin esto el avatar
  // desaparece en cada F5 mientras responde la consulta a `usuarios`.
  const [userAvatarUrl, setUserAvatarUrl] = useState(() => leerAvatarCache(user?.id));

  /* Al iniciar sesión el avatar real se toma de la ficha de `usuarios` (que ya
     trae `avatar_url`) y, si aún no llegó, se pide directamente. Así la foto
     aparece en el header, el sidebar y el chat sin recargar la página. */
  useEffect(() => {
    if (perfil?.avatar_url) {
      setUserAvatarUrl(perfil.avatar_url);
      guardarAvatarCache(user?.id, perfil.avatar_url);
      return;
    }
    let vigente = true;
    getAvatarUsuario(user?.id).then(url => { if (vigente && url) setUserAvatarUrl(url); });
    return () => { vigente = false; };
  }, [user?.id, perfil?.avatar_url]);

  const [timeCST, setTimeCST] = useState('');
  const [timePDT, setTimePDT] = useState('');
  // El saludo se recalcula con el reloj: al cruzar las 12:00 o las 18:00 cambia solo
  const [saludo, setSaludo] = useState(() => claveSaludo());

  // Relojes digitales en tiempo real (El Salvador y costa oeste de EE. UU.)
  // Formato: solo hora y minuto, sin segundos ni sufijo de zona.
  useEffect(() => {
    const updateClocks = () => {
      const now = new Date();
      const cstStr = now.toLocaleTimeString('en-US', { timeZone: 'America/El_Salvador', hour: '2-digit', minute: '2-digit', hour12: true });
      const pdtStr = now.toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit', hour12: true });
      setTimeCST(cstStr);
      setTimePDT(pdtStr);
      setSaludo(claveSaludo(now));
    };
    updateClocks();
    // Sin segundos en pantalla, basta con refrescar cada 15 s
    const interval = setInterval(updateClocks, 15000);
    return () => clearInterval(interval);
  }, []);

  /* La vista se lee de la URL en el PRIMER render, no en un efecto posterior:
     así un F5 sobre el detalle de un proyecto no parpadea mostrando el
     Dashboard antes de volver a su sitio. */
  const [currentView, setCurrentView] = useState(
    () => new URLSearchParams(window.location.search).get('view') || 'portfolio'
  );
  const [activeProject, setActiveProject] = useState(null);
  /* Id del proyecto que venía en la URL y todavía no se puede resolver: los
     proyectos llegan de Supabase un instante después. En cuanto la lista está,
     el efecto de más abajo lo convierte en el proyecto real. */
  const [proyectoPendiente, setProyectoPendiente] = useState(
    () => new URLSearchParams(window.location.search).get('proyecto')
  );
  const [isEditMode, setIsEditMode] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  // Menú desplegable del avatar (perfil, tema, idioma y cierre de sesión).
  // El estado es UNO solo: el header de escritorio y el móvil lo comparten,
  // cada uno con su propio anclaje para el clic-fuera.
  const [showMenuAvatar, setShowMenuAvatar] = useState(false);
  const menuAvatarRef = useRef(null);
  const menuAvatarMovilRef = useRef(null);
  const notifRef = useRef(null);
  const notifMovilRef = useRef(null);
  const [navHover, setNavHover] = useState(null);
  const portadaProyectoRef = useRef(null);

  /* Canal "Socios": MISMA fuente de datos que la página de Chat (tabla
     `mensajes` de Supabase + Realtime). Lo que se escribe aquí aparece
     idéntico e instantáneo allá, y al revés. */
  const {
    mensajes: mensajesSocios,
    enviarMensaje,
    tieneAcceso: puedeChatear,
    hayNoLeidos: chatNoLeido,
    noLeidos: noLeidosChat,
    marcarLeido: marcarChatLeido,
    miembros: miembrosSocios,
    error: chatError
  } = useChat();
  const [borradorSidebar, setBorradorSidebar] = useState('');
  const [enviandoSidebar, setEnviandoSidebar] = useState(false);
  const finChatSidebarRef = useRef(null);

  const handleEnviarSidebar = async (e) => {
    e.preventDefault();
    if (!borradorSidebar.trim() || enviandoSidebar) return;
    setEnviandoSidebar(true);
    const ok = await enviarMensaje(borradorSidebar);
    setEnviandoSidebar(false);
    if (ok) setBorradorSidebar('');
  };

  // Mantener el historial del sidebar pegado al último mensaje
  useEffect(() => {
    finChatSidebarRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [mensajesSocios.length]);
  /* Portada del proyecto: el selector de archivo es UNO solo y sirve a los tres
     sitios donde se puede cambiar la foto (destacado de escritorio, carrusel
     móvil y lista "Todos los Proyectos"). Por eso el id del proyecto no puede
     salir de `fp`: se guarda al abrir el selector.

     `subiendoPortadaId` en vez de un booleano: así el spinner aparece sobre la
     tarjeta que de verdad se está subiendo y no sobre todas a la vez. */
  const proyectoPortadaRef = useRef(null);
  const [subiendoPortadaId, setSubiendoPortadaId] = useState(null);
  const [portadaMsg, setPortadaMsg] = useState(null);

  /**
   * Apunta el selector de portada al proyecto tocado.
   *
   * NO abre el selector: de eso se encarga la propia etiqueta `<label>` del
   * botón, que es el mecanismo nativo del navegador. Llamar a `.click()` desde
   * JavaScript funciona en la laptop pero varios navegadores de teléfono lo
   * ignoran por seguridad, y era la razón por la que en el celular el botón
   * "Cambiar portada" no abría la galería.
   */
  const pedirPortadaProyecto = (proyectoId) => {
    if (!proyectoId) return;
    proyectoPortadaRef.current = proyectoId;
  };

  /** Sube la imagen elegida y la deja como portada del proyecto marcado. */
  const handlePortadaProyecto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const proyectoId = proyectoPortadaRef.current;
    if (!file || !proyectoId) return;

    setSubiendoPortadaId(proyectoId);
    setPortadaMsg(null);

    const { success, error } = await subirPortadaProyecto(file, proyectoId);

    setSubiendoPortadaId(null);
    proyectoPortadaRef.current = null;
    setPortadaMsg(success
      ? { tipo: 'exito', texto: t('dash.portadaActualizada') }
      : { tipo: 'error', texto: error });

    if (success) await refetchData();
    setTimeout(() => setPortadaMsg(null), 5000);
  };

  // Preferencias de interfaz (tema e idioma) compartidas por toda la app
  const { modoOscuro, alternarTema, language, alternarIdioma, t, locale } = usePrefs();

  // Cerrar el menú del avatar al hacer clic fuera o al presionar Escape
  useEffect(() => {
    if (!showMenuAvatar) return;

    const alClicFuera = (e) => {
      // Dos anclajes posibles (escritorio y móvil): solo se cierra si el clic
      // cae fuera de AMBOS, si no el menú móvil se cerraría al abrirse.
      const dentro =
        menuAvatarRef.current?.contains(e.target) ||
        menuAvatarMovilRef.current?.contains(e.target);
      if (!dentro) setShowMenuAvatar(false);
    };
    const alEscape = (e) => { if (e.key === 'Escape') setShowMenuAvatar(false); };

    document.addEventListener('mousedown', alClicFuera);
    document.addEventListener('keydown', alEscape);
    return () => {
      document.removeEventListener('mousedown', alClicFuera);
      document.removeEventListener('keydown', alEscape);
    };
  }, [showMenuAvatar]);

  // La bandeja de notificaciones móvil se cierra igual: fuera o Escape
  useEffect(() => {
    if (!showNotifications) return;

    const alClicFuera = (e) => {
      const dentro =
        notifRef.current?.contains(e.target) ||
        notifMovilRef.current?.contains(e.target);
      if (!dentro) setShowNotifications(false);
    };
    const alEscape = (e) => { if (e.key === 'Escape') setShowNotifications(false); };

    document.addEventListener('mousedown', alClicFuera);
    document.addEventListener('keydown', alEscape);
    return () => {
      document.removeEventListener('mousedown', alClicFuera);
      document.removeEventListener('keydown', alEscape);
    };
  }, [showNotifications]);


  // 2. Sincronización con el botón "Atrás" del navegador (Popstate & History API)
  useEffect(() => {
    const handlePopState = (e) => {
      if (e.state && e.state.view) {
        setCurrentView(e.state.view);
        /* Del historial solo sale un id, y se entrega al mismo mecanismo que
           ya resuelve el proyecto de la URL contra la lista viva de Supabase.
           Así retroceder nunca resucita cifras viejas —antes se guardaba una
           foto del objeto y cerrar las Facturas con "Atrás" devolvía los
           importes anteriores a lo último guardado— y no hace falta leer
           PROJECTS aquí dentro, que quedaría obsoleto en este efecto. */
        const id = e.state.proyectoId ?? null;
        setActiveProject(null);
        setProyectoPendiente(id);
      } else {
        const p = new URLSearchParams(window.location.search);
        setCurrentView(p.get('view') || 'portfolio');
        // Sin estado en el historial (p. ej. tras recargar) el id de la URL
        // es lo único que dice qué proyecto tocaba: se vuelve a resolver.
        setProyectoPendiente(p.get('proyecto'));
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  /**
   * Cambia de vista y lo deja escrito en la URL.
   *
   * El id del proyecto viaja en la dirección (`?view=project-details&proyecto=…`)
   * y no solo en el estado del historial: al recargar, el estado se pierde pero
   * la URL sobrevive, y es lo que permite quedarse en la misma pantalla.
   */
  const changeView = (viewName, projectData = null) => {
    setCurrentView(viewName);
    if (projectData !== undefined) {
      setActiveProject(projectData);
      setProyectoPendiente(null);
    }

    let newUrl = window.location.pathname;
    if (viewName !== 'portfolio') {
      newUrl += `?view=${encodeURIComponent(viewName)}`;
      if (projectData?.id) newUrl += `&proyecto=${encodeURIComponent(projectData.id)}`;
    }
    /* En el historial viaja solo el ID, no el objeto entero. Antes se guardaba
       el proyecto completo con su checklist: el estado del historial tiene
       límite de tamaño por navegador (Firefox ~640 KB) y con proyectos grandes
       podía lanzar excepción. El id basta, porque el efecto de más abajo lo
       resuelve contra la lista ya cargada. */
    window.history.pushState({ view: viewName, proyectoId: projectData?.id ?? null }, '', newUrl);
  };

  // Usa los proyectos reales de Supabase
  const PROJECTS = proyectos;

  /* Recarga sobre el detalle de un proyecto: la URL trae el id, pero la lista
     tarda un instante en llegar de Supabase. Aquí se espera a esa lista y se
     reabre el proyecto exacto. Si al terminar de cargar el id ya no existe
     (proyecto borrado, enlace viejo), se vuelve al inicio en vez de dejar la
     pantalla en blanco, y se limpia la dirección. */
  useEffect(() => {
    if (!proyectoPendiente) return;

    const encontrado = PROJECTS.find(p => String(p?.id) === String(proyectoPendiente));
    if (encontrado) {
      setActiveProject(encontrado);
      setProyectoPendiente(null);
      return;
    }

    if (!loading && PROJECTS.length > 0) {
      setProyectoPendiente(null);
      setCurrentView('portfolio');
      window.history.replaceState({ view: 'portfolio', proyectoId: null }, '', window.location.pathname);
    }
  }, [proyectoPendiente, PROJECTS, loading]);

  /* ── Estado visible de la campana ───────────────────────────────────────
     El punto rojo señala NOVEDAD, no existencia. Un vencimiento que ya
     revisaste sigue estando ahí durante días o semanas, y si la campana se
     enciende por el mero hecho de que exista, acaba encendida siempre — y una
     señal que está siempre activa deja de ser una señal.

     Por eso se recuerda QUÉ avisos concretos se han visto, por su id, y la
     marca vive en Supabase: guardada solo en el navegador, entrar desde el
     teléfono devolvía todo a "sin leer". */
  const idsAvisosActuales = React.useMemo(
    () => (Array.isArray(notificaciones) ? notificaciones : [])
      .map(n => String(n?.id ?? '')).filter(Boolean),
    [notificaciones]
  );

  /* Arranca con la copia local para que el primer fotograma ya sea correcto:
     esperar a la consulta encendería el punto rojo en cada carga. */
  const [avisosVistos, setAvisosVistos] = useState(() => leerAvisosLocales(user?.id));

  /* Al cambiar de usuario se lee SU lista, no la del anterior; primero la
     local (instantánea) y después la de la base, que es la que manda. */
  useEffect(() => {
    let vigente = true;
    const locales = leerAvisosLocales(user?.id);
    setAvisosVistos(locales);
    if (!user?.id) return;

    leerAvisosLeidos(user.id).then(deLaBase => {
      /* `null` = no se pudo preguntar (sin red, o la migración 013 todavía sin
         aplicar). Ahí se conserva la copia local en vez de vaciar la lista y
         hacer que reaparezcan como no leídos avisos que sí se revisaron. */
      if (!vigente || deLaBase === null) return;
      const union = [...new Set([...locales, ...deLaBase])];
      setAvisosVistos(union);
      guardarAvisosLocales(user.id, union);
      // Lo que solo estaba en este navegador sube a la base y deja de ser suyo
      const soloLocales = locales.filter(id => !deLaBase.includes(id));
      if (soloLocales.length > 0) marcarAvisosLeidosEnBD(user.id, soloLocales);
    });

    return () => { vigente = false; };
  }, [user?.id]);

  /* Hay novedad solo si algún aviso actual NO está en la lista de vistos. */
  const hayAvisosNuevos = idsAvisosActuales.some(id => !avisosVistos.includes(id));
  const hayAvisos = hayAvisosNuevos || chatNoLeido;

  /* Los avisos que ya no existen se olvidan de la copia local: si no, crecería
     sin límite. En la base los limpia la migración 013.

     La guarda de `loading`/`errorCarga` es lo que hacía que la campana volviera
     a encenderse en cada recarga por mucho que se pulsara "Marcar leídas".
     Mientras el portafolio carga, `notificaciones` está vacío — no porque no
     haya avisos, sino porque todavía no han llegado — y esta limpieza leía ese
     vacío como "ninguno sigue vigente" y borraba la lista entera de vistos,
     incluida la que acababa de llegar de la base. Un dato que aún no ha llegado
     no es un dato que ya no existe. */
  useEffect(() => {
    if (loading || errorCarga) return;
    if (!user?.id || avisosVistos.length === 0) return;
    const vigentes = avisosVistos.filter(id => idsAvisosActuales.includes(id));
    if (vigentes.length !== avisosVistos.length) {
      setAvisosVistos(vigentes);
      guardarAvisosLocales(user.id, vigentes);
    }
  }, [idsAvisosActuales, avisosVistos, user?.id, loading, errorCarga]);

  /** "Marcar leídas": apaga a la vez el chat y los vencimientos. */
  const marcarTodoLeido = () => {
    marcarChatLeido();
    setAvisosVistos(idsAvisosActuales);
    guardarAvisosLocales(user?.id, idsAvisosActuales);
    marcarAvisosLeidosEnBD(user?.id, idsAvisosActuales);
  };

  /**
   * Marca UNA notificación como leída: en pantalla al instante, en la base
   * inmediatamente después. El estado local no espera a la respuesta —a nadie
   * le sirve una bandeja que tarda en reaccionar al clic— y si la escritura
   * falla, la copia de `localStorage` sostiene la marca hasta el siguiente
   * intento.
   */
  const marcarAvisoLeido = (id) => {
    const clave = String(id ?? '');
    if (!clave || avisosVistos.includes(clave)) return;
    const siguiente = [...avisosVistos, clave];
    setAvisosVistos(siguiente);
    guardarAvisosLocales(user?.id, siguiente);
    marcarAvisoLeidoEnBD(user?.id, clave);
  };

  /* ── Qué se pinta en la bandeja ──────────────────────────────────────────
     Todas las NO leídas, más un rastro de hasta 5 leídas antiguas. Sin el
     tope, un panel que ya no se vacía solo acabaría siendo un archivo
     histórico; con él sigue siendo una bandeja. */
  const MAX_LEIDAS_VISIBLES = 5;

  const notificacionesPanel = React.useMemo(() => {
    const lista = Array.isArray(notificaciones) ? notificaciones : [];
    const noLeidas = lista.filter(n => !avisosVistos.includes(String(n?.id ?? '')));
    const leidas = lista
      .filter(n => avisosVistos.includes(String(n?.id ?? '')))
      .slice(0, MAX_LEIDAS_VISIBLES);
    return [...noLeidas, ...leidas];
  }, [notificaciones, avisosVistos]);

  /**
   * Abre o cierra la bandeja. Abrirla NO marca nada: desplegar la lista no es
   * lo mismo que haber leído cada aviso, y apagarlos todos de golpe borraba la
   * única señal de qué quedaba pendiente. Cada aviso se apaga al pulsarlo.
   */
  const alternarNotificaciones = () => {
    setShowMenuAvatar(false);
    setShowNotifications(abierto => !abierto);
  };

  const handleCardClick = (proyecto) => {
    changeView('project-details', proyecto);
  };

  /** Abre el detalle del proyecto al que pertenece un ítem del panel inferior. */
  const abrirProyectoDeItem = (proyecto) => {
    if (proyecto) changeView('project-details', proyecto);
  };

  /** Clic en una notificación: la marca leída y abre el proyecto de ese hito. */
  const abrirNotificacion = (n) => {
    marcarAvisoLeido(n?.id);
    setShowNotifications(false);
    const proyecto = n?.proyecto
      || PROJECTS.find(p => String(p.id) === String(n?.proyecto_id));
    if (proyecto) changeView('project-details', proyecto);
  };

  const handleBack = () => {
    changeView('portfolio', null);
  };


  /* ── Cuándo NO se puede enseñar una cifra ────────────────────────────────
     Con `errorCarga` las colecciones quedan vacías a propósito (ver el `catch`
     de useProyectos), así que todos los agregados valen 0. Pintar "$0" ahí
     sería sustituir un fallo de lectura por un dato falso — que es justo lo
     que se acaba de corregir aguas arriba. Los KPI muestran "–", igual que
     mientras cargan, y el aviso de error explica el porqué. */
  const cifrasNoFiables = loading || !!errorCarga;

  /* ── Listas completas para los botones "Ver todos" ─────────────────────── */
  const [modalLista, setModalLista] = useState(null);   // 'actividad' | 'hitos' | 'tareas'

  const { entradasActividad, entradasHitos, entradasTareas } = useEntradasPanel({
    proyectos: PROJECTS, gastos, hitos, archivos, vencimientos, t, locale
  });

  const LISTAS = {
    actividad: { titulo: t('lista.actividad'), entradas: entradasActividad },
    hitos: { titulo: t('lista.hitos'), entradas: entradasHitos },
    tareas: { titulo: t('lista.tareas'), entradas: entradasTareas }
  };

  // Menú principal de la barra lateral.
  // "Administrar Usuarios" y "Chat IA" NO van aquí: viven únicamente en la
  // tarjeta "Configuración para Administrador" dentro de ProfileView.
  const navItems = [
    { id: 'portfolio', label: t('nav.dashboard'), icon: LayoutDashboard },
    { id: 'all-projects', label: t('nav.proyectos'), icon: Building2 },
    { id: 'vault', label: t('nav.boveda'), icon: FolderLock },
    { id: 'investors', label: t('nav.inversionistas'), icon: Briefcase },
    { id: 'chat', label: t('nav.chat'), icon: MessageSquare },
    { id: 'profile', label: t('nav.perfil'), icon: Users },
  ];

  return (
    /* `100dvh` en vez de `h-screen`: en el móvil, `100vh` mide la ventana SIN
       contar la barra de direcciones, así que la app quedaba más alta que lo
       visible y el compositor del chat caía fuera de pantalla. `dvh` sigue al
       alto real y en escritorio se comporta igual que `vh`. */
    <div className="flex h-full overflow-hidden bg-mm-navy dark:bg-zinc-900">

      {/* Selector de portada de proyecto: vive en la RAÍZ, no dentro del bloque
          de escritorio. Colgado de un contenedor `hidden md:flex` el navegador
          móvil no llegaba a abrirlo y por eso la foto solo se podía cambiar
          desde la laptop. Aquí lo comparten escritorio, carrusel móvil y la
          lista de "Todos los Proyectos". */}
      {/* `accept="image/*"`: la lista larga de tipos hacía que algunas galerías
          de Android mostraran las fotos en gris y no dejaran elegir ninguna.
          `archivo-oculto` en vez de `hidden` porque Safari de iPhone no abre
          el selector de un input con `display:none` (ver index.css). */}
      <input
        type="file"
        id={ID_INPUT_PORTADA}
        ref={portadaProyectoRef}
        onChange={handlePortadaProyecto}
        accept="image/*"
        className="archivo-oculto"
      />

      {/* ════════════════════════════════════════════════
          SIDEBAR IZQUIERDO (solo desktop)
      ════════════════════════════════════════════════ */}
      <aside className="w-[230px] lg:w-[270px] hidden md:flex flex-col h-full overflow-hidden bg-mm-navy-hondo dark:bg-zinc-900 border-r border-white/5 dark:border-zinc-800 flex-shrink-0">

        {/* Logo imponente y legible con navegación a Inicio */}
        <div
          onClick={() => changeView('portfolio')}
          className="px-3 py-0.5 border-b border-white/5 dark:border-zinc-800 flex-shrink-0 flex items-center justify-center cursor-pointer group hover:bg-white/[0.02] transition-colors"
          title={t('nav.inicio')}
        >
          <img
            src="/logo2.png"
            alt="MM Capital"
            className="w-full max-w-[120px] lg:max-w-[135px] mx-auto object-contain -my-3 group-hover:scale-[1.02] transition-transform"
            style={{ filter: 'brightness(0) invert(1)' }}
          />
        </div>

        {/* Nav Links compactos: empujan el chat hacia arriba.
            `flex-shrink-0` se mantiene para que el nav no le robe alto al chat.

            Efecto Berlix "Menu Vertical": el ícono entra deslizándose desde la
            izquierda y el texto se corre a su sitio, ambos tomando el dorado.
            Se conservan los íconos de lucide (no se cambian por flechas) y el
            estado por defecto es blanco puro. */}
        <nav
          className="px-2 pt-1 pb-0.5 flex-shrink-0 space-y-0"
          onMouseLeave={() => setNavHover(null)}
        >
          {navItems.map(item => {
            const Icon = item.icon;
            const active = currentView === item.id || (item.id === 'portfolio' && currentView === 'project-details');
            // Al pasar el cursor manda el hover; si no hay, manda el ítem activo
            const resaltado = navHover ? navHover === item.id : active;

            return (
              <button
                key={item.id}
                onClick={() => changeView(item.id)}
                onMouseEnter={() => setNavHover(item.id)}
                onFocus={() => setNavHover(item.id)}
                className="w-full flex items-center gap-2 px-3 py-1 rounded-lg text-left focus:outline-none cursor-pointer"
              >
                {/* El ícono se mantiene SIEMPRE visible: blanco por defecto y
                    dorado al activarse. Solo acompaña con un leve desplazamiento. */}
                <motion.span
                  animate={{
                    x: resaltado ? 10 : 0,
                    color: resaltado ? NAV_DORADO : '#ffffff'
                  }}
                  transition={{ duration: 0.35, ease: 'easeOut' }}
                  className="flex items-center flex-shrink-0"
                >
                  <Icon size={16} strokeWidth={2.4} />
                </motion.span>

                <motion.span
                  animate={{
                    x: resaltado ? 14 : 0,
                    color: resaltado ? NAV_DORADO : '#ffffff'
                  }}
                  transition={{ duration: 0.35, ease: 'easeOut' }}
                  className="text-sm font-semibold tracking-wider uppercase flex-1 truncate"
                >
                  {item.label}
                </motion.span>
              </button>
            );
          })}
        </nav>

        {/* Chat Grupal: ocupa el alto sobrante y solo los mensajes hacen scroll.
            Fondo oscuro FIJO en ambos temas por decisión de diseño: no lleva
            variantes dark: porque no debe cambiar con el modo día/noche. */}
        <div className="mx-2.5 mt-0.5 mb-1.5 rounded-xl bg-zinc-800 border border-zinc-700 p-2.5 flex-1 min-h-0 flex flex-col overflow-hidden shadow-inner">
          {/* Encabezado separado del historial por una línea sutil */}
          <div className="flex-shrink-0 border-b border-gray-700/50 pb-1.5 mb-2">
            <div className="flex items-center gap-1.5 mb-1">
              <Users size={11} className="text-mm-3" />
              <span className="text-[11px] font-bold text-white/70 tracking-wider uppercase">{t('chat.canalSocios')}</span>
            </div>
            <div className="text-[11px] text-white/60">{miembrosSocios} {t('chat.miembros')}</div>
          </div>

          {!puedeChatear ? (
            /* Solo admin y socios: para el resto el canal ni siquiera se lee */
            <div className="flex-1 min-h-0 flex flex-col items-center justify-center text-center px-2">
              <Lock size={16} className="text-white/25 mb-1.5" />
              <p className="text-[11px] text-white/40 leading-relaxed">{t('chat.sinAcceso')}</p>
            </div>
          ) : (
            <>
              {/* Único elemento con scroll: el historial. El menú lateral no se mueve. */}
              <div
                onClick={marcarChatLeido}
                className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1 my-0.5 [scrollbar-width:thin] [scrollbar-color:rgba(255,255,255,0.22)_transparent] [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-white/20 [&::-webkit-scrollbar-thumb]:rounded-full"
              >
                {mensajesSocios.length === 0 ? (
                  <p className="text-[11px] text-white/35 text-center py-4">{t('chat.sinMensajes')}</p>
                ) : mensajesSocios.map((m) => (
                  <div key={m.id} className={`flex ${m.propio ? 'justify-end' : 'justify-start'}`}>
                    {/* Burbuja suave y legible, con padding contenido para que
                        un mensaje largo no se coma el alto del recuadro. */}
                    <div className={`rounded-2xl px-3 py-2 text-[13px] leading-snug max-w-[95%] ${
                      m.propio
                        ? 'bg-blue-500/20 border border-blue-500/30 text-white/90'
                        : 'bg-white/10 text-white/80'
                    }`}>
                      {!m.propio && <p className="text-[11px] font-bold text-mm-oro mb-0.5">{m.autor}</p>}
                      <p className="break-words">{m.texto}</p>
                    </div>
                  </div>
                ))}
                <div ref={finChatSidebarRef} />
              </div>

              {chatError && (
                <p className="text-[11px] text-red-300 leading-relaxed flex-shrink-0 mb-1 break-words">{chatError}</p>
              )}

              <form onSubmit={handleEnviarSidebar} className="relative mt-1.5 flex-shrink-0">
                <input
                  type="text"
                  value={borradorSidebar}
                  onChange={(e) => setBorradorSidebar(e.target.value)}
                  onFocus={marcarChatLeido}
                  placeholder={t('nav.enviarMensaje')}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg py-1.5 pl-3 pr-8 text-[11px] text-white placeholder-white/40 focus:outline-none focus:border-mm-oro transition-colors"
                />
                {/* El clip de adjuntar se retiró: era un <button> sin acción que
                    se iluminaba al pasar el ratón y luego no respondía. El chat
                    completo (con adjuntos) vive en la pestaña Chat. */}
                <button
                  type="submit"
                  disabled={!borradorSidebar.trim() || enviandoSidebar}
                  aria-label={t('comun.enviar')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-white/50 hover:text-mm-oro-tinta dark:hover:text-mm-oro-claro transition-colors disabled:opacity-30"
                >
                  <Send size={12} />
                </button>
              </form>
            </>
          )}
        </div>

        {/* Perfil del Usuario en el Sidebar (Clic redirige a Perfil) */}
        <div
          onClick={() => changeView('profile')}
          className="px-3 py-1.5 border-t border-white/5 flex-shrink-0 bg-mm-navy-velo/60 cursor-pointer hover:bg-mm-navy-velo transition-colors group"
        >
          <div className="flex items-center gap-2">
            <AvatarUsuario
              url={userAvatarUrl}
              iniciales={iniciales}
              nombre={nombreUsuario}
              alt="Avatar"
              className="w-7 h-7"
            />
            {/* Nombre y cargo SIEMPRE completos y en UNA sola línea: nada de
                truncado con "…". NombreAjustado baja el tamaño de letra hasta
                que el texto entra en el ancho del sidebar, así caben igual
                "Ing. Giovanni Morales" que "Socio propietario y representante
                legal" sin recortar ni una palabra. */}
            <div className="flex flex-col overflow-hidden min-w-0 flex-1">
              <NombreAjustado
                texto={nombreUsuario}
                descifrar
                esperando={loading}
                max={15}
                min={8}
                className="text-white font-bold tracking-tight leading-tight group-hover:text-mm-oro-tinta dark:group-hover:text-mm-oro-claro transition-colors"
              />
              <NombreAjustado
                texto={cargo.texto || t(cargo.clave)}
                max={11}
                min={6.5}
                className="text-mm-oro font-semibold tracking-wide leading-tight mt-0.5"
              />
            </div>
          </div>
        </div>

        {/* Cerrar Sesión con letra más grande (text-sm lg:text-base font-semibold) */}
        <div className="px-3 pb-2 pt-1 flex-shrink-0">
          <button
            onClick={onLogout}
            className="flex items-center justify-center gap-2 w-full py-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/5 transition-colors text-sm font-semibold"
          >
            <LogOut size={16} />
            {t('perfil.cerrarSesion')}
          </button>
        </div>
      </aside>

      {/* ════════════════════════════════════════════════
          CONTENEDOR PRINCIPAL DERECHO (Header Estático + Vistas)
      ════════════════════════════════════════════════ */}
      {/* `relative isolate`: abre un contexto de apilamiento propio para que el
          fondo animado pueda colgarse en `-z-10`. Con un z-index negativo el
          video se pinta POR ENCIMA del color de fondo de este contenedor pero
          POR DEBAJO de todo el contenido en flujo, que es justo lo que se
          quiere: el fondo abajo y las tarjetas encima, sin tener que tocar el
          z-index de cada vista.
          El color de fondo se mantiene como red de seguridad: el video se ve
          ENCIMA de él (va al 15-20% de opacidad), así que si el archivo no
          carga el panel se ve con el lienzo de siempre. */}
      <div className="relative isolate flex-1 flex flex-col h-full overflow-hidden bg-mm-lienzo dark:bg-zinc-900">

        {/* ── Fondo animado (solo con sesión iniciada) ──
            La pantalla de acceso NO lo usa: allí sigue mandando la animación de
            tubos. `aria-hidden` + `pointer-events-none` porque es decoración
            pura: ni el lector de pantalla ni el ratón deben tropezar con él.

            El mismo video en los dos temas: lo que cambia es el color con el
            que se funde (piedra clara de día, navy de noche) y la opacidad.
            El video ya es oscuro de base —su color medio es RGB (74, 78, 86)
            con destellos hasta 248—, así que de noche sus estelas se leen como
            hilos de luz sobre el navy en vez de aclarar el fondo. */}
        <div className="absolute inset-0 -z-10 pointer-events-none" aria-hidden="true">
          <VideoBackground oscuro={modoOscuro} />
        </div>

        {/* ── HEADER SUPERIOR GLOBAL Y ESTÁTICO (Desktop) ── */}
        {/* `flex-wrap` + `gap-y-2`: si en monitor vertical no cupiera todo en
            una línea, el bloque de la derecha baja entero en vez de desbordar
            o de comprimir el título. En escritorio horizontal nunca llega a
            envolver, así que ahí no cambia nada. */}
        <header className="hidden md:flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-8 py-3.5 bg-white dark:bg-zinc-800 border-b border-gray-200 dark:border-zinc-700 flex-shrink-0 z-30 shadow-sm">
          <div className="flex flex-col min-w-0">
            {/* Tipografía corporativa: ligera y espaciada, sin peso excesivo */}
            <h2 className="text-lg lg:text-xl font-light text-slate-900 dark:text-white tracking-[0.18em] uppercase">{t('dash.panelSocios')}</h2>
            <p className="text-xs text-slate-500 dark:text-zinc-200 font-normal tracking-wide">{t('dash.gestionInmob')}</p>
          </div>

          <div className="flex items-center gap-4">
            {isAdmin && (
              <button
                onClick={() => setIsEditMode(!isEditMode)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold tracking-wide transition-all shadow-sm border ${
                  isEditMode
                    ? 'bg-mm-oro text-white border-mm-oro'
                    : 'bg-white dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 border-gray-200 dark:border-zinc-700 hover:bg-slate-50 dark:hover:bg-zinc-700/50'
                }`}
              >
                <Edit2 size={14} />
                {isEditMode ? t('dash.edicionActiva') : t('dash.modoEdicion')}
              </button>
            )}

            {/* Reloj dual SV / US — alineado a la derecha, antes de la campana.
                Antes era `hidden lg:flex` y desaparecía en todo el tramo
                mediano. Ahora se ve desde `md`, solo que más apretado
                (menos aire y sin espacio entre las dos horas hasta `lg`): la
                información no se pierde, y con el `flex-wrap` del header no
                hay riesgo de desbordar. */}
            <div className="flex items-center gap-2 lg:gap-3 text-xs font-semibold tracking-widest text-slate-500 dark:text-zinc-200 bg-slate-50 dark:bg-zinc-900 px-3 lg:px-4 py-1.5 lg:py-2 rounded-full border border-gray-200 dark:border-zinc-700 uppercase whitespace-nowrap">
              <span className="flex items-center gap-1.5">SV <span className="text-sm text-slate-900 dark:text-white font-bold tracking-wide">{timeCST || '--:--'}</span></span>
              <span className="text-gray-300 dark:text-zinc-600">|</span>
              <span className="flex items-center gap-1.5">US <span className="text-sm text-slate-900 dark:text-white font-bold tracking-wide">{timePDT || '--:--'}</span></span>
            </div>

            {/* Campana de notificaciones.
                El punto rojo se enciende con los vencimientos críticos Y con
                los mensajes nuevos sin leer del canal "Socios". */}
            <div className="relative" ref={notifRef}>
              <button
                onClick={alternarNotificaciones}
                className="text-slate-500 dark:text-zinc-200 hover:text-slate-800 dark:hover:text-white transition-colors relative p-1"
              >
                {/* Misma condición que en móvil: `hayAvisos`, no "existen
                    avisos". Esta copia comprobaba `notificaciones.length > 0`
                    por su cuenta, así que el punto seguía encendido después de
                    marcarlas leídas y las dos campanas se contradecían. */}
                <Bell size={20} className={hayAvisos ? 'animate-campaneo' : ''} />
                {hayAvisos && (
                  <span className="absolute -top-0.5 -right-0.5 flex w-3.5 h-3.5">
                    <span className="absolute inline-flex w-full h-full rounded-full bg-red-500 opacity-70 animate-ping" />
                    <span className="relative inline-flex w-3.5 h-3.5 rounded-full bg-red-500 border-2 border-white dark:border-zinc-800" />
                  </span>
                )}
              </button>
              {showNotifications && (
                <PanelNotificaciones
                  t={t}
                  notificaciones={notificacionesPanel}
                  idsLeidos={avisosVistos}
                  chatNoLeido={chatNoLeido}
                  noLeidosChat={noLeidosChat}
                  marcarChatLeido={marcarTodoLeido}
                  onAbrirNotificacion={abrirNotificacion}
                  onAbrirChat={() => { setShowNotifications(false); marcarChatLeido(); changeView('chat'); }}
                  onVerTodas={() => { setShowNotifications(false); setModalLista('tareas'); }}
                  className="absolute top-10 right-0 w-80"
                />
              )}
            </div>

            {/* El engranaje de Ajustes se eliminó: todas las preferencias
                (tema, idioma y perfil) viven en el menú del avatar. */}

            {/* Avatar: ABRE UN MENÚ (no redirige directo al perfil). */}
            <div className="relative" ref={menuAvatarRef}>
              <button
                onClick={() => { setShowMenuAvatar(!showMenuAvatar); setShowNotifications(false); }}
                aria-haspopup="menu"
                aria-expanded={showMenuAvatar}
                title={t('menu.miPerfilConfig')}
                className={`flex items-center gap-2 px-2 py-1 rounded-xl transition-colors ml-1 border ${
                  showMenuAvatar
                    ? 'bg-slate-100 dark:bg-zinc-700 border-gray-200 dark:border-zinc-600'
                    : 'border-transparent hover:bg-slate-100 dark:hover:bg-zinc-700 hover:border-gray-200'
                }`}
              >
                <AvatarUsuario
                  url={userAvatarUrl}
                  iniciales={iniciales}
                  nombre={nombreUsuario}
                  alt="Avatar"
                  className="w-10 h-10 shadow-sm"
                  claseContenedor="bg-mm-navy border-2 border-mm-oro"
                  claseTexto="text-[12px]"
                />
                <ChevronDown
                  size={14}
                  className={`text-slate-400 dark:text-zinc-200 transition-transform ${showMenuAvatar ? 'rotate-180' : ''}`}
                />
              </button>

              {showMenuAvatar && (
                <MenuAvatar
                  t={t}
                  nombreUsuario={nombreUsuario}
                  cargo={cargo}
                  iniciales={iniciales}
                  userAvatarUrl={userAvatarUrl}
                  modoOscuro={modoOscuro}
                  alternarTema={alternarTema}
                  language={language}
                  alternarIdioma={alternarIdioma}
                  onPerfil={() => { setShowMenuAvatar(false); changeView('profile'); }}
                  onLogout={() => { setShowMenuAvatar(false); onLogout(); }}
                  isAdmin={isAdmin}
                  className="absolute top-14 right-0 w-64"
                />
              )}
            </div>
          </div>
        </header>

        {/* ════════════════════════════════════════════════
            HEADER SUPERIOR MÓVIL — GLOBAL (vive fuera del
            switch de vistas: acompaña a TODAS las pantallas)
        ════════════════════════════════════════════════ */}
        <header className="md:hidden flex items-center justify-between gap-1 pl-2 pr-3 pb-2 safe-top bg-mm-navy dark:bg-zinc-900 text-white border-b border-white/5 dark:border-zinc-800 flex-shrink-0 z-40">
          {/* Logo + identidad de marca: también es el acceso a Inicio */}
          <button
            onClick={() => changeView('portfolio')}
            title={t('nav.inicio')}
            className="flex items-center gap-1.5 min-w-0 flex-1 active:scale-95 transition-transform"
          >
            <img
              src="/logo1.png"
              alt="MM Capital"
              className="h-14 w-auto object-contain flex-shrink-0"
              style={{ filter: 'brightness(0) invert(1)' }}
            />
            {/* El bloque de marca cede ancho antes que la campana o el avatar */}
            <span className="flex flex-col items-start leading-none min-w-0 border-l border-white/15 pl-1.5 text-left">
              <span className="text-[12px] font-bold text-white tracking-tight truncate w-full">{t('dash.panelSocios')}</span>
              <span className="text-[11px] text-white/60 font-medium tracking-[0.1em] uppercase mt-1 truncate w-full">{t('dash.gestionInmobMin')}</span>
            </span>
          </button>

          {/* El reloj dual ya no vive aquí: bajó junto al saludo, donde hay
              sitio de sobra, para que la barra respire. */}
          <div className="flex items-center gap-4 flex-shrink-0">
            {/* Campana de notificaciones: con avisos sin leer se pone dorada y
                se sacude; al marcarlas leídas vuelve a blanco y se queda quieta. */}
            <div className="relative flex-shrink-0" ref={notifMovilRef}>
              <button
                onClick={alternarNotificaciones}
                aria-label={t('notif.titulo')}
                className={`p-1 active:scale-90 transition-colors relative ${
                  hayAvisos ? 'text-mm-oro' : 'text-white/90'
                }`}
              >
                {/* La sacudida y el halo vuelven, pero atados a `hayAvisos`:
                    solo se mueven cuando hay algo NUEVO sin ver. Antes el punto
                    se encendía porque existieran avisos, así que la campana
                    temblaba siempre y el movimiento dejaba de significar nada.
                    Al marcarlas leídas se queda quieta y en blanco. */}
                <Bell size={24} className={hayAvisos ? 'animate-campaneo' : ''} />
                {hayAvisos && (
                  <span className="absolute -top-0.5 -right-0.5 flex w-3.5 h-3.5">
                    <span className="absolute inline-flex w-full h-full rounded-full bg-red-500 opacity-70 animate-ping" />
                    <span className="relative inline-flex w-3.5 h-3.5 rounded-full bg-red-500 border-2 border-mm-navy dark:border-zinc-900" />
                  </span>
                )}
              </button>
              {showNotifications && (
                <PanelNotificaciones
                  t={t}
                  notificaciones={notificacionesPanel}
                  idsLeidos={avisosVistos}
                  chatNoLeido={chatNoLeido}
                  noLeidosChat={noLeidosChat}
                  marcarChatLeido={marcarTodoLeido}
                  onAbrirNotificacion={abrirNotificacion}
                  onAbrirChat={() => { setShowNotifications(false); marcarChatLeido(); changeView('chat'); }}
                  onVerTodas={() => { setShowNotifications(false); setModalLista('tareas'); }}
                  className="absolute top-10 right-0 w-[78vw] max-w-[320px]"
                />
              )}
            </div>

            {/* Avatar: abre EL MISMO menú del escritorio, con el toggle de
                Modo Edición dentro para no ocupar sitio en la barra. */}
            <div className="relative flex-shrink-0" ref={menuAvatarMovilRef}>
              <button
                onClick={() => { setShowMenuAvatar(!showMenuAvatar); setShowNotifications(false); }}
                aria-haspopup="menu"
                aria-expanded={showMenuAvatar}
                title={t('menu.miPerfilConfig')}
                className="flex items-center gap-1 active:scale-95 transition-transform"
              >
                <AvatarUsuario
                  url={userAvatarUrl}
                  iniciales={iniciales}
                  nombre={nombreUsuario}
                  alt="Avatar"
                  className="w-11 h-11"
                  claseContenedor="bg-mm-navy-hondo border-2 border-mm-oro"
                  claseTexto="text-[13px]"
                  claseIniciales="text-mm-oro"
                />
                {/* Misma señal que en escritorio: indica que se despliega */}
                <ChevronDown
                  size={13}
                  className={`text-white/60 transition-transform flex-shrink-0 ${showMenuAvatar ? 'rotate-180' : ''}`}
                />
              </button>

              {showMenuAvatar && (
                <MenuAvatar
                  t={t}
                  nombreUsuario={nombreUsuario}
                  cargo={cargo}
                  iniciales={iniciales}
                  userAvatarUrl={userAvatarUrl}
                  modoOscuro={modoOscuro}
                  alternarTema={alternarTema}
                  language={language}
                  alternarIdioma={alternarIdioma}
                  onPerfil={() => { setShowMenuAvatar(false); changeView('profile'); }}
                  onInversores={() => { setShowMenuAvatar(false); changeView('investors'); }}
                  onLogout={() => { setShowMenuAvatar(false); onLogout(); }}
                  isAdmin={isAdmin}
                  isEditMode={isEditMode}
                  onToggleEditMode={() => setIsEditMode(v => !v)}
                  className="absolute top-11 right-0 w-[72vw] max-w-[280px]"
                />
              )}
            </div>
          </div>
        </header>

        {/* ── ÁREA DINÁMICA DE VISTAS ──
            En móvil se reserva el alto de la barra inferior fija para que
            ninguna vista quede tapada por ella. */}
        <div className="flex-1 flex flex-col overflow-hidden relative pb-[68px] md:pb-0">
          {currentView === 'project-details' && activeProject ? (
            <ProjectDetails project={activeProject} onBack={handleBack} userRole={rol} userId={user?.id} isEditMode={isEditMode} onUpdateProject={refetchData} aportaciones={aportaciones} />
          ) : currentView === 'project-details' && proyectoPendiente ? (
            /* Recarga sobre un proyecto: se espera a que Supabase devuelva la
               lista. Sin esto asomaría el Dashboard un instante, que es
               justo el salto que se quiere evitar. */
            <div className="flex-1 flex flex-col items-center justify-center gap-3 bg-white dark:bg-zinc-900">
              <Loader2 size={28} className="animate-spin text-mm-oro" />
              <p className="text-xs font-bold text-slate-400 dark:text-zinc-300">{t('comun.cargando')}</p>
            </div>
          ) : currentView === 'vault' ? (
            <VaultView userRole={rol} userId={user?.id} onBack={handleBack} isAdmin={isAdmin} isEditMode={isEditMode} />
          ) : currentView === 'investors' ? (
            <InvestorsView
              onBack={handleBack}
              proyectos={PROJECTS}
              onAbrirProyecto={(p) => changeView('project-details', p)}
              isEditMode={isEditMode}
              isAdmin={isAdmin}
            />
          ) : currentView === 'chat' ? (
            <ChatModule onBack={handleBack} isEditMode={isEditMode} />
          ) : currentView === 'admin-users' ? (
            <AdminUsersView onBack={handleBack} currentUserId={user?.id} isEditMode={isEditMode} isAdmin={isAdmin} />
          ) : currentView === 'ai-chat' ? (
            <AIChatView onBack={handleBack} />
          ) : currentView === 'new-project' ? (
            <NewProjectView onBack={handleBack} />
          ) : currentView === 'all-projects' ? (
            <AllProjectsView
              projects={PROJECTS}
              onCardClick={handleCardClick}
              onBack={handleBack}
              isEditMode={isEditMode}
              isAdmin={isAdmin}
              onNuevoProyecto={() => changeView('new-project')}
              onCambiarPortada={pedirPortadaProyecto}
              subiendoPortadaId={subiendoPortadaId}
              portadaMsg={portadaMsg}
            />
          ) : currentView === 'profile' ? (
            <ProfileView
              user={user}
              onLogout={onLogout}
              onBack={handleBack}
              isAdmin={isAdmin}
              onNavigate={changeView}
              avatarUrl={userAvatarUrl}
              setAvatarUrl={setUserAvatarUrl}
              nombre={nombreUsuario}
              iniciales={iniciales}
              cargo={cargo}
            />
          ) : (
            /* ── Vista Portfolio (Principal) ── */
            <DashboardView
              proyectos={PROJECTS}
              loading={loading}
              errorCarga={errorCarga}
              refetchData={refetchData}
              isAdmin={isAdmin}
              isEditMode={isEditMode}
              saludo={saludo}
              nombreUsuario={nombreUsuario}
              timeCST={timeCST}
              timePDT={timePDT}
              cifrasNoFiables={cifrasNoFiables}
              capitalTotal={capitalTotal}
              egresosTotales={egresosTotales}
              pctDisponible={pctDisponible}
              saludCapital={saludCapital}
              actualizarCapitalTotal={actualizarCapitalTotal}
              entradasActividad={entradasActividad}
              entradasHitos={entradasHitos}
              entradasTareas={entradasTareas}
              changeView={changeView}
              handleCardClick={handleCardClick}
              abrirProyectoDeItem={abrirProyectoDeItem}
              setModalLista={setModalLista}
              portadaMsg={portadaMsg}
              subiendoPortadaId={subiendoPortadaId}
              pedirPortadaProyecto={pedirPortadaProyecto}
            />
      )}
      </div>

      {/* ════════════════════════════════════════════════
          BOTTOM TAB BAR MÓVIL — SIEMPRE FIJA Y SIEMPRE VISIBLE
          Vive fuera del switch de vistas: al navegar entre
          Dashboard, Proyectos, Bóveda, Chat y Perfil nunca desaparece.
      ════════════════════════════════════════════════ */}
      {/* CINCO accesos, no seis. Con seis, cada celda quedaba en 62×38 px con
          etiqueta de 8 px: por debajo del objetivo táctil de 44 px y el
          elemento más apretado de toda la aplicación, presente en TODAS las
          pantallas. "Inversores" pasa al menú del avatar y aquí queda sitio
          para 11 px de etiqueta y una zona de toque cómoda. */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 w-full bg-mm-navy dark:bg-zinc-900 border-t border-white/10 dark:border-zinc-800 flex items-stretch px-1 pt-2 z-50 safe-bottom shadow-[0_-4px_20px_rgba(0,0,0,0.18)]">
        {[
          { id: 'portfolio', label: t('nav.dashboardCorto'), icon: LayoutDashboard },
          { id: 'all-projects', label: t('nav.proyectos'), icon: Building2 },
          { id: 'vault', label: t('nav.boveda'), icon: FolderLock },
          { id: 'chat', label: t('nav.chat'), icon: MessageSquare, badge: chatNoLeido },
          { id: 'profile', label: t('nav.perfil'), icon: Users },
        ].map(item => {
          const Icon = item.icon;
          const active = currentView === item.id || (item.id === 'portfolio' && currentView === 'project-details');
          return (
            <button
              key={item.id}
              onClick={() => changeView(item.id)}
              aria-current={active ? 'page' : undefined}
              className={`relative flex-1 min-w-0 flex flex-col items-center justify-center gap-1 px-1 py-1.5 min-h-[48px] rounded-xl transition-colors active:scale-95 ${
                active ? 'text-mm-oro' : 'text-white/60'
              }`}
            >
              <span className="relative">
                <Icon size={21} strokeWidth={active ? 2.4 : 2} />
                {/* Indicador de mensajes nuevos del canal "Socios" */}
                {item.badge && (
                  <span className="absolute -top-0.5 -right-1 w-2.5 h-2.5 rounded-full bg-red-500 border-2 border-mm-navy dark:border-zinc-900" />
                )}
              </span>
              <span className="text-[11px] font-semibold tracking-tight leading-none w-full text-center truncate">{item.label}</span>
              {active && <span className="absolute bottom-0 w-7 h-[2px] rounded-full bg-mm-oro" />}
            </button>
          );
        })}
      </nav>
      </div>

      {/* "Ver todos": lista completa de actividad, hitos o tareas críticas.
          Cada fila dice a qué proyecto pertenece y viaja a su detalle. */}
      <ListaCompletaModal
        abierto={!!modalLista}
        titulo={LISTAS[modalLista]?.titulo || ''}
        entradas={LISTAS[modalLista]?.entradas || []}
        onCerrar={() => setModalLista(null)}
        onAbrirProyecto={(p) => { setModalLista(null); abrirProyectoDeItem(p); }}
      />
    </div>
  );
}
