import React, { useState, useEffect, useRef } from 'react';
import {
  AlertTriangle, Camera, CheckCircle2, ChevronLeft, ChevronRight, Edit3, Headset,
  Landmark, Loader2, LogOut, MessageSquare, Send, Settings, Sparkles, Trash2,
  Upload, UserCheck, X
} from 'lucide-react';
import { usePrefs } from '../context/PreferenciasContext';
import { useConfirmacion } from '../hooks/useConfirmacion';
import {
  cambiarCorreo, cambiarPassword, leerDatosBancarios, guardarDatosBancarios,
  enviarReporte, getReportes, actualizarEstadoReporte, responderReporte, eliminarReporte
} from '../services/perfilService';
import { subirAvatar, getAvatarUsuario, validarImagen } from '../services/storageService';
import AvatarUsuario from './ui/AvatarUsuario';
import NombreAjustado from './ui/NombreAjustado';
import RecorteAvatar from './RecorteAvatar';

/**
 * Perfil del usuario: identidad, credenciales de Auth, datos bancarios,
 * soporte y —si es Administrador— los accesos de configuración.
 *
 * Vivía dentro de Dashboard.jsx y era el bloque más grande que quedaba tras
 * sacar la Bóveda. Sale entero —estados, avatar, sus seis modales y el hilo de
 * reportes— porque no comparte nada con el panel: este solo lo monta y le pasa
 * la identidad ya resuelta.
 */
