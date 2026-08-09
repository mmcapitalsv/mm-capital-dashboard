import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useProyectos } from '../hooks/useProyectos';
import { usePrefs } from '../context/PreferenciasContext';
import RecorteAvatar from './RecorteAvatar';
import InvestorsView from './InvestorsView';
import ChatModule from './ChatModule';
import NombreAjustado from './ui/NombreAjustado';
import { VideoBackground } from './ui/VideoBackground';
import { HyperText } from './ui/hyper-text';
import { useChat } from '../context/ChatContext';
import { motion } from 'framer-motion';

/** Dorado de marca para el resaltado del menú lateral. */
const NAV_DORADO = '#C5A059';

/* Id del único selector de portada de la aplicación.
   Los botones "Cambiar portada" son <label htmlFor> apuntando aquí: abrir el
   selector con la etiqueta es la forma NATIVA y funciona en todos los
   teléfonos, mientras que llamar a `input.click()` desde JavaScript lo
   bloquean varios navegadores móviles. */
const ID_INPUT_PORTADA = 'input-portada-proyecto';

/**
 * Quita la numeración inicial de un hito ("4. Losa de entrepiso" -> "Losa de
 * entrepiso"). Solo la usa la tarjeta "Próximos hitos" del Dashboard: el dato
 * guardado en Supabase no se toca.
 */
const sinNumeracion = (texto) => String(texto || '').replace(/^\d+\.\s*/, '');

/* ── Avisos ya revisados, recordados entre sesiones ─────────────────────────
   Se guardan los ids de los vencimientos que el usuario ya vio. Sin esto, el
   punto rojo de la campana volvía a aparecer en cada recarga aunque no hubiera
   nada nuevo, porque el estado arrancaba vacío en memoria.
   La clave lleva el id del usuario: en un equipo compartido, los avisos vistos
   de uno no apagan la campana del otro. */
const CLAVE_AVISOS = 'mmcapital:avisosVistos:';

function leerAvisosVistos(usuarioId) {
  if (!usuarioId) return [];
  try {
    const crudo = localStorage.getItem(CLAVE_AVISOS + usuarioId);
    const lista = crudo ? JSON.parse(crudo) : [];
    return Array.isArray(lista) ? lista.map(String) : [];
  } catch {
    return [];   // localStorage bloqueado o JSON corrupto: se empieza de cero
  }
}

function guardarAvisosVistos(usuarioId, ids) {
  if (!usuarioId) return;
  try {
    localStorage.setItem(CLAVE_AVISOS + usuarioId, JSON.stringify(ids));
  } catch {
    /* Sin almacenamiento disponible se pierde entre sesiones, pero la campana
       sigue funcionando dentro de la sesión actual. */
  }
}

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

