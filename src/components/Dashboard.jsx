import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useProyectos } from '../hooks/useProyectos';
import { usePrefs } from '../context/PreferenciasContext';
import RecorteAvatar from './RecorteAvatar';
import InvestorsView from './InvestorsView';
import ChatModule from './ChatModule';
import NombreAjustado from './ui/NombreAjustado';
import { useChat } from '../context/ChatContext';
import { motion } from 'framer-motion';

/** Dorado de marca para el resaltado del menú lateral. */
const NAV_DORADO = '#C5A059';

/**
 * Quita la numeración inicial de un hito ("4. Losa de entrepiso" -> "Losa de
 * entrepiso"). Solo la usa la tarjeta "Próximos hitos" del Dashboard: el dato
 * guardado en Supabase no se toca.
 */
const sinNumeracion = (texto) => String(texto || '').replace(/^\d+\.\s*/, '');
import {
  getUsuarios, crearUsuario, actualizarUsuario, eliminarUsuario as eliminarUsuarioDB
} from '../services/inversionesService';
import { etiquetaEstado } from '../i18n/diccionario';
import { etiquetaCategoria } from '../i18n/diccionario';
import ProjectDetails from './ProjectDetails';
import ListaCompletaModal from './ListaCompletaModal';
import {
  Activity, AlertTriangle, ArrowUp, Bell, Bot, Building2, Briefcase, Calendar, Camera, CheckCircle2, ChevronDown,
  ChevronLeft, ChevronRight, Headset, Landmark, DollarSign, Download, Edit2, Edit3, ExternalLink, FileText, FolderLock, Globe,
  Layers, LayoutDashboard, Loader2, Lock, LogOut, MapPin, MessageSquare, Moon, Paperclip, Plus, Send, Settings,
  Save, Sparkles, Sun, Trash2, TrendingUp, Upload, UserCheck, Users, Wallet, X
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell
} from 'recharts';
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

// ─── Vistas secundarias ───────────────────────────────────────────────────────