function ProfileView({ user, onLogout, onBack, isAdmin, onNavigate, avatarUrl, setAvatarUrl, nombre, iniciales, cargo }) {
  const { t, locale } = usePrefs();
  const { confirmar, dialogoConfirmacion } = useConfirmacion();
  const initials = iniciales || (user?.email ? user.email.substring(0, 2).toUpperCase() : 'MM');
  const cargoTexto = cargo?.texto || (cargo?.clave ? t(cargo.clave) : t('cargo.socioInversionista'));
  // ── Modales de cuenta ──
  const [modalSeguridad, setModalSeguridad] = useState(null);   // 'email' | 'password' | null
  // `passActual` es obligatoria (P0-3): sin re-autenticación no se toca Auth.
  const [formSeguridad, setFormSeguridad] = useState({ email: '', pass: '', pass2: '', passActual: '' });
  // Doble check obligatorio antes de tocar las credenciales de Auth
  const [confirmarSeguridad, setConfirmarSeguridad] = useState(null); // 'email' | 'password' | null
  const [modalBanco, setModalBanco] = useState(false);
  const [formBanco, setFormBanco] = useState({ banco: '', numeroCuenta: '', tipoCuenta: 'ahorro' });
  const [modalSoporte, setModalSoporte] = useState(false);
  const [mensajeSoporte, setMensajeSoporte] = useState('');
  const [modalReportes, setModalReportes] = useState(false);
  const [reportes, setReportes] = useState([]);
  const [cargandoReportes, setCargandoReportes] = useState(false);
  const [ocupadoPerfil, setOcupadoPerfil] = useState(false);
  const [avisoPerfil, setAvisoPerfil] = useState(null);

  const notificar = (tipo, texto) => {
    setAvisoPerfil({ tipo, texto });
    if (tipo === 'exito') setTimeout(() => setAvisoPerfil(null), 6000);
  };

  // Guardar NO ejecuta el cambio: solo valida en local y abre el doble check.
  // La llamada a Supabase vive en ejecutarCambioSeguridad y solo corre si el
  // usuario confirma en el modal de advertencia.
  const handleGuardarSeguridad = (e) => {
    e.preventDefault();
    setAvisoPerfil(null);

    if (!formSeguridad.passActual) {
      notificar('error', t('perfil.passActualRequerida'));
      return;
    }

    if (modalSeguridad === 'password' && formSeguridad.pass !== formSeguridad.pass2) {
      notificar('error', t('perfil.passNoCoinciden'));
      return;
    }

    setConfirmarSeguridad(modalSeguridad);
  };

  const ejecutarCambioSeguridad = async () => {
    const tipo = confirmarSeguridad;
    setOcupadoPerfil(true);
    setAvisoPerfil(null);

    const r = tipo === 'email'
      ? await cambiarCorreo(formSeguridad.email, formSeguridad.passActual)
      : await cambiarPassword(formSeguridad.pass, formSeguridad.pass2, formSeguridad.passActual);

    setOcupadoPerfil(false);
    setConfirmarSeguridad(null);

    if (r.success) {
      setModalSeguridad(null);
      setFormSeguridad({ email: '', pass: '', pass2: '', passActual: '' });
      notificar('exito', r.requiereConfirmacion ? t('perfil.correoConfirmar') : t('perfil.passActualizada'));
    } else {
      // La contraseña actual nunca se conserva tras un intento fallido.
      setFormSeguridad(prev => ({ ...prev, passActual: '' }));
      notificar('error', r.error);
    }
  };

  const handleGuardarBanco = async (e) => {
    e.preventDefault();
    setOcupadoPerfil(true);
    setAvisoPerfil(null);

    const { success, error } = await guardarDatosBancarios(formBanco);
    setOcupadoPerfil(false);

    if (success) { setModalBanco(false); notificar('exito', t('perfil.datosActualizados')); }
    else notificar('error', error);
  };

  const handleEnviarReporte = async (e) => {
    e.preventDefault();
    setOcupadoPerfil(true);
    setAvisoPerfil(null);

    const { success, error } = await enviarReporte(user?.id, mensajeSoporte);
    setOcupadoPerfil(false);

    if (success) { setModalSoporte(false); setMensajeSoporte(''); notificar('exito', t('perfil.reporteEnviado')); }
    else notificar('error', error);
  };

  /* ── Hilo de reportes ─────────────────────────────────────────────────────
     El Administrador responde, cambia el estado y elimina; el usuario normal
     lee la respuesta y contesta. Todo se persiste en Supabase y RLS decide
     qué puede hacer cada rol (migración 007). */
  const [hiloAbierto, setHiloAbierto] = useState(null);      // id del reporte desplegado
  const [borradorRespuesta, setBorradorRespuesta] = useState({});  // { [reporteId]: texto }
  const [reporteOcupado, setReporteOcupado] = useState(null);      // id en proceso

  const recargarReportes = async () => {
    const { reportes: lista, error } = await getReportes();
    setReportes(lista);
    if (error) notificar('error', error);
    return lista;
  };

  const handleResponderReporte = async (reporte) => {
    const texto = (borradorRespuesta[reporte.id] || '').trim();
    if (!texto) return;

    setReporteOcupado(reporte.id);
    const { success, error } = await responderReporte(reporte.id, user?.id, texto, !!isAdmin);
    setReporteOcupado(null);

    if (!success) { notificar('error', error); return; }

    setBorradorRespuesta(prev => ({ ...prev, [reporte.id]: '' }));
    await recargarReportes();
    notificar('exito', t('rep.respuestaEnviada'));
  };

  /** Rota el estado: pendiente -> en_proceso -> resuelto -> pendiente. */
  const handleCambiarEstadoReporte = async (reporte) => {
    const ciclo = ['pendiente', 'en_proceso', 'resuelto'];
    const siguiente = ciclo[(ciclo.indexOf(reporte.estado) + 1) % ciclo.length];

    setReporteOcupado(reporte.id);
    const { success, error } = await actualizarEstadoReporte(reporte.id, siguiente);
    setReporteOcupado(null);

    if (!success) { notificar('error', error); return; }

    await recargarReportes();
    notificar('exito', t('rep.estadoActualizado'));
  };

  const handleEliminarReporte = async (reporte) => {
    if (!await confirmar({
      mensaje: t('rep.confirmarEliminar'),
      detalle: reporte?.autor,
      textoConfirmar: t('rep.eliminar')
    })) return;

    setReporteOcupado(reporte.id);
    const { success, error } = await eliminarReporte(reporte.id);
    setReporteOcupado(null);

    if (!success) { notificar('error', error); return; }

    if (hiloAbierto === reporte.id) setHiloAbierto(null);
    await recargarReportes();
    notificar('exito', t('rep.eliminado'));
  };

  const abrirBandejaReportes = async () => {
    setModalReportes(true);
    setCargandoReportes(true);
    const { reportes: lista, error } = await getReportes();
    setReportes(lista);
    setCargandoReportes(false);
    if (error) notificar('error', error);
  };

  const [showAvatarModal, setShowAvatarModal] = useState(false);
  const [subiendoAvatar, setSubiendoAvatar] = useState(false);
  const [avatarError, setAvatarError] = useState(null);
  const [archivoParaRecortar, setArchivoParaRecortar] = useState(null);
  const avatarInputRef = useRef(null);

  // Al abrir el perfil se trae el avatar realmente guardado en `usuarios`
  useEffect(() => {
    let vigente = true;
    getAvatarUsuario(user?.id).then(url => {
      if (vigente && url) setAvatarUrl(url);
    });
    return () => { vigente = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  /**
   * Paso 1: elegir archivo. NO sube nada todavía; abre el recorte.
   * La subida solo ocurre al confirmar en "Guardar y Subir".
   */
  const handleArchivoAvatar = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';               // permite volver a elegir el mismo archivo
    if (!file) return;

    setAvatarError(null);

    const invalido = validarImagen(file);
    if (invalido) { setAvatarError(invalido); return; }

    setArchivoParaRecortar(file);
  };

  /** Paso 2: el usuario confirmó el encuadre; ahora sí se sube. */
  const handleConfirmarRecorte = async (blob) => {
    setSubiendoAvatar(true);
    setAvatarError(null);

    const { success, url, error } = await subirAvatar(blob, user?.id, 'avatar.jpg');

    setSubiendoAvatar(false);

    if (success) {
      setAvatarUrl(url);
      setArchivoParaRecortar(null);
      setShowAvatarModal(false);
    } else {
      setAvatarError(error);
      setArchivoParaRecortar(null);
    }
  };

  return (
    <main className="flex-1 flex flex-col overflow-hidden bg-transparent">
      {/* Header */}
      <div className="flex items-center gap-4 px-6 md:px-8 py-5 border-b border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800">
        <button onClick={onBack} className="w-8 h-8 rounded-full border border-gray-200 dark:border-zinc-700 flex items-center justify-center text-slate-400 dark:text-zinc-200 hover:text-slate-700 dark:hover:text-zinc-100 hover:border-gray-300 dark:hover:border-zinc-600 transition-all">
          <ChevronLeft size={18} />
        </button>
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-slate-900 dark:text-white">{t('perfil.titulo')}</h2>
          <p className="text-xs text-slate-400 dark:text-zinc-200 font-medium">{t('perfil.subtitulo')}</p>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 md:p-10">
        <div className="max-w-4xl mx-auto space-y-4 md:space-y-6">
          {/* Ficha de identidad, estilo iOS: retrato grande y centrado en
              móvil, nombre proporcionado y correo legible (no diminuto). */}
          <div className="bg-white dark:bg-zinc-800 rounded-[24px] border border-gray-100 dark:border-zinc-700 shadow-sm p-6 md:p-8 flex flex-col sm:flex-row items-center sm:items-start gap-4 sm:gap-6">
            <div className="relative cursor-pointer group flex-shrink-0" onClick={() => setShowAvatarModal(true)}>
              <AvatarUsuario
                url={avatarUrl}
                iniciales={initials}
                nombre={nombre}
                alt={t('perfil.fotoPerfil')}
                className="w-28 h-28 md:w-32 md:h-32 shadow-lg transition-transform group-hover:scale-105"
                claseContenedor="bg-mm-navy border-4 border-mm-oro"
                claseTexto="text-4xl"
                claseIniciales="text-mm-oro"
              />
              <button
                onClick={(e) => { e.stopPropagation(); setShowAvatarModal(true); }}
                className="absolute bottom-0.5 right-0.5 w-9 h-9 bg-mm-oro rounded-full flex items-center justify-center shadow-lg border-2 border-white dark:border-zinc-800 hover:bg-mm-oro-hondo transition-colors active:scale-90"
                title={t('perfil.cambiarFotoTooltip')}
              >
                <Camera size={16} className="text-white" />
              </button>
            </div>

            <div className="text-center sm:text-left flex-1 min-w-0 w-full">
              <h3 className="font-bold text-slate-900 dark:text-white">
                <NombreAjustado texto={nombre || t('admin.sinRol')} max={24} min={15} className="text-center sm:text-left" />
              </h3>
              <p className="text-mm-oro-tinta dark:text-mm-oro-claro text-[15px] font-bold mt-1">{cargoTexto}</p>
              <p className="text-slate-500 dark:text-zinc-300 text-[14px] font-medium mt-1.5 break-all">
                {user?.email || 'usuario@mmcapital.com'}
              </p>
              <div className="mt-4 flex flex-wrap gap-2 justify-center sm:justify-start">
                <span className="text-[12px] font-bold bg-amber-50 dark:bg-amber-500/10 text-mm-oro-tinta dark:text-mm-oro-claro px-3 py-1.5 rounded-full border border-amber-200 dark:border-amber-500/30">{cargoTexto}</span>
                <span className="text-[12px] font-bold bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 px-3 py-1.5 rounded-full border border-emerald-200 dark:border-emerald-500/30">{t('perfil.estadoActivo')}</span>
              </div>
            </div>
          </div>

          {/* Opciones de Cuenta (Sin el botón redundante de Modificar Foto) */}
          <div className="bg-white dark:bg-zinc-800 rounded-[24px] border border-gray-100 dark:border-zinc-700 shadow-sm overflow-hidden">
            <div className="px-6 md:px-8 py-5 border-b border-gray-100 dark:border-zinc-700">
              <h4 className="text-xs font-bold text-slate-400 dark:text-zinc-200 uppercase tracking-widest">{t('perfil.seguridad')}</h4>
            </div>
            {/* border-gray-50 sin variante oscura pintaba una línea casi blanca
                en modo noche: ahora usa el mismo separador que el resto. */}
            <button
              onClick={() => { setFormSeguridad({ email: user?.email || '', pass: '', pass2: '', passActual: '' }); setModalSeguridad('email'); }}
              className="w-full flex items-center justify-between px-6 md:px-8 py-5 hover:bg-gray-50 dark:hover:bg-zinc-700/50 transition-colors border-b border-gray-50 dark:border-zinc-700/60"
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-purple-50 dark:bg-purple-500/10 flex items-center justify-center">
                  <Settings size={18} className="text-purple-500 dark:text-purple-300" />
                </div>
                <div className="text-left">
                  <p className="text-base font-semibold text-slate-800 dark:text-zinc-100">{t('perfil.cambiarCorreo')}</p>
                  <p className="text-xs text-slate-400 dark:text-zinc-200">{t('perfil.cambiarCorreoDesc')}</p>
                </div>
              </div>
              <ChevronRight size={18} className="text-slate-300 dark:text-zinc-200" />
            </button>

            <button
              onClick={() => { setFormSeguridad({ email: '', pass: '', pass2: '', passActual: '' }); setModalSeguridad('password'); }}
              className="w-full flex items-center justify-between px-6 md:px-8 py-5 hover:bg-gray-50 dark:hover:bg-zinc-700/50 transition-colors border-b border-gray-50 dark:border-zinc-700/60"
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-500/10 flex items-center justify-center">
                  <AlertTriangle size={18} className="text-amber-500" />
                </div>
                <div className="text-left">
                  <p className="text-base font-semibold text-slate-800 dark:text-zinc-100">{t('perfil.cambiarPass')}</p>
                  <p className="text-xs text-slate-400 dark:text-zinc-200">{t('perfil.cambiarPassDesc')}</p>
                </div>
              </div>
              <ChevronRight size={18} className="text-slate-300 dark:text-zinc-200" />
            </button>

            {/* Datos Bancarios */}
            <button
              onClick={() => { setFormBanco(leerDatosBancarios(user)); setModalBanco(true); }}
              className="w-full flex items-center justify-between px-6 md:px-8 py-5 border-b border-gray-50 dark:border-zinc-700/60 hover:bg-gray-50 dark:hover:bg-zinc-700/40 transition-colors"
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-sky-50 dark:bg-sky-500/10 flex items-center justify-center">
                  <Landmark size={18} className="text-sky-500 dark:text-sky-300" />
                </div>
                <div className="text-left">
                  <p className="text-base font-semibold text-slate-800 dark:text-zinc-100">{t('perfil.datosBancarios')}</p>
                  <p className="text-xs text-slate-400 dark:text-zinc-200">{t('perfil.datosBancariosDesc')}</p>
                </div>
              </div>
              <ChevronRight size={18} className="text-slate-300 dark:text-zinc-300 flex-shrink-0" />
            </button>

            {/* Soporte Ejecutivo */}
            <button
              onClick={() => { setMensajeSoporte(''); setModalSoporte(true); }}
              className="w-full flex items-center justify-between px-6 md:px-8 py-5 hover:bg-gray-50 dark:hover:bg-zinc-700/40 transition-colors border-b border-gray-100 dark:border-zinc-700"
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center">
                  <Headset size={18} className="text-emerald-500 dark:text-emerald-300" />
                </div>
                <div className="text-left">
                  <p className="text-base font-semibold text-slate-800 dark:text-zinc-100">{t('perfil.soporte')}</p>
                  <p className="text-xs text-slate-400 dark:text-zinc-200">{t('perfil.soporteDesc')}</p>
                </div>
              </div>
              <ChevronRight size={18} className="text-slate-300 dark:text-zinc-300 flex-shrink-0" />
            </button>

            {/* Mis reportes enviados: el usuario ve la respuesta del
                Administrador y puede seguir el hilo. RLS solo le devuelve
                los reportes que él mismo abrió. */}
            {!isAdmin && (
              <button
                onClick={abrirBandejaReportes}
                className="w-full flex items-center justify-between px-6 md:px-8 py-5 hover:bg-gray-50 dark:hover:bg-zinc-700/40 transition-colors"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-sky-50 dark:bg-sky-500/10 flex items-center justify-center">
                    <MessageSquare size={18} className="text-sky-500 dark:text-sky-300" />
                  </div>
                  <div className="text-left">
                    <p className="text-base font-semibold text-slate-800 dark:text-zinc-100">{t('rep.misReportes')}</p>
                    <p className="text-xs text-slate-400 dark:text-zinc-200">{t('perfil.bandejaReportesDesc')}</p>
                  </div>
                </div>
                <ChevronRight size={18} className="text-slate-300 dark:text-zinc-300 flex-shrink-0" />
              </button>
            )}
          </div>

          {/* Opciones Admin (Si es Admin) */}
          {isAdmin && (
            <div className="bg-white dark:bg-zinc-800 rounded-[24px] border border-amber-200/80 dark:border-zinc-700 shadow-sm overflow-hidden">
              {/* El degradado ámbar no tenía variante oscura: en modo noche dejaba
                  una banda clara con texto dorado, ilegible. */}
              <div className="px-6 md:px-8 py-5 border-b border-amber-100 dark:border-zinc-700 bg-gradient-to-r from-amber-50/80 to-amber-50/20 dark:from-amber-500/10 dark:to-transparent flex items-center justify-between">
                <h4 className="text-xs md:text-sm font-bold text-mm-oro-tinta dark:text-mm-oro-claro uppercase tracking-widest flex items-center gap-2">
                  <UserCheck size={16} className="text-mm-2" /> {t('perfil.configAdmin')}
                </h4>
                <span className="text-[11px] font-black bg-mm-oro text-white px-2.5 py-1 rounded-md uppercase tracking-wider">{t('perfil.controlTotal')}</span>
              </div>

              {/* Botón 1: Configuración de Usuarios */}
              <button
                onClick={() => onNavigate && onNavigate('admin-users')}
                className="w-full flex items-center justify-between px-6 md:px-8 py-5 hover:bg-amber-50/40 dark:hover:bg-amber-500/10 transition-colors border-b border-gray-100 dark:border-zinc-700 group"
              >
                <div className="flex items-center gap-4">
                  <div className="w-11 h-11 rounded-2xl bg-amber-100/80 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-500/30 flex items-center justify-center shadow-sm">
                    <UserCheck size={20} className="text-mm-oro-tinta dark:text-mm-oro-claro" />
                  </div>
                  <div className="text-left">
                    <p className="text-base font-bold text-slate-900 dark:text-white group-hover:text-mm-oro-tinta dark:group-hover:text-mm-oro-claro transition-colors">{t('perfil.configUsuarios')}</p>
                    <p className="text-xs text-slate-500 dark:text-zinc-200 mt-0.5">{t('perfil.configUsuariosDesc')}</p>
                  </div>
                </div>
                <ChevronRight size={18} className="text-slate-300 dark:text-zinc-200 group-hover:text-mm-oro-tinta dark:group-hover:text-mm-oro-claro transition-colors" />
              </button>

              {/* Botón 3: Bandeja de reportes de soporte */}
              <button
                onClick={abrirBandejaReportes}
                className="w-full flex items-center justify-between px-6 md:px-8 py-5 hover:bg-amber-50/40 dark:hover:bg-amber-500/10 transition-colors border-b border-gray-100 dark:border-zinc-700 group"
              >
                <div className="flex items-center gap-4">
                  <div className="w-11 h-11 rounded-2xl bg-emerald-100/80 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-500/30 flex items-center justify-center shadow-sm">
                    <Headset size={20} className="text-emerald-600 dark:text-emerald-300" />
                  </div>
                  <div className="text-left">
                    <p className="text-base font-bold text-slate-900 dark:text-white group-hover:text-mm-oro-tinta dark:group-hover:text-mm-oro-claro transition-colors">{t('perfil.bandejaReportes')}</p>
                    <p className="text-xs text-slate-500 dark:text-zinc-200 mt-0.5">{t('perfil.bandejaReportesDesc')}</p>
                  </div>
                </div>
                <ChevronRight size={18} className="text-slate-300 dark:text-zinc-200 group-hover:text-mm-oro-tinta dark:group-hover:text-mm-oro-claro transition-colors" />
              </button>

              {/* Botón 2: Chat de la IA para Administrador */}
              <button
                onClick={() => onNavigate && onNavigate('ai-chat')}
                className="w-full flex items-center justify-between px-6 md:px-8 py-5 hover:bg-amber-50/40 dark:hover:bg-amber-500/10 transition-colors border-b border-gray-100 dark:border-zinc-700 group"
              >
                <div className="flex items-center gap-4">
                  {/* Mismo tratamiento suave que las otras dos tarjetas: sin
                      cuadro negro, que rompía la fila. */}
                  <div className="w-11 h-11 rounded-2xl bg-violet-100/80 dark:bg-violet-500/15 border border-violet-200 dark:border-violet-500/30 flex items-center justify-center shadow-sm">
                    <Sparkles size={20} className="text-violet-600 dark:text-violet-300" />
                  </div>
                  <div className="text-left">
                    <p className="text-base font-bold text-slate-900 dark:text-white group-hover:text-mm-oro-tinta dark:group-hover:text-mm-oro-claro transition-colors">{t('perfil.chatIA')}</p>
                    <p className="text-xs text-slate-500 dark:text-zinc-200 mt-0.5">{t('perfil.chatIADesc')}</p>
                  </div>
                </div>
                <ChevronRight size={18} className="text-slate-300 dark:text-zinc-200 group-hover:text-mm-oro-tinta dark:group-hover:text-mm-oro-claro transition-colors" />
              </button>
            </div>
          )}

          {/* Logout */}
          <button
            onClick={onLogout}
            className="w-full flex items-center justify-center gap-2.5 py-4 rounded-[20px] border border-red-100 bg-red-50 dark:bg-red-500/10 text-red-600 font-bold text-base hover:bg-red-100 transition-colors shadow-sm"
          >
            <LogOut size={18} />
            {t('perfil.cerrarSesion')}
          </button>
        </div>
      </div>

      {/* Modal Interactivo Cambiar Foto de Perfil */}
      {showAvatarModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-800 rounded-3xl max-w-md w-full p-6 shadow-2xl border border-gray-100 dark:border-zinc-700">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100 dark:border-zinc-700">
              <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Camera size={18} className="text-mm-2" /> {t('perfil.cambiarFoto')}
              </h3>
              <button onClick={() => setShowAvatarModal(false)} className="text-slate-400 dark:text-zinc-200 hover:text-slate-700 dark:hover:text-zinc-100">
                ✕
              </button>
            </div>
            {/* Subida real desde el dispositivo al bucket archivos_mmcapital */}
            <div className="space-y-4">
              <input
                type="file"
                ref={avatarInputRef}
                onChange={handleArchivoAvatar}
                accept="image/*"
                className="archivo-oculto"
              />

              {/* Vista previa: la temporal mientras sube, si no la guardada */}
              <div className="flex flex-col items-center gap-3 py-2">
                {/* El velo de "subiendo" va FUERA del avatar, en un envoltorio
                    propio: así el avatar sigue siendo el mismo componente que
                    en el resto del panel y no hay que abrirle un hueco para
                    hijos. */}
                <div className="relative w-28 h-28">
                  <AvatarUsuario
                    url={avatarUrl}
                    iniciales={initials}
                    alt={t('perfil.fotoPerfil')}
                    className="w-28 h-28"
                    claseContenedor="bg-mm-navy border-4 border-mm-oro"
                    claseTexto="text-3xl"
                    claseIniciales="text-mm-oro"
                  />
                  {subiendoAvatar && (
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center rounded-full">
                      <Loader2 size={26} className="animate-spin text-white" />
                    </div>
                  )}
                </div>
                <p className="text-[11px] text-slate-400 dark:text-zinc-200 text-center">
                  {t('perfil.formatosAceptados')}
                </p>
              </div>

              {avatarError && (
                <div className="p-3 rounded-xl border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 flex items-start gap-2 text-xs font-semibold text-red-700 dark:text-red-300">
                  <AlertTriangle size={15} className="flex-shrink-0 mt-px" />
                  <span>{avatarError}</span>
                </div>
              )}

              <button
                type="button"
                onClick={() => avatarInputRef.current?.click()}
                disabled={subiendoAvatar}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-mm-navy text-white text-sm font-bold hover:bg-slate-800 transition-colors disabled:opacity-60"
              >
                {subiendoAvatar
                  ? <><Loader2 size={16} className="animate-spin text-mm-oro" /> {t('comun.subiendo')}</>
                  : <><Upload size={16} className="text-mm-3" /> {t('perfil.elegirFoto')}</>}
              </button>

              <div className="pt-1 flex justify-end">
                <button
                  type="button"
                  onClick={() => { setShowAvatarModal(false); setAvatarError(null); }}
                  disabled={subiendoAvatar}
                  className="px-4 py-2 text-xs font-bold text-slate-500 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-700 rounded-xl disabled:opacity-50"
                >
                  {t('comun.cancelar')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}


      {/* ── Aviso global del perfil ── */}
      {avisoPerfil && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[70] max-w-md w-[92%]">
          <div className={`p-4 rounded-2xl border shadow-xl flex items-start gap-3 text-xs font-semibold ${
            avisoPerfil.tipo === 'exito'
              ? 'bg-emerald-50 dark:bg-emerald-900 text-emerald-800 dark:text-emerald-200 border-emerald-200 dark:border-emerald-700'
              : 'bg-red-50 dark:bg-red-900 text-red-800 dark:text-red-200 border-red-200 dark:border-red-700'
          }`}>
            {avisoPerfil.tipo === 'exito'
              ? <CheckCircle2 size={16} className="flex-shrink-0 mt-px" />
              : <AlertTriangle size={16} className="flex-shrink-0 mt-px" />}
            <span className="flex-1">{avisoPerfil.texto}</span>
            <button onClick={() => setAvisoPerfil(null)} className="flex-shrink-0"><X size={14} /></button>
          </div>
        </div>
      )}

      {/* ── Modal: correo / contraseña (Supabase Auth) ── */}
      {modalSeguridad && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-800 rounded-3xl max-w-md w-full p-6 shadow-2xl border border-gray-100 dark:border-zinc-700">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100 dark:border-zinc-700">
              <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Settings size={18} className="text-mm-2" />
                {modalSeguridad === 'email' ? t('perfil.cambiarCorreo') : t('perfil.cambiarPass')}
              </h3>
              <button onClick={() => { setModalSeguridad(null); setConfirmarSeguridad(null); setFormSeguridad({ email: '', pass: '', pass2: '', passActual: '' }); }} className="text-slate-400 dark:text-zinc-200 hover:text-slate-700 dark:hover:text-white"><X size={18} /></button>
            </div>

            <form onSubmit={handleGuardarSeguridad} className="space-y-4">
              {/* Re-autenticación obligatoria: va primero porque sin ella el
                  resto del formulario no llega nunca a Supabase. */}
              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-zinc-300 mb-1 uppercase">{t('perfil.passActual')}</label>
                <input
                  type="password" required autoComplete="current-password" value={formSeguridad.passActual}
                  onChange={(e) => setFormSeguridad({ ...formSeguridad, passActual: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-slate-800 dark:text-zinc-100 focus:outline-none focus:border-mm-oro"
                />
                <p className="text-[11px] text-slate-400 dark:text-zinc-300 mt-1.5 leading-relaxed">{t('perfil.passActualAviso')}</p>
              </div>

              {modalSeguridad === 'email' ? (
                <div>
                  <label className="block text-xs font-bold text-slate-600 dark:text-zinc-300 mb-1 uppercase">{t('perfil.nuevoCorreo')}</label>
                  <input
                    type="email" required value={formSeguridad.email}
                    onChange={(e) => setFormSeguridad({ ...formSeguridad, email: e.target.value })}
                    className="w-full bg-slate-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-slate-800 dark:text-zinc-100 focus:outline-none focus:border-mm-oro"
                  />
                  <p className="text-[11px] text-slate-400 dark:text-zinc-300 mt-1.5 leading-relaxed">{t('perfil.avisoCorreo')}</p>
                </div>
              ) : (
                <>
                  <div>
                    <label className="block text-xs font-bold text-slate-600 dark:text-zinc-300 mb-1 uppercase">{t('perfil.nuevaPass')}</label>
                    <input
                      type="password" required minLength={8} autoComplete="new-password" value={formSeguridad.pass}
                      onChange={(e) => setFormSeguridad({ ...formSeguridad, pass: e.target.value })}
                      className="w-full bg-slate-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-slate-800 dark:text-zinc-100 focus:outline-none focus:border-mm-oro"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-600 dark:text-zinc-300 mb-1 uppercase">{t('perfil.repetirPass')}</label>
                    <input
                      type="password" required minLength={8} autoComplete="new-password" value={formSeguridad.pass2}
                      onChange={(e) => setFormSeguridad({ ...formSeguridad, pass2: e.target.value })}
                      className="w-full bg-slate-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-slate-800 dark:text-zinc-100 focus:outline-none focus:border-mm-oro"
                    />
                  </div>
                  <p className="text-[11px] text-slate-400 dark:text-zinc-300">{t('perfil.minCaracteres')}</p>
                </>
              )}

              <div className="pt-2 flex justify-end gap-2">
                <button type="button" onClick={() => { setModalSeguridad(null); setConfirmarSeguridad(null); setFormSeguridad({ email: '', pass: '', pass2: '', passActual: '' }); }} className="px-4 py-2.5 text-xs font-bold text-slate-500 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-700 rounded-xl">{t('comun.cancelar')}</button>
                <button type="submit" disabled={ocupadoPerfil} className="flex items-center gap-2 px-5 py-2.5 text-xs font-bold text-white bg-mm-navy hover:bg-slate-800 rounded-xl shadow-sm disabled:opacity-50">
                  {ocupadoPerfil && <Loader2 size={14} className="animate-spin text-mm-3" />}
                  {t('comun.guardar')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Doble check: sin pasar por aquí no se llama a Supabase ── */}
      {confirmarSeguridad && (
        <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-800 rounded-3xl max-w-sm w-full p-6 shadow-2xl border border-gray-100 dark:border-zinc-700">
            <div className="flex flex-col items-center text-center">
              <div className="w-12 h-12 rounded-full bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 flex items-center justify-center mb-4">
                <AlertTriangle size={22} className="text-mm-oro" />
              </div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white mb-2">
                {t('perfil.confirmarTitulo')}
              </h3>
              <p className="text-sm font-semibold text-slate-700 dark:text-zinc-200 leading-relaxed">
                {t('perfil.confirmarMensaje')}
              </p>
              <p className="text-[11px] text-slate-400 dark:text-zinc-200 leading-relaxed mt-2">
                {confirmarSeguridad === 'email'
                  ? t('perfil.confirmarDetalleCorreo')
                  : t('perfil.confirmarDetallePass')}
              </p>
            </div>

            <div className="mt-6 flex flex-col-reverse sm:flex-row sm:justify-center gap-2">
              <button
                type="button"
                onClick={() => setConfirmarSeguridad(null)}
                disabled={ocupadoPerfil}
                className="px-4 py-2.5 text-xs font-bold text-slate-500 dark:text-zinc-300 bg-slate-100 dark:bg-zinc-700 hover:bg-slate-200 dark:hover:bg-zinc-600 rounded-xl disabled:opacity-50"
              >
                {t('comun.cancelar')}
              </button>
              <button
                type="button"
                onClick={ejecutarCambioSeguridad}
                disabled={ocupadoPerfil}
                className="flex items-center justify-center gap-2 px-5 py-2.5 text-xs font-bold text-white bg-mm-navy hover:bg-slate-800 rounded-xl shadow-sm disabled:opacity-50"
              >
                {ocupadoPerfil && <Loader2 size={14} className="animate-spin text-mm-3" />}
                {t('perfil.confirmarSi')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: datos bancarios (user_metadata) ── */}
      {modalBanco && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-800 rounded-3xl max-w-md w-full p-6 shadow-2xl border border-gray-100 dark:border-zinc-700">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100 dark:border-zinc-700">
              <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Landmark size={18} className="text-mm-2" /> {t('perfil.datosBancarios')}
              </h3>
              <button onClick={() => setModalBanco(false)} className="text-slate-400 dark:text-zinc-200 hover:text-slate-700 dark:hover:text-white"><X size={18} /></button>
            </div>

            <form onSubmit={handleGuardarBanco} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-zinc-300 mb-1 uppercase">{t('perfil.banco')}</label>
                <input
                  type="text" required placeholder={t('perfil.bancoPh')} value={formBanco.banco}
                  onChange={(e) => setFormBanco({ ...formBanco, banco: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-slate-800 dark:text-zinc-100 focus:outline-none focus:border-mm-oro"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-zinc-300 mb-1 uppercase">{t('perfil.numeroCuenta')}</label>
                <input
                  type="text" required inputMode="numeric" value={formBanco.numeroCuenta}
                  onChange={(e) => setFormBanco({ ...formBanco, numeroCuenta: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-slate-800 dark:text-zinc-100 focus:outline-none focus:border-mm-oro"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-zinc-300 mb-1 uppercase">{t('perfil.tipoCuenta')}</label>
                <select
                  value={formBanco.tipoCuenta}
                  onChange={(e) => setFormBanco({ ...formBanco, tipoCuenta: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-slate-800 dark:text-zinc-100 focus:outline-none focus:border-mm-oro cursor-pointer"
                >
                  <option value="ahorro">{t('perfil.cuentaAhorro')}</option>
                  <option value="corriente">{t('perfil.cuentaCorriente')}</option>
                </select>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button type="button" onClick={() => setModalBanco(false)} className="px-4 py-2.5 text-xs font-bold text-slate-500 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-700 rounded-xl">{t('comun.cancelar')}</button>
                <button type="submit" disabled={ocupadoPerfil} className="flex items-center gap-2 px-5 py-2.5 text-xs font-bold text-white bg-mm-navy hover:bg-slate-800 rounded-xl shadow-sm disabled:opacity-50">
                  {ocupadoPerfil && <Loader2 size={14} className="animate-spin text-mm-3" />}
                  {t('comun.guardar')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal: enviar reporte de soporte ── */}
      {modalSoporte && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-800 rounded-3xl max-w-md w-full p-6 shadow-2xl border border-gray-100 dark:border-zinc-700">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100 dark:border-zinc-700">
              <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Headset size={18} className="text-mm-2" /> {t('perfil.soporte')}
              </h3>
              <button onClick={() => setModalSoporte(false)} className="text-slate-400 dark:text-zinc-200 hover:text-slate-700 dark:hover:text-white"><X size={18} /></button>
            </div>

            <form onSubmit={handleEnviarReporte} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-zinc-300 mb-1 uppercase">{t('perfil.describeProblema')}</label>
                <textarea
                  required rows={6} minLength={10} value={mensajeSoporte}
                  onChange={(e) => setMensajeSoporte(e.target.value)}
                  placeholder={t('perfil.soportePh')}
                  className="w-full bg-slate-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-slate-800 dark:text-zinc-100 focus:outline-none focus:border-mm-oro resize-none leading-relaxed"
                />
                <p className="text-[11px] text-slate-400 dark:text-zinc-300 mt-1.5">
                  {mensajeSoporte.trim().length} {t('perfil.caracteres')}
                </p>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button type="button" onClick={() => setModalSoporte(false)} className="px-4 py-2.5 text-xs font-bold text-slate-500 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-700 rounded-xl">{t('comun.cancelar')}</button>
                <button type="submit" disabled={ocupadoPerfil} className="flex items-center gap-2 px-5 py-2.5 text-xs font-bold text-white bg-mm-navy hover:bg-slate-800 rounded-xl shadow-sm disabled:opacity-50">
                  {ocupadoPerfil && <Loader2 size={14} className="animate-spin text-mm-3" />}
                  {t('perfil.enviarReporte')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal grande: bandeja de reportes (admin) ── */}
      {modalReportes && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-800 rounded-3xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl border border-gray-100 dark:border-zinc-700 overflow-hidden">
            <div className="px-6 py-5 border-b border-gray-100 dark:border-zinc-700 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-emerald-100/80 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-500/30 flex items-center justify-center">
                  <Headset size={20} className="text-emerald-600 dark:text-emerald-300" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">
                    {isAdmin ? t('perfil.bandejaReportes') : t('rep.misReportes')}
                  </h3>
                  <p className="text-xs text-slate-400 dark:text-zinc-200">{reportes.length} {t('perfil.reportesRecibidos')}</p>
                </div>
              </div>
              <button onClick={() => setModalReportes(false)} className="text-slate-400 dark:text-zinc-200 hover:text-slate-700 dark:hover:text-white"><X size={18} /></button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {cargandoReportes ? (
                <div className="flex items-center justify-center gap-3 py-14 text-slate-400 dark:text-zinc-200">
                  <Loader2 size={20} className="animate-spin text-mm-3" />
                  <span className="text-sm font-semibold">{t('comun.cargando')}</span>
                </div>
              ) : reportes.length === 0 ? (
                <div className="border border-dashed border-gray-300 dark:border-zinc-600 rounded-2xl py-12 text-center">
                  <Headset size={26} className="text-slate-300 dark:text-zinc-600 mx-auto mb-3" />
                  <p className="text-sm font-bold text-slate-600 dark:text-zinc-300">{t('perfil.sinReportes')}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {reportes.map(r => {
                    const abierto = hiloAbierto === r.id;
                    const ocupado = reporteOcupado === r.id;
                    const respuestas = r.respuestas || [];

                    return (
                    <div key={r.id} className="p-4 rounded-2xl bg-slate-50 dark:bg-zinc-900/50 border border-gray-100 dark:border-zinc-700">
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <AvatarUsuario
                            url={r.avatarUrl}
                            iniciales={(r.autor || '').substring(0, 2)}
                            className="w-8 h-8"
                            claseContenedor="bg-mm-navy border border-mm-oro"
                            claseIniciales="text-mm-oro"
                          />
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-slate-900 dark:text-white truncate">{r.autor}</p>
                            <p className="text-[11px] text-slate-400 dark:text-zinc-300 truncate">{r.email}</p>
                          </div>
                        </div>
                        <span className={`text-[11px] font-black uppercase tracking-wider px-2 py-1 rounded-full flex-shrink-0 ${
                          r.estado === 'resuelto'
                            ? 'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                            : r.estado === 'en_proceso'
                            ? 'bg-sky-50 dark:bg-sky-500/15 text-sky-700 dark:text-sky-300'
                            : 'bg-amber-50 dark:bg-amber-500/15 text-mm-oro-tinta dark:text-mm-oro-claro'
                        }`}>
                          {t('estadoReporte.' + r.estado)}
                        </span>
                      </div>

                      <p className="text-sm text-slate-700 dark:text-zinc-200 leading-relaxed whitespace-pre-wrap break-words">{r.mensaje}</p>
                      <p className="text-[11px] text-slate-400 dark:text-zinc-300 mt-2">
                        {r.fecha ? new Date(r.fecha).toLocaleString(locale) : ''}
                      </p>

                      {/* ── Acciones: Responder / Cambiar estado / Eliminar ── */}
                      <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-gray-100 dark:border-zinc-700">
                        <button
                          onClick={() => setHiloAbierto(abierto ? null : r.id)}
                          disabled={ocupado}
                          className="inline-flex items-center gap-1.5 text-[11px] font-bold text-white bg-mm-navy px-3 py-1.5 rounded-xl hover:bg-slate-800 transition-colors disabled:opacity-50"
                        >
                          <MessageSquare size={13} className="text-mm-oro" />
                          {abierto ? t('rep.ocultarHilo') : t('rep.responder')}
                        </button>

                        {isAdmin && (
                          <>
                            <button
                              onClick={() => handleCambiarEstadoReporte(r)}
                              disabled={ocupado}
                              className="inline-flex items-center gap-1.5 text-[11px] font-bold text-mm-oro-tinta dark:text-mm-oro-claro bg-mm-oro-lavado dark:bg-amber-500/10 border border-mm-oro-borde dark:border-amber-500/30 px-3 py-1.5 rounded-xl hover:bg-mm-oro-hover dark:hover:bg-amber-500/20 transition-colors disabled:opacity-50"
                            >
                              {ocupado
                                ? <Loader2 size={13} className="animate-spin text-mm-3" />
                                : <Edit3 size={13} className="text-mm-3" />}
                              {t('rep.cambiarEstado')}
                            </button>
                            <button
                              onClick={() => handleEliminarReporte(r)}
                              disabled={ocupado}
                              className="inline-flex items-center gap-1.5 text-[11px] font-bold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 px-3 py-1.5 rounded-xl hover:bg-red-100 dark:hover:bg-red-500/20 transition-colors disabled:opacity-50"
                            >
                              <Trash2 size={13} />
                              {t('rep.eliminar')}
                            </button>
                          </>
                        )}

                        {respuestas.length > 0 && (
                          <span className="text-[11px] font-bold text-slate-500 dark:text-zinc-200 ml-auto">
                            {respuestas.length} {t('rep.respuestas')}
                          </span>
                        )}
                      </div>

                      {/* ── Hilo visual de respuestas ── */}
                      {abierto && (
                        <div className="mt-3 pl-3 border-l-2 border-mm-oro/40 space-y-2.5">
                          {respuestas.length === 0 ? (
                            <p className="text-[11px] text-slate-400 dark:text-zinc-300 italic">{t('rep.sinRespuestas')}</p>
                          ) : respuestas.map(resp => (
                            <div
                              key={resp.id}
                              className={`p-3 rounded-xl border ${
                                resp.esAdmin
                                  ? 'bg-amber-50/60 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/30'
                                  : 'bg-white dark:bg-zinc-800 border-gray-100 dark:border-zinc-700'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2 mb-1">
                                <span className="text-[11px] font-bold text-slate-900 dark:text-white truncate">
                                  {resp.autor}
                                  {resp.esAdmin && (
                                    <span className="ml-1.5 text-[11px] font-black uppercase tracking-wider text-mm-oro-tinta dark:text-mm-oro-claro">
                                      {t('rep.administracion')}
                                    </span>
                                  )}
                                </span>
                                <span className="text-[11px] text-slate-400 dark:text-zinc-300 flex-shrink-0">
                                  {resp.fecha ? new Date(resp.fecha).toLocaleString(locale) : ''}
                                </span>
                              </div>
                              <p className="text-xs text-slate-700 dark:text-zinc-200 leading-relaxed whitespace-pre-wrap break-words">
                                {resp.mensaje}
                              </p>
                            </div>
                          ))}

                          {/* Caja de respuesta (admin y autor del reporte) */}
                          <form
                            onSubmit={(e) => { e.preventDefault(); handleResponderReporte(r); }}
                            className="flex items-end gap-2 pt-1"
                          >
                            <textarea
                              rows={2}
                              value={borradorRespuesta[r.id] || ''}
                              onChange={(e) => setBorradorRespuesta(prev => ({ ...prev, [r.id]: e.target.value }))}
                              placeholder={t('rep.escribeRespuesta')}
                              className="flex-1 min-w-0 resize-none rounded-xl border border-gray-200 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-xs text-slate-700 dark:text-zinc-200 focus:outline-none focus:border-mm-oro"
                            />
                            <button
                              type="submit"
                              disabled={ocupado || !(borradorRespuesta[r.id] || '').trim()}
                              title={t('rep.enviarRespuesta')}
                              className="flex-shrink-0 inline-flex items-center gap-1.5 bg-mm-navy text-white text-[11px] font-bold px-3 py-2.5 rounded-xl hover:bg-slate-800 transition-colors disabled:opacity-40"
                            >
                              {ocupado
                                ? <Loader2 size={13} className="animate-spin text-mm-3" />
                                : <Send size={13} className="text-mm-3" />}
                              {t('rep.enviarRespuesta')}
                            </button>
                          </form>
                        </div>
                      )}
                    </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {dialogoConfirmacion}

      {/* Recorte antes de subir: nada viaja a Storage hasta confirmar */}
      {archivoParaRecortar && (
        <RecorteAvatar
          file={archivoParaRecortar}
          subiendo={subiendoAvatar}
          onCancel={() => setArchivoParaRecortar(null)}
          onConfirmar={handleConfirmarRecorte}
        />
      )}
    </main>
  );
}

export default ProfileView;