import { crearUsuario, actualizarUsuario } from '../services/inversionesService';
import { etiquetaEstado } from '../i18n/diccionario';
import { etiquetaCategoria } from '../i18n/diccionario';
import ProjectDetails from './ProjectDetails';
import ListaCompletaModal from './ListaCompletaModal';
import {
  Activity, AlertTriangle, ArrowUp, Bell, Building2, Briefcase, Calendar, Camera, CheckCircle2, ChevronDown,
  ChevronLeft, ChevronRight, Headset, Landmark, DollarSign, Download, Edit2, Edit3, FileText, FolderLock, Globe,
  Image as ImageIcon, LayoutDashboard, Loader2, Lock, LogOut, MapPin, MessageSquare, Moon, Paperclip, Plus, Send, Settings,
  Save, Sparkles, Sun, Trash2, TrendingUp, TrendingDown, Upload, UserCheck, Users, Wallet, X
} from 'lucide-react';
import { Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import {
  uploadArchivoProyecto, getArchivosProyecto, subirAvatar, getAvatarUsuario, validarImagen,
  leerAvatarCache, guardarAvatarCache, subirPortadaProyecto,
  renombrarArchivo, eliminarArchivo, actualizarArchivo
} from '../services/storageService';
import { supabase } from '../supabaseClient';
import { conversarConIA, hayClaveGemini } from '../services/geminiService';
import {
  cambiarCorreo, cambiarPassword, leerDatosBancarios, guardarDatosBancarios,
  enviarReporte, getReportes, actualizarEstadoReporte, responderReporte, eliminarReporte
} from '../services/perfilService';
import {
  claveSaludo, nombreMostrado, inicialesUsuario, cargoUsuario
} from '../lib/perfilUsuario';
import { formatoArchivo, claveFormato, ACEPTA_BOVEDA } from '../lib/archivos';
import InputMonto from './ui/InputMonto';
import MetricasProyecto, { EjecucionFinanciera } from './ui/MetricasProyecto';
import { montoCorto, montoExacto } from '../lib/formato';
import { useConfirmacion } from '../hooks/useConfirmacion';

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

// ─── Vistas secundarias ───────────────────────────────────────────────────────

function VaultView({ userRole, onBack, isAdmin, isEditMode }) {
  const { t, locale } = usePrefs();
  // Confirmación con la estética de la app en vez del `confirm()` del navegador
  const { confirmar, dialogoConfirmacion } = useConfirmacion();
  /* Fuente ÚNICA de datos: la tabla `archivos` de Supabase (proyecto_id null).
     No hay documentos de ejemplo: lo que no esté subido, no se ve. */
  const [dbFiles, setDbFiles] = useState([]);
  const [cargandoVault, setCargandoVault] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  /** {porcentaje, fase} mientras se comprime y sube; null cuando no hay subida. */
  const [progresoSubida, setProgresoSubida] = useState(null);
  const [uploadMsg, setUploadMsg] = useState(null);
  const [newDocName, setNewDocName] = useState('');
  const [newDocCategory, setNewDocCategory] = useState('Legal Corporativo');
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [cambiosPendientes, setCambiosPendientes] = useState(false);
  const [confirmandoVault, setConfirmandoVault] = useState(false);
  /* Archivo elegido en el modal: se guarda para poder decir QUÉ es (imagen,
     PDF o documento) y enseñar la miniatura antes de subirlo. */
  const [archivoElegido, setArchivoElegido] = useState(null);
  const [previaArchivo, setPreviaArchivo] = useState(null);
  // Documento de tipo imagen abierto a pantalla completa desde la lista
  const [imagenAmpliada, setImagenAmpliada] = useState(null);

  /** Relee la bóveda desde Supabase y confirma visualmente los cambios. */
  const handleConfirmarCambiosVault = async () => {
    setConfirmandoVault(true);
    await loadVaultFiles();
    setConfirmandoVault(false);
    setCambiosPendientes(false);
    setUploadMsg({ type: 'success', text: t('vault.cambiosGuardados') });
    setTimeout(() => setUploadMsg(null), 5000);
  };

  // Edit Doc modal state
  const [editingDoc, setEditingDoc] = useState(null);
  const [editDocName, setEditDocName] = useState('');
  const [editDocCategory, setEditDocCategory] = useState('');

  const fileInputRef = useRef(null);

  const loadVaultFiles = async () => {
    try {
      const list = await getArchivosProyecto('global_vault');
      setDbFiles(Array.isArray(list) ? list : []);
    } catch (e) {
      console.warn("Vault fetch warning:", e);
      setDbFiles([]);
    } finally {
      setCargandoVault(false);
    }
  };

  useEffect(() => {
    loadVaultFiles();
    // Realtime: un documento subido desde otra sesión aparece solo
    /* Filtrado por la bóveda: sin `filter`, subir una factura de CUALQUIER
       proyecto disparaba una relectura completa de los documentos
       corporativos, que no tienen nada que ver. */
    const canal = supabase
      .channel('boveda-archivos')
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'archivos',
        filter: 'proyecto_id=eq.global_vault'
      }, loadVaultFiles)
      .subscribe();
    return () => { supabase.removeChannel(canal); };
  }, []);

  // Apagar el Modo Edición cierra el formulario de renombrado a medio escribir:
  // no puede quedar abierto un editor que ya no tiene permiso para guardar.
  useEffect(() => {
    if (!isEditMode) setEditingDoc(null);
  }, [isEditMode]);

  /** Recuerda el archivo elegido y prepara la miniatura si es una imagen. */
  const handleElegirArchivoVault = (e) => {
    const file = e.target.files?.[0] || null;
    setPreviaArchivo((previa) => {
      if (previa) URL.revokeObjectURL(previa);
      return file && formatoArchivo(file.name, '') === 'imagen' ? URL.createObjectURL(file) : null;
    });
    setArchivoElegido(file);
  };

  /** Deja el modal de subida como recién abierto. */
  const cerrarModalSubida = () => {
    setPreviaArchivo((previa) => {
      if (previa) URL.revokeObjectURL(previa);
      return null;
    });
    setArchivoElegido(null);
    setShowUploadModal(false);
  };

  const handleUploadVaultDoc = async (e) => {
    e.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      // Aviso en línea, no `alert()` del navegador: la tarjeta ya tiene su
      // propio sitio para mensajes y el diálogo nativo rompe la estética.
      setUploadMsg({ type: 'error', text: t('vault.seleccionaArchivo') });
      setTimeout(() => setUploadMsg(null), 5000);
      return;
    }

    setIsUploading(true);
    setProgresoSubida({ porcentaje: 0, fase: 'subiendo' });
    setUploadMsg(null);

    // La categoría elegida viaja como `tipo`: es la columna real de `archivos`
    const res = await uploadArchivoProyecto(
      file,
      'global_vault',
      newDocCategory || 'Legal Corporativo',
      setProgresoSubida
    );
    setIsUploading(false);
    setProgresoSubida(null);

    // Supabase rechaza por tamaño (413) incluso después de comprimir: se avisa claro
    if (!res.success && res.tamanoExcedido) {
      // El `alert()` que había aquí duplicaba literalmente el aviso de abajo
      setUploadMsg({ type: 'error', text: t('vault.archivoDemasiadoGrande') });
      setTimeout(() => setUploadMsg(null), 5000);
      return;
    }

    if (res.success) {
      // El nombre visible es el que escribió el administrador, si lo puso
      const nombreFinal = newDocName.trim();
      if (nombreFinal && nombreFinal !== file.name && res.data?.id) {
        await renombrarArchivo(res.data.id, nombreFinal);
      }
      setUploadMsg({ type: 'success', text: t('msg.docRegistrado', { nombre: nombreFinal || file.name }) });
      setNewDocName('');
      cerrarModalSubida();
      setCambiosPendientes(true);
      await loadVaultFiles();
    } else {
      setUploadMsg({ type: 'error', text: res.error || t('msg.errorSupabase') });
    }

    setTimeout(() => setUploadMsg(null), 5000);
  };

  const handleSaveEditDoc = async (e) => {
    e.preventDefault();
    if (!editingDoc || !puedeModificarDocs) return;

    const { success, error } = await actualizarArchivo(editingDoc.id, {
      nombre_archivo: editDocName,
      tipo: editDocCategory
    });

    if (!success) {
      setUploadMsg({ type: 'error', text: error || t('msg.errorSupabase') });
      setTimeout(() => setUploadMsg(null), 5000);
      return;
    }

    setEditingDoc(null);
    setCambiosPendientes(true);
    await loadVaultFiles();
  };

  const handleDeleteDoc = async (doc) => {
    if (!puedeModificarDocs) return;
    if (!await confirmar({
      mensaje: t('vault.confirmEliminar'),
      detalle: doc?.nombre_archivo,
      textoConfirmar: t('vault.eliminarDoc')
    })) return;

    const { success, error } = await eliminarArchivo(doc.raw || doc);
    if (!success) {
      setUploadMsg({ type: 'error', text: error || t('msg.errorSupabase') });
      setTimeout(() => setUploadMsg(null), 5000);
      return;
    }

    setCambiosPendientes(true);
    await loadVaultFiles();
  };

  /* `categoria` es lo que eligió el administrador (Legal, Fiscal...) y
     `formato` es lo que el archivo ES (imagen, PDF o documento), deducido de
     su extensión: así una foto se ve como foto y no como un PDF genérico. */
  const allVaultDocs = dbFiles.map(f => ({
    id: f.id,
    nombre_archivo: f.nombre_archivo,
    categoria: f.tipo || t('fb.docEnStorage'),
    formato: formatoArchivo(f.nombre_archivo, f.url_archivo),
    subido_por: t('fb.administracion'),
    created_at: f.created_at,
    url_archivo: f.url_archivo,
    raw: f
  }));

  const adminAccess = isAdmin || userRole === 'admin';

  /* Renombrar y eliminar exigen ADEMÁS el Modo Edición encendido. En lectura
     un documento corporativo solo se descarga: así ni el propio Administrador
     borra un escritura de un clic despistado. */
  const puedeModificarDocs = adminAccess && !!isEditMode;

  return (
    <main className="flex-1 flex flex-col overflow-hidden bg-transparent">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 md:px-8 py-4 md:py-5 border-b border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 shadow-sm flex-shrink-0">
        <button onClick={onBack} className="w-9 h-9 rounded-full border border-gray-200 dark:border-zinc-700 flex items-center justify-center text-slate-400 dark:text-zinc-300 hover:text-slate-700 dark:hover:text-zinc-100 hover:border-gray-300 dark:hover:border-zinc-600 transition-all flex-shrink-0 active:scale-95">
          <ChevronLeft size={18} />
        </button>
        {/* Sin recuadro oscuro: el candado va suelto, en dorado sobre el fondo */}
        <FolderLock size={22} className="text-mm-2 flex-shrink-0" />
        {/* Título y subtítulo COMPLETOS: parten en varias líneas antes que
            recortarse con puntos suspensivos. */}
        <div className="min-w-0">
          <h2 className="text-[15px] md:text-xl font-bold text-slate-900 dark:text-white leading-tight text-balance">{t('vault.titulo')}</h2>
          <p className="text-[11px] md:text-xs text-slate-500 dark:text-zinc-300 font-medium leading-snug mt-0.5">{t('vault.subtitulo')}</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-8">
        <div className="max-w-5xl mx-auto space-y-6">

          {uploadMsg && (
            <div className={`p-4 rounded-2xl border flex items-center gap-3 text-xs font-semibold ${
              uploadMsg.type === 'success' ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30' : 'bg-red-50 dark:bg-red-500/10 text-red-800 dark:text-red-300 border-red-200 dark:border-red-500/30'
            }`}>
              {uploadMsg.type === 'success' ? <CheckCircle2 size={18} className="text-emerald-600 flex-shrink-0" /> : <AlertTriangle size={18} className="text-red-600 flex-shrink-0" />}
              <span>{uploadMsg.text}</span>
            </div>
          )}

          {/* Listado de Documentos Corporativos */}
          <div className="bg-white dark:bg-zinc-800 rounded-3xl border border-gray-100 dark:border-zinc-700 shadow-sm p-4 md:p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 mb-4 border-b border-gray-100 dark:border-zinc-700">
              <h3 className="text-xs font-bold text-slate-500 dark:text-zinc-300 uppercase tracking-widest flex items-center gap-2">
                <FileText size={14} className="text-mm-3" /> {t('vault.institucionales')} ({allVaultDocs.length})
              </h3>

              {/* "Subir documento" vive aquí, junto al listado al que pertenece,
                  en vez de suelto en la cabecera de la pantalla. */}
              {adminAccess && (
                <div className="flex items-center gap-2.5 flex-wrap">
                  <button
                    onClick={() => setShowUploadModal(true)}
                    className="flex items-center gap-2 bg-mm-navy dark:bg-zinc-900 text-white text-xs font-bold px-3.5 py-2 rounded-xl hover:bg-slate-800 transition-colors shadow-sm border border-mm-oro/25 active:scale-95"
                  >
                    <Upload size={14} className="text-mm-3" /> {t('vault.subirDoc')}
                  </button>
                  {cambiosPendientes && (
                    <span className="text-[11px] font-bold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 px-2.5 py-1 rounded-lg flex items-center gap-1.5">
                      <AlertTriangle size={12} /> {t('vault.cambiosPendientes')}
                    </span>
                  )}
                  {/* Sin esta pista, un administrador buscaría los botones de
                      renombrar y borrar sin entender por qué ya no están. */}
                  {!isEditMode && (
                    <span className="text-[11px] font-semibold text-slate-500 dark:text-zinc-300 bg-slate-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 px-2.5 py-1 rounded-lg flex items-center gap-1.5">
                      <Lock size={12} className="text-slate-400 dark:text-zinc-400" /> {t('vault.soloLectura')}
                    </span>
                  )}
                  <button
                    onClick={handleConfirmarCambiosVault}
                    disabled={!cambiosPendientes || confirmandoVault}
                    className="flex items-center gap-1.5 bg-mm-oro-lavado dark:bg-amber-500/15 text-mm-oro-tinta dark:text-mm-oro-claro border border-mm-oro-borde dark:border-amber-500/30 text-xs font-bold px-3.5 py-2 rounded-xl hover:bg-mm-oro-hover transition-colors shadow-sm disabled:opacity-40 active:scale-95"
                  >
                    {confirmandoVault
                      ? <><Loader2 size={14} className="animate-spin text-mm-3" /> {t('proy.guardando')}</>
                      : <><Save size={14} className="text-mm-3" /> {t('vault.guardarCambios')}</>}
                  </button>
                </div>
              )}
            </div>

            <div className="space-y-3">
              {cargandoVault ? (
                <p className="text-xs text-slate-400 dark:text-zinc-300 py-8 text-center">{t('comun.cargando')}</p>
              ) : allVaultDocs.length === 0 ? (
                <div className="py-10 flex flex-col items-center justify-center text-center gap-2">
                  <FolderLock size={34} className="text-slate-200 dark:text-zinc-600" />
                  <p className="text-sm font-bold text-slate-500 dark:text-zinc-300">{t('vault.vacio')}</p>
                  <p className="text-xs text-slate-400 dark:text-zinc-400">{t('vault.vacioAyuda')}</p>
                </div>
              ) : allVaultDocs.map((doc, idx) => (
                <div key={doc.id || idx} className="p-4 bg-slate-50/70 dark:bg-zinc-800/70 border border-gray-100 dark:border-zinc-700 rounded-2xl hover:bg-white dark:hover:bg-zinc-700 hover:shadow-md transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4 group">
                  <div className="flex items-start sm:items-center gap-3.5 flex-1 min-w-0">
                    {/* Una imagen se ve: miniatura real en vez del icono
                        genérico, y al pulsarla se abre a pantalla completa.
                        Un PDF lleva su icono rojo y el resto, el azul. */}
                    {doc.formato === 'imagen' && doc.url_archivo && doc.url_archivo !== '#' ? (
                      <button
                        type="button"
                        onClick={() => setImagenAmpliada(doc)}
                        title={t('vault.verImagen')}
                        className="w-11 h-11 rounded-xl overflow-hidden border border-gray-200 dark:border-zinc-600 flex-shrink-0 mt-0.5 sm:mt-0 bg-slate-100 dark:bg-zinc-900 cursor-zoom-in hover:border-mm-oro transition-colors"
                      >
                        <img src={doc.url_archivo} alt={doc.nombre_archivo} loading="lazy" className="w-full h-full object-cover" />
                      </button>
                    ) : (
                      <div className={`w-11 h-11 rounded-xl border flex items-center justify-center flex-shrink-0 mt-0.5 sm:mt-0 ${
                        doc.formato === 'pdf'
                          ? 'bg-red-50 dark:bg-red-500/10 border-red-100 dark:border-red-500/30 text-red-600 dark:text-red-400'
                          : doc.formato === 'imagen'
                          ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-100 dark:border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                          : 'bg-blue-50 dark:bg-blue-500/10 border-blue-100 dark:border-blue-500/30 text-blue-600 dark:text-blue-400'
                      }`}>
                        {doc.formato === 'imagen' ? <ImageIcon size={20} /> : <FileText size={20} />}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      {/* Nombre de archivo COMPLETO: parte en varias líneas
                          antes que recortarse con puntos suspensivos. */}
                      <h4 className="text-sm font-bold text-slate-900 dark:text-white group-hover:text-mm-oro-tinta dark:group-hover:text-mm-oro-claro transition-colors break-all leading-snug">{doc.nombre_archivo}</h4>
                      <div className="flex flex-wrap items-center gap-2 mt-1">
                        <span className="text-[11px] font-bold text-mm-oro-tinta dark:text-mm-oro-claro bg-mm-oro-lavado dark:bg-amber-500/10 px-2.5 py-0.5 rounded-full border border-mm-oro-borde dark:border-amber-500/30">{etiquetaCategoria(doc.categoria, t)}</span>
                        {/* Qué ES el archivo, no en qué carpeta va */}
                        <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${
                          doc.formato === 'pdf'
                            ? 'text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/30'
                            : doc.formato === 'imagen'
                            ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30'
                            : 'text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/30'
                        }`}>
                          {t(claveFormato(doc.formato))}
                        </span>
                        <span className="text-[11px] text-slate-400 dark:text-zinc-200 font-medium">{t('vault.subido')} {new Date(doc.created_at || Date.now()).toLocaleDateString(locale)}</span>
                      </div>
                    </div>
                  </div>

                  {/* ACCIONES: DESCARGA PARA TODOS + EDITAR/ELIMINAR PARA ADMIN */}
                  <div className="flex items-center gap-2 flex-shrink-0 self-end sm:self-center">
                    {/* Descargar */}
                    {doc.url_archivo && doc.url_archivo !== '#' ? (
                      <a
                        href={doc.url_archivo}
                        download={doc.nombre_archivo}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-xs font-bold text-white bg-mm-navy px-3.5 py-2 rounded-xl hover:bg-slate-800 transition-colors shadow-sm"
                      >
                        <Download size={14} className="text-mm-3" /> {t('comun.descargar')}
                      </a>
                    ) : (
                      /* Sin archivo real no se finge una descarga. Antes este
                         botón lanzaba un `alert()` diciendo "descargando…" y
                         no descargaba nada: prometía algo que no podía cumplir. */
                      <span
                        title={t('vault.sinArchivoAyuda')}
                        className="flex items-center gap-1.5 text-xs font-bold text-mm-3 bg-slate-50 dark:bg-zinc-900 px-3.5 py-2 rounded-xl border border-gray-200 dark:border-zinc-700 cursor-not-allowed"
                      >
                        <AlertTriangle size={14} /> {t('vault.sinArchivo')}
                      </span>
                    )}

                    {/* Editar / Eliminar: Administrador Y en Modo Edición */}
                    {puedeModificarDocs && (
                      <>
                        <button
                          onClick={() => {
                            setEditingDoc(doc);
                            setEditDocName(doc.nombre_archivo);
                            setEditDocCategory(doc.categoria || 'Legal Corporativo');
                          }}
                          className="p-2 text-slate-400 dark:text-zinc-200 hover:text-slate-700 dark:hover:text-zinc-100 bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl hover:bg-slate-50 dark:hover:bg-zinc-700/50 transition-colors"
                          title={t('vault.editarDoc')}
                        >
                          <Edit3 size={14} />
                        </button>
                        <button
                          onClick={() => handleDeleteDoc(doc)}
                          className="p-2 text-red-400 hover:text-red-600 bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl hover:bg-red-50 transition-colors"
                          title={t('vault.eliminarDoc')}
                        >
                          <Trash2 size={14} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Modal Subir Documento Corporativo */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-800 rounded-3xl max-w-md w-full p-6 shadow-2xl border border-gray-100 dark:border-zinc-700">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100 dark:border-zinc-700">
              <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Upload size={18} className="text-mm-oro" /> {t('vault.subirDoc')}
              </h3>
              <button onClick={cerrarModalSubida} className="text-slate-400 dark:text-zinc-200 hover:text-slate-700 dark:hover:text-zinc-100">
                ✕
              </button>
            </div>
            <form onSubmit={handleUploadVaultDoc} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-zinc-300 mb-1 uppercase">{t('vault.seleccionarArchivo')}</label>
                <input
                  type="file"
                  ref={fileInputRef}
                  required
                  accept={ACEPTA_BOVEDA}
                  onChange={handleElegirArchivoVault}
                  className="w-full bg-slate-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl px-3 py-2 text-xs focus:outline-none"
                />
                {/* La bóveda no es solo de PDF: aquí se dice en voz alta */}
                <p className="text-[11px] text-slate-400 dark:text-zinc-400 mt-1.5 leading-relaxed">
                  {t('vault.formatosAdmitidos')}
                </p>

                {/* Qué se eligió y QUÉ ES, antes de subirlo */}
                {archivoElegido && (
                  <div className="mt-2 flex items-center gap-3 p-2.5 rounded-xl border border-gray-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900">
                    {previaArchivo ? (
                      <img src={previaArchivo} alt={archivoElegido.name} className="w-12 h-12 rounded-lg object-cover border border-gray-200 dark:border-zinc-600 flex-shrink-0" />
                    ) : (
                      <div className={`w-12 h-12 rounded-lg border flex items-center justify-center flex-shrink-0 ${
                        formatoArchivo(archivoElegido.name) === 'pdf'
                          ? 'bg-red-50 dark:bg-red-500/10 border-red-100 dark:border-red-500/30 text-red-600 dark:text-red-400'
                          : 'bg-blue-50 dark:bg-blue-500/10 border-blue-100 dark:border-blue-500/30 text-blue-600 dark:text-blue-400'
                      }`}>
                        <FileText size={20} />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-slate-800 dark:text-white break-all leading-snug">{archivoElegido.name}</p>
                      <p className="text-[11px] font-semibold text-slate-400 dark:text-zinc-300 mt-0.5">
                        {t(claveFormato(formatoArchivo(archivoElegido.name)))} · {(archivoElegido.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                    </div>
                  </div>
                )}
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-zinc-300 mb-1 uppercase">{t('vault.nombreDoc')}</label>
                <input
                  type="text"
                  placeholder="Ej. Escritura_Constitucion_MM_Capital.pdf"
                  value={newDocName}
                  onChange={(e) => setNewDocName(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-slate-800"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-zinc-300 mb-1 uppercase">{t('comun.categoria')}</label>
                <select
                  value={newDocCategory}
                  onChange={(e) => setNewDocCategory(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none"
                >
                  <option value="Legal Corporativo">{t('cat.legalCorp')}</option>
                  <option value="Poderes Legales">{t('cat.poderes')}</option>
                  <option value="Fiscal y Tributario">{t('cat.fiscal')}</option>
                  <option value="Gobernanza / Socios">{t('cat.gobernanza')}</option>
                  <option value="Reglamento Interno">{t('cat.reglamento')}</option>
                </select>
              </div>
              {/* Estado visual de la subida: fase + barra de progreso real */}
              {isUploading && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] font-bold text-slate-600 dark:text-zinc-200">
                    <span className="flex items-center gap-1.5">
                      <Loader2 size={12} className="animate-spin text-mm-3" />
                      {progresoSubida?.fase === 'comprimiendo'
                        ? t('vault.comprimiendo')
                        : progresoSubida?.fase === 'registrando'
                          ? t('vault.registrando')
                          : t('comun.subiendo')}
                    </span>
                    <span>{progresoSubida?.porcentaje ?? 0}%</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-slate-100 dark:bg-zinc-700 overflow-hidden">
                    <div
                      className="h-full bg-mm-oro transition-all duration-300"
                      style={{ width: `${progresoSubida?.porcentaje ?? 0}%` }}
                    />
                  </div>
                </div>
              )}

              <div className="pt-2 flex justify-end gap-2">
                <button type="button" onClick={cerrarModalSubida} disabled={isUploading} className="px-4 py-2 text-xs font-bold text-slate-500 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-700 rounded-xl disabled:opacity-40">
                  {t('comun.cancelar')}
                </button>
                <button
                  type="submit"
                  disabled={isUploading}
                  className="px-5 py-2 text-xs font-bold text-white bg-mm-navy hover:bg-slate-800 rounded-xl shadow-sm disabled:opacity-50 flex items-center gap-2"
                >
                  {isUploading ? <Loader2 size={14} className="animate-spin text-mm-3" /> : <Upload size={14} className="text-mm-3" />}
                  {isUploading
                    ? `${t('comun.subiendo')} ${progresoSubida?.porcentaje ?? 0}%`
                    : t('vault.subirABoveda')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Visor de una imagen guardada en la bóveda (a pantalla completa) */}
      {imagenAmpliada && (
        <div
          className="fixed inset-0 z-[60] bg-black/90 backdrop-blur-sm flex flex-col"
          onClick={() => setImagenAmpliada(null)}
        >
          <div className="flex items-center justify-between gap-4 px-4 sm:px-6 py-3 border-b border-white/10 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-white break-all leading-snug">{imagenAmpliada.nombre_archivo}</h3>
              <p className="text-[11px] font-semibold text-white/50">
                {t(claveFormato(imagenAmpliada.formato))} · {etiquetaCategoria(imagenAmpliada.categoria, t)}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <a
                href={imagenAmpliada.url_archivo}
                download={imagenAmpliada.nombre_archivo}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-xs font-bold text-mm-navy bg-mm-oro hover:bg-mm-oro-vivo px-4 py-2 rounded-xl transition-colors"
              >
                <Download size={14} />
                <span className="hidden sm:inline">{t('comun.descargar')}</span>
              </a>
              <button
                onClick={() => setImagenAmpliada(null)}
                className="p-2 rounded-xl text-white/80 bg-white/10 hover:bg-white/20 transition-colors"
              >
                <X size={16} />
              </button>
            </div>
          </div>
          <div className="flex-1 min-h-0 p-3 sm:p-6 flex items-center justify-center">
            <img
              src={imagenAmpliada.url_archivo}
              alt={imagenAmpliada.nombre_archivo}
              onClick={(e) => e.stopPropagation()}
              className="max-w-full max-h-full object-contain rounded-xl shadow-2xl bg-white"
            />
          </div>
        </div>
      )}

      {dialogoConfirmacion}

      {/* Modal Editar Documento Corporativo */}
      {editingDoc && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-800 rounded-3xl max-w-md w-full p-6 shadow-2xl border border-gray-100 dark:border-zinc-700">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100 dark:border-zinc-700">
              <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Edit3 size={18} className="text-mm-2" /> {t('vault.editarDocTitulo')}
              </h3>
              <button onClick={() => setEditingDoc(null)} className="text-slate-400 dark:text-zinc-200 hover:text-slate-700 dark:hover:text-zinc-100">
                ✕
              </button>
            </div>
            <form onSubmit={handleSaveEditDoc} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-zinc-300 mb-1 uppercase">{t('vault.nombreArchivo')}</label>
                <input
                  type="text"
                  required
                  value={editDocName}
                  onChange={(e) => setEditDocName(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-slate-800"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-zinc-300 mb-1 uppercase">{t('comun.categoria')}</label>
                <select
                  value={editDocCategory}
                  onChange={(e) => setEditDocCategory(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none"
                >
                  <option value="Legal Corporativo">{t('cat.legalCorp')}</option>
                  <option value="Poderes Legales">{t('cat.poderes')}</option>
                  <option value="Fiscal y Tributario">{t('cat.fiscal')}</option>
                  <option value="Gobernanza / Socios">{t('cat.gobernanza')}</option>
                  <option value="Reglamento Interno">{t('cat.reglamento')}</option>
                </select>
              </div>
              <div className="pt-2 flex justify-end gap-2">
                <button type="button" onClick={() => setEditingDoc(null)} className="px-4 py-2 text-xs font-bold text-slate-500 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-700 rounded-xl">
                  {t('comun.cancelar')}
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-bold text-white bg-mm-navy hover:bg-slate-800 rounded-xl shadow-sm"
                >
                  {t('proy.guardarCambios')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}


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

// El `valor` es lo que se guarda en Supabase y NUNCA se traduce.
// La etiqueta visible sí se traduce con la clave correspondiente.
const ROLES = [
  { valor: 'admin',               clave: 'rol.admin' },
  { valor: 'socio_administrador', clave: 'rol.socioAdmin' },
  { valor: 'socio_director',      clave: 'rol.socioDirector' },
  { valor: 'inversionista',       clave: 'rol.inversionista' }
];

function etiquetaRol(rol, t) {
  const encontrado = ROLES.find(r => r.valor === rol);
  if (encontrado) return t(encontrado.clave);
  return rol || t('admin.sinRol');
}

function AdminUsersView({ onBack, currentUserId, isEditMode, isAdmin }) {
  const { t } = usePrefs();
  const { confirmar, dialogoConfirmacion } = useConfirmacion();
  // El Modo Edición es la llave maestra: sin él la vista es solo lectura
  const puedeEditar = isAdmin && isEditMode;
  const [showCrear, setShowCrear] = useState(false);
  const [editando, setEditando] = useState(null);
  const [form, setForm] = useState({ nombre: '', email: '', rol: 'inversionista' });
  const [usuarios, setUsuarios] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [mensaje, setMensaje] = useState(null);
  const [guardandoId, setGuardandoId] = useState(null);

  const cargarUsuarios = async () => {
    setCargando(true);
    try {
      const { data, error } = await supabase
        .from('usuarios')
        .select('*')
        .order('created_at', { ascending: true });

      if (error) {
        setMensaje({ tipo: 'error', texto: t('msg.leerUsuarios', { error: error.message }) });
        setUsuarios([]);
      } else {
        setUsuarios(Array.isArray(data) ? data.filter(Boolean) : []);
      }
    } catch (err) {
      setMensaje({ tipo: 'error', texto: t('msg.errorInesperado', { error: err?.message || err }) });
      setUsuarios([]);
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    cargarUsuarios();
    // Reactividad: si alguien cambia la tabla, la lista se actualiza sola
    const canal = supabase
      .channel('admin-usuarios')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'usuarios' }, cargarUsuarios)
      .subscribe();
    return () => { supabase.removeChannel(canal); };
  }, []);

  const handleCrear = async (e) => {
    e.preventDefault();
    setGuardandoId('nuevo');
    setMensaje(null);

    const { success, error } = await crearUsuario(form);
    setGuardandoId(null);

    if (success) {
      setShowCrear(false);
      setForm({ nombre: '', email: '', rol: 'inversionista' });
      setMensaje({ tipo: 'exito', texto: t('admin.usuarioCreado') });
      await cargarUsuarios();
      setTimeout(() => setMensaje(null), 5000);
    } else {
      setMensaje({ tipo: 'error', texto: error });
    }
  };

  const handleGuardarEdicion = async (e) => {
    e.preventDefault();
    if (!editando?.id) return;

    setGuardandoId(editando.id);
    setMensaje(null);

    const { success, error } = await actualizarUsuario(editando.id, {
      nombre: editando.nombre_completo,
      email: editando.email,
      rol: editando.rol
    });
    setGuardandoId(null);

    if (success) {
      setEditando(null);
      setMensaje({ tipo: 'exito', texto: t('admin.usuarioActualizado') });
      await cargarUsuarios();
      setTimeout(() => setMensaje(null), 5000);
    } else {
      setMensaje({ tipo: 'error', texto: error });
    }
  };

  const handleCambiarRol = async (usuario, nuevoRol) => {
    if (!usuario?.id || nuevoRol === usuario.rol) return;

    setGuardandoId(usuario.id);
    setMensaje(null);

    // Actualización optimista: la UI responde de inmediato
    setUsuarios(prev => prev.map(u => u.id === usuario.id ? { ...u, rol: nuevoRol } : u));

    const { error } = await supabase.from('usuarios').update({ rol: nuevoRol }).eq('id', usuario.id);

    if (error) {
      setMensaje({ tipo: 'error', texto: t('msg.cambiarRol', { error: error.message }) });
      await cargarUsuarios();
    } else {
      setMensaje({ tipo: 'exito', texto: t('msg.rolCambiado', { email: usuario.email, rol: etiquetaRol(nuevoRol, t) }) });
      setTimeout(() => setMensaje(null), 5000);
    }
    setGuardandoId(null);
  };

  const handleEliminar = async (usuario) => {
    if (!usuario?.id) return;
    if (usuario.id === currentUserId) {
      setMensaje({ tipo: 'error', texto: t('admin.noEliminarPropia') });
      return;
    }
    if (!await confirmar({
      mensaje: t('dlg.eliminarUsuario', { email: usuario.email }),
      detalle: usuario.nombre_completo || usuario.email,
      textoConfirmar: t('admin.eliminarUsuario')
    })) return;

    setGuardandoId(usuario.id);
    setMensaje(null);

    const { error } = await supabase.from('usuarios').delete().eq('id', usuario.id);

    if (error) {
      setMensaje({ tipo: 'error', texto: t('msg.noEliminar', { error: error.message }) });
    } else {
      setUsuarios(prev => prev.filter(u => u.id !== usuario.id));
      setMensaje({ tipo: 'exito', texto: t('msg.usuarioEliminado', { email: usuario.email }) });
      setTimeout(() => setMensaje(null), 5000);
    }
    setGuardandoId(null);
  };

  return (
    <main className="flex-1 flex flex-col overflow-hidden bg-transparent">
      <div className="flex items-center justify-between px-6 md:px-8 py-5 border-b border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-slate-400 dark:text-zinc-200 hover:text-slate-700 dark:hover:text-zinc-100 transition-colors">
            <ChevronLeft size={20} />
          </button>
          <div className="flex items-center gap-2">
            <UserCheck size={20} className="text-mm-2" />
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">{t('admin.titulo')}</h2>
              <p className="text-xs text-slate-400 dark:text-zinc-200 font-medium">{t('admin.subtitulo')} <span className="font-mono">usuarios</span> {t('admin.subtituloPost')}</p>
            </div>
          </div>
        </div>
        <button
          onClick={cargarUsuarios}
          disabled={cargando}
          className="flex items-center gap-2 text-xs font-bold text-slate-600 dark:text-zinc-300 bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 px-3.5 py-2 rounded-xl hover:bg-slate-50 dark:hover:bg-zinc-700/50 transition-colors disabled:opacity-50"
        >
          {cargando ? <Loader2 size={14} className="animate-spin text-mm-3" /> : <Activity size={14} className="text-mm-oro" />}
          {t('comun.actualizar')}
        </button>
      </div>

      <div className="flex-1 p-6 md:p-8 overflow-y-auto">
        <div className="max-w-4xl space-y-4">

          {mensaje && (
            <div className={`p-4 rounded-2xl border flex items-center gap-3 text-xs font-semibold ${
              mensaje.tipo === 'exito' ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30' : 'bg-red-50 dark:bg-red-500/10 text-red-800 dark:text-red-300 border-red-200 dark:border-red-500/30'
            }`}>
              {mensaje.tipo === 'exito'
                ? <CheckCircle2 size={16} className="text-emerald-600 flex-shrink-0" />
                : <AlertTriangle size={16} className="text-red-600 flex-shrink-0" />}
              <span>{mensaje.texto}</span>
            </div>
          )}

          <div className="bg-white dark:bg-zinc-800 rounded-2xl p-6 border border-gray-100 dark:border-zinc-700 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <h3 className="text-sm font-bold text-slate-800 dark:text-zinc-100 uppercase tracking-wider">
                {t('admin.registrados')} ({usuarios.length})
              </h3>

              {puedeEditar ? (
                <button
                  onClick={() => { setForm({ nombre: '', email: '', rol: 'inversionista' }); setShowCrear(true); }}
                  className="flex items-center gap-2 bg-mm-navy text-white text-xs font-bold px-4 py-2.5 rounded-xl hover:bg-slate-800 transition-colors shadow-sm"
                >
                  <Plus size={15} className="text-mm-3" /> {t('admin.anadirUsuario')}
                </button>
              ) : isAdmin && (
                <span className="text-[11px] font-semibold text-slate-400 dark:text-zinc-300 flex items-center gap-1.5">
                  <AlertTriangle size={12} /> {t('admin.activaEdicion')}
                </span>
              )}
            </div>

            {cargando ? (
              <div className="flex items-center justify-center gap-3 py-12 text-slate-400 dark:text-zinc-200">
                <Loader2 size={20} className="animate-spin text-mm-3" />
                <span className="text-sm font-semibold">{t('admin.cargando')}</span>
              </div>
            ) : usuarios.length === 0 ? (
              <div className="border border-dashed border-gray-300 dark:border-zinc-600 rounded-2xl bg-slate-50/60 dark:bg-zinc-800/60 py-12 px-6 text-center">
                <Users size={28} className="text-slate-300 dark:text-zinc-200 mx-auto mb-3" />
                <p className="text-sm font-bold text-slate-600 dark:text-zinc-300">{t('msg.tablaVacia', { tabla: 'usuarios' })}</p>
                <p className="text-xs text-slate-400 dark:text-zinc-200 mt-1 max-w-md mx-auto">
                  {t('admin.tablaVaciaAyuda2', { archivo: '001_esquema_mmcapital.sql' })}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {usuarios.map((u) => {
                  const esYo = u.id === currentUserId;
                  const ocupado = guardandoId === u.id;
                  return (
                    <div key={u.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-slate-50 dark:bg-zinc-800 rounded-xl border border-gray-100 dark:border-zinc-700">
                      <div className="flex items-center gap-3.5 min-w-0 flex-1">
                        <div className="w-10 h-10 rounded-full bg-mm-navy border-2 border-mm-oro flex items-center justify-center flex-shrink-0 overflow-hidden">
                          {u.avatar_url
                            ? <img src={u.avatar_url} alt="" className="w-full h-full object-cover" />
                            : <span className="text-mm-oro text-xs font-black">{(u.email || '??').substring(0, 2).toUpperCase()}</span>}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-slate-900 dark:text-white truncate">
                            {u.nombre_completo || (u.email || '').split('@')[0] || 'Usuario'}
                            {esYo && <span className="ml-2 text-[11px] font-bold text-mm-oro-tinta dark:text-mm-oro-claro bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 px-2 py-0.5 rounded-full">{t('admin.tu')}</span>}
                          </p>
                          <p className="text-xs text-slate-400 dark:text-zinc-200 truncate">{u.email || t('fb.sinCorreo')}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 flex-shrink-0">
                        <select
                          value={u.rol || ''}
                          disabled={ocupado || !puedeEditar}
                          onChange={(e) => handleCambiarRol(u, e.target.value)}
                          className="text-xs font-semibold px-3 py-2 rounded-xl bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 text-slate-700 dark:text-zinc-200 focus:outline-none focus:border-mm-oro disabled:opacity-50 cursor-pointer"
                          title={t('admin.cambiarRol')}
                        >
                          {!u.rol && <option value="">{t('admin.sinRol')}</option>}
                          {ROLES.map(r => <option key={r.valor} value={r.valor}>{t(r.clave)}</option>)}
                        </select>

                        {puedeEditar && (
                          <button
                            onClick={() => setEditando({ ...u })}
                            disabled={ocupado}
                            className="p-2 text-slate-400 dark:text-zinc-200 hover:text-mm-oro rounded-xl hover:bg-amber-50 dark:hover:bg-amber-500/10 border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 transition-colors disabled:opacity-40"
                            title={t('admin.editarUsuario')}
                          >
                            <Edit2 size={15} />
                          </button>
                        )}

                        <button
                          onClick={() => handleEliminar(u)}
                          disabled={ocupado || esYo || !puedeEditar}
                          className="p-2 text-slate-300 dark:text-zinc-200 hover:text-red-500 rounded-xl hover:bg-red-50 border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 transition-colors disabled:opacity-30 disabled:hover:text-slate-300 disabled:hover:bg-white"
                          title={esYo ? t('admin.noEliminarTooltip') : t('admin.eliminarUsuario')}
                        >
                          {ocupado ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {dialogoConfirmacion}

      {/* ── Modal: añadir usuario ── */}
      {showCrear && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-800 rounded-3xl max-w-md w-full p-6 shadow-2xl border border-gray-100 dark:border-zinc-700">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100 dark:border-zinc-700">
              <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <UserCheck size={18} className="text-mm-oro" /> {t('admin.anadirUsuario')}
              </h3>
              <button onClick={() => setShowCrear(false)} className="text-slate-400 dark:text-zinc-200 hover:text-slate-700 dark:hover:text-white">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCrear} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-zinc-300 mb-1 uppercase">{t('admin.nombre')}</label>
                <input type="text" required value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} className="w-full bg-slate-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-slate-800 dark:text-zinc-100 focus:outline-none focus:border-mm-oro" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-zinc-300 mb-1 uppercase">{t('admin.correo')}</label>
                <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full bg-slate-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-slate-800 dark:text-zinc-100 focus:outline-none focus:border-mm-oro" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-zinc-300 mb-1 uppercase">{t('admin.rol')}</label>
                <select value={form.rol} onChange={(e) => setForm({ ...form, rol: e.target.value })} className="w-full bg-slate-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-slate-800 dark:text-zinc-100 focus:outline-none focus:border-mm-oro cursor-pointer">
                  {ROLES.map(r => <option key={r.valor} value={r.valor}>{t(r.clave)}</option>)}
                </select>
              </div>

              <p className="text-[11px] text-slate-400 dark:text-zinc-300 leading-relaxed">
                {t('admin.avisoSinAuth')}
              </p>

              <div className="pt-2 flex justify-end gap-2">
                <button type="button" onClick={() => setShowCrear(false)} className="px-4 py-2.5 text-xs font-bold text-slate-500 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-700 rounded-xl">
                  {t('comun.cancelar')}
                </button>
                <button type="submit" disabled={guardandoId === 'nuevo'} className="flex items-center gap-2 px-5 py-2.5 text-xs font-bold text-white bg-mm-navy hover:bg-slate-800 rounded-xl shadow-sm disabled:opacity-50">
                  {guardandoId === 'nuevo' && <Loader2 size={14} className="animate-spin text-mm-3" />}
                  {t('comun.guardar')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal: editar usuario ── */}
      {editando && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-800 rounded-3xl max-w-md w-full p-6 shadow-2xl border border-gray-100 dark:border-zinc-700">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100 dark:border-zinc-700">
              <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Edit2 size={18} className="text-mm-2" /> {t('admin.editarUsuario')}
              </h3>
              <button onClick={() => setEditando(null)} className="text-slate-400 dark:text-zinc-200 hover:text-slate-700 dark:hover:text-white">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleGuardarEdicion} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-zinc-300 mb-1 uppercase">{t('admin.nombre')}</label>
                <input type="text" required value={editando.nombre_completo || ''} onChange={(e) => setEditando({ ...editando, nombre_completo: e.target.value })} className="w-full bg-slate-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-slate-800 dark:text-zinc-100 focus:outline-none focus:border-mm-oro" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-zinc-300 mb-1 uppercase">{t('admin.correo')}</label>
                <input type="email" required value={editando.email || ''} onChange={(e) => setEditando({ ...editando, email: e.target.value })} className="w-full bg-slate-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-slate-800 dark:text-zinc-100 focus:outline-none focus:border-mm-oro" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-zinc-300 mb-1 uppercase">{t('admin.rol')}</label>
                <select value={editando.rol || 'inversionista'} onChange={(e) => setEditando({ ...editando, rol: e.target.value })} className="w-full bg-slate-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-slate-800 dark:text-zinc-100 focus:outline-none focus:border-mm-oro cursor-pointer">
                  {ROLES.map(r => <option key={r.valor} value={r.valor}>{t(r.clave)}</option>)}
                </select>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button type="button" onClick={() => setEditando(null)} className="px-4 py-2.5 text-xs font-bold text-slate-500 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-700 rounded-xl">
                  {t('comun.cancelar')}
                </button>
                <button type="submit" disabled={guardandoId === editando.id} className="flex items-center gap-2 px-5 py-2.5 text-xs font-bold text-white bg-mm-navy hover:bg-slate-800 rounded-xl shadow-sm disabled:opacity-50">
                  {guardandoId === editando.id && <Loader2 size={14} className="animate-spin text-mm-3" />}
                  {t('comun.guardar')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </main>
  );
}

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

function AllProjectsView({
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
                  {p.imagen_url ? (
                    <img src={p.imagen_url} alt={p.nombre} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Building2 size={36} className="text-slate-300 dark:text-zinc-200" />
                    </div>
                  )}
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

function ProfileView({ user, onLogout, onBack, isAdmin, onNavigate, avatarUrl, setAvatarUrl, nombre, iniciales, cargo }) {
  const { t, locale } = usePrefs();
  const { confirmar, dialogoConfirmacion } = useConfirmacion();
  const initials = iniciales || (user?.email ? user.email.substring(0, 2).toUpperCase() : 'MM');
  const cargoTexto = cargo?.texto || (cargo?.clave ? t(cargo.clave) : t('cargo.socioInversionista'));
  // ── Modales de cuenta ──
  const [modalSeguridad, setModalSeguridad] = useState(null);   // 'email' | 'password' | null
  const [formSeguridad, setFormSeguridad] = useState({ email: '', pass: '', pass2: '' });
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
      ? await cambiarCorreo(formSeguridad.email)
      : await cambiarPassword(formSeguridad.pass, formSeguridad.pass2);

    setOcupadoPerfil(false);
    setConfirmarSeguridad(null);

    if (r.success) {
      setModalSeguridad(null);
      notificar('exito', r.requiereConfirmacion ? t('perfil.correoConfirmar') : t('perfil.passActualizada'));
    } else {
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
              <div className="w-28 h-28 md:w-32 md:h-32 rounded-full bg-mm-navy border-4 border-mm-oro flex items-center justify-center shadow-lg overflow-hidden transition-transform group-hover:scale-105">
                {avatarUrl ? (
                  <img src={avatarUrl} alt={t('perfil.fotoPerfil')} className="w-full h-full object-cover" />
                ) : (
                  <span className="text-mm-oro text-4xl font-black tracking-widest">{initials}</span>
                )}
              </div>
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
              onClick={() => { setFormSeguridad({ email: user?.email || '', pass: '', pass2: '' }); setModalSeguridad('email'); }}
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
              onClick={() => { setFormSeguridad({ email: '', pass: '', pass2: '' }); setModalSeguridad('password'); }}
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
                <div className="w-28 h-28 rounded-full bg-mm-navy border-4 border-mm-oro overflow-hidden flex items-center justify-center relative">
                  {avatarUrl ? (
                    <img src={avatarUrl} alt={t('perfil.fotoPerfil')} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-mm-oro text-3xl font-black tracking-widest">{initials}</span>
                  )}
                  {subiendoAvatar && (
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
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
              <button onClick={() => { setModalSeguridad(null); setConfirmarSeguridad(null); }} className="text-slate-400 dark:text-zinc-200 hover:text-slate-700 dark:hover:text-white"><X size={18} /></button>
            </div>

            <form onSubmit={handleGuardarSeguridad} className="space-y-4">
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
                      type="password" required minLength={8} value={formSeguridad.pass}
                      onChange={(e) => setFormSeguridad({ ...formSeguridad, pass: e.target.value })}
                      className="w-full bg-slate-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-slate-800 dark:text-zinc-100 focus:outline-none focus:border-mm-oro"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-600 dark:text-zinc-300 mb-1 uppercase">{t('perfil.repetirPass')}</label>
                    <input
                      type="password" required minLength={8} value={formSeguridad.pass2}
                      onChange={(e) => setFormSeguridad({ ...formSeguridad, pass2: e.target.value })}
                      className="w-full bg-slate-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-slate-800 dark:text-zinc-100 focus:outline-none focus:border-mm-oro"
                    />
                  </div>
                  <p className="text-[11px] text-slate-400 dark:text-zinc-300">{t('perfil.minCaracteres')}</p>
                </>
              )}

              <div className="pt-2 flex justify-end gap-2">
                <button type="button" onClick={() => { setModalSeguridad(null); setConfirmarSeguridad(null); }} className="px-4 py-2.5 text-xs font-bold text-slate-500 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-700 rounded-xl">{t('comun.cancelar')}</button>
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
                          <div className="w-8 h-8 rounded-full bg-mm-navy border border-mm-oro flex items-center justify-center flex-shrink-0 overflow-hidden">
                            {r.avatarUrl
                              ? <img src={r.avatarUrl} alt="" className="w-full h-full object-cover" />
                              : <span className="text-[11px] font-black text-mm-oro">{(r.autor || '??').substring(0, 2).toUpperCase()}</span>}
                          </div>
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
        <div className="w-9 h-9 bg-mm-navy rounded-full flex items-center justify-center border border-mm-oro flex-shrink-0 overflow-hidden">
          {userAvatarUrl ? (
            <img src={userAvatarUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="text-[11px] font-bold text-mm-oro tracking-wider">{iniciales}</span>
          )}
        </div>
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
  const [featuredIndex, setFeaturedIndex] = useState(0);
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
  // Colores de las gráficas: recharts no entiende `dark:`, hay que dárselos
  const { colorPendiente, estiloTooltip } = useColoresGrafica(modoOscuro);

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
  const safeIndex = PROJECTS.length > 0 ? featuredIndex % PROJECTS.length : 0;
  const fp = PROJECTS[safeIndex] || null;

  // Hitos pendientes reales: la columna es `completado` (bool), no `estado`
  const hitosPendientesTodos = (Array.isArray(hitos) ? hitos : [])
    .filter(h => h && !h.completado)
    .sort((a, b) => {
      const fa = a.fecha_vencimiento ? new Date(a.fecha_vencimiento).getTime() : Infinity;
      const fb = b.fecha_vencimiento ? new Date(b.fecha_vencimiento).getTime() : Infinity;
      return fa - fb;
    });

  /** Devuelve el proyecto completo a partir de un proyecto_id (uuid). */
  const buscarProyecto = (id) => PROJECTS.find(x => String(x.id) === String(id)) || null;

  /** Traduce un proyecto_id (uuid) a su nombre legible. */
  const nombreProyecto = (id) => buscarProyecto(id)?.nombre || t('inv.proyectoNoDisponible');

  /* ── Estado visible de la campana ───────────────────────────────────────
     El punto rojo señala NOVEDAD, no existencia. Un vencimiento que ya
     revisaste sigue estando ahí durante días o semanas, y si la campana se
     enciende por el mero hecho de que exista, acaba encendida siempre — y una
     señal que está siempre activa deja de ser una señal.

     Por eso se recuerda QUÉ avisos concretos se han visto, por su id, y en
     `localStorage`: antes el estado vivía solo en memoria y arrancaba vacío,
     así que bastaba recargar la página para que el punto reapareciera. */
  const cantidadAvisos = Array.isArray(notificaciones) ? notificaciones.length : 0;

  const idsAvisosActuales = React.useMemo(
    () => (Array.isArray(notificaciones) ? notificaciones : [])
      .map(n => String(n?.id ?? '')).filter(Boolean),
    [notificaciones]
  );

  const [avisosVistos, setAvisosVistos] = useState(() => leerAvisosVistos(user?.id));

  // Al cambiar de usuario se lee su propia lista, no la del anterior
  useEffect(() => { setAvisosVistos(leerAvisosVistos(user?.id)); }, [user?.id]);

  /* Hay novedad solo si algún aviso actual NO está en la lista de vistos. */
  const hayAvisosNuevos = idsAvisosActuales.some(id => !avisosVistos.includes(id));
  const hayAvisos = hayAvisosNuevos || chatNoLeido;

  /* Los avisos que ya no existen se olvidan: si no, la lista de vistos
     crecería sin límite en `localStorage`. */
  useEffect(() => {
    if (!user?.id || avisosVistos.length === 0) return;
    const vigentes = avisosVistos.filter(id => idsAvisosActuales.includes(id));
    if (vigentes.length !== avisosVistos.length) {
      setAvisosVistos(vigentes);
      guardarAvisosVistos(user.id, vigentes);
    }
  }, [idsAvisosActuales, avisosVistos, user?.id]);

  /** "Marcar leídas": apaga a la vez el chat y los vencimientos. */
  const marcarTodoLeido = () => {
    marcarChatLeido();
    setAvisosVistos(idsAvisosActuales);
    guardarAvisosVistos(user?.id, idsAvisosActuales);
  };

  /** Marca UNA notificación como leída y lo persiste. */
  const marcarAvisoLeido = (id) => {
    const clave = String(id ?? '');
    if (!clave || avisosVistos.includes(clave)) return;
    const siguiente = [...avisosVistos, clave];
    setAvisosVistos(siguiente);
    guardarAvisosVistos(user?.id, siguiente);
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

  // ── KPIs calculados desde Supabase ─────────────────────────────────────────
  // `capitalTotal` y `egresosTotales` vienen del hook: el primero es la cifra
  // editable del Administrador (o la suma de presupuestos si nunca se tocó) y
  // el segundo la suma de TODAS las inversiones registradas.
  const totalCapital = capitalTotal;

  // Avance FÍSICO promedio: promedio del % de checklist real de cada proyecto (Supabase)
  const avanceProm = Array.isArray(proyectos) && proyectos.length > 0
    ? (proyectos.reduce((s, p) => s + (Number(p?.avanceFisico) || 0), 0) / proyectos.length).toFixed(0)
    : 0;

  // Avance físico del proyecto activo del carrusel (0-100), blindado contra nulos
  const avanceProyectoActivo = fp
    ? Math.max(0, Math.min(100, Math.round(Number(fp.avanceFisico) || 0)))
    : 0;
  const hitosHechos = Number(fp?.hitosCompletados) || 0;
  const hitosTotales = Number(fp?.hitosTotales) || 0;

  /* ── Proyecto visible en el carrusel táctil móvil ────────────────────────
     No se mezcla con `featuredIndex` (que rota solo cada 6 s en escritorio):
     en móvil manda el dedo, así que el índice lo fija el propio scroll. */
  const indiceMovilSeguro = PROJECTS.length > 0
    ? Math.min(Math.max(indiceMovil, 0), PROJECTS.length - 1)
    : 0;
  const fpMovil = PROJECTS[indiceMovilSeguro] || null;
  const avanceMovil = fpMovil
    ? Math.max(0, Math.min(100, Math.round(Number(fpMovil.avanceFisico) || 0)))
    : 0;
  const hitosHechosMovil = Number(fpMovil?.hitosCompletados) || 0;
  const hitosTotalesMovil = Number(fpMovil?.hitosTotales) || 0;
  /* Ejecución financiera del proyecto centrado. Se lee de `porcentajeGastado`,
     la MISMA fuente que usa la barra verde de la tarjeta: si se recalculara
     aquí a mano, el anillo y la barra podrían acabar diciendo cifras distintas
     del mismo dato. */
  const pctFinancieroMovil = fpMovil
    ? Math.max(0, Math.min(100, Math.round(Number(fpMovil.porcentajeGastado) || 0)))
    : 0;

  /* Lo mismo para el proyecto del carrusel de escritorio, que rota por su
     cuenta cada 6 s y no tiene por qué coincidir con el del móvil. */
  const pctFinancieroActivo = fp
    ? Math.max(0, Math.min(100, Math.round(Number(fp.porcentajeGastado) || 0)))
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
    setCapitalBorrador(String(Math.round(Number(capitalTotal) || 0)));
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

  /* ── Listas completas para los botones "Ver todos" ─────────────────────── */
  const [modalLista, setModalLista] = useState(null);   // 'actividad' | 'hitos' | 'tareas'

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
      ? Math.ceil((new Date(h.fecha_vencimiento) - new Date()) / (1000 * 60 * 60 * 24))
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
  }), [hitosPendientesTodos, PROJECTS, t]);

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
          className="px-3 py-1 border-b border-white/5 dark:border-zinc-800 flex-shrink-0 flex items-center justify-center cursor-pointer group hover:bg-white/[0.02] transition-colors"
          title={t('nav.inicio')}
        >
          <img
            src="/logo2.png"
            alt="MM Capital"
            className="w-full max-w-[150px] mx-auto object-contain -my-2 group-hover:scale-[1.02] transition-transform"
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
          className="px-2 pt-1.5 pb-1 flex-shrink-0 space-y-0.5"
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
                className="w-full flex items-center gap-2 px-3 py-1.5 rounded-xl text-left focus:outline-none cursor-pointer"
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
        <div className="mx-3 mt-1 mb-2 rounded-xl bg-zinc-800 border border-zinc-700 p-3.5 flex-1 min-h-0 flex flex-col overflow-hidden shadow-inner">
          {/* Encabezado separado del historial por una línea sutil */}
          <div className="flex-shrink-0 border-b border-gray-700/50 pb-2 mb-3">
            <div className="flex items-center gap-1.5 mb-1.5">
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
                className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1 my-1 [scrollbar-width:thin] [scrollbar-color:rgba(255,255,255,0.22)_transparent] [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-white/20 [&::-webkit-scrollbar-thumb]:rounded-full"
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

              <form onSubmit={handleEnviarSidebar} className="relative mt-2 flex-shrink-0">
                <input
                  type="text"
                  value={borradorSidebar}
                  onChange={(e) => setBorradorSidebar(e.target.value)}
                  onFocus={marcarChatLeido}
                  placeholder={t('nav.enviarMensaje')}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg py-2 pl-3 pr-8 text-[11px] text-white placeholder-white/40 focus:outline-none focus:border-mm-oro transition-colors"
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
          className="px-4 py-2.5 border-t border-white/5 flex-shrink-0 bg-mm-navy-velo/60 cursor-pointer hover:bg-mm-navy-velo transition-colors group"
        >
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-slate-800 border border-mm-oro flex items-center justify-center flex-shrink-0 overflow-hidden">
              {userAvatarUrl ? (
                <img src={userAvatarUrl} alt="Avatar" className="w-full h-full object-cover" />
              ) : (
                <span className="text-white text-[11px] font-bold tracking-wider">{iniciales}</span>
              )}
            </div>
            {/* Nombre y cargo SIEMPRE completos y en UNA sola línea: nada de
                truncado con "…". NombreAjustado baja el tamaño de letra hasta
                que el texto entra en el ancho del sidebar, así caben igual
                "Ing. Giovanni Morales" que "Socio propietario y representante
                legal" sin recortar ni una palabra. */}
            <div className="flex flex-col overflow-hidden min-w-0 flex-1">
              <NombreAjustado
                texto={nombreUsuario}
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
        <div className="px-4 pb-3 pt-2 flex-shrink-0">
          <button
            onClick={onLogout}
            className="flex items-center justify-center gap-2.5 w-full py-2 rounded-xl text-white/40 hover:text-white hover:bg-white/5 transition-colors text-sm font-semibold"
          >
            <LogOut size={18} />
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
        <header className="hidden md:flex items-center justify-between px-8 py-3.5 bg-white dark:bg-zinc-800 border-b border-gray-200 dark:border-zinc-700 flex-shrink-0 z-30 shadow-sm">
          <div className="flex flex-col">
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
                Se oculta en pantallas medianas para no apretar el header. */}
            <div className="hidden lg:flex items-center gap-3 text-xs font-semibold tracking-widest text-slate-500 dark:text-zinc-200 bg-slate-50 dark:bg-zinc-900 px-4 py-2 rounded-full border border-gray-200 dark:border-zinc-700 uppercase">
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
                <div className="w-10 h-10 bg-mm-navy rounded-full flex items-center justify-center border-2 border-mm-oro shadow-sm overflow-hidden">
                  {userAvatarUrl ? (
                    <img src={userAvatarUrl} alt="Avatar" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-[12px] font-bold text-white tracking-wider">{iniciales}</span>
                  )}
                </div>
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
                <span className="w-11 h-11 rounded-full border-2 border-mm-oro bg-mm-navy-hondo flex items-center justify-center overflow-hidden flex-shrink-0">
                  {userAvatarUrl ? (
                    <img src={userAvatarUrl} alt="Avatar" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-[13px] font-bold text-mm-oro tracking-wider">{iniciales}</span>
                  )}
                </span>
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
            <ProjectDetails project={activeProject} onBack={handleBack} userRole={rol} isEditMode={isEditMode} onUpdateProject={refetchData} aportaciones={aportaciones} />
          ) : currentView === 'project-details' && proyectoPendiente ? (
            /* Recarga sobre un proyecto: se espera a que Supabase devuelva la
               lista. Sin esto asomaría el Dashboard un instante, que es
               justo el salto que se quiere evitar. */
            <div className="flex-1 flex flex-col items-center justify-center gap-3 bg-white dark:bg-zinc-900">
              <Loader2 size={28} className="animate-spin text-mm-oro" />
              <p className="text-xs font-bold text-slate-400 dark:text-zinc-300">{t('comun.cargando')}</p>
            </div>
          ) : currentView === 'vault' ? (
            <VaultView userRole={rol} onBack={handleBack} isAdmin={isAdmin} isEditMode={isEditMode} />
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
                        { icono: Building2, valor: loading ? '–' : String(PROJECTS.length), etiqueta: t('dash.proyectosActivos') },
                        // El Capital Total es la ÚNICA cifra escrita a mano de
                        // este bloque, así que es la única con lápiz.
                        { icono: DollarSign, valor: loading ? '–' : montoCorto(totalCapital, locale), exacto: montoExacto(totalCapital, locale), etiqueta: t('dash.capitalTotal'), editable: true },
                        { icono: TrendingUp, valor: loading ? '–' : `${avanceProm}%`, etiqueta: t('dash.avancePromedioMin') },
                        // Mismo dato que el KPI 4 del escritorio: la suma de
                        // TODAS las inversiones registradas, no el gasto del mes.
                        { icono: Wallet, valor: loading ? '–' : montoCorto(egresosTotales, locale), exacto: montoExacto(egresosTotales, locale), etiqueta: t('dash.egresosTotales') }
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
                                    {p.imagen_url ? (
                                      <img src={p.imagen_url} alt={p.nombre} className="absolute inset-0 w-full h-full object-cover" />
                                    ) : (
                                      <div className="absolute inset-0 flex items-center justify-center">
                                        <Building2 size={30} className="text-slate-300 dark:text-zinc-300" />
                                      </div>
                                    )}
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
                            <HyperText text={nombreUsuario} esperando={loading} duration={900} />
                          </span>
                        </h1>
                        <p className="text-slate-500 dark:text-zinc-200 text-sm mt-1 font-medium flex items-center gap-2">
                          {t('dash.panelEjec')} <span className="text-slate-300 dark:text-zinc-500">•</span> {t('dash.accesoSocios')}
                        </p>
                      </div>

                  {/* 4 tarjetas KPI de escritorio.
                      2 columnas en tablet: con cuatro en fila el ancho útil
                      bajaba de ~110px y etiquetas como "PRESUPUESTADO" salían
                      cortadas. */}
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-5">

                    {/* Proyectos en portafolio */}
                    <div className="bg-white dark:bg-zinc-800 rounded-[20px] p-4 lg:p-5 xl:p-7 border border-gray-100/80 dark:border-zinc-700/80 shadow-[var(--mm-sombra)] flex items-center gap-3 xl:gap-4 min-w-0 hover:shadow-[var(--mm-sombra-alta)] transition-shadow">
                      <div className="w-[44px] h-[44px] rounded-full bg-mm-navy flex items-center justify-center flex-shrink-0">
                        <Building2 size={18} className="text-mm-oro" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] text-slate-400 dark:text-zinc-300 font-bold tracking-wide mb-1 truncate">{t('dash.proyectosActivosMay')}</p>
                        {/* Sin `|| 3`: cero proyectos es una respuesta válida
                            y hay que mostrarla, no inventar un tres. */}
                        <p className="text-[clamp(19px,1.9vw,28px)] font-bold text-slate-900 dark:text-white mb-0.5 leading-none truncate tabular-nums">
                          {loading ? '–' : PROJECTS.length}
                        </p>
                        <p className="text-slate-400 dark:text-zinc-300 text-[11px] font-medium flex items-center gap-1 mt-1.5 truncate">{t('dash.enPortafolio')}</p>
                      </div>
                    </div>

                    {/* Capital total — la única cifra editable a mano */}
                    <div className="bg-white dark:bg-zinc-800 rounded-[20px] p-4 lg:p-5 xl:p-7 border border-gray-100/80 dark:border-zinc-700/80 shadow-[var(--mm-sombra)] flex items-center gap-3 xl:gap-4 min-w-0 hover:shadow-[var(--mm-sombra-alta)] transition-shadow">
                      <div className="w-[44px] h-[44px] rounded-full bg-mm-navy flex items-center justify-center flex-shrink-0">
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
                          <p title={montoExacto(capitalTotal, locale)} className="text-[clamp(19px,1.9vw,28px)] font-bold text-slate-900 dark:text-white mb-0.5 leading-none truncate tabular-nums">
                            {loading ? '–' : montoCorto(capitalTotal, locale)}
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
                    <div className="bg-white dark:bg-zinc-800 rounded-[20px] p-4 lg:p-5 xl:p-7 border border-gray-100/80 dark:border-zinc-700/80 shadow-[var(--mm-sombra)] flex items-center gap-3 xl:gap-4 min-w-0 hover:shadow-[var(--mm-sombra-alta)] transition-shadow">
                      <div className="w-[44px] h-[44px] rounded-full bg-mm-navy flex items-center justify-center flex-shrink-0">
                        <TrendingUp size={18} className="text-mm-oro" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] text-slate-400 dark:text-zinc-300 font-bold tracking-wide mb-1 truncate">{t('dash.avancePromedio')}</p>
                        <p className="text-[clamp(19px,1.9vw,28px)] font-bold text-slate-900 dark:text-white mb-0.5 leading-none truncate tabular-nums">
                          {loading ? '–' : `${avanceProm}%`}
                        </p>
                        <p className="text-slate-400 dark:text-zinc-300 text-[11px] font-medium flex items-center gap-1 mt-1.5 truncate">{t('dash.avanceSufijo')}</p>
                      </div>
                    </div>

                    {/* Egresos totales — suma de las inversiones registradas */}
                    <div className="bg-white dark:bg-zinc-800 rounded-[20px] p-4 lg:p-5 xl:p-7 border border-gray-100/80 dark:border-zinc-700/80 shadow-[var(--mm-sombra)] flex items-center gap-3 xl:gap-4 min-w-0 hover:shadow-[var(--mm-sombra-alta)] transition-shadow">
                      <div className="w-[44px] h-[44px] rounded-full bg-mm-navy flex items-center justify-center flex-shrink-0">
                        <Wallet size={18} className="text-mm-oro" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] text-slate-400 dark:text-zinc-300 font-bold tracking-wide mb-1 truncate">{t('dash.egresosTotales')}</p>
                        <p title={montoExacto(egresosTotales, locale)} className="text-[clamp(19px,1.9vw,28px)] font-bold text-slate-900 dark:text-white mb-0.5 leading-none truncate tabular-nums">
                          {loading ? '–' : montoCorto(egresosTotales, locale)}
                        </p>
                        <button
                          onClick={() => changeView('investors')}
                          title={t('dash.egresosAutoTooltip')}
                          className="text-slate-400 dark:text-zinc-300 text-[11px] font-medium flex items-center gap-1 mt-1.5 truncate hover:text-mm-oro-tinta dark:hover:text-mm-oro-claro transition-colors"
                        >
                          {t('dash.egresosAuto')}
                        </button>
                      </div>
                    </div>

                  </div>
                </div>

                {/* ── Layout central: Proyecto Destacado + Gráfica ── */}
                {/* Una sola columna hasta lg: con el sidebar puesto, en tablet
                    quedaban ~540px para dos columnas y todo se estrangulaba. */}
                {/* El panel de la gráfica cede ancho al destacado: la dona se
                    lee igual de bien en menos sitio, y la fotografía de la
                    propiedad es lo que de verdad tiene que resaltar. */}
                <div className="px-8 grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] xl:grid-cols-[1.9fr_1fr] gap-6 lg:gap-7 mb-7">

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
                            className="w-full sm:w-[46%] sm:min-w-[210px] sm:self-stretch min-h-[220px] rounded-2xl overflow-hidden flex-shrink-0 cursor-pointer group bg-slate-100 dark:bg-zinc-700 relative shadow-sm"
                          >
                            {fp.imagen_url ? (
                              <img
                                src={fp.imagen_url}
                                alt={fp.nombre}
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 ease-out"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <Building2 size={44} className="text-slate-300 dark:text-zinc-500" />
                              </div>
                            )}
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
                  ese trabajo. */}
              <div className="hidden md:grid grid-cols-3 gap-6 px-8 pb-8 mt-2">

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