function VaultView({ userRole, onBack, isAdmin, isEditMode }) {
  const { t, locale } = usePrefs();
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
    const canal = supabase
      .channel('boveda-archivos')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'archivos' }, loadVaultFiles)
      .subscribe();
    return () => { supabase.removeChannel(canal); };
  }, []);

  // Apagar el Modo Edición cierra el formulario de renombrado a medio escribir:
  // no puede quedar abierto un editor que ya no tiene permiso para guardar.
  useEffect(() => {
    if (!isEditMode) setEditingDoc(null);
  }, [isEditMode]);

  const handleUploadVaultDoc = async (e) => {
    e.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      alert(t('vault.seleccionaArchivo'));
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
      alert(t('vault.archivoDemasiadoGrande'));
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
      setShowUploadModal(false);
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
    if (!confirm(t('vault.confirmEliminar'))) return;

    const { success, error } = await eliminarArchivo(doc.raw || doc);
    if (!success) {
      setUploadMsg({ type: 'error', text: error || t('msg.errorSupabase') });
      setTimeout(() => setUploadMsg(null), 5000);
      return;
    }

    setCambiosPendientes(true);
    await loadVaultFiles();
  };

  const allVaultDocs = dbFiles.map(f => ({
    id: f.id,
    nombre_archivo: f.nombre_archivo,
    categoria: f.tipo || t('fb.docEnStorage'),
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
    <main className="flex-1 flex flex-col overflow-hidden bg-[#F5F6F8] dark:bg-zinc-900">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 md:px-8 py-4 md:py-5 border-b border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 shadow-sm flex-shrink-0">
        <button onClick={onBack} className="w-9 h-9 rounded-full border border-gray-200 dark:border-zinc-700 flex items-center justify-center text-slate-400 dark:text-zinc-300 hover:text-slate-700 dark:hover:text-zinc-100 hover:border-gray-300 dark:hover:border-zinc-600 transition-all flex-shrink-0 active:scale-95">
          <ChevronLeft size={18} />
        </button>
        {/* Sin recuadro oscuro: el candado va suelto, en dorado sobre el fondo */}
        <FolderLock size={22} className="text-[#C5A059] flex-shrink-0" />
        {/* Título y subtítulo COMPLETOS: parten en varias líneas antes que
            recortarse con puntos suspensivos. */}
        <div className="min-w-0">
          <h2 className="text-[15px] md:text-xl font-bold text-slate-900 dark:text-white leading-tight text-balance">{t('vault.titulo')}</h2>
          <p className="text-[10px] md:text-xs text-slate-500 dark:text-zinc-300 font-medium leading-snug mt-0.5">{t('vault.subtitulo')}</p>
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
                <FileText size={14} className="text-[#C5A059]" /> {t('vault.institucionales')} ({allVaultDocs.length})
              </h3>

              {/* "Subir documento" vive aquí, junto al listado al que pertenece,
                  en vez de suelto en la cabecera de la pantalla. */}
              {adminAccess && (
                <div className="flex items-center gap-2.5 flex-wrap">
                  <button
                    onClick={() => setShowUploadModal(true)}
                    className="flex items-center gap-2 bg-[#0B1B2C] dark:bg-zinc-900 text-white text-xs font-bold px-3.5 py-2 rounded-xl hover:bg-slate-800 transition-colors shadow-sm border border-[#C5A059]/25 active:scale-95"
                  >
                    <Upload size={14} className="text-[#C5A059]" /> {t('vault.subirDoc')}
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
                    className="flex items-center gap-1.5 bg-[#FAF4EA] dark:bg-amber-500/15 text-[#8B6914] dark:text-[#E3C77B] border border-[#F0E2CD] dark:border-amber-500/30 text-xs font-bold px-3.5 py-2 rounded-xl hover:bg-[#F3E7D3] transition-colors shadow-sm disabled:opacity-40 active:scale-95"
                  >
                    {confirmandoVault
                      ? <><Loader2 size={14} className="animate-spin text-[#C5A059]" /> {t('proy.guardando')}</>
                      : <><Save size={14} className="text-[#C5A059]" /> {t('vault.guardarCambios')}</>}
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
                    <div className="w-11 h-11 rounded-xl bg-blue-50 dark:bg-blue-500/10 border border-blue-100 dark:border-blue-500/30 flex items-center justify-center flex-shrink-0 text-blue-600 dark:text-blue-400 mt-0.5 sm:mt-0">
                      <FileText size={20} />
                    </div>
                    <div className="flex-1 min-w-0">
                      {/* Nombre de archivo COMPLETO: parte en varias líneas
                          antes que recortarse con puntos suspensivos. */}
                      <h4 className="text-sm font-bold text-slate-900 dark:text-white group-hover:text-[#C5A059] transition-colors break-all leading-snug">{doc.nombre_archivo}</h4>
                      <div className="flex flex-wrap items-center gap-2 mt-1">
                        <span className="text-[10px] font-bold text-[#8B6914] dark:text-[#E3C77B] bg-[#FAF4EA] dark:bg-amber-500/10 px-2.5 py-0.5 rounded-full border border-[#F0E2CD] dark:border-amber-500/30">{etiquetaCategoria(doc.categoria, t)}</span>
                        <span className="text-[10px] text-slate-400 dark:text-zinc-200 font-medium">{t('vault.subido')} {new Date(doc.created_at || Date.now()).toLocaleDateString(locale)}</span>
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
                        className="flex items-center gap-1.5 text-xs font-bold text-white bg-[#0B1B2C] px-3.5 py-2 rounded-xl hover:bg-slate-800 transition-colors shadow-sm"
                      >
                        <Download size={14} className="text-[#C5A059]" /> {t('comun.descargar')}
                      </a>
                    ) : (
                      <a
                        href="#"
                        onClick={(e) => { e.preventDefault(); alert(t('vault.descargando') + ' "' + doc.nombre_archivo + '"...'); }}
                        className="flex items-center gap-1.5 text-xs font-bold text-[#8B6914] dark:text-[#E3C77B] bg-[#FAF4EA] dark:bg-amber-500/10 px-3.5 py-2 rounded-xl hover:bg-[#F3E7D3] dark:hover:bg-amber-500/20 transition-colors border border-[#F0E2CD] dark:border-amber-500/30"
                      >
                        <Download size={14} className="text-[#C5A059]" /> {t('comun.descargar')}
                      </a>
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
                <Upload size={18} className="text-[#C5A059]" /> {t('vault.subirDoc')}
              </h3>
              <button onClick={() => setShowUploadModal(false)} className="text-slate-400 dark:text-zinc-200 hover:text-slate-700 dark:hover:text-zinc-100">
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
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
                  className="w-full bg-slate-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl px-3 py-2 text-xs focus:outline-none"
                />
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
                      <Loader2 size={12} className="animate-spin text-[#C5A059]" />
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
                      className="h-full bg-[#C5A059] transition-all duration-300"
                      style={{ width: `${progresoSubida?.porcentaje ?? 0}%` }}
                    />
                  </div>
                </div>
              )}

              <div className="pt-2 flex justify-end gap-2">
                <button type="button" onClick={() => setShowUploadModal(false)} disabled={isUploading} className="px-4 py-2 text-xs font-bold text-slate-500 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-700 rounded-xl disabled:opacity-40">
                  {t('comun.cancelar')}
                </button>
                <button
                  type="submit"
                  disabled={isUploading}
                  className="px-5 py-2 text-xs font-bold text-white bg-[#0B1B2C] hover:bg-slate-800 rounded-xl shadow-sm disabled:opacity-50 flex items-center gap-2"
                >
                  {isUploading ? <Loader2 size={14} className="animate-spin text-[#C5A059]" /> : <Upload size={14} className="text-[#C5A059]" />}
                  {isUploading
                    ? `${t('comun.subiendo')} ${progresoSubida?.porcentaje ?? 0}%`
                    : t('vault.subirABoveda')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Editar Documento Corporativo */}
      {editingDoc && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-800 rounded-3xl max-w-md w-full p-6 shadow-2xl border border-gray-100 dark:border-zinc-700">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100 dark:border-zinc-700">
              <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Edit3 size={18} className="text-[#C5A059]" /> {t('vault.editarDocTitulo')}
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
                  className="px-5 py-2 text-xs font-bold text-white bg-[#0B1B2C] hover:bg-slate-800 rounded-xl shadow-sm"
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
    <main className="flex-1 flex flex-col overflow-hidden bg-[#F5F6F8] dark:bg-zinc-900">
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
    if (!confirm(t('dlg.eliminarUsuario', { email: usuario.email }))) return;

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
    <main className="flex-1 flex flex-col overflow-hidden bg-[#F5F6F8] dark:bg-zinc-900">
      <div className="flex items-center justify-between px-6 md:px-8 py-5 border-b border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-slate-400 dark:text-zinc-200 hover:text-slate-700 dark:hover:text-zinc-100 transition-colors">
            <ChevronLeft size={20} />
          </button>
          <div className="flex items-center gap-2">
            <UserCheck size={20} className="text-[#C5A059]" />
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
          {cargando ? <Loader2 size={14} className="animate-spin text-[#C5A059]" /> : <Activity size={14} className="text-[#C5A059]" />}
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
                  className="flex items-center gap-2 bg-[#0B1B2C] text-white text-xs font-bold px-4 py-2.5 rounded-xl hover:bg-slate-800 transition-colors shadow-sm"
                >
                  <Plus size={15} className="text-[#C5A059]" /> {t('admin.anadirUsuario')}
                </button>
              ) : isAdmin && (
                <span className="text-[11px] font-semibold text-slate-400 dark:text-zinc-300 flex items-center gap-1.5">
                  <AlertTriangle size={12} /> {t('admin.activaEdicion')}
                </span>
              )}
            </div>

            {cargando ? (
              <div className="flex items-center justify-center gap-3 py-12 text-slate-400 dark:text-zinc-200">
                <Loader2 size={20} className="animate-spin text-[#C5A059]" />
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
                        <div className="w-10 h-10 rounded-full bg-[#0B1B2C] border-2 border-[#C5A059] flex items-center justify-center flex-shrink-0 overflow-hidden">
                          {u.avatar_url
                            ? <img src={u.avatar_url} alt="" className="w-full h-full object-cover" />
                            : <span className="text-[#C5A059] text-xs font-black">{(u.email || '??').substring(0, 2).toUpperCase()}</span>}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-slate-900 dark:text-white truncate">
                            {u.nombre_completo || (u.email || '').split('@')[0] || 'Usuario'}
                            {esYo && <span className="ml-2 text-[10px] font-bold text-[#8B6914] dark:text-[#E3C77B] bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 px-2 py-0.5 rounded-full">{t('admin.tu')}</span>}
                          </p>
                          <p className="text-xs text-slate-400 dark:text-zinc-200 truncate">{u.email || t('fb.sinCorreo')}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 flex-shrink-0">
                        <select
                          value={u.rol || ''}
                          disabled={ocupado || !puedeEditar}
                          onChange={(e) => handleCambiarRol(u, e.target.value)}
                          className="text-xs font-semibold px-3 py-2 rounded-xl bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 text-slate-700 dark:text-zinc-200 focus:outline-none focus:border-[#C5A059] disabled:opacity-50 cursor-pointer"
                          title={t('admin.cambiarRol')}
                        >
                          {!u.rol && <option value="">{t('admin.sinRol')}</option>}
                          {ROLES.map(r => <option key={r.valor} value={r.valor}>{t(r.clave)}</option>)}
                        </select>

                        {puedeEditar && (
                          <button
                            onClick={() => setEditando({ ...u })}
                            disabled={ocupado}
                            className="p-2 text-slate-400 dark:text-zinc-200 hover:text-[#C5A059] rounded-xl hover:bg-amber-50 dark:hover:bg-amber-500/10 border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 transition-colors disabled:opacity-40"
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

      {/* ── Modal: añadir usuario ── */}
      {showCrear && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-800 rounded-3xl max-w-md w-full p-6 shadow-2xl border border-gray-100 dark:border-zinc-700">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100 dark:border-zinc-700">
              <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <UserCheck size={18} className="text-[#C5A059]" /> {t('admin.anadirUsuario')}
              </h3>
              <button onClick={() => setShowCrear(false)} className="text-slate-400 dark:text-zinc-200 hover:text-slate-700 dark:hover:text-white">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCrear} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-zinc-300 mb-1 uppercase">{t('admin.nombre')}</label>
                <input type="text" required value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} className="w-full bg-slate-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-slate-800 dark:text-zinc-100 focus:outline-none focus:border-[#C5A059]" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-zinc-300 mb-1 uppercase">{t('admin.correo')}</label>
                <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full bg-slate-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-slate-800 dark:text-zinc-100 focus:outline-none focus:border-[#C5A059]" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-zinc-300 mb-1 uppercase">{t('admin.rol')}</label>
                <select value={form.rol} onChange={(e) => setForm({ ...form, rol: e.target.value })} className="w-full bg-slate-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-slate-800 dark:text-zinc-100 focus:outline-none focus:border-[#C5A059] cursor-pointer">
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
                <button type="submit" disabled={guardandoId === 'nuevo'} className="flex items-center gap-2 px-5 py-2.5 text-xs font-bold text-white bg-[#0B1B2C] hover:bg-slate-800 rounded-xl shadow-sm disabled:opacity-50">
                  {guardandoId === 'nuevo' && <Loader2 size={14} className="animate-spin text-[#C5A059]" />}
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
                <Edit2 size={18} className="text-[#C5A059]" /> {t('admin.editarUsuario')}
              </h3>
              <button onClick={() => setEditando(null)} className="text-slate-400 dark:text-zinc-200 hover:text-slate-700 dark:hover:text-white">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleGuardarEdicion} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-zinc-300 mb-1 uppercase">{t('admin.nombre')}</label>
                <input type="text" required value={editando.nombre_completo || ''} onChange={(e) => setEditando({ ...editando, nombre_completo: e.target.value })} className="w-full bg-slate-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-slate-800 dark:text-zinc-100 focus:outline-none focus:border-[#C5A059]" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-zinc-300 mb-1 uppercase">{t('admin.correo')}</label>
                <input type="email" required value={editando.email || ''} onChange={(e) => setEditando({ ...editando, email: e.target.value })} className="w-full bg-slate-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-slate-800 dark:text-zinc-100 focus:outline-none focus:border-[#C5A059]" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-zinc-300 mb-1 uppercase">{t('admin.rol')}</label>
                <select value={editando.rol || 'inversionista'} onChange={(e) => setEditando({ ...editando, rol: e.target.value })} className="w-full bg-slate-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-slate-800 dark:text-zinc-100 focus:outline-none focus:border-[#C5A059] cursor-pointer">
                  {ROLES.map(r => <option key={r.valor} value={r.valor}>{t(r.clave)}</option>)}
                </select>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button type="button" onClick={() => setEditando(null)} className="px-4 py-2.5 text-xs font-bold text-slate-500 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-700 rounded-xl">
                  {t('comun.cancelar')}
                </button>
                <button type="submit" disabled={guardandoId === editando.id} className="flex items-center gap-2 px-5 py-2.5 text-xs font-bold text-white bg-[#0B1B2C] hover:bg-slate-800 rounded-xl shadow-sm disabled:opacity-50">
                  {guardandoId === editando.id && <Loader2 size={14} className="animate-spin text-[#C5A059]" />}
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
    <main className="flex-1 flex flex-col overflow-hidden bg-[#F5F6F8] dark:bg-zinc-900">
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
              m.sender === 'user' ? 'bg-[#0B1B2C] text-white' : 'bg-white dark:bg-zinc-800 border border-gray-100 dark:border-zinc-700 text-slate-800 dark:text-zinc-100'
            }`}>
              {m.sender === 'ai' && (
                <div className="flex items-center gap-1.5 text-xs font-bold text-[#C5A059] mb-1.5">
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
                    <span key={i} className="flex items-center gap-1 text-[10px] font-semibold bg-white/15 px-2 py-0.5 rounded-full">
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
              <Loader2 size={15} className="animate-spin text-[#C5A059]" /> {t('ia.pensando')}
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
                  <Paperclip size={11} className="text-[#C5A059]" />
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
              className="hidden"
            />
            <button
              type="button"
              onClick={() => clipRef.current?.click()}
              title={t('ia.adjuntar')}
              className="w-12 flex items-center justify-center rounded-xl border border-gray-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 text-slate-400 dark:text-zinc-300 hover:text-[#C5A059] hover:border-[#C5A059]/40 transition-colors flex-shrink-0 active:scale-95"
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
              className="bg-[#0B1B2C] text-white px-6 py-3 rounded-xl font-bold text-sm hover:bg-slate-800 transition-colors flex items-center gap-2 disabled:opacity-40 flex-shrink-0"
            >
              {pensando
                ? <Loader2 size={14} className="animate-spin text-[#C5A059]" />
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
  const statusColor = (estado) => {
    const e = (estado || '').toLowerCase();
    if (e.includes('ejecución') || e.includes('activo')) return 'bg-amber-50 dark:bg-amber-500/10 text-amber-600 border-amber-100 dark:border-amber-500/25';
    if (e.includes('entregado') || e.includes('completado')) return 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 border-emerald-100';
    return 'bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-100 dark:border-blue-500/30';
  };
  return (
    <main className="flex-1 flex flex-col overflow-hidden bg-[#F5F6F8] dark:bg-zinc-900">
      <div className="flex items-center gap-4 px-6 md:px-8 py-5 border-b border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800">
        <button onClick={onBack} className="w-8 h-8 rounded-full border border-gray-200 dark:border-zinc-700 flex items-center justify-center text-slate-400 dark:text-zinc-200 hover:text-slate-700 dark:hover:text-zinc-100 hover:border-gray-300 dark:hover:border-zinc-600 transition-all">
          <ChevronLeft size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">{t('proys.titulo')}</h2>
          <p className="text-[11px] text-slate-400 dark:text-zinc-200 font-medium">{t('proys.subtitulo')}</p>
        </div>
        {puedeEditar && (
          <span className="flex items-center gap-1.5 text-[10px] font-bold text-white bg-[#C5A059] px-2.5 py-1.5 rounded-lg flex-shrink-0 uppercase tracking-wide">
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
            className="w-full mb-4 flex items-center justify-center gap-2 bg-[#0B1B2C] dark:bg-zinc-800 text-white rounded-2xl py-3.5 text-[13px] font-bold shadow-md border border-[#C5A059]/30 active:scale-[0.98] transition-transform"
          >
            <Plus size={17} className="text-[#C5A059]" /> {t('proyNuevo.titulo')}
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
                    <button
                      onClick={(e) => { e.stopPropagation(); onCambiarPortada(p.id); }}
                      disabled={subiendoPortadaId === p.id}
                      className="absolute bottom-2 right-2 flex items-center gap-1.5 bg-black/60 backdrop-blur-sm text-white text-[10px] font-bold px-2.5 py-1.5 rounded-lg active:scale-95 transition-transform disabled:opacity-60"
                    >
                      {subiendoPortadaId === p.id
                        ? <Loader2 size={12} className="animate-spin" />
                        : <Camera size={12} className="text-[#C5A059]" />}
                      {subiendoPortadaId === p.id ? t('comun.subiendo') : t('dash.cambiarPortada')}
                    </button>
                  )}
                </div>
                <div className={`inline-flex px-2 py-0.5 rounded text-[9px] font-bold tracking-wider uppercase border mb-2 ${statusColor(p.estado)}`}>
                  {etiquetaEstado(p.estado, t) || t('fb.sinEstado')}
                </div>
                <h3 className="font-bold text-slate-900 dark:text-white text-sm mb-1 uppercase group-hover:text-[#C5A059] transition-colors">{p.nombre}</h3>
                <div className="mt-3 pt-3 border-t border-gray-100 dark:border-zinc-700 flex justify-between items-center gap-2">
                  <span className="text-[11px] text-slate-400 dark:text-zinc-200 min-w-0 truncate">{Number(p.porcentajeGastado || 0).toFixed(0)}% {t('dash.porcentajeEjecutado')}</span>
                  {/* Con el Modo Edición encendido, el acceso a editar la ficha
                      es un botón real y tocable, no un efecto de hover. */}
                  {puedeEditar ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); onCardClick(p); }}
                      className="flex items-center gap-1.5 text-[11px] font-bold text-white bg-[#C5A059] px-3 py-2 rounded-xl flex-shrink-0 active:scale-95 transition-transform"
                    >
                      <Edit2 size={13} /> {t('comun.editar')}
                    </button>
                  ) : (
                    <ChevronRight size={14} className="text-slate-300 dark:text-zinc-200 group-hover:text-[#C5A059] transition-colors flex-shrink-0" />
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
    if (!confirm(t('rep.confirmarEliminar'))) return;

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
    <main className="flex-1 flex flex-col overflow-hidden bg-[#F5F6F8] dark:bg-zinc-900">
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
              <div className="w-28 h-28 md:w-32 md:h-32 rounded-full bg-[#0B1B2C] border-4 border-[#C5A059] flex items-center justify-center shadow-lg overflow-hidden transition-transform group-hover:scale-105">
                {avatarUrl ? (
                  <img src={avatarUrl} alt={t('perfil.fotoPerfil')} className="w-full h-full object-cover" />
                ) : (
                  <span className="text-[#C5A059] text-4xl font-black tracking-widest">{initials}</span>
                )}
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); setShowAvatarModal(true); }}
                className="absolute bottom-0.5 right-0.5 w-9 h-9 bg-[#C5A059] rounded-full flex items-center justify-center shadow-lg border-2 border-white dark:border-zinc-800 hover:bg-[#B8963A] transition-colors active:scale-90"
                title={t('perfil.cambiarFotoTooltip')}
              >
                <Camera size={16} className="text-white" />
              </button>
            </div>

            <div className="text-center sm:text-left flex-1 min-w-0 w-full">
              <h3 className="font-bold text-slate-900 dark:text-white">
                <NombreAjustado texto={nombre || t('admin.sinRol')} max={24} min={15} className="text-center sm:text-left" />
              </h3>
              <p className="text-[#C5A059] text-[15px] font-bold mt-1">{cargoTexto}</p>
              <p className="text-slate-500 dark:text-zinc-300 text-[14px] font-medium mt-1.5 break-all">
                {user?.email || 'usuario@mmcapital.com'}
              </p>
              <div className="mt-4 flex flex-wrap gap-2 justify-center sm:justify-start">
                <span className="text-[12px] font-bold bg-amber-50 dark:bg-amber-500/10 text-[#8B6914] dark:text-[#E3C77B] px-3 py-1.5 rounded-full border border-amber-200 dark:border-amber-500/30">{cargoTexto}</span>
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
                <h4 className="text-xs md:text-sm font-bold text-[#8B6914] dark:text-[#E3C77B] uppercase tracking-widest flex items-center gap-2">
                  <UserCheck size={16} className="text-[#C5A059]" /> {t('perfil.configAdmin')}
                </h4>
                <span className="text-[10px] font-black bg-[#C5A059] text-white px-2.5 py-1 rounded-md uppercase tracking-wider">{t('perfil.controlTotal')}</span>
              </div>

              {/* Botón 1: Configuración de Usuarios */}
              <button
                onClick={() => onNavigate && onNavigate('admin-users')}
                className="w-full flex items-center justify-between px-6 md:px-8 py-5 hover:bg-amber-50/40 dark:hover:bg-amber-500/10 transition-colors border-b border-gray-100 dark:border-zinc-700 group"
              >
                <div className="flex items-center gap-4">
                  <div className="w-11 h-11 rounded-2xl bg-amber-100/80 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-500/30 flex items-center justify-center shadow-sm">
                    <UserCheck size={20} className="text-[#8B6914] dark:text-[#E3C77B]" />
                  </div>
                  <div className="text-left">
                    <p className="text-base font-bold text-slate-900 dark:text-white group-hover:text-[#C5A059] transition-colors">{t('perfil.configUsuarios')}</p>
                    <p className="text-xs text-slate-500 dark:text-zinc-200 mt-0.5">{t('perfil.configUsuariosDesc')}</p>
                  </div>
                </div>
                <ChevronRight size={18} className="text-slate-300 dark:text-zinc-200 group-hover:text-[#C5A059] transition-colors" />
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
                    <p className="text-base font-bold text-slate-900 dark:text-white group-hover:text-[#C5A059] transition-colors">{t('perfil.bandejaReportes')}</p>
                    <p className="text-xs text-slate-500 dark:text-zinc-200 mt-0.5">{t('perfil.bandejaReportesDesc')}</p>
                  </div>
                </div>
                <ChevronRight size={18} className="text-slate-300 dark:text-zinc-200 group-hover:text-[#C5A059] transition-colors" />
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
                    <p className="text-base font-bold text-slate-900 dark:text-white group-hover:text-[#C5A059] transition-colors">{t('perfil.chatIA')}</p>
                    <p className="text-xs text-slate-500 dark:text-zinc-200 mt-0.5">{t('perfil.chatIADesc')}</p>
                  </div>
                </div>
                <ChevronRight size={18} className="text-slate-300 dark:text-zinc-200 group-hover:text-[#C5A059] transition-colors" />
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
                <Camera size={18} className="text-[#C5A059]" /> {t('perfil.cambiarFoto')}
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
                accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
                className="hidden"
              />

              {/* Vista previa: la temporal mientras sube, si no la guardada */}
              <div className="flex flex-col items-center gap-3 py-2">
                <div className="w-28 h-28 rounded-full bg-[#0B1B2C] border-4 border-[#C5A059] overflow-hidden flex items-center justify-center relative">
                  {avatarUrl ? (
                    <img src={avatarUrl} alt={t('perfil.fotoPerfil')} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-[#C5A059] text-3xl font-black tracking-widest">{initials}</span>
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
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-[#0B1B2C] text-white text-sm font-bold hover:bg-slate-800 transition-colors disabled:opacity-60"
              >
                {subiendoAvatar
                  ? <><Loader2 size={16} className="animate-spin text-[#C5A059]" /> {t('comun.subiendo')}</>
                  : <><Upload size={16} className="text-[#C5A059]" /> {t('perfil.elegirFoto')}</>}
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
                <Settings size={18} className="text-[#C5A059]" />
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
                    className="w-full bg-slate-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-slate-800 dark:text-zinc-100 focus:outline-none focus:border-[#C5A059]"
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
                      className="w-full bg-slate-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-slate-800 dark:text-zinc-100 focus:outline-none focus:border-[#C5A059]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-600 dark:text-zinc-300 mb-1 uppercase">{t('perfil.repetirPass')}</label>
                    <input
                      type="password" required minLength={8} value={formSeguridad.pass2}
                      onChange={(e) => setFormSeguridad({ ...formSeguridad, pass2: e.target.value })}
                      className="w-full bg-slate-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-slate-800 dark:text-zinc-100 focus:outline-none focus:border-[#C5A059]"
                    />
                  </div>
                  <p className="text-[11px] text-slate-400 dark:text-zinc-300">{t('perfil.minCaracteres')}</p>
                </>
              )}

              <div className="pt-2 flex justify-end gap-2">
                <button type="button" onClick={() => { setModalSeguridad(null); setConfirmarSeguridad(null); }} className="px-4 py-2.5 text-xs font-bold text-slate-500 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-700 rounded-xl">{t('comun.cancelar')}</button>
                <button type="submit" disabled={ocupadoPerfil} className="flex items-center gap-2 px-5 py-2.5 text-xs font-bold text-white bg-[#0B1B2C] hover:bg-slate-800 rounded-xl shadow-sm disabled:opacity-50">
                  {ocupadoPerfil && <Loader2 size={14} className="animate-spin text-[#C5A059]" />}
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
                <AlertTriangle size={22} className="text-[#C5A059]" />
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
                className="flex items-center justify-center gap-2 px-5 py-2.5 text-xs font-bold text-white bg-[#0B1B2C] hover:bg-slate-800 rounded-xl shadow-sm disabled:opacity-50"
              >
                {ocupadoPerfil && <Loader2 size={14} className="animate-spin text-[#C5A059]" />}
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
                <Landmark size={18} className="text-[#C5A059]" /> {t('perfil.datosBancarios')}
              </h3>
              <button onClick={() => setModalBanco(false)} className="text-slate-400 dark:text-zinc-200 hover:text-slate-700 dark:hover:text-white"><X size={18} /></button>
            </div>

            <form onSubmit={handleGuardarBanco} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-zinc-300 mb-1 uppercase">{t('perfil.banco')}</label>
                <input
                  type="text" required placeholder={t('perfil.bancoPh')} value={formBanco.banco}
                  onChange={(e) => setFormBanco({ ...formBanco, banco: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-slate-800 dark:text-zinc-100 focus:outline-none focus:border-[#C5A059]"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-zinc-300 mb-1 uppercase">{t('perfil.numeroCuenta')}</label>
                <input
                  type="text" required inputMode="numeric" value={formBanco.numeroCuenta}
                  onChange={(e) => setFormBanco({ ...formBanco, numeroCuenta: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-slate-800 dark:text-zinc-100 focus:outline-none focus:border-[#C5A059]"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-zinc-300 mb-1 uppercase">{t('perfil.tipoCuenta')}</label>
                <select
                  value={formBanco.tipoCuenta}
                  onChange={(e) => setFormBanco({ ...formBanco, tipoCuenta: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-slate-800 dark:text-zinc-100 focus:outline-none focus:border-[#C5A059] cursor-pointer"
                >
                  <option value="ahorro">{t('perfil.cuentaAhorro')}</option>
                  <option value="corriente">{t('perfil.cuentaCorriente')}</option>
                </select>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button type="button" onClick={() => setModalBanco(false)} className="px-4 py-2.5 text-xs font-bold text-slate-500 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-700 rounded-xl">{t('comun.cancelar')}</button>
                <button type="submit" disabled={ocupadoPerfil} className="flex items-center gap-2 px-5 py-2.5 text-xs font-bold text-white bg-[#0B1B2C] hover:bg-slate-800 rounded-xl shadow-sm disabled:opacity-50">
                  {ocupadoPerfil && <Loader2 size={14} className="animate-spin text-[#C5A059]" />}
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
                <Headset size={18} className="text-[#C5A059]" /> {t('perfil.soporte')}
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
                  className="w-full bg-slate-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-slate-800 dark:text-zinc-100 focus:outline-none focus:border-[#C5A059] resize-none leading-relaxed"
                />
                <p className="text-[11px] text-slate-400 dark:text-zinc-300 mt-1.5">
                  {mensajeSoporte.trim().length} {t('perfil.caracteres')}
                </p>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button type="button" onClick={() => setModalSoporte(false)} className="px-4 py-2.5 text-xs font-bold text-slate-500 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-700 rounded-xl">{t('comun.cancelar')}</button>
                <button type="submit" disabled={ocupadoPerfil} className="flex items-center gap-2 px-5 py-2.5 text-xs font-bold text-white bg-[#0B1B2C] hover:bg-slate-800 rounded-xl shadow-sm disabled:opacity-50">
                  {ocupadoPerfil && <Loader2 size={14} className="animate-spin text-[#C5A059]" />}
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
                  <Loader2 size={20} className="animate-spin text-[#C5A059]" />
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
                          <div className="w-8 h-8 rounded-full bg-[#0B1B2C] border border-[#C5A059] flex items-center justify-center flex-shrink-0 overflow-hidden">
                            {r.avatarUrl
                              ? <img src={r.avatarUrl} alt="" className="w-full h-full object-cover" />
                              : <span className="text-[10px] font-black text-[#C5A059]">{(r.autor || '??').substring(0, 2).toUpperCase()}</span>}
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-slate-900 dark:text-white truncate">{r.autor}</p>
                            <p className="text-[10px] text-slate-400 dark:text-zinc-300 truncate">{r.email}</p>
                          </div>
                        </div>
                        <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-1 rounded-full flex-shrink-0 ${
                          r.estado === 'resuelto'
                            ? 'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                            : r.estado === 'en_proceso'
                            ? 'bg-sky-50 dark:bg-sky-500/15 text-sky-700 dark:text-sky-300'
                            : 'bg-amber-50 dark:bg-amber-500/15 text-[#8B6914] dark:text-[#E3C77B]'
                        }`}>
                          {t('estadoReporte.' + r.estado)}
                        </span>
                      </div>

                      <p className="text-sm text-slate-700 dark:text-zinc-200 leading-relaxed whitespace-pre-wrap break-words">{r.mensaje}</p>
                      <p className="text-[10px] text-slate-400 dark:text-zinc-300 mt-2">
                        {r.fecha ? new Date(r.fecha).toLocaleString(locale) : ''}
                      </p>

                      {/* ── Acciones: Responder / Cambiar estado / Eliminar ── */}
                      <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-gray-100 dark:border-zinc-700">
                        <button
                          onClick={() => setHiloAbierto(abierto ? null : r.id)}
                          disabled={ocupado}
                          className="inline-flex items-center gap-1.5 text-[11px] font-bold text-white bg-[#0B1B2C] px-3 py-1.5 rounded-xl hover:bg-slate-800 transition-colors disabled:opacity-50"
                        >
                          <MessageSquare size={13} className="text-[#C5A059]" />
                          {abierto ? t('rep.ocultarHilo') : t('rep.responder')}
                        </button>

                        {isAdmin && (
                          <>
                            <button
                              onClick={() => handleCambiarEstadoReporte(r)}
                              disabled={ocupado}
                              className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[#8B6914] dark:text-[#E3C77B] bg-[#FAF4EA] dark:bg-amber-500/10 border border-[#F0E2CD] dark:border-amber-500/30 px-3 py-1.5 rounded-xl hover:bg-[#F3E7D3] dark:hover:bg-amber-500/20 transition-colors disabled:opacity-50"
                            >
                              {ocupado
                                ? <Loader2 size={13} className="animate-spin text-[#C5A059]" />
                                : <Edit3 size={13} className="text-[#C5A059]" />}
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
                          <span className="text-[10px] font-bold text-slate-500 dark:text-zinc-200 ml-auto">
                            {respuestas.length} {t('rep.respuestas')}
                          </span>
                        )}
                      </div>

                      {/* ── Hilo visual de respuestas ── */}
                      {abierto && (
                        <div className="mt-3 pl-3 border-l-2 border-[#C5A059]/40 space-y-2.5">
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
                                    <span className="ml-1.5 text-[9px] font-black uppercase tracking-wider text-[#8B6914] dark:text-[#E3C77B]">
                                      {t('rep.administracion')}
                                    </span>
                                  )}
                                </span>
                                <span className="text-[9px] text-slate-400 dark:text-zinc-300 flex-shrink-0">
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
                              className="flex-1 min-w-0 resize-none rounded-xl border border-gray-200 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-xs text-slate-700 dark:text-zinc-200 focus:outline-none focus:border-[#C5A059]"
                            />
                            <button
                              type="submit"
                              disabled={ocupado || !(borradorRespuesta[r.id] || '').trim()}
                              title={t('rep.enviarRespuesta')}
                              className="flex-shrink-0 inline-flex items-center gap-1.5 bg-[#0B1B2C] text-white text-[11px] font-bold px-3 py-2.5 rounded-xl hover:bg-slate-800 transition-colors disabled:opacity-40"
                            >
                              {ocupado
                                ? <Loader2 size={13} className="animate-spin text-[#C5A059]" />
                                : <Send size={13} className="text-[#C5A059]" />}
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

function formatMoney(amount) {
  const n = Number(amount) || 0;
  if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return '$' + (n / 1_000).toFixed(1) + 'K';
  return '$' + n.toLocaleString('es-SV');
}

/* ─── Piezas compartidas escritorio / móvil ───────────────────────────────────
   El menú del avatar y la bandeja de notificaciones son IDÉNTICOS en ambas
   resoluciones: se extraen aquí para que el móvil no sea una copia paralela
   que se desincronice con el escritorio. */

function PanelNotificaciones({
  t, notificaciones, chatNoLeido, noLeidosChat,
  marcarChatLeido, onAbrirNotificacion, onAbrirChat, className = ''
}) {
  return (
    <div className={`bg-white dark:bg-zinc-800 rounded-xl shadow-xl border border-gray-100 dark:border-zinc-700 z-50 overflow-hidden ${className}`}>
      <div className="px-4 py-3 border-b border-gray-100 dark:border-zinc-700 flex justify-between items-center bg-gray-50 dark:bg-zinc-900">
        <span className="text-xs font-bold text-slate-800 dark:text-zinc-100">{t('notif.titulo')}</span>
        <button onClick={marcarChatLeido} className="text-[10px] text-[#C5A059] font-semibold hover:underline">
          {t('notif.marcarLeidas')}
        </button>
      </div>
      <div className="max-h-60 overflow-y-auto">
        {chatNoLeido && (
          <button
            onClick={onAbrirChat}
            className="w-full text-left px-4 py-3 border-b border-gray-50 dark:border-zinc-700 hover:bg-gray-50 dark:hover:bg-zinc-700/50 cursor-pointer transition-colors"
          >
            <p className="text-[11px] font-bold text-[#C5A059] flex items-center gap-1.5">
              <MessageSquare size={12} /> {t('notif.chatNuevo')}
            </p>
            <p className="text-[10px] text-slate-500 dark:text-zinc-200 mt-0.5">
              {t('notif.chatNuevoDetalle', { cantidad: noLeidosChat })}
            </p>
          </button>
        )}
        {notificaciones && notificaciones.length > 0 ? notificaciones.map(n => (
          <button
            key={n.id}
            onClick={() => onAbrirNotificacion(n)}
            className="w-full text-left px-4 py-3 border-b border-gray-50 dark:border-zinc-700 hover:bg-gray-50 dark:hover:bg-zinc-700/50 cursor-pointer transition-colors"
          >
            <p className="text-[11px] font-bold text-red-500 flex items-center gap-1.5"><AlertTriangle size={12} /> {t('notif.vencimientoCritico')}</p>
            <p className="text-[10px] text-slate-500 dark:text-zinc-200 mt-0.5">
              {t('notif.tareaProyecto', { tarea: n.tarea, proyecto: n.proyectoNombre || t('inv.proyectoNoDisponible') })}
            </p>
            <p className="text-[9px] text-slate-400 dark:text-zinc-200 mt-1">{t('notif.vence')} {n.fecha_vencimiento}</p>
          </button>
        )) : !chatNoLeido && (
          <div className="px-4 py-3 text-center text-xs text-slate-500 dark:text-zinc-200">{t('notif.sinNotificaciones')}</div>
        )}
      </div>
      <div className="px-4 py-2 border-t border-gray-100 dark:border-zinc-700 text-center bg-gray-50 dark:bg-zinc-900">
        <span className="text-[10px] font-semibold text-slate-500 dark:text-zinc-200 hover:text-slate-800 dark:hover:text-white cursor-pointer">{t('dash.verTodas')}</span>
      </div>
    </div>
  );
}

/** Interruptor visual reutilizado por las filas de tipo toggle del menú. */
function Interruptor({ activo }) {
  return (
    <span
      aria-hidden="true"
      className={`w-9 h-5 rounded-full flex items-center px-0.5 transition-colors flex-shrink-0 ${
        activo ? 'bg-[#C5A059] justify-end' : 'bg-slate-200 dark:bg-zinc-600 justify-start'
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
  onPerfil, onLogout, isAdmin, isEditMode, onToggleEditMode, className = ''
}) {
  const filaBase = 'w-full px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-zinc-200 hover:bg-gray-50 dark:hover:bg-zinc-700/50 hover:text-[#C5A059] dark:hover:text-[#C5A059] transition-colors flex items-center gap-2.5';

  return (
    <div
      role="menu"
      className={`bg-white dark:bg-zinc-800 rounded-2xl shadow-2xl border border-gray-100 dark:border-zinc-700 z-50 overflow-hidden ${className}`}
    >
      {/* Cabecera con la identidad real del usuario */}
      <div className="px-4 py-3 border-b border-gray-100 dark:border-zinc-700 bg-slate-50/70 dark:bg-zinc-900/50 flex items-center gap-3">
        <div className="w-9 h-9 bg-[#0B1B2C] rounded-full flex items-center justify-center border border-[#C5A059] flex-shrink-0 overflow-hidden">
          {userAvatarUrl ? (
            <img src={userAvatarUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="text-[10px] font-bold text-[#C5A059] tracking-wider">{iniciales}</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <NombreAjustado texto={nombreUsuario} max={13} min={9} className="font-bold text-slate-900 dark:text-white leading-tight" />
          <NombreAjustado texto={cargo.texto || t(cargo.clave)} max={10} min={6.5} className="text-[#8B6914] dark:text-[#E3C77B] font-semibold leading-tight mt-0.5" />
        </div>
      </div>

      {/* 1) Mi perfil y configuración */}
      <button role="menuitem" onClick={onPerfil} className={filaBase}>
        <UserCheck size={15} className="text-slate-400 dark:text-zinc-200 flex-shrink-0" />
        {t('menu.miPerfilConfig')}
      </button>

      {/* 2) Modo Edición: SOLO Administrador y solo donde se pidió el toggle */}
      {isAdmin && onToggleEditMode && (
        <button
          role="menuitem"
          onClick={onToggleEditMode}
          aria-pressed={isEditMode}
          className={`${filaBase} justify-between`}
        >
          <span className="flex items-center gap-2.5">
            <Edit2 size={15} className={isEditMode ? 'text-[#C5A059] flex-shrink-0' : 'text-slate-400 dark:text-zinc-200 flex-shrink-0'} />
            {isEditMode ? t('dash.edicionActiva') : t('dash.modoEdicion')}
          </span>
          <Interruptor activo={isEditMode} />
        </button>
      )}

      {/* 3) Modo oscuro (toggle) */}
      <button role="menuitem" onClick={alternarTema} aria-pressed={modoOscuro} className={`${filaBase} justify-between`}>
        <span className="flex items-center gap-2.5">
          {modoOscuro
            ? <Sun size={15} className="text-[#C5A059] flex-shrink-0" />
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

  /** Abre el selector de imagen para un proyecto concreto (solo modo edición). */
  const pedirPortadaProyecto = (proyectoId) => {
    if (!proyectoId) return;
    proyectoPortadaRef.current = proyectoId;
    portadaProyectoRef.current?.click();
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

  /* 1. Auto-slide del Proyecto Destacado.
     `reinicioCarrusel` se incrementa en cada navegación manual: al cambiar la
     dependencia, React limpia el intervalo anterior y arranca uno nuevo, así
     el slide recién elegido dura los 6 s completos en vez de saltar enseguida. */
  const DURACION_SLIDE = 6000;
  const [reinicioCarrusel, setReinicioCarrusel] = useState(0);

  useEffect(() => {
    if (!proyectos || proyectos.length === 0) return;
    const timer = setInterval(() => {
      setFeaturedIndex((prevIndex) => (prevIndex + 1) % proyectos.length);
    }, DURACION_SLIDE);
    return () => clearInterval(timer);
  }, [proyectos.length, reinicioCarrusel]);

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
        if (e.state.activeProject !== undefined) {
          /* Lo que viaja en el historial es una FOTO del proyecto del momento
             en que se navegó, no el objeto vivo. Si al retroceder seguimos en
             el MISMO proyecto se conserva el que ya está en pantalla: de lo
             contrario, cerrar las Facturas con el botón "Atrás" resucitaría
             las cifras anteriores a lo último que se guardó. */
          const guardado = e.state.activeProject;
          setActiveProject(prev =>
            (prev && guardado && String(prev.id) === String(guardado.id)) ? prev : guardado
          );
          setProyectoPendiente(null);
        }
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
    window.history.pushState({ view: viewName, activeProject: projectData }, '', newUrl);
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
      window.history.replaceState({ view: 'portfolio', activeProject: null }, '', window.location.pathname);
    }
  }, [proyectoPendiente, PROJECTS, loading]);
  const safeIndex = PROJECTS.length > 0 ? featuredIndex % PROJECTS.length : 0;
  const fp = PROJECTS[safeIndex] || null;

  const statusColor = fp
    ? (fp.estado?.toLowerCase().includes('ejecución') || fp.estado?.toLowerCase().includes('activo')
        ? 'bg-amber-50 dark:bg-amber-500/10 text-amber-600 border-amber-100 dark:border-amber-500/25'
        : fp.estado?.toLowerCase().includes('entregado') || fp.estado?.toLowerCase().includes('completado')
        ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 border-emerald-100'
        : 'bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-100 dark:border-blue-500/30')
    : 'bg-slate-50 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 border-slate-100';

  // Reloj base para los cálculos del mes en curso
  const now = new Date();

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
     Los vencimientos críticos no se "leen" solos como los mensajes, así que
     se recuerda si el usuario ya los revisó. Si entra un aviso nuevo, la
     campana vuelve a encenderse sola. */
  const [avisosVistos, setAvisosVistos] = useState(false);
  const cantidadAvisos = Array.isArray(notificaciones) ? notificaciones.length : 0;

  useEffect(() => { setAvisosVistos(false); }, [cantidadAvisos]);

  const hayAvisos = (cantidadAvisos > 0 && !avisosVistos) || chatNoLeido;

  /** "Marcar leídas": apaga a la vez el chat y los vencimientos. */
  const marcarTodoLeido = () => {
    marcarChatLeido();
    setAvisosVistos(true);
  };

  const handleCardClick = (proyecto) => {
    changeView('project-details', proyecto);
  };

  /** Abre el detalle del proyecto al que pertenece un ítem del panel inferior. */
  const abrirProyectoDeItem = (proyecto) => {
    if (proyecto) changeView('project-details', proyecto);
  };

  /** Clic en una notificación: abre el detalle del proyecto de ese hito. */
  const abrirNotificacion = (n) => {
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
  const flujoMes = (() => {
    const mesActual = now.getMonth();
    const anioActual = now.getFullYear();
    return gastos
      .filter(g => {
        const f = new Date(g.fecha || g.created_at);
        return f.getMonth() === mesActual && f.getFullYear() === anioActual;
      })
      .reduce((s, g) => s + (Number(g.monto) || 0), 0);
  })();

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

  const entradasActividad = (Array.isArray(gastos) ? gastos : [])
    .slice()
    .sort((a, b) => String(b?.fecha || b?.created_at || '').localeCompare(String(a?.fecha || a?.created_at || '')))
    .map((g, i) => {
      const proyecto = buscarProyecto(g?.proyecto_id);
      return {
        id: g?.id ?? `gasto-${i}`,
        icono: g?.tipo === 'documento' ? 'documento' : g?.tipo === 'pago' ? 'actividad' : 'otro',
        titulo: g?.descripcion || g?.concepto || t('act.pagoRegistrado'),
        proyecto,
        proyectoNombre: proyecto?.nombre || nombreProyecto(g?.proyecto_id),
        detalle: g?.fecha ? new Date(g.fecha).toLocaleDateString(locale) : '',
        valor: g?.monto ? formatMoney(g.monto) : null,
        tono: 'text-emerald-600'
      };
    });

  const entradasHitos = hitosPendientesTodos.map((h, i) => {
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
      tono: dias !== null && dias <= 7 ? 'text-red-500' : 'text-slate-400 dark:text-zinc-200'
    };
  });

  /* Tareas críticas: NUNCA agrupadas ("2 pagos pendientes"). Cada hito vencido
     o por vencer dentro de 7 días se pinta como un ítem independiente que dice
     explícitamente a qué PROYECTO pertenece y abre su detalle al hacer clic. */
  const entradasTareas = hitosPendientesTodos
    .map((h, i) => {
      const proyecto = buscarProyecto(h?.proyecto_id);
      const dias = h?.fecha_vencimiento
        ? Math.ceil((new Date(h.fecha_vencimiento) - new Date()) / (1000 * 60 * 60 * 24))
        : null;
      return {
        id: h?.id ?? `tarea-${i}`,
        icono: 'tarea',
        titulo: h?.titulo || h?.tarea || t('proy.hitoSinTitulo'),
        proyecto,
        proyectoNombre: proyecto?.nombre || nombreProyecto(h?.proyecto_id),
        detalle: h?.fecha_vencimiento ? `${t('notif.vence')} ${h.fecha_vencimiento}` : '',
        valor: dias !== null && dias < 0 ? t('notif.vencido') : t('notif.urgente'),
        tono: 'text-red-500',
        dias
      };
    })
    .filter(e => e.dias !== null && e.dias <= 7)
    .sort((a, b) => a.dias - b.dias);

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
    <div className="flex h-full overflow-hidden bg-[#0B1B2C] dark:bg-zinc-900">

      {/* Selector de portada de proyecto: vive en la RAÍZ, no dentro del bloque
          de escritorio. Colgado de un contenedor `hidden md:flex` el navegador
          móvil no llegaba a abrirlo y por eso la foto solo se podía cambiar
          desde la laptop. Aquí lo comparten escritorio, carrusel móvil y la
          lista de "Todos los Proyectos". */}
      <input
        type="file"
        ref={portadaProyectoRef}
        onChange={handlePortadaProyecto}
        accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
        className="hidden"
      />

      {/* ════════════════════════════════════════════════
          SIDEBAR IZQUIERDO (solo desktop)
      ════════════════════════════════════════════════ */}
      <aside className="w-[230px] lg:w-[270px] hidden md:flex flex-col h-full overflow-hidden bg-[#050D15] dark:bg-zinc-900 border-r border-white/5 dark:border-zinc-800 flex-shrink-0">

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
              <Users size={11} className="text-[#C5A059]" />
              <span className="text-[10px] font-bold text-white/70 tracking-wider uppercase">{t('chat.canalSocios')}</span>
            </div>
            <div className="text-[9px] text-white/60">{miembrosSocios} {t('chat.miembros')}</div>
          </div>

          {!puedeChatear ? (
            /* Solo admin y socios: para el resto el canal ni siquiera se lee */
            <div className="flex-1 min-h-0 flex flex-col items-center justify-center text-center px-2">
              <Lock size={16} className="text-white/25 mb-1.5" />
              <p className="text-[9px] text-white/40 leading-relaxed">{t('chat.sinAcceso')}</p>
            </div>
          ) : (
            <>
              {/* Único elemento con scroll: el historial. El menú lateral no se mueve. */}
              <div
                onClick={marcarChatLeido}
                className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1 my-1 [scrollbar-width:thin] [scrollbar-color:rgba(255,255,255,0.22)_transparent] [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-white/20 [&::-webkit-scrollbar-thumb]:rounded-full"
              >
                {mensajesSocios.length === 0 ? (
                  <p className="text-[9px] text-white/35 text-center py-4">{t('chat.sinMensajes')}</p>
                ) : mensajesSocios.map((m) => (
                  <div key={m.id} className={`flex ${m.propio ? 'justify-end' : 'justify-start'}`}>
                    {/* Burbuja suave y legible, con padding contenido para que
                        un mensaje largo no se coma el alto del recuadro. */}
                    <div className={`rounded-2xl px-3 py-2 text-[13px] leading-snug max-w-[95%] ${
                      m.propio
                        ? 'bg-blue-500/20 border border-blue-500/30 text-white/90'
                        : 'bg-white/10 text-white/80'
                    }`}>
                      {!m.propio && <p className="text-[10px] font-bold text-[#C5A059] mb-0.5">{m.autor}</p>}
                      <p className="break-words">{m.texto}</p>
                    </div>
                  </div>
                ))}
                <div ref={finChatSidebarRef} />
              </div>

              {chatError && (
                <p className="text-[8px] text-red-300 leading-relaxed flex-shrink-0 mb-1 break-words">{chatError}</p>
              )}

              <form onSubmit={handleEnviarSidebar} className="relative mt-2 flex-shrink-0">
                <input
                  type="text"
                  value={borradorSidebar}
                  onChange={(e) => setBorradorSidebar(e.target.value)}
                  onFocus={marcarChatLeido}
                  placeholder={t('nav.enviarMensaje')}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg py-1.5 pl-7 pr-7 text-[10px] text-white placeholder-white/30 focus:outline-none focus:border-[#C5A059] transition-colors"
                />
                <button type="button" className="absolute left-2 top-1/2 -translate-y-1/2 text-white/40 hover:text-[#C5A059] transition-colors" title={t('nav.adjuntar')}>
                  <Paperclip size={11} />
                </button>
                <button type="submit" disabled={!borradorSidebar.trim() || enviandoSidebar} className="absolute right-2 top-1/2 -translate-y-1/2 text-white/40 hover:text-white transition-colors disabled:opacity-30">
                  <Send size={10} />
                </button>
              </form>
            </>
          )}
        </div>

        {/* Perfil del Usuario en el Sidebar (Clic redirige a Perfil) */}
        <div
          onClick={() => changeView('profile')}
          className="px-4 py-2.5 border-t border-white/5 flex-shrink-0 bg-[#071320]/60 cursor-pointer hover:bg-[#071320] transition-colors group"
        >
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-slate-800 border border-[#C5A059] flex items-center justify-center flex-shrink-0 overflow-hidden">
              {userAvatarUrl ? (
                <img src={userAvatarUrl} alt="Avatar" className="w-full h-full object-cover" />
              ) : (
                <span className="text-white text-[10px] font-bold tracking-wider">{iniciales}</span>
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
                className="text-white font-bold tracking-tight leading-tight group-hover:text-[#C5A059] transition-colors"
              />
              <NombreAjustado
                texto={cargo.texto || t(cargo.clave)}
                max={11}
                min={6.5}
                className="text-[#C5A059] font-semibold tracking-wide leading-tight mt-0.5"
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
      <div className="flex-1 flex flex-col h-full overflow-hidden bg-[#F5F6F8] dark:bg-zinc-900">

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
                    ? 'bg-[#C5A059] text-white border-[#C5A059]'
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
                onClick={() => { setShowNotifications(!showNotifications); setShowMenuAvatar(false); }}
                className="text-slate-500 dark:text-zinc-200 hover:text-slate-800 dark:hover:text-white transition-colors relative p-1"
              >
                <Bell size={20} />
                {/* Indicador bien visible: punto grande, latiendo y con halo */}
                {((notificaciones && notificaciones.length > 0) || chatNoLeido) && (
                  <span className="absolute -top-0.5 -right-0.5 flex w-3.5 h-3.5">
                    <span className="absolute inline-flex w-full h-full rounded-full bg-red-500 opacity-60 animate-ping"></span>
                    <span className="relative inline-flex w-3.5 h-3.5 rounded-full bg-red-500 border-2 border-white dark:border-zinc-800 animate-pulse"></span>
                  </span>
                )}
              </button>
              {showNotifications && (
                <PanelNotificaciones
                  t={t}
                  notificaciones={notificaciones}
                  chatNoLeido={chatNoLeido}
                  noLeidosChat={noLeidosChat}
                  marcarChatLeido={marcarTodoLeido}
                  onAbrirNotificacion={abrirNotificacion}
                  onAbrirChat={() => { setShowNotifications(false); marcarChatLeido(); changeView('chat'); }}
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
                <div className="w-10 h-10 bg-[#0B1B2C] rounded-full flex items-center justify-center border-2 border-[#C5A059] shadow-sm overflow-hidden">
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
        <header className="md:hidden flex items-center justify-between gap-1 pl-2 pr-3 pb-2 safe-top bg-[#0B1B2C] dark:bg-zinc-900 text-white border-b border-white/5 dark:border-zinc-800 flex-shrink-0 z-40">
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
              <span className="text-[7px] text-white/60 font-medium tracking-[0.1em] uppercase mt-1 truncate w-full">{t('dash.gestionInmobMin')}</span>
            </span>
          </button>

          {/* El reloj dual ya no vive aquí: bajó junto al saludo, donde hay
              sitio de sobra, para que la barra respire. */}
          <div className="flex items-center gap-4 flex-shrink-0">
            {/* Campana de notificaciones: con avisos sin leer se pone dorada y
                se sacude; al marcarlas leídas vuelve a blanco y se queda quieta. */}
            <div className="relative flex-shrink-0" ref={notifMovilRef}>
              <button
                onClick={() => { setShowNotifications(!showNotifications); setShowMenuAvatar(false); }}
                aria-label={t('notif.titulo')}
                className={`p-1 active:scale-90 transition-colors relative ${
                  hayAvisos ? 'text-[#C5A059]' : 'text-white/90'
                }`}
              >
                <Bell size={24} className={hayAvisos ? 'animate-campaneo' : ''} />
                {hayAvisos && (
                  <span className="absolute -top-0.5 -right-0.5 flex w-3.5 h-3.5">
                    <span className="absolute inline-flex w-full h-full rounded-full bg-red-500 opacity-70 animate-ping" />
                    <span className="relative inline-flex w-3.5 h-3.5 rounded-full bg-red-500 border-2 border-[#0B1B2C] dark:border-zinc-900" />
                  </span>
                )}
              </button>
              {showNotifications && (
                <PanelNotificaciones
                  t={t}
                  notificaciones={notificaciones}
                  chatNoLeido={chatNoLeido}
                  noLeidosChat={noLeidosChat}
                  marcarChatLeido={marcarTodoLeido}
                  onAbrirNotificacion={abrirNotificacion}
                  onAbrirChat={() => { setShowNotifications(false); marcarChatLeido(); changeView('chat'); }}
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
                <span className="w-11 h-11 rounded-full border-2 border-[#C5A059] bg-[#050D15] flex items-center justify-center overflow-hidden flex-shrink-0">
                  {userAvatarUrl ? (
                    <img src={userAvatarUrl} alt="Avatar" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-[13px] font-bold text-[#C5A059] tracking-wider">{iniciales}</span>
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
            <ProjectDetails project={activeProject} onBack={handleBack} userRole={rol} isEditMode={isEditMode} onUpdateProject={refetchData} />
          ) : currentView === 'project-details' && proyectoPendiente ? (
            /* Recarga sobre un proyecto: se espera a que Supabase devuelva la
               lista. Sin esto asomaría el Dashboard un instante, que es
               justo el salto que se quiere evitar. */
            <div className="flex-1 flex flex-col items-center justify-center gap-3 bg-white dark:bg-zinc-900">
              <Loader2 size={28} className="animate-spin text-[#C5A059]" />
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
            <main className="flex-1 flex flex-col overflow-hidden bg-[#F5F6F8] dark:bg-zinc-900">

              {/* La barra superior móvil ya no vive aquí: subió al contenedor
                  principal para acompañar a todas las vistas. */}
              <div className="flex-1 overflow-y-auto custom-scrollbar w-full pb-6 md:pb-20 bg-[#F8FAFC] dark:bg-zinc-900">

                {/* ── Saludo móvil + reloj dual ──
                    El reloj bajó aquí desde la barra azul: aprovecha el hueco
                    de la derecha y deja la cabecera despejada. */}
                <header className="md:hidden px-4 pt-5 pb-3 w-full flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight leading-tight">
                      {t(saludo)}<br />
                      <span className="text-[#C5A059]">{nombreUsuario}</span>
                    </h1>
                    <p className="text-slate-500 dark:text-zinc-200 text-sm mt-1.5 font-medium">
                      {t('dash.panelEjecutivo')}
                    </p>
                  </div>

                  {/* Los dos husos A LA PAR en una sola fila. Se achica lo
                      necesario para que nunca se monte sobre el saludo. */}
                  <div className="flex items-center gap-1.5 bg-white dark:bg-zinc-800 border border-gray-100 dark:border-zinc-700 rounded-xl px-2 py-1.5 shadow-sm flex-shrink-0 whitespace-nowrap">
                    <span className="flex items-center gap-1 text-[7px] font-bold tracking-widest text-slate-400 dark:text-zinc-300 uppercase leading-none">
                      SV <span className="text-[10px] text-slate-900 dark:text-white tracking-normal tabular-nums">{timeCST || '--:--'}</span>
                    </span>
                    <span className="w-px h-3 bg-gray-200 dark:bg-zinc-600" />
                    <span className="flex items-center gap-1 text-[7px] font-bold tracking-widest text-slate-400 dark:text-zinc-300 uppercase leading-none">
                      US <span className="text-[10px] text-slate-900 dark:text-white tracking-normal tabular-nums">{timePDT || '--:--'}</span>
                    </span>
                  </div>
                </header>

                {/* ── KPIs móvil (bloque oscuro) ── */}
                <section className="px-4 md:px-8 py-2 md:py-4 w-full">
                  <div className="md:hidden bg-[#0B1B2C] dark:bg-zinc-800 rounded-[20px] p-4 text-white shadow-xl">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-lg bg-[#C5A059] flex items-center justify-center">
                          <Activity size={16} className="text-[#0B1B2C]" />
                        </div>
                        <div>
                          <h2 className="text-sm font-bold">{t('dash.resumen')}</h2>
                          <p className="text-[9px] text-white/70">{t('dash.resumenSub')}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-400"></div>
                        <span className="text-[9px] text-white/80">{t('dash.enLinea')}</span>
                      </div>
                    </div>
                    {/* Las 4 tarjetas SIEMPRE a la vista: nada de deslizar.
                        Se achican lo necesario para caber en 375 px. */}
                    <div className="grid grid-cols-4 gap-1.5 mt-2">
                      {[
                        { icono: Building2, valor: loading ? '–' : String(PROJECTS.length), etiqueta: t('dash.proyectosActivos') },
                        // El Capital Total es la ÚNICA cifra escrita a mano de
                        // este bloque, así que es la única con lápiz.
                        { icono: DollarSign, valor: loading ? '–' : formatMoney(totalCapital), etiqueta: t('dash.capitalTotal'), editable: true },
                        { icono: TrendingUp, valor: loading ? '–' : `${avanceProm}%`, etiqueta: t('dash.avancePromedioMin'), pie: !loading && t('dash.ejecAbrev') },
                        // Mismo dato que el KPI 4 del escritorio: la suma de
                        // TODAS las inversiones registradas, no el gasto del mes.
                        { icono: Wallet, valor: loading ? '–' : formatMoney(egresosTotales), etiqueta: t('dash.egresosTotales') }
                      ].map((kpi, i) => {
                        const IconoKpi = kpi.icono;
                        const puedeEditarKpi = kpi.editable && isAdmin && isEditMode;
                        return (
                          <div
                            key={i}
                            className="relative min-w-0 bg-[#16273B] dark:bg-zinc-700 rounded-xl px-1 py-2 flex flex-col items-center justify-start text-center border border-white/5 dark:border-zinc-600"
                          >
                            {/* El lápiz solo cabe como sello en la esquina: la
                                caja de escritura se abre debajo de la rejilla,
                                donde sí hay ancho para escribir con el pulgar. */}
                            {puedeEditarKpi && (
                              <button
                                onClick={abrirEdicionCapital}
                                aria-label={t('dash.editarCapital')}
                                className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-[#C5A059] text-[#0B1B2C] flex items-center justify-center shadow-md active:scale-90 transition-transform z-10"
                              >
                                <Edit2 size={11} />
                              </button>
                            )}
                            <div className="w-6 h-6 rounded-full border border-[#C5A059]/30 flex items-center justify-center mb-1.5 flex-shrink-0">
                              <IconoKpi size={11} className="text-[#C5A059]" />
                            </div>
                            <p className="text-[13px] font-bold leading-none mb-1 w-full truncate">{kpi.valor}</p>
                            <p className="text-[7px] text-white/85 leading-[1.25] w-full">{kpi.etiqueta}</p>
                            {kpi.pie && (
                              <span className="text-[7px] text-emerald-400 flex items-center gap-0.5 font-medium mt-0.5">
                                <ArrowUp size={6} /> {kpi.pie}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Edición del Capital Total en móvil (misma función que en
                        escritorio: `guardarCapital` escribe en configuración). */}
                    {editandoCapital && (
                      <form onSubmit={guardarCapital} className="mt-3 flex items-center gap-2 bg-[#16273B] dark:bg-zinc-700 border border-[#C5A059]/50 rounded-xl px-2.5 py-2">
                        <span className="text-xs font-bold text-white/70 flex-shrink-0">{t('dash.capitalTotal')}</span>
                        <span className="text-sm font-black text-white/80">$</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          autoFocus
                          value={capitalBorrador}
                          onChange={(e) => setCapitalBorrador(e.target.value)}
                          className="flex-1 min-w-0 bg-transparent border-b border-[#C5A059] text-sm font-bold text-white focus:outline-none"
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
                      <p className={`mt-2 text-[10px] font-bold ${
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
                        <span className="text-[#C5A059]">★</span> {t('dash.proyectoDestacado')}
                      </h2>
                      <button
                        onClick={() => changeView('all-projects')}
                        className="text-[11px] font-semibold text-[#8B6914] dark:text-[#E3C77B] flex items-center gap-0.5"
                      >
                        {t('comun.verTodos')} <ChevronRight size={13} />
                      </button>
                    </div>

                    {loading ? (
                      <div className="h-52 flex items-center justify-center bg-white dark:bg-zinc-800 rounded-[20px] border border-gray-100 dark:border-zinc-700">
                        <div className="w-7 h-7 border-2 border-[#C5A059] border-t-transparent rounded-full animate-spin" />
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
                          onTouchStart={() => { ultimoGestoRef.current = Date.now(); }}
                          onTouchMove={() => { ultimoGestoRef.current = Date.now(); }}
                          className="flex overflow-x-auto snap-x snap-mandatory hide-scrollbar gap-3 -mx-4 px-[5vw] scroll-px-[5vw]"
                        >
                          {PROJECTS.map((p) => {
                            const lista = p.checklist || [];
                            const pctP = lista.length > 0
                              ? (lista.filter(c => c.done || c.estado === 'completado').length / lista.length) * 100
                              : 0;
                            return (
                              <article
                                key={p.id}
                                onClick={() => handleCardClick(p)}
                                className="w-[90vw] shrink-0 snap-center bg-white dark:bg-zinc-800 rounded-[20px] border border-gray-100 dark:border-zinc-700 shadow-[0_2px_16px_rgba(0,0,0,0.06)] p-3 active:scale-[0.98] transition-transform"
                              >
                                {/* Imagen a la IZQUIERDA, detalle a la DERECHA */}
                                <div className="flex gap-3">
                                  <div className="w-[38%] flex-shrink-0 rounded-2xl overflow-hidden bg-slate-100 dark:bg-zinc-700 min-h-[132px] relative">
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
                                      <button
                                        onClick={(e) => { e.stopPropagation(); pedirPortadaProyecto(p.id); }}
                                        disabled={subiendoPortadaId === p.id}
                                        aria-label={t('dash.cambiarPortada')}
                                        className="absolute inset-0 bg-black/45 flex flex-col items-center justify-center gap-1.5 active:bg-black/60 transition-colors"
                                      >
                                        <span className="bg-white/90 p-2 rounded-full text-slate-900">
                                          {subiendoPortadaId === p.id
                                            ? <Loader2 size={16} className="animate-spin" />
                                            : <Camera size={16} />}
                                        </span>
                                        <span className="text-[9px] font-bold text-white tracking-wide px-1 text-center leading-tight">
                                          {subiendoPortadaId === p.id ? t('comun.subiendo') : t('dash.cambiarPortada')}
                                        </span>
                                      </button>
                                    )}
                                  </div>

                                  <div className="flex-1 min-w-0 flex flex-col">
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[8px] font-bold bg-[#FAF4EA] dark:bg-amber-500/10 text-[#8B6914] dark:text-[#E3C77B] border border-[#F0E2CD] dark:border-amber-500/30 w-fit mb-1.5">
                                      <span className="text-[6px]">★</span> {etiquetaEstado(p.estado, t).toUpperCase()}
                                    </span>

                                    <div className="flex items-start justify-between gap-2">
                                      <h3 className="text-[13px] font-bold text-slate-900 dark:text-white leading-tight uppercase break-words flex-1 min-w-0">{p.nombre}</h3>
                                      <div className="text-right flex-shrink-0">
                                        <p className="text-lg font-bold text-slate-900 dark:text-white leading-none">{pctP.toFixed(0)}%</p>
                                        <p className="text-[8px] text-slate-400 dark:text-zinc-200 font-medium">{t('dash.avanceObraCorto')}</p>
                                      </div>
                                    </div>

                                    {p.ubicacion && (
                                      <p className="text-[10px] text-slate-500 dark:text-zinc-200 flex items-center gap-1 mt-1 font-medium min-w-0">
                                        <MapPin size={10} className="text-slate-400 dark:text-zinc-200 flex-shrink-0" />
                                        <span className="truncate">{p.ubicacion}</span>
                                      </p>
                                    )}

                                    {p.descripcion && (
                                      <p className="text-[10px] text-slate-500 dark:text-zinc-200 leading-snug line-clamp-2 mt-1.5">{p.descripcion}</p>
                                    )}

                                    <div className="w-full bg-slate-100 dark:bg-zinc-700 rounded-full h-2 overflow-hidden mt-auto pt-0">
                                      <div className="bg-[#C5A059] rounded-full h-full transition-all duration-700" style={{ width: `${pctP}%` }} />
                                    </div>
                                  </div>
                                </div>

                                {/* Fila de métricas inferior, como la referencia */}
                                <div className="flex items-end gap-2 pt-2.5 mt-2.5 border-t border-gray-100 dark:border-zinc-700">
                                  <div className="min-w-0 flex-1">
                                    <p className="text-[8px] text-slate-400 dark:text-zinc-200 font-medium truncate">{t('dash.inversionTotal')}</p>
                                    <p className="text-[13px] font-bold text-slate-900 dark:text-white truncate">{formatMoney(p.presupuesto_total)}</p>
                                  </div>
                                  <div className="min-w-0 flex-1 border-l border-gray-100 dark:border-zinc-700 pl-2">
                                    <p className="text-[8px] text-slate-400 dark:text-zinc-200 font-medium truncate">{t('dash.ejecutado')}</p>
                                    <p className="text-[13px] font-bold text-slate-900 dark:text-white truncate">
                                      {formatMoney(p.totalGastado)} <span className="text-[9px] text-slate-500 dark:text-zinc-200 font-normal">({pctP.toFixed(0)}%)</span>
                                    </p>
                                  </div>
                                  <div className="min-w-0 flex-1 border-l border-gray-100 dark:border-zinc-700 pl-2">
                                    <p className="text-[8px] text-slate-400 dark:text-zinc-200 font-medium truncate flex items-center gap-1">
                                      <Calendar size={9} className="flex-shrink-0" /> {t('dash.entregaEstimada')}
                                    </p>
                                    <p className="text-[11px] font-bold text-slate-900 dark:text-white truncate">
                                      {p.fecha_entrega
                                        ? new Date(p.fecha_entrega).toLocaleDateString(locale, { day: '2-digit', month: 'short', year: '2-digit' })
                                        : '—'}
                                    </p>
                                  </div>
                                  <span className="px-2 py-1.5 bg-[#FAF4EA] dark:bg-amber-500/10 text-[#8B6914] dark:text-[#E3C77B] rounded-lg text-[10px] font-bold flex items-center gap-0.5 border border-[#F0E2CD] dark:border-amber-500/30 whitespace-nowrap flex-shrink-0">
                                    {t('dash.verProyectoCorto')} <ChevronRight size={11} />
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
                                  i === indiceMovilSeguro ? 'w-5 bg-[#C5A059]' : 'w-1.5 bg-slate-300 dark:bg-zinc-600'
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
                        <h3 className="text-[9px] font-bold text-slate-900 dark:text-white tracking-tight uppercase min-w-0 truncate">{t('dash.actividadReciente')}</h3>
                        <button
                          onClick={() => setModalLista('actividad')}
                          className="text-[9px] text-[#C5A059] font-semibold flex-shrink-0"
                        >
                          {t('dash.verTodas')}
                        </button>
                      </div>
                      <div className="space-y-2.5 flex-1">
                        {loading ? (
                          <p className="text-[10px] text-slate-400 dark:text-zinc-200">{t('comun.cargando')}</p>
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
                              <p className="text-[10px] font-semibold text-slate-800 dark:text-zinc-100 truncate leading-tight">{e.titulo}</p>
                              <p className="text-[9px] text-slate-400 dark:text-zinc-200 truncate leading-tight mt-0.5">{e.proyectoNombre}</p>
                            </div>
                          </button>
                        )) : (
                          <p className="text-[10px] text-slate-400 dark:text-zinc-300 py-4 text-center">{t('dash.sinActividad')}</p>
                        )}
                      </div>
                    </div>

                    {/* Avance de Obra Ejecutado: sigue al proyecto centrado */}
                    <div className="h-full flex flex-col bg-white dark:bg-zinc-800 rounded-[18px] border border-gray-100 dark:border-zinc-700 shadow-[0_1px_8px_rgba(0,0,0,0.05)] p-3">
                      <div className="flex items-center justify-between gap-1 mb-1">
                        <h3 className="text-[9px] font-bold text-slate-900 dark:text-white tracking-tight uppercase min-w-0 truncate">{t('dash.avanceObraCorto')}</h3>
                        <span className="text-[7px] font-extrabold bg-amber-50 dark:bg-amber-500/10 text-[#8B6914] dark:text-[#E3C77B] px-1.5 py-0.5 rounded-full border border-amber-200 dark:border-amber-500/30 uppercase whitespace-nowrap flex-shrink-0">
                          {t('dash.sincronizado')}
                        </span>
                      </div>
                      <p className="text-[9px] font-bold text-slate-800 dark:text-zinc-100 uppercase flex items-center gap-1 truncate mb-1">
                        <Building2 size={10} className="text-[#C5A059] flex-shrink-0" />
                        <span className="truncate">{fpMovil ? fpMovil.nombre : t('dash.proyectoActivo')}</span>
                      </p>

                      <div className="h-32 relative flex items-center justify-center">
                        {loading || !fpMovil ? (
                          <div className="w-5 h-5 border-2 border-[#C5A059] border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <>
                            <ResponsiveContainer width="100%" height="100%">
                              <PieChart>
                                <Pie
                                  data={[
                                    { name: t('dash.ejecutado'), value: avanceMovil },
                                    { name: t('dash.pendiente'), value: Math.max(100 - avanceMovil, 0) }
                                  ]}
                                  cx="50%"
                                  cy="50%"
                                  innerRadius={38}
                                  outerRadius={52}
                                  startAngle={90}
                                  endAngle={-270}
                                  dataKey="value"
                                  stroke="none"
                                  isAnimationActive={false}
                                >
                                  <Cell key="mov-0" fill="#C5A059" />
                                  <Cell key="mov-1" fill="#E2E8F0" />
                                </Pie>
                              </PieChart>
                            </ResponsiveContainer>
                            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                              <span className="text-xl font-black text-slate-900 dark:text-white leading-none">{avanceMovil}%</span>
                              <span className="text-[7px] font-bold text-slate-400 dark:text-zinc-200 uppercase tracking-wider mt-0.5">{t('dash.avanceFisico')}</span>
                            </div>
                          </>
                        )}
                      </div>

                      {fpMovil && (
                        <div className="pt-2 mt-auto border-t border-gray-100 dark:border-zinc-700 space-y-1.5">
                          <div className="grid grid-cols-2 gap-1.5 text-center">
                            <div className="bg-amber-50/60 dark:bg-amber-500/10 py-1 rounded-lg border border-amber-100 dark:border-amber-500/25">
                              <p className="text-[7px] font-bold text-amber-900 dark:text-amber-200 uppercase leading-tight">{t('dash.ejecutado')}</p>
                              <p className="text-[11px] font-black text-[#8B6914] dark:text-[#E3C77B] leading-tight">{avanceMovil}%</p>
                            </div>
                            <div className="bg-slate-50 dark:bg-zinc-900 py-1 rounded-lg border border-gray-100 dark:border-zinc-700">
                              <p className="text-[7px] font-bold text-slate-500 dark:text-zinc-200 uppercase leading-tight">{t('dash.pendiente')}</p>
                              <p className="text-[11px] font-black text-slate-700 dark:text-zinc-200 leading-tight">{100 - avanceMovil}%</p>
                            </div>
                          </div>
                          <p className="text-[8px] text-slate-400 dark:text-zinc-200 font-medium text-center leading-tight">
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
                  <div className="md:hidden mt-3 space-y-3">

                    {/* Próximos Hitos */}
                    <div className="bg-white dark:bg-zinc-800 rounded-[18px] border border-gray-100 dark:border-zinc-700 shadow-[0_1px_8px_rgba(0,0,0,0.05)] p-4">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-[10px] font-bold text-slate-900 dark:text-white tracking-[0.12em] uppercase">{t('dash.proximosHitos')}</h3>
                        <button onClick={() => setModalLista('hitos')} className="text-[10px] text-[#C5A059] font-semibold">
                          {t('comun.verTodos')}
                        </button>
                      </div>
                      {/* El texto del hito NUNCA se recorta: baja de línea y la
                          tarjeta hace su propio scroll si crece demasiado. */}
                      <div className="space-y-3 max-h-56 overflow-y-auto pr-1">
                        {loading ? (
                          <p className="text-[11px] text-slate-400 dark:text-zinc-200">{t('comun.cargando')}</p>
                        ) : entradasHitos.length > 0 ? entradasHitos.slice(0, 3).map((e, i) => (
                          <button
                            key={e.id ?? i}
                            onClick={() => abrirProyectoDeItem(e.proyecto)}
                            disabled={!e.proyecto}
                            className="w-full text-left flex items-start gap-3 rounded-lg active:bg-slate-50 dark:active:bg-zinc-700/40 transition-colors"
                          >
                            <div className="w-6 h-6 rounded-full bg-slate-100 dark:bg-zinc-700 flex items-center justify-center flex-shrink-0 mt-0.5">
                              <MapPin size={11} className="text-slate-500 dark:text-zinc-200" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[11px] font-semibold text-slate-800 dark:text-zinc-100 whitespace-normal break-words leading-snug">{sinNumeracion(e.titulo)}</p>
                              <p className="text-[10px] text-slate-400 dark:text-zinc-200 whitespace-normal break-words">{e.proyectoNombre}</p>
                            </div>
                            {e.valor && <span className={`text-[10px] font-bold flex-shrink-0 ${e.tono}`}>{e.valor}</span>}
                          </button>
                        )) : (
                          <p className="text-[11px] text-slate-400 dark:text-zinc-300 py-3 text-center">{t('dash.sinHitosPendientes')}</p>
                        )}
                      </div>
                    </div>

                    {/* Tareas Críticas */}
                    <div className="bg-white dark:bg-zinc-800 rounded-[18px] border border-gray-100 dark:border-zinc-700 shadow-[0_1px_8px_rgba(0,0,0,0.05)] p-4">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-[10px] font-bold text-slate-900 dark:text-white tracking-[0.12em] uppercase">{t('dash.tareasCriticas')}</h3>
                        <button onClick={() => setModalLista('tareas')} className="text-[10px] text-[#C5A059] font-semibold">
                          {t('dash.verTodas')}
                        </button>
                      </div>
                      {/* Igual que los hitos: el texto de la tarea baja de línea
                          y la tarjeta hace su propio scroll si crece. */}
                      <div className="space-y-3 max-h-56 overflow-y-auto pr-1">
                        {loading ? (
                          <p className="text-[11px] text-slate-400 dark:text-zinc-200">{t('comun.cargando')}</p>
                        ) : entradasTareas.length > 0 ? entradasTareas.slice(0, 3).map((e, i) => (
                          <button
                            key={e.id ?? i}
                            onClick={() => abrirProyectoDeItem(e.proyecto)}
                            disabled={!e.proyecto}
                            className="w-full text-left flex items-start gap-3 rounded-lg active:bg-slate-50 dark:active:bg-zinc-700/40 transition-colors"
                          >
                            <div className="w-6 h-6 rounded-full bg-red-50 dark:bg-red-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                              <AlertTriangle size={11} className="text-red-500" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[11px] font-semibold text-slate-800 dark:text-zinc-100 whitespace-normal break-words leading-snug">{sinNumeracion(e.titulo)}</p>
                              <p className="text-[10px] text-slate-400 dark:text-zinc-200 whitespace-normal break-words">{e.proyectoNombre}</p>
                            </div>
                            <span className="text-[9px] font-bold text-red-400 flex-shrink-0 bg-red-50 dark:bg-red-500/10 px-1.5 py-0.5 rounded">{e.valor}</span>
                          </button>
                        )) : (
                          <p className="text-[11px] text-slate-400 dark:text-zinc-300 py-3 text-center">{t('dash.sinTareasCriticas')}</p>
                        )}
                      </div>
                    </div>
                  </div>
{/* ── Desktop: Saludo + KPIs ── */}
                  <div className="hidden md:flex flex-col w-full">
                    <div className="px-8 mt-6 mb-8">
                      {/* El reloj dual se movió al header superior; este bloque
                          ya no necesita ser flex de dos columnas. */}
                      <div className="mb-8">
                        <h1 className="text-[32px] lg:text-4xl font-bold text-slate-900 dark:text-white tracking-tight leading-tight">
                          {t(saludo)} <span className="text-[#C5A059]">{nombreUsuario}</span>
                        </h1>
                        <p className="text-slate-500 dark:text-zinc-200 text-sm mt-1 font-medium flex items-center gap-2">
                          {t('dash.panelEjec')} <span className="text-slate-300 dark:text-zinc-200">•</span> {t('dash.accesoSocios')}
                        </p>
                      </div>

                  {/* 4 Tarjetas KPI desktop.
                      2 columnas en tablet y ventanas medianas: con 4 en fila
                      el ancho útil por tarjeta bajaba de ~110px y etiquetas
                      como "PRESUPUESTADO" salían cortadas. */}
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
                    {/* KPI 1 */}
                    <div className="bg-white dark:bg-zinc-800 rounded-[20px] p-4 lg:p-5 xl:p-8 border border-gray-100/80 dark:border-zinc-700/80 shadow-[0_4px_24px_rgba(0,0,0,0.09)] flex items-center gap-3 xl:gap-4 min-w-0 hover:shadow-[0_8px_32px_rgba(0,0,0,0.13)] transition-shadow">
                      <div className="w-[44px] h-[44px] rounded-full bg-[#0B1B2C] flex items-center justify-center flex-shrink-0">
                        <Building2 size={18} className="text-[#C5A059]" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] text-slate-400 dark:text-zinc-200 font-bold tracking-wide mb-1 truncate">{t('dash.proyectosActivosMay')}</p>
                        <p className="text-[clamp(18px,2vw,28px)] font-bold text-slate-900 dark:text-white mb-0.5 leading-none truncate">
                          {loading ? '–' : (PROJECTS.length || 3)}
                        </p>
                        <p className="text-slate-400 dark:text-zinc-200 text-[10px] font-medium flex items-center gap-1 mt-1.5 truncate">
                          {t('dash.enPortafolio')}
                        </p>
                      </div>
                    </div>
                    {/* KPI 2 */}
                    <div className="bg-white dark:bg-zinc-800 rounded-[20px] p-4 lg:p-5 xl:p-8 border border-gray-100/80 dark:border-zinc-700/80 shadow-[0_4px_24px_rgba(0,0,0,0.09)] flex items-center gap-3 xl:gap-4 min-w-0 hover:shadow-[0_8px_32px_rgba(0,0,0,0.13)] transition-shadow">
                      <div className="w-[44px] h-[44px] rounded-full bg-[#0B1B2C] flex items-center justify-center flex-shrink-0">
                        <DollarSign size={18} className="text-[#C5A059]" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 mb-1">
                          <p className="text-[10px] text-slate-400 dark:text-zinc-200 font-bold tracking-wide truncate">{t('dash.capitalTotalMay')}</p>
                          {/* Solo el Administrador y solo en MODO EDICIÓN */}
                          {isAdmin && isEditMode && !editandoCapital && (
                            <button
                              onClick={abrirEdicionCapital}
                              title={t('dash.editarCapital')}
                              className="p-1 rounded-lg text-[#C5A059] hover:bg-amber-50 dark:hover:bg-amber-500/10 transition-colors flex-shrink-0"
                            >
                              <Edit2 size={12} />
                            </button>
                          )}
                        </div>

                        {editandoCapital ? (
                          <form onSubmit={guardarCapital} className="flex items-center gap-1.5">
                            <span className="text-sm font-black text-slate-500 dark:text-zinc-200">$</span>
                            <input
                              type="text"
                              inputMode="decimal"
                              autoFocus
                              value={capitalBorrador}
                              onChange={(e) => setCapitalBorrador(e.target.value)}
                              className="w-full min-w-0 bg-slate-50 dark:bg-zinc-900 border border-[#C5A059] rounded-lg px-2 py-1 text-sm font-bold text-slate-900 dark:text-white focus:outline-none"
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
                              className="p-1.5 rounded-lg text-slate-400 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-700 flex-shrink-0"
                            >
                              <X size={14} />
                            </button>
                          </form>
                        ) : (
                          <p className="text-[clamp(18px,2vw,28px)] font-bold text-slate-900 dark:text-white mb-0.5 leading-none truncate">
                            {loading ? '–' : formatMoney(capitalTotal)}
                          </p>
                        )}

                        {capitalMsg ? (
                          <p className={`text-[10px] font-bold mt-1.5 truncate ${
                            capitalMsg.tipo === 'exito' ? 'text-emerald-600' : 'text-red-500'
                          }`}>
                            {capitalMsg.texto}
                          </p>
                        ) : (
                          <p className="text-emerald-500 text-[10px] font-bold flex items-center gap-1 mt-1.5 min-w-0">
                            <ArrowUp size={10} className="flex-shrink-0" />
                            <span className="text-slate-400 dark:text-zinc-200 font-medium truncate">
                              {pctDisponible.toFixed(0)}% {t('dash.disponible')}
                            </span>
                          </p>
                        )}
                      </div>
                    </div>
                    {/* KPI 3 */}
                    <div className="bg-white dark:bg-zinc-800 rounded-[20px] p-4 lg:p-5 xl:p-8 border border-gray-100/80 dark:border-zinc-700/80 shadow-[0_4px_24px_rgba(0,0,0,0.09)] flex items-center gap-3 xl:gap-4 min-w-0 hover:shadow-[0_8px_32px_rgba(0,0,0,0.13)] transition-shadow">
                      <div className="w-[44px] h-[44px] rounded-full bg-[#0B1B2C] flex items-center justify-center flex-shrink-0">
                        <TrendingUp size={18} className="text-[#C5A059]" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] text-slate-400 dark:text-zinc-200 font-bold tracking-wide mb-1 truncate">{t('dash.avancePromedio')}</p>
                        <p className="text-[clamp(18px,2vw,28px)] font-bold text-slate-900 dark:text-white mb-0.5 leading-none truncate">
                          {loading ? '–' : `${avanceProm}%`}
                        </p>
                        <p className="text-emerald-500 text-[10px] font-bold flex items-center gap-1 mt-1.5 min-w-0">
                          <ArrowUp size={10} className="flex-shrink-0" /> <span className="text-slate-400 dark:text-zinc-200 font-medium truncate">{t('dash.avanceSufijo')}</span>
                        </p>
                      </div>
                    </div>
                    {/* KPI 4 */}
                    <div className="bg-white dark:bg-zinc-800 rounded-[20px] p-4 lg:p-5 xl:p-8 border border-gray-100/80 dark:border-zinc-700/80 shadow-[0_4px_24px_rgba(0,0,0,0.09)] flex items-center gap-3 xl:gap-4 min-w-0 hover:shadow-[0_8px_32px_rgba(0,0,0,0.13)] transition-shadow">
                      <div className="w-[44px] h-[44px] rounded-full bg-[#0B1B2C] flex items-center justify-center flex-shrink-0">
                        <Wallet size={18} className="text-[#C5A059]" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] text-slate-400 dark:text-zinc-200 font-bold tracking-wide mb-1 truncate">{t('dash.egresosTotales')}</p>
                        {/* Cifra NO manual: suma de las inversiones registradas
                            en Inversionistas. Cambia sola al agregar o editar. */}
                        <p className="text-[clamp(18px,2vw,28px)] font-bold text-slate-900 dark:text-white mb-0.5 leading-none truncate">
                          {loading ? '–' : formatMoney(egresosTotales)}
                        </p>
                        <button
                          onClick={() => changeView('investors')}
                          className="text-slate-400 dark:text-zinc-200 text-[10px] font-medium flex items-center gap-1 mt-1.5 truncate hover:text-[#C5A059] transition-colors"
                          title={t('dash.egresosAutoTooltip')}
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
                <div className="px-8 grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] xl:grid-cols-[1.5fr_1fr] gap-6 lg:gap-7 mb-7">

                  {/* Proyecto Destacado */}
                  {(() => {
                    if (loading) return (
                      <div className="bg-white dark:bg-zinc-800 rounded-[24px] border border-gray-100 dark:border-zinc-700 p-6 flex items-center justify-center min-h-[340px] shadow-sm">
                        <div className="flex flex-col items-center gap-3">
                          <div className="w-8 h-8 border-2 border-[#C5A059] border-t-transparent rounded-full animate-spin" />
                          <p className="text-slate-400 dark:text-zinc-200 text-xs">{t('dash.cargandoProyectos')}</p>
                        </div>
                      </div>
                    );
                    if (!fp) return (
                      <div className="bg-white dark:bg-zinc-800 rounded-[24px] border border-gray-100 dark:border-zinc-700 p-6 flex items-center justify-center min-h-[340px] shadow-sm">
                        <div className="text-center">
                          <Building2 size={40} className="text-slate-200 mx-auto mb-3" />
                          <p className="text-slate-400 dark:text-zinc-200 text-sm font-medium">{t('dash.sinProyectos')}</p>
                          <p className="text-slate-300 dark:text-zinc-200 text-xs mt-1">{t('dash.verificaConexion')}</p>
                        </div>
                      </div>
                    );
                    const activeChecklist = fp.checklist || [];
                    const pct = activeChecklist.length > 0 ? (activeChecklist.filter(c => c.done || c.estado === 'completado').length / activeChecklist.length) * 100 : 0;
                    return (
                      <div key={fp.id || safeIndex} className="bg-white dark:bg-zinc-800 rounded-[24px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] border border-gray-100 dark:border-zinc-700 flex flex-col p-6 transition-opacity duration-1000 ease-in-out animate-fadeIn">

                        {/* Encabezado */}
                        <div className="flex justify-between items-center mb-4">
                          <div className="flex items-center gap-2">
                            <span className="text-[#C5A059] text-base">★</span>
                            <h2 className="text-base font-bold text-slate-900 dark:text-white">{t('dash.proyectoDestacado')}</h2>
                            {portadaMsg && (
                              <span className={`text-[10px] font-bold px-2 py-1 rounded-lg border ${
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
                            <button
                              onClick={() => setCurrentView('all-projects')}
                              className="text-xs font-semibold text-[#8B6914] dark:text-[#E3C77B] hover:underline flex items-center gap-0.5"
                            >
                              {t('comun.verTodos')} <ChevronRight size={14} />
                            </button>
                          </div>
                        </div>

                        {/* Contenido Principal: Imagen + Detalles con transición suave.
                            flex-wrap: si la tarjeta se estrecha, la imagen pasa
                            arriba y los detalles ocupan el ancho completo en vez
                            de comprimirse hasta romperse. */}
                        <div className="flex flex-wrap gap-5 mb-5">
                          {/* El selector de portada vive en la raíz del Dashboard:
                              lo comparten escritorio y móvil. */}

                          {/* Imagen Grande */}
                          <div
                            onClick={() => handleCardClick(fp)}
                            className="w-full sm:w-[42%] sm:min-w-[190px] rounded-2xl overflow-hidden flex-shrink-0 cursor-pointer group bg-slate-100 dark:bg-zinc-700 h-[190px] lg:h-[220px] relative shadow-sm"
                          >
                            {fp.imagen_url ? (
                              <img
                                src={fp.imagen_url}
                                alt={fp.nombre}
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 ease-out"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center bg-slate-100 dark:bg-zinc-700">
                                <Building2 size={48} className="text-slate-300 dark:text-zinc-200" />
                              </div>
                            )}
                            {/* Cambiar la portada del proyecto: sube a Storage y
                                actualiza proyectos.imagen_url */}
                            {isEditMode && (
                              <button
                                onClick={(e) => { e.stopPropagation(); pedirPortadaProyecto(fp.id); }}
                                disabled={subiendoPortadaId === fp.id}
                                className="absolute inset-0 bg-black/45 flex flex-col items-center justify-center gap-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 focus:opacity-100 transition-opacity cursor-pointer disabled:opacity-100"
                                title={t('dash.cambiarPortada')}
                              >
                                <span className="bg-white/90 p-2.5 rounded-full text-slate-900">
                                  {subiendoPortadaId === fp.id
                                    ? <Loader2 size={18} className="animate-spin" />
                                    : <Camera size={18} />}
                                </span>
                                <span className="text-[10px] font-bold text-white tracking-wide">
                                  {subiendoPortadaId === fp.id ? t('comun.subiendo') : t('dash.cambiarPortada')}
                                </span>
                              </button>
                            )}
                          </div>

                          {/* Detalles del proyecto */}
                          <div className="flex-1 min-w-0 basis-[260px] flex flex-col py-0.5">
                            {/* Badge */}
                            <div className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[10px] font-bold bg-[#FAF4EA] dark:bg-amber-500/10 text-[#8B6914] dark:text-[#E3C77B] mb-2.5 w-fit border border-[#F0E2CD] dark:border-amber-500/30">
                              <span className="text-[8px]">★</span> {etiquetaEstado(fp.estado, t).toUpperCase()}
                            </div>

                            {/* Título & % Avance */}
                            {/* Título y "% Avance Obra" ya no compiten por el
                                mismo ancho: el título puede partir palabra y el
                                bloque del porcentaje nunca se comprime. */}
                            <div className="flex items-start justify-between flex-wrap gap-x-3 gap-y-1 mb-1">
                              <h3
                                onClick={() => handleCardClick(fp)}
                                className="text-[clamp(17px,1.9vw,24px)] font-bold text-slate-900 dark:text-white leading-tight uppercase cursor-pointer hover:text-[#C5A059] transition-colors flex-1 min-w-0 basis-[150px] break-words"
                              >
                                {fp.nombre}
                              </h3>
                              <div className="text-right flex-shrink-0">
                                <p className="text-[clamp(26px,3vw,36px)] font-bold text-slate-900 dark:text-white leading-none">{pct.toFixed(0)}%</p>
                                <p className="text-[11px] text-slate-400 dark:text-zinc-200 font-medium whitespace-nowrap">{t('dash.avanceObraCorto')}</p>
                              </div>
                            </div>

                            {/* Ubicación */}
                            {fp.ubicacion && (
                              <p className="text-xs text-slate-500 dark:text-zinc-200 flex items-center gap-1 mb-2 font-medium">
                                <MapPin size={13} className="text-slate-400 dark:text-zinc-200" /> {fp.ubicacion}
                              </p>
                            )}

                            {/* Descripción */}
                            {fp.descripcion && (
                              <p className="text-xs text-slate-500 dark:text-zinc-200 leading-relaxed line-clamp-2 mb-4">
                                {fp.descripcion}
                              </p>
                            )}

                            {/* Navegación del carrusel: flotan justo encima
                                de la barra de progreso, no sobre la imagen. */}
                            <div className="mt-auto">
                              {PROJECTS.length > 1 && (
                                <div className="flex items-center justify-end gap-2 mb-2">
                                  <button
                                    onClick={(e) => { e.stopPropagation(); irASlide(safeIndex - 1); }}
                                    aria-label={t('dash.anteriorProyecto')}
                                    title={t('dash.anteriorProyecto')}
                                    className="w-8 h-8 rounded-full bg-white/80 dark:bg-zinc-900/70 hover:bg-white dark:hover:bg-zinc-900 backdrop-blur-md border border-gray-200 dark:border-zinc-600 text-slate-600 dark:text-zinc-200 flex items-center justify-center shadow-sm transition-all hover:scale-110 active:scale-95 focus:outline-none focus:ring-2 focus:ring-[#C5A059]/50"
                                  >
                                    <ChevronLeft size={16} />
                                  </button>
                                  <span className="text-[10px] font-bold text-slate-400 dark:text-zinc-300 tabular-nums px-1">
                                    {safeIndex + 1}/{PROJECTS.length}
                                  </span>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); irASlide(safeIndex + 1); }}
                                    aria-label={t('dash.siguienteProyecto')}
                                    title={t('dash.siguienteProyecto')}
                                    className="w-8 h-8 rounded-full bg-white/80 dark:bg-zinc-900/70 hover:bg-white dark:hover:bg-zinc-900 backdrop-blur-md border border-gray-200 dark:border-zinc-600 text-slate-600 dark:text-zinc-200 flex items-center justify-center shadow-sm transition-all hover:scale-110 active:scale-95 focus:outline-none focus:ring-2 focus:ring-[#C5A059]/50"
                                  >
                                    <ChevronRight size={16} />
                                  </button>
                                </div>
                              )}
                              <div className="w-full bg-slate-100 dark:bg-zinc-700 rounded-full h-2.5 overflow-hidden">
                                <div
                                  className="bg-[#C5A059] rounded-full h-full transition-all duration-1000 ease-out"
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Fila de métricas inferior (con estilo del mock) */}
                        {/* 2 columnas hasta xl: en tablet, cuatro celdas en fila
                            dejaban ~90px cada una y el botón chocaba con la
                            fecha de entrega. */}
                        <div className="grid grid-cols-2 xl:grid-cols-4 items-center gap-x-4 gap-y-4 pt-4 border-t border-gray-100/80 dark:border-zinc-700/80">
                          <div className="min-w-0">
                            <p className="text-[11px] text-slate-400 dark:text-zinc-200 font-medium mb-0.5 truncate">{t('dash.inversionTotal')}</p>
                            <p className="text-base lg:text-lg font-bold text-slate-900 dark:text-white truncate">{formatMoney(fp.presupuesto_total)}</p>
                          </div>
                          <div className="min-w-0">
                            <p className="text-[11px] text-slate-400 dark:text-zinc-200 font-medium mb-0.5 truncate">{t('dash.ejecutado')}</p>
                            <p className="text-base lg:text-lg font-bold text-slate-900 dark:text-white truncate">
                              {formatMoney(fp.totalGastado)} <span className="text-xs text-slate-500 dark:text-zinc-200 font-normal">({pct.toFixed(0)}%)</span>
                            </p>
                          </div>
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="w-8 h-8 rounded-xl bg-slate-50 dark:bg-zinc-800 border border-gray-100 dark:border-zinc-700 flex items-center justify-center flex-shrink-0 text-slate-400 dark:text-zinc-200">
                              <Calendar size={15} />
                            </div>
                            <div className="min-w-0">
                              <p className="text-[11px] text-slate-400 dark:text-zinc-200 font-medium mb-0.5 truncate">{t('dash.entregaEstimada')}</p>
                              <p className="text-xs lg:text-sm font-bold text-slate-900 dark:text-white truncate">
                                {fp.fecha_entrega
                                  ? new Date(fp.fecha_entrega).toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' })
                                  : '30 Nov 2025'}
                              </p>
                            </div>
                          </div>
                          <div className="flex justify-end min-w-0">
                            <button
                              onClick={() => handleCardClick(fp)}
                              className="px-4 xl:px-5 py-2.5 bg-[#FAF4EA] dark:bg-amber-500/10 text-[#8B6914] dark:text-[#E3C77B] rounded-xl text-xs font-bold hover:bg-[#F3E7D3] dark:hover:bg-amber-500/20 transition-colors flex items-center gap-1 border border-[#F0E2CD] dark:border-amber-500/30 whitespace-nowrap"
                            >
                              {t('dash.verProyecto')} <ChevronRight size={14} className="flex-shrink-0" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Gráfica Sincronizada con el Carrusel Activo (PieChart / Donut) */}
                  <div className="bg-white dark:bg-zinc-800 rounded-[20px] shadow-[0_1px_8px_rgba(0,0,0,0.05)] border border-gray-100/80 dark:border-zinc-700/80 flex flex-col p-5 lg:p-6 justify-between">
                    <div>
                      <div className="flex justify-between items-center flex-wrap gap-x-2 gap-y-1 mb-2">
                        <h2 className="text-[11px] font-bold text-slate-900 dark:text-white tracking-[0.12em] uppercase min-w-0">{t('dash.avanceObra')}</h2>
                        <span className="text-[10px] font-extrabold bg-amber-50 dark:bg-amber-500/10 text-[#8B6914] dark:text-[#E3C77B] px-2.5 py-1 rounded-full border border-amber-200 dark:border-amber-500/30 uppercase whitespace-nowrap">
                          {t('dash.sincronizado')}
                        </span>
                      </div>
                      <p className="text-xs font-bold text-slate-800 dark:text-zinc-100 uppercase flex items-center gap-1 truncate mb-3">
                        <Building2 size={13} className="text-[#C5A059]" /> {fp ? fp.nombre : t('dash.proyectoActivo')}
                      </p>
                    </div>

                    <div className="h-52 lg:h-56 relative flex items-center justify-center">
                      {loading || !fp ? (
                        <div className="h-full flex items-center justify-center">
                          <div className="w-6 h-6 border-2 border-[#C5A059] border-t-transparent rounded-full animate-spin" />
                        </div>
                      ) : (
                        <>
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie
                                data={[
                                  { name: t('dash.ejecutado'), value: avanceProyectoActivo },
                                  { name: t('dash.pendiente'), value: Math.max(100 - avanceProyectoActivo, 0) }
                                ]}
                                cx="50%"
                                cy="50%"
                                innerRadius={60}
                                outerRadius={80}
                                startAngle={90}
                                endAngle={-270}
                                dataKey="value"
                                stroke="none"
                              >
                                <Cell key="cell-0" fill="#C5A059" />
                                <Cell key="cell-1" fill="#E2E8F0" />
                              </Pie>
                              <Tooltip formatter={(value) => [`${Number(value || 0).toFixed(0)}%`, t('dash.avanceFisico')]} />
                            </PieChart>
                          </ResponsiveContainer>
                          {/* Texto central en la dona */}
                          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                            <span className="text-2xl font-black text-slate-900 dark:text-white leading-none">
                              {avanceProyectoActivo}%
                            </span>
                            <span className="text-[10px] font-bold text-slate-400 dark:text-zinc-200 uppercase tracking-wider mt-0.5">{t('dash.avanceFisico')}</span>
                          </div>
                        </>
                      )}
                    </div>

                    {/* Leyenda Dinámica */}
                    {fp && (
                      <div className="pt-3 border-t border-gray-100 dark:border-zinc-700 space-y-2">
                        <div className="grid grid-cols-2 gap-2 text-center">
                          <div className="bg-amber-50/60 dark:bg-amber-500/10 p-2 rounded-xl border border-amber-100 dark:border-amber-500/25">
                            <p className="text-[10px] font-bold text-amber-900 dark:text-amber-200 uppercase">{t('dash.ejecutado')}</p>
                            <p className="text-sm font-black text-[#8B6914] dark:text-[#E3C77B]">{avanceProyectoActivo}%</p>
                          </div>
                          <div className="bg-slate-50 dark:bg-zinc-800 p-2 rounded-xl border border-gray-100 dark:border-zinc-700">
                            <p className="text-[10px] font-bold text-slate-500 dark:text-zinc-200 uppercase">{t('dash.pendiente')}</p>
                            <p className="text-sm font-black text-slate-700 dark:text-zinc-200">{100 - avanceProyectoActivo}%</p>
                          </div>
                        </div>
                        <p className="text-[10px] text-slate-400 dark:text-zinc-200 font-medium text-center">
                          {hitosTotales > 0
                            ? `${hitosHechos} / ${hitosTotales} ` + t('dash.hitosCompletados')
                            : t('dash.sinHitos')}
                        </p>
                      </div>
                    )}
                  </div>

                </div>
              </div>{/* fin hidden md:flex */}

              {/* ── Secciones inferiores desktop: Actividad | Hitos | Tareas ── */}
              <div className="hidden md:grid grid-cols-3 gap-6 px-8 pb-8 mt-2">

                {/* Actividad Reciente */}
                <div className="bg-white dark:bg-zinc-800 rounded-[20px] border border-gray-100/80 dark:border-zinc-700/80 shadow-sm p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-[11px] font-bold text-slate-900 dark:text-white tracking-[0.12em] uppercase">{t('dash.actividadReciente')}</h3>
                    <button
                      onClick={() => setModalLista('actividad')}
                      className="text-[10px] text-[#C5A059] font-semibold hover:underline"
                    >
                      {t('dash.verTodas')}
                    </button>
                  </div>
                  <div className="space-y-3">
                    {loading ? (
                      <p className="text-xs text-slate-400 dark:text-zinc-200">{t('comun.cargando')}</p>
                    ) : entradasActividad.length > 0 ? entradasActividad.slice(0, 4).map((e, i) => (
                      /* Cada movimiento viaja al proyecto al que pertenece */
                      <button
                        key={e.id ?? i}
                        onClick={() => abrirProyectoDeItem(e.proyecto)}
                        disabled={!e.proyecto}
                        title={e.proyecto ? t('dash.verProyecto') : undefined}
                        className="w-full text-left flex items-start gap-3 rounded-lg -mx-1 px-1 py-0.5 enabled:hover:bg-slate-50 dark:enabled:hover:bg-zinc-700/40 transition-colors"
                      >
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
                          e.icono === 'actividad' ? 'bg-emerald-50 dark:bg-emerald-500/10' : e.icono === 'documento' ? 'bg-blue-50 dark:bg-blue-500/10' : 'bg-amber-50 dark:bg-amber-500/10'
                        }`}>
                          {e.icono === 'actividad' ? <DollarSign size={11} className="text-emerald-500" /> :
                           e.icono === 'documento' ? <FileText size={11} className="text-blue-500" /> :
                           <Activity size={11} className="text-amber-500" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] font-semibold text-slate-800 dark:text-zinc-100 truncate">{e.titulo}</p>
                          {/* Se ve siempre a qué proyecto pertenece */}
                          <p className="text-[10px] text-slate-400 dark:text-zinc-200 truncate">
                            {e.proyectoNombre}{e.detalle ? ` · ${e.detalle}` : ''}
                          </p>
                        </div>
                        {e.valor && <span className="text-[10px] font-bold text-emerald-600 flex-shrink-0">+{e.valor}</span>}
                      </button>
                    )) : (
                      /* Sin datos reales se muestra el vacío, nunca ejemplos
                         agrupados que se confundan con movimientos verdaderos. */
                      <p className="text-xs text-slate-400 dark:text-zinc-300 py-4 text-center">{t('dash.sinActividad')}</p>
                    )}
                  </div>
                </div>

                {/* Próximos Hitos */}
                <div className="bg-white dark:bg-zinc-800 rounded-[20px] border border-gray-100/80 dark:border-zinc-700/80 shadow-sm p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-[11px] font-bold text-slate-900 dark:text-white tracking-[0.12em] uppercase">{t('dash.proximosHitos')}</h3>
                    <button
                      onClick={() => setModalLista('hitos')}
                      className="text-[10px] text-[#C5A059] font-semibold hover:underline"
                    >
                      {t('comun.verTodos')}
                    </button>
                  </div>
                  {/* El texto del hito NUNCA se recorta: baja de línea y la
                      tarjeta hace su propio scroll si crece demasiado. */}
                  <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
                    {loading ? (
                      <p className="text-xs text-slate-400 dark:text-zinc-200">{t('comun.cargando')}</p>
                    ) : entradasHitos.length > 0 ? entradasHitos.slice(0, 3).map((e, i) => (
                        /* Cada hito abre el proyecto que lo contiene */
                        <button
                          key={e.id ?? i}
                          onClick={() => abrirProyectoDeItem(e.proyecto)}
                          disabled={!e.proyecto}
                          title={e.proyecto ? t('dash.verProyecto') : undefined}
                          className="w-full text-left flex items-start gap-3 rounded-lg -mx-1 px-1 py-0.5 enabled:hover:bg-slate-50 dark:enabled:hover:bg-zinc-700/40 transition-colors"
                        >
                          <div className="w-6 h-6 rounded-full bg-slate-100 dark:bg-zinc-700 flex items-center justify-center flex-shrink-0 mt-0.5">
                            <MapPin size={11} className="text-slate-500 dark:text-zinc-200" />
                          </div>
                          <div className="flex-1 min-w-0">
                            {/* La columna real es `titulo`, no `tarea` */}
                            <p className="text-[11px] font-semibold text-slate-800 dark:text-zinc-100 whitespace-normal break-words leading-snug">{sinNumeracion(e.titulo)}</p>
                            {/* Nombre del proyecto, no su UUID */}
                            <p className="text-[10px] text-slate-400 dark:text-zinc-200 whitespace-normal break-words">{e.proyectoNombre}</p>
                          </div>
                          {e.valor && (
                            <span className={`text-[10px] font-bold flex-shrink-0 ${e.tono}`}>{e.valor}</span>
                          )}
                        </button>
                      )) : (
                        <p className="text-xs text-slate-400 dark:text-zinc-300 py-4 text-center">{t('dash.sinHitosPendientes')}</p>
                      )}
                  </div>
                </div>

                {/* Tareas Críticas */}
                <div className="bg-white dark:bg-zinc-800 rounded-[20px] border border-gray-100/80 dark:border-zinc-700/80 shadow-sm p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-[11px] font-bold text-slate-900 dark:text-white tracking-[0.12em] uppercase">{t('dash.tareasCriticas')}</h3>
                    <button
                      onClick={() => setModalLista('tareas')}
                      className="text-[10px] text-[#C5A059] font-semibold hover:underline"
                    >
                      {t('dash.verTodas')}
                    </button>
                  </div>
                  {/* Igual que los hitos: el texto de la tarea baja de línea
                      y la tarjeta hace su propio scroll si crece. */}
                  <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
                    {loading ? (
                      <p className="text-xs text-slate-400 dark:text-zinc-200">{t('comun.cargando')}</p>
                    ) : entradasTareas.length > 0 ? entradasTareas.slice(0, 3).map((e, i) => (
                      <button
                        key={e.id ?? i}
                        onClick={() => abrirProyectoDeItem(e.proyecto)}
                        disabled={!e.proyecto}
                        title={e.proyecto ? t('dash.verProyecto') : undefined}
                        className="w-full text-left flex items-start gap-3 rounded-lg -mx-1 px-1 py-0.5 enabled:hover:bg-slate-50 dark:enabled:hover:bg-zinc-700/40 transition-colors"
                      >
                        <div className="w-6 h-6 rounded-full bg-red-50 dark:bg-red-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <AlertTriangle size={11} className="text-red-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] font-semibold text-slate-800 dark:text-zinc-100 whitespace-normal break-words leading-snug">{sinNumeracion(e.titulo)}</p>
                          <p className="text-[10px] text-slate-400 dark:text-zinc-200 whitespace-normal break-words">
                            {e.proyectoNombre}{e.detalle ? ` · ${e.detalle}` : ''}
                          </p>
                        </div>
                        <span className="text-[9px] font-bold text-red-400 flex-shrink-0 bg-red-50 dark:bg-red-500/10 px-1.5 py-0.5 rounded">{e.valor}</span>
                      </button>
                    )) : (
                      /* Nada de "2 pagos pendientes": o hay tareas reales, una
                         por una, o se dice claramente que no hay ninguna. */
                      <p className="text-xs text-slate-400 dark:text-zinc-300 py-4 text-center">{t('dash.sinTareasCriticas')}</p>
                    )}
                  </div>
                </div>

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
      {/* Seis accesos en el ancho del teléfono: etiquetas cortas, tipografía
          más ceñida y sin separación lateral, para que ninguna se recorte ni
          se monte con la de al lado. */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 w-full bg-[#0B1B2C] dark:bg-zinc-900 border-t border-white/10 dark:border-zinc-800 flex items-stretch px-0.5 pt-2 z-50 safe-bottom shadow-[0_-4px_20px_rgba(0,0,0,0.18)]">
        {[
          { id: 'portfolio', label: t('nav.dashboardCorto'), icon: LayoutDashboard },
          { id: 'all-projects', label: t('nav.proyectos'), icon: Building2 },
          { id: 'investors', label: t('nav.inversionistasCorto'), icon: Briefcase },
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
              title={item.id === 'investors' ? t('nav.inversionistas') : item.label}
              className={`relative flex-1 min-w-0 flex flex-col items-center justify-start gap-1 px-0.5 py-1 rounded-xl transition-colors active:scale-95 ${
                active ? 'text-[#C5A059]' : 'text-white/55'
              }`}
            >
              <span className="relative">
                <Icon size={20} strokeWidth={active ? 2.4 : 2} />
                {/* Indicador de mensajes nuevos del canal "Socios" */}
                {item.badge && (
                  <span className="absolute -top-0.5 -right-1 w-2.5 h-2.5 rounded-full bg-red-500 border-2 border-[#0B1B2C] dark:border-zinc-900 animate-pulse" />
                )}
              </span>
              <span className="text-[8px] font-semibold tracking-tight leading-none w-full text-center">{item.label}</span>
              {active && <span className="absolute bottom-0 w-6 h-[2px] rounded-full bg-[#C5A059]" />}
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
