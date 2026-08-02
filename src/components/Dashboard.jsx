import React, { useState, useEffect, useRef } from 'react';
import { useProyectos } from '../hooks/useProyectos';
import { usePrefs } from '../context/PreferenciasContext';
import RecorteAvatar from './RecorteAvatar';
import InvestorsView from './InvestorsView';
import ChatModule from './ChatModule';
import { useChat } from '../context/ChatContext';
import {
  getUsuarios, crearUsuario, actualizarUsuario, eliminarUsuario as eliminarUsuarioDB
} from '../services/inversionesService';
import { etiquetaEstado } from '../i18n/diccionario';
import { etiquetaCategoria } from '../i18n/diccionario';
import ProjectDetails from './ProjectDetails';
import {
  Activity, AlertTriangle, ArrowUp, Bell, Bot, Building2, Briefcase, Calendar, Camera, CheckCircle2, ChevronDown,
  ChevronLeft, ChevronRight, Headset, Landmark, DollarSign, Download, Edit2, Edit3, ExternalLink, FileText, FolderLock, Globe,
  Layers, LayoutDashboard, Loader2, LogOut, MapPin, MessageSquare, Moon, Paperclip, Plus, Send, Settings,
  Save, Sparkles, Sun, Trash2, TrendingUp, Upload, UserCheck, Users, Wallet, X
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell
} from 'recharts';
import {
  uploadArchivoProyecto, getArchivosProyecto, subirAvatar, getAvatarUsuario, validarImagen,
  leerAvatarCache, guardarAvatarCache, subirPortadaProyecto
} from '../services/storageService';
import { supabase } from '../supabaseClient';
import {
  cambiarCorreo, cambiarPassword, leerDatosBancarios, guardarDatosBancarios,
  enviarReporte, getReportes
} from '../services/perfilService';

// ─── Vistas secundarias ───────────────────────────────────────────────────────

function VaultView({ userRole, onBack, isAdmin }) {
  const { t, locale } = usePrefs();
  const [corporateFiles, setCorporateFiles] = useState([
    {
      id: 'c1',
      nombre_archivo: 'Escritura_Constitucion_MM_Capital_SA_de_CV.pdf',
      categoria: 'Legal Corporativo',
      subido_por: 'Ing. Luis Panameño',
      created_at: '2024-01-15',
      url_archivo: '#'
    },
    {
      id: 'c2',
      nombre_archivo: 'Poder_Representacion_Legal_Firmado.pdf',
      categoria: 'Poderes Legales',
      subido_por: 'Ing. Luis Panameño',
      created_at: '2024-02-10',
      url_archivo: '#'
    },
    {
      id: 'c3',
      nombre_archivo: 'Registro_NIF_NIT_Corporativo_MMCapital.pdf',
      categoria: 'Fiscal y Tributario',
      subido_por: t('fb.administracion'),
      created_at: '2024-03-01',
      url_archivo: '#'
    },
    {
      id: 'c4',
      nombre_archivo: 'Estatutos_y_Reglamento_Interno_Socios_2025.pdf',
      categoria: 'Gobernanza / Socios',
      subido_por: 'Socio Director',
      created_at: '2025-01-05',
      url_archivo: '#'
    }
  ]);

  const [dbFiles, setDbFiles] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
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
      if (Array.isArray(list)) {
        setDbFiles(list);
      }
    } catch (e) {
      console.warn("Vault fetch warning:", e);
    }
  };

  useEffect(() => {
    loadVaultFiles();
  }, []);

  const handleUploadVaultDoc = async (e) => {
    e.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      alert(t('vault.seleccionaArchivo'));
      return;
    }

    setIsUploading(true);
    setUploadMsg(null);

    const res = await uploadArchivoProyecto(file, 'global_vault', 'documento_boveda');
    setIsUploading(false);

    if (res.success) {
      const newDoc = {
        id: Date.now(),
        nombre_archivo: newDocName || file.name,
        categoria: newDocCategory || t('fb.docCorporativo'),
        subido_por: 'Administrador',
        created_at: new Date().toISOString(),
        url_archivo: res.url
      };
      setCorporateFiles([newDoc, ...corporateFiles]);
      setUploadMsg({ type: 'success', text: t('msg.docRegistrado', { nombre: file.name }) });
      setNewDocName('');
      setShowUploadModal(false);
      setCambiosPendientes(true);
      await loadVaultFiles();
    } else {
      setUploadMsg({ type: 'error', text: res.error || t('msg.errorSupabase') });
    }

    setTimeout(() => setUploadMsg(null), 5000);
  };

  const handleSaveEditDoc = (e) => {
    e.preventDefault();
    if (!editingDoc) return;
    setCorporateFiles(prev => prev.map(f => f.id === editingDoc.id ? {
      ...f,
      nombre_archivo: editDocName || f.nombre_archivo,
      categoria: editDocCategory || f.categoria
    } : f));
    setEditingDoc(null);
  };

  const handleDeleteDoc = (docId) => {
    if (confirm(t('vault.confirmEliminar'))) {
      setCorporateFiles(prev => prev.filter(f => f.id !== docId));
      setCambiosPendientes(true);
    }
  };

  const allVaultDocs = [...dbFiles.map(f => ({
    id: f.id,
    nombre_archivo: f.nombre_archivo,
    categoria: t('fb.docEnStorage'),
    subido_por: t('fb.administracion'),
    created_at: f.created_at,
    url_archivo: f.url_archivo
  })), ...corporateFiles];

  const adminAccess = isAdmin || userRole === 'admin';

  return (
    <main className="flex-1 flex flex-col overflow-hidden bg-[#F5F6F8] dark:bg-zinc-900">
      {/* Header */}
      <div className="flex items-center justify-between px-6 md:px-8 py-5 border-b border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 shadow-sm flex-shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="w-8 h-8 rounded-full border border-gray-200 dark:border-zinc-700 flex items-center justify-center text-slate-400 dark:text-zinc-400 hover:text-slate-700 dark:hover:text-zinc-100 hover:border-gray-300 dark:hover:border-zinc-600 transition-all">
            <ChevronLeft size={18} />
          </button>
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-[#0B1B2C] flex items-center justify-center text-[#C5A059] shadow-sm">
              <FolderLock size={20} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">{t('vault.titulo')}</h2>
              <p className="text-xs text-slate-500 dark:text-zinc-400 font-medium">{t('vault.subtitulo')}</p>
            </div>
          </div>
        </div>

        {/* SOLO ADMINISTRADOR PUEDE SUBIR ARCHIVOS */}
        {adminAccess && (
          <button
            onClick={() => setShowUploadModal(true)}
            className="flex items-center gap-2 bg-[#0B1B2C] text-white text-xs md:text-sm font-bold px-4 py-2.5 rounded-xl hover:bg-slate-800 transition-colors shadow-sm"
          >
            <Upload size={16} className="text-[#C5A059]" /> {t('vault.subirDoc')}
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-6 md:p-8">
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
          <div className="bg-white dark:bg-zinc-800 rounded-3xl border border-gray-100 dark:border-zinc-700 shadow-sm p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 mb-4 border-b border-gray-100 dark:border-zinc-700">
              <h3 className="text-xs font-bold text-slate-400 dark:text-zinc-400 uppercase tracking-widest flex items-center gap-2">
                <FileText size={14} className="text-[#C5A059]" /> {t('vault.institucionales')} ({allVaultDocs.length})
              </h3>

              {/* Confirmación explícita tras subir o eliminar documentos */}
              {adminAccess && (
                <div className="flex items-center gap-2.5">
                  {cambiosPendientes && (
                    <span className="text-[11px] font-bold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 px-2.5 py-1 rounded-lg flex items-center gap-1.5">
                      <AlertTriangle size={12} /> {t('vault.cambiosPendientes')}
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
              {allVaultDocs.map((doc, idx) => (
                <div key={doc.id || idx} className="p-4 bg-slate-50/70 dark:bg-zinc-800/70 border border-gray-100 dark:border-zinc-700 rounded-2xl hover:bg-white dark:hover:bg-zinc-700 hover:shadow-md transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4 group">
                  <div className="flex items-start sm:items-center gap-3.5 flex-1 min-w-0">
                    <div className="w-11 h-11 rounded-xl bg-blue-50 dark:bg-blue-500/10 border border-blue-100 dark:border-blue-500/30 flex items-center justify-center flex-shrink-0 text-blue-600 dark:text-blue-400 mt-0.5 sm:mt-0">
                      <FileText size={20} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="text-sm font-bold text-slate-900 dark:text-white group-hover:text-[#C5A059] transition-colors truncate">{doc.nombre_archivo}</h4>
                      <div className="flex flex-wrap items-center gap-2 mt-1">
                        <span className="text-[10px] font-bold text-[#8B6914] dark:text-[#E3C77B] bg-[#FAF4EA] dark:bg-amber-500/10 px-2.5 py-0.5 rounded-full border border-[#F0E2CD] dark:border-amber-500/30">{etiquetaCategoria(doc.categoria, t)}</span>
                        <span className="text-[10px] text-slate-400 dark:text-zinc-400 font-medium">{t('vault.subido')} {new Date(doc.created_at || Date.now()).toLocaleDateString(locale)}</span>
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

                    {/* Editar / Eliminar (Solo Admin) */}
                    {adminAccess && (
                      <>
                        <button
                          onClick={() => {
                            setEditingDoc(doc);
                            setEditDocName(doc.nombre_archivo);
                            setEditDocCategory(doc.categoria || 'Legal Corporativo');
                          }}
                          className="p-2 text-slate-400 dark:text-zinc-400 hover:text-slate-700 dark:hover:text-zinc-100 bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl hover:bg-slate-50 dark:hover:bg-zinc-700/50 transition-colors"
                          title={t('vault.editarDoc')}
                        >
                          <Edit3 size={14} />
                        </button>
                        <button
                          onClick={() => handleDeleteDoc(doc.id)}
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
              <button onClick={() => setShowUploadModal(false)} className="text-slate-400 dark:text-zinc-400 hover:text-slate-700 dark:hover:text-zinc-100">
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
              <div className="pt-2 flex justify-end gap-2">
                <button type="button" onClick={() => setShowUploadModal(false)} className="px-4 py-2 text-xs font-bold text-slate-500 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-700 rounded-xl">
                  {t('comun.cancelar')}
                </button>
                <button
                  type="submit"
                  disabled={isUploading}
                  className="px-5 py-2 text-xs font-bold text-white bg-[#0B1B2C] hover:bg-slate-800 rounded-xl shadow-sm disabled:opacity-50 flex items-center gap-2"
                >
                  {isUploading ? <Loader2 size={14} className="animate-spin text-[#C5A059]" /> : <Upload size={14} className="text-[#C5A059]" />}
                  {t('vault.subirABoveda')}
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
              <button onClick={() => setEditingDoc(null)} className="text-slate-400 dark:text-zinc-400 hover:text-slate-700 dark:hover:text-zinc-100">
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
                <button type="button" onClick={() => setEditingDoc(null)} className="px-4 py-2 text-xs font-bold text-slate-500 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-700 rounded-xl">
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
        <button onClick={onBack} className="text-slate-400 dark:text-zinc-400 hover:text-slate-700 dark:hover:text-zinc-100 transition-colors">
          <ChevronLeft size={20} />
        </button>
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">{t('proyNuevo.titulo')}</h2>
      </div>
      <div className="flex-1 flex items-center justify-center">
        <p className="text-slate-500 dark:text-zinc-400 font-medium">{t('comun.moduloDesarrollo')}</p>
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
          <button onClick={onBack} className="text-slate-400 dark:text-zinc-400 hover:text-slate-700 dark:hover:text-zinc-100 transition-colors">
            <ChevronLeft size={20} />
          </button>
          <div className="flex items-center gap-2">
            <UserCheck size={20} className="text-[#C5A059]" />
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">{t('admin.titulo')}</h2>
              <p className="text-xs text-slate-400 dark:text-zinc-400 font-medium">{t('admin.subtitulo')} <span className="font-mono">usuarios</span> {t('admin.subtituloPost')}</p>
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
                <span className="text-[11px] font-semibold text-slate-400 dark:text-zinc-500 flex items-center gap-1.5">
                  <AlertTriangle size={12} /> {t('admin.activaEdicion')}
                </span>
              )}
            </div>

            {cargando ? (
              <div className="flex items-center justify-center gap-3 py-12 text-slate-400 dark:text-zinc-400">
                <Loader2 size={20} className="animate-spin text-[#C5A059]" />
                <span className="text-sm font-semibold">{t('admin.cargando')}</span>
              </div>
            ) : usuarios.length === 0 ? (
              <div className="border border-dashed border-gray-300 dark:border-zinc-600 rounded-2xl bg-slate-50/60 dark:bg-zinc-800/60 py-12 px-6 text-center">
                <Users size={28} className="text-slate-300 dark:text-zinc-400 mx-auto mb-3" />
                <p className="text-sm font-bold text-slate-600 dark:text-zinc-300">{t('msg.tablaVacia', { tabla: 'usuarios' })}</p>
                <p className="text-xs text-slate-400 dark:text-zinc-400 mt-1 max-w-md mx-auto">
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
                          <p className="text-xs text-slate-400 dark:text-zinc-400 truncate">{u.email || t('fb.sinCorreo')}</p>
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
                            className="p-2 text-slate-400 dark:text-zinc-400 hover:text-[#C5A059] rounded-xl hover:bg-amber-50 dark:hover:bg-amber-500/10 border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 transition-colors disabled:opacity-40"
                            title={t('admin.editarUsuario')}
                          >
                            <Edit2 size={15} />
                          </button>
                        )}

                        <button
                          onClick={() => handleEliminar(u)}
                          disabled={ocupado || esYo || !puedeEditar}
                          className="p-2 text-slate-300 dark:text-zinc-400 hover:text-red-500 rounded-xl hover:bg-red-50 border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 transition-colors disabled:opacity-30 disabled:hover:text-slate-300 disabled:hover:bg-white"
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
              <button onClick={() => setShowCrear(false)} className="text-slate-400 dark:text-zinc-400 hover:text-slate-700 dark:hover:text-white">
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

              <p className="text-[11px] text-slate-400 dark:text-zinc-500 leading-relaxed">
                {t('admin.avisoSinAuth')}
              </p>

              <div className="pt-2 flex justify-end gap-2">
                <button type="button" onClick={() => setShowCrear(false)} className="px-4 py-2.5 text-xs font-bold text-slate-500 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-700 rounded-xl">
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
              <button onClick={() => setEditando(null)} className="text-slate-400 dark:text-zinc-400 hover:text-slate-700 dark:hover:text-white">
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
                <button type="button" onClick={() => setEditando(null)} className="px-4 py-2.5 text-xs font-bold text-slate-500 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-700 rounded-xl">
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

function AIChatView({ onBack }) {
  const { t } = usePrefs();
  const [messages, setMessages] = useState([
    { sender: 'ai', clave: 'ia.saludo' }
  ]);
  const [inputMsg, setInputMsg] = useState('');

  const handleSend = (e) => {
    e.preventDefault();
    if (!inputMsg.trim()) return;
    const userMessage = inputMsg;
    setMessages(prev => [...prev, { sender: 'user', text: userMessage }]);
    setInputMsg('');

    setTimeout(() => {
      setMessages(prev => [...prev, {
        sender: 'ai',
        text: t('msg.iaRespuesta', { comando: userMessage })
      }]);
    }, 1000);
  };

  return (
    <main className="flex-1 flex flex-col overflow-hidden bg-[#F5F6F8] dark:bg-zinc-900">
      <div className="flex items-center justify-between px-8 py-5 border-b border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-slate-400 dark:text-zinc-400 hover:text-slate-700 dark:hover:text-zinc-100 transition-colors">
            <ChevronLeft size={20} />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-[#0B1B2C] flex items-center justify-center text-[#C5A059]">
              <Sparkles size={16} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">{t('ia.titulo')}</h2>
              <p className="text-xs text-slate-400 dark:text-zinc-400">{t('ia.subtitulo')}</p>
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
              {m.clave ? t(m.clave) : m.text}
            </div>
          </div>
        ))}
      </div>

      {/* Input */}
      <form onSubmit={handleSend} className="p-4 bg-white border-t border-gray-200 dark:border-zinc-700 max-w-4xl mx-auto w-full flex gap-3">
        <input
          type="text"
          value={inputMsg}
          onChange={(e) => setInputMsg(e.target.value)}
          placeholder={t('ia.placeholder')}
          className="flex-1 bg-slate-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-slate-400 focus:bg-white transition-colors text-slate-800 dark:text-zinc-100"
        />
        <button type="submit" className="bg-[#0B1B2C] text-white px-6 py-3 rounded-xl font-bold text-sm hover:bg-slate-800 transition-colors flex items-center gap-2">
          {t('comun.enviar')} <Send size={14} />
        </button>
      </form>
    </main>
  );
}

function AllProjectsView({ projects, onCardClick, onBack, isEditMode }) {
  const { t } = usePrefs();
  const statusColor = (estado) => {
    const e = (estado || '').toLowerCase();
    if (e.includes('ejecución') || e.includes('activo')) return 'bg-amber-50 dark:bg-amber-500/10 text-amber-600 border-amber-100 dark:border-amber-500/25';
    if (e.includes('entregado') || e.includes('completado')) return 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 border-emerald-100';
    return 'bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-100 dark:border-blue-500/30';
  };
  return (
    <main className="flex-1 flex flex-col overflow-hidden bg-[#F5F6F8] dark:bg-zinc-900">
      <div className="flex items-center gap-4 px-6 md:px-8 py-5 border-b border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800">
        <button onClick={onBack} className="w-8 h-8 rounded-full border border-gray-200 dark:border-zinc-700 flex items-center justify-center text-slate-400 dark:text-zinc-400 hover:text-slate-700 dark:hover:text-zinc-100 hover:border-gray-300 dark:hover:border-zinc-600 transition-all">
          <ChevronLeft size={18} />
        </button>
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">{t('proys.titulo')}</h2>
          <p className="text-[11px] text-slate-400 dark:text-zinc-400 font-medium">{t('proys.subtitulo')}</p>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-6 md:p-8">
        {!projects || projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <Building2 size={40} className="text-slate-200" />
            <p className="text-slate-400 dark:text-zinc-400 text-sm font-medium">{t('proys.vacio')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {projects.map(p => (
              <div
                key={p.id}
                onClick={() => onCardClick(p)}
                className="bg-white dark:bg-zinc-800 rounded-[20px] border border-gray-100 dark:border-zinc-700 shadow-sm p-5 cursor-pointer hover:shadow-[0_8px_32px_rgba(0,0,0,0.10)] transition-all group"
              >
                {p.imagen_url ? (
                  <div className="w-full h-36 rounded-xl overflow-hidden mb-4 bg-slate-100 dark:bg-zinc-700">
                    <img src={p.imagen_url} alt={p.nombre} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                  </div>
                ) : (
                  <div className="w-full h-36 rounded-xl mb-4 bg-slate-100 dark:bg-zinc-700 flex items-center justify-center">
                    <Building2 size={36} className="text-slate-300 dark:text-zinc-400" />
                  </div>
                )}
                <div className={`inline-flex px-2 py-0.5 rounded text-[9px] font-bold tracking-wider uppercase border mb-2 ${statusColor(p.estado)}`}>
                  {etiquetaEstado(p.estado, t) || t('fb.sinEstado')}
                </div>
                <h3 className="font-bold text-slate-900 dark:text-white text-sm mb-1 uppercase group-hover:text-[#C5A059] transition-colors">{p.nombre}</h3>
                <div className="mt-3 pt-3 border-t border-gray-100 dark:border-zinc-700 flex justify-between items-center">
                  <span className="text-[11px] text-slate-400 dark:text-zinc-400">{Number(p.porcentajeGastado || 0).toFixed(0)}% {t('dash.porcentajeEjecutado')}</span>
                  <ChevronRight size={14} className="text-slate-300 dark:text-zinc-400 group-hover:text-[#C5A059] transition-colors" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function ProfileView({ user, onLogout, onBack, isAdmin, onNavigate, avatarUrl, setAvatarUrl }) {
  const { t, locale } = usePrefs();
  const initials = user?.email ? user.email.substring(0, 2).toUpperCase() : 'LP';
  // ── Modales de cuenta ──
  const [modalSeguridad, setModalSeguridad] = useState(null);   // 'email' | 'password' | null
  const [formSeguridad, setFormSeguridad] = useState({ email: '', pass: '', pass2: '' });
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

  const handleGuardarSeguridad = async (e) => {
    e.preventDefault();
    setOcupadoPerfil(true);
    setAvisoPerfil(null);

    const r = modalSeguridad === 'email'
      ? await cambiarCorreo(formSeguridad.email)
      : await cambiarPassword(formSeguridad.pass, formSeguridad.pass2);

    setOcupadoPerfil(false);

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
        <button onClick={onBack} className="w-8 h-8 rounded-full border border-gray-200 dark:border-zinc-700 flex items-center justify-center text-slate-400 dark:text-zinc-400 hover:text-slate-700 dark:hover:text-zinc-100 hover:border-gray-300 dark:hover:border-zinc-600 transition-all">
          <ChevronLeft size={18} />
        </button>
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-slate-900 dark:text-white">{t('perfil.titulo')}</h2>
          <p className="text-xs text-slate-400 dark:text-zinc-400 font-medium">{t('perfil.subtitulo')}</p>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-6 md:p-10">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Avatar + Info (Clic directo en foto abre modal de edicion) */}
          <div className="bg-white dark:bg-zinc-800 rounded-[24px] border border-gray-100 dark:border-zinc-700 shadow-sm p-6 md:p-8 flex flex-col sm:flex-row items-center sm:items-start gap-6">
            <div className="relative cursor-pointer group" onClick={() => setShowAvatarModal(true)}>
              <div className="w-24 h-24 md:w-28 md:h-28 rounded-full bg-[#0B1B2C] border-4 border-[#C5A059] flex items-center justify-center shadow-md overflow-hidden transition-transform group-hover:scale-105">
                {avatarUrl ? (
                  <img src={avatarUrl} alt={t('perfil.fotoPerfil')} className="w-full h-full object-cover" />
                ) : (
                  <span className="text-[#C5A059] text-3xl md:text-4xl font-black tracking-widest">{initials}</span>
                )}
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); setShowAvatarModal(true); }}
                className="absolute bottom-0 right-0 w-8 h-8 bg-[#C5A059] rounded-full flex items-center justify-center shadow-lg hover:bg-[#B8963A] transition-colors"
                title={t('perfil.cambiarFotoTooltip')}
              >
                <Camera size={15} className="text-white" />
              </button>
            </div>
            <div className="text-center sm:text-left flex-1">
              <h3 className="text-xl md:text-2xl lg:text-3xl font-bold text-slate-900 dark:text-white">Ing. Luis Panameño</h3>
              <p className="text-[#C5A059] text-sm md:text-base font-bold mb-1.5">{t('rol.socioAdmin')}</p>
              <p className="text-slate-400 dark:text-zinc-400 text-sm font-medium">{user?.email || 'usuario@mmcapital.com'}</p>
              <div className="mt-4 flex flex-wrap gap-2 justify-center sm:justify-start">
                <span className="text-xs font-bold bg-amber-50 dark:bg-amber-500/10 text-[#8B6914] dark:text-[#E3C77B] px-3 py-1 rounded-full border border-amber-200 dark:border-amber-500/30">{t('perfil.rolAdmin')}</span>
                <span className="text-xs font-bold bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 px-3 py-1 rounded-full border border-emerald-200 dark:border-emerald-500/30">{t('perfil.estadoActivo')}</span>
              </div>
            </div>
          </div>

          {/* Opciones de Cuenta (Sin el botón redundante de Modificar Foto) */}
          <div className="bg-white dark:bg-zinc-800 rounded-[24px] border border-gray-100 dark:border-zinc-700 shadow-sm overflow-hidden">
            <div className="px-6 md:px-8 py-5 border-b border-gray-100 dark:border-zinc-700">
              <h4 className="text-xs font-bold text-slate-400 dark:text-zinc-400 uppercase tracking-widest">{t('perfil.seguridad')}</h4>
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
                  <p className="text-xs text-slate-400 dark:text-zinc-400">{t('perfil.cambiarCorreoDesc')}</p>
                </div>
              </div>
              <ChevronRight size={18} className="text-slate-300 dark:text-zinc-400" />
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
                  <p className="text-xs text-slate-400 dark:text-zinc-400">{t('perfil.cambiarPassDesc')}</p>
                </div>
              </div>
              <ChevronRight size={18} className="text-slate-300 dark:text-zinc-400" />
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
                  <p className="text-xs text-slate-400 dark:text-zinc-400">{t('perfil.datosBancariosDesc')}</p>
                </div>
              </div>
              <ChevronRight size={18} className="text-slate-300 dark:text-zinc-500 flex-shrink-0" />
            </button>

            {/* Soporte Ejecutivo */}
            <button
              onClick={() => { setMensajeSoporte(''); setModalSoporte(true); }}
              className="w-full flex items-center justify-between px-6 md:px-8 py-5 hover:bg-gray-50 dark:hover:bg-zinc-700/40 transition-colors"
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center">
                  <Headset size={18} className="text-emerald-500 dark:text-emerald-300" />
                </div>
                <div className="text-left">
                  <p className="text-base font-semibold text-slate-800 dark:text-zinc-100">{t('perfil.soporte')}</p>
                  <p className="text-xs text-slate-400 dark:text-zinc-400">{t('perfil.soporteDesc')}</p>
                </div>
              </div>
              <ChevronRight size={18} className="text-slate-300 dark:text-zinc-500 flex-shrink-0" />
            </button>
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
                    <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">{t('perfil.configUsuariosDesc')}</p>
                  </div>
                </div>
                <ChevronRight size={18} className="text-slate-300 dark:text-zinc-400 group-hover:text-[#C5A059] transition-colors" />
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
                    <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">{t('perfil.bandejaReportesDesc')}</p>
                  </div>
                </div>
                <ChevronRight size={18} className="text-slate-300 dark:text-zinc-400 group-hover:text-[#C5A059] transition-colors" />
              </button>

              {/* Botón 2: Chat de la IA para Administrador */}
              <button
                onClick={() => onNavigate && onNavigate('ai-chat')}
                className="w-full flex items-center justify-between px-6 md:px-8 py-5 hover:bg-amber-50/40 dark:hover:bg-amber-500/10 transition-colors border-b border-gray-100 dark:border-zinc-700 group"
              >
                <div className="flex items-center gap-4">
                  <div className="w-11 h-11 rounded-2xl bg-[#0B1B2C] flex items-center justify-center text-[#C5A059] shadow-sm">
                    <Sparkles size={20} />
                  </div>
                  <div className="text-left">
                    <p className="text-base font-bold text-slate-900 dark:text-white group-hover:text-[#C5A059] transition-colors">{t('perfil.chatIA')}</p>
                    <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">{t('perfil.chatIADesc')}</p>
                  </div>
                </div>
                <ChevronRight size={18} className="text-slate-300 dark:text-zinc-400 group-hover:text-[#C5A059] transition-colors" />
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
              <button onClick={() => setShowAvatarModal(false)} className="text-slate-400 dark:text-zinc-400 hover:text-slate-700 dark:hover:text-zinc-100">
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
                <p className="text-[11px] text-slate-400 dark:text-zinc-400 text-center">
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
                  className="px-4 py-2 text-xs font-bold text-slate-500 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-700 rounded-xl disabled:opacity-50"
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
              <button onClick={() => setModalSeguridad(null)} className="text-slate-400 dark:text-zinc-400 hover:text-slate-700 dark:hover:text-white"><X size={18} /></button>
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
                  <p className="text-[11px] text-slate-400 dark:text-zinc-500 mt-1.5 leading-relaxed">{t('perfil.avisoCorreo')}</p>
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
                  <p className="text-[11px] text-slate-400 dark:text-zinc-500">{t('perfil.minCaracteres')}</p>
                </>
              )}

              <div className="pt-2 flex justify-end gap-2">
                <button type="button" onClick={() => setModalSeguridad(null)} className="px-4 py-2.5 text-xs font-bold text-slate-500 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-700 rounded-xl">{t('comun.cancelar')}</button>
                <button type="submit" disabled={ocupadoPerfil} className="flex items-center gap-2 px-5 py-2.5 text-xs font-bold text-white bg-[#0B1B2C] hover:bg-slate-800 rounded-xl shadow-sm disabled:opacity-50">
                  {ocupadoPerfil && <Loader2 size={14} className="animate-spin text-[#C5A059]" />}
                  {t('comun.guardar')}
                </button>
              </div>
            </form>
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
              <button onClick={() => setModalBanco(false)} className="text-slate-400 dark:text-zinc-400 hover:text-slate-700 dark:hover:text-white"><X size={18} /></button>
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
                <button type="button" onClick={() => setModalBanco(false)} className="px-4 py-2.5 text-xs font-bold text-slate-500 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-700 rounded-xl">{t('comun.cancelar')}</button>
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
              <button onClick={() => setModalSoporte(false)} className="text-slate-400 dark:text-zinc-400 hover:text-slate-700 dark:hover:text-white"><X size={18} /></button>
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
                <p className="text-[11px] text-slate-400 dark:text-zinc-500 mt-1.5">
                  {mensajeSoporte.trim().length} {t('perfil.caracteres')}
                </p>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button type="button" onClick={() => setModalSoporte(false)} className="px-4 py-2.5 text-xs font-bold text-slate-500 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-700 rounded-xl">{t('comun.cancelar')}</button>
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
                <div className="w-10 h-10 rounded-2xl bg-[#0B1B2C] flex items-center justify-center text-[#C5A059]">
                  <Headset size={20} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">{t('perfil.bandejaReportes')}</h3>
                  <p className="text-xs text-slate-400 dark:text-zinc-400">{reportes.length} {t('perfil.reportesRecibidos')}</p>
                </div>
              </div>
              <button onClick={() => setModalReportes(false)} className="text-slate-400 dark:text-zinc-400 hover:text-slate-700 dark:hover:text-white"><X size={18} /></button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {cargandoReportes ? (
                <div className="flex items-center justify-center gap-3 py-14 text-slate-400 dark:text-zinc-400">
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
                  {reportes.map(r => (
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
                            <p className="text-[10px] text-slate-400 dark:text-zinc-500 truncate">{r.email}</p>
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
                      <p className="text-[10px] text-slate-400 dark:text-zinc-500 mt-2">
                        {r.fecha ? new Date(r.fecha).toLocaleString(locale) : ''}
                      </p>
                    </div>
                  ))}
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
    refetchData
  } = useProyectos(user);

  // Se hidrata de localStorage en el primer render: sin esto el avatar
  // desaparece en cada F5 mientras responde la consulta a `usuarios`.
  const [userAvatarUrl, setUserAvatarUrl] = useState(() => leerAvatarCache(user?.id));
  const [timeCST, setTimeCST] = useState('');
  const [timePDT, setTimePDT] = useState('');

  // Relojes digitales en tiempo real (El Salvador y costa oeste de EE. UU.)
  // Formato: solo hora y minuto, sin segundos ni sufijo de zona.
  useEffect(() => {
    const updateClocks = () => {
      const now = new Date();
      const cstStr = now.toLocaleTimeString('en-US', { timeZone: 'America/El_Salvador', hour: '2-digit', minute: '2-digit', hour12: true });
      const pdtStr = now.toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit', hour12: true });
      setTimeCST(cstStr);
      setTimePDT(pdtStr);
    };
    updateClocks();
    // Sin segundos en pantalla, basta con refrescar cada 15 s
    const interval = setInterval(updateClocks, 15000);
    return () => clearInterval(interval);
  }, []);

  const [currentView, setCurrentView] = useState('portfolio');
  const [activeProject, setActiveProject] = useState(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [featuredIndex, setFeaturedIndex] = useState(0);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const settingsRef = useRef(null);
  const portadaProyectoRef = useRef(null);

  // Espejo del canal "general": mismo estado que el módulo de Chat
  const { mensajesGeneral, enviarMensaje } = useChat();
  const [borradorSidebar, setBorradorSidebar] = useState('');
  const finChatSidebarRef = useRef(null);

  const handleEnviarSidebar = (e) => {
    e.preventDefault();
    if (enviarMensaje(borradorSidebar, 'general')) setBorradorSidebar('');
  };

  // Mantener el historial del sidebar pegado al último mensaje
  useEffect(() => {
    finChatSidebarRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [mensajesGeneral.length]);
  const [subiendoPortada, setSubiendoPortada] = useState(false);
  const [portadaMsg, setPortadaMsg] = useState(null);

  /** Cambia la imagen del proyecto destacado (solo en modo edición). */
  const handlePortadaProyecto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !fp?.id) return;

    setSubiendoPortada(true);
    setPortadaMsg(null);

    const { success, error } = await subirPortadaProyecto(file, fp.id);

    setSubiendoPortada(false);
    setPortadaMsg(success
      ? { tipo: 'exito', texto: t('dash.portadaActualizada') }
      : { tipo: 'error', texto: error });

    if (success) await refetchData();
    setTimeout(() => setPortadaMsg(null), 5000);
  };

  // Preferencias de interfaz (tema e idioma) compartidas por toda la app
  const { modoOscuro, alternarTema, language, alternarIdioma, t, locale } = usePrefs();

  // Cerrar el menú de ajustes al hacer clic fuera o al presionar Escape
  useEffect(() => {
    if (!showSettings) return;

    const alClicFuera = (e) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target)) setShowSettings(false);
    };
    const alEscape = (e) => { if (e.key === 'Escape') setShowSettings(false); };

    document.addEventListener('mousedown', alClicFuera);
    document.addEventListener('keydown', alEscape);
    return () => {
      document.removeEventListener('mousedown', alClicFuera);
      document.removeEventListener('keydown', alEscape);
    };
  }, [showSettings]);

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

  // 2. Sincronización con el botón "Atrás" del navegador (Popstate & History API)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initialView = params.get('view');
    if (initialView) {
      setCurrentView(initialView);
    }

    const handlePopState = (e) => {
      if (e.state && e.state.view) {
        setCurrentView(e.state.view);
        if (e.state.activeProject !== undefined) {
          setActiveProject(e.state.activeProject);
        }
      } else {
        const p = new URLSearchParams(window.location.search);
        setCurrentView(p.get('view') || 'portfolio');
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const changeView = (viewName, projectData = null) => {
    setCurrentView(viewName);
    if (projectData !== undefined) setActiveProject(projectData);
    const newUrl = viewName === 'portfolio' ? window.location.pathname : `${window.location.pathname}?view=${viewName}`;
    window.history.pushState({ view: viewName, activeProject: projectData }, '', newUrl);
  };

  // Usa los proyectos reales de Supabase
  const PROJECTS = proyectos;
  const safeIndex = PROJECTS.length > 0 ? featuredIndex % PROJECTS.length : 0;
  const fp = PROJECTS[safeIndex] || null;

  const statusColor = fp
    ? (fp.estado?.toLowerCase().includes('ejecución') || fp.estado?.toLowerCase().includes('activo')
        ? 'bg-amber-50 dark:bg-amber-500/10 text-amber-600 border-amber-100 dark:border-amber-500/25'
        : fp.estado?.toLowerCase().includes('entregado') || fp.estado?.toLowerCase().includes('completado')
        ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 border-emerald-100'
        : 'bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-100 dark:border-blue-500/30')
    : 'bg-slate-50 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 border-slate-100';

  // Gráfica: egresos mensuales reales desde Supabase con fallback progresivo
  const meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const now = new Date();
  const baseChartDefaults = [12000, 18000, 32000, 25000, 45000, 37000, 52000];
  const chartData = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 6 + i, 1);
    const mes = d.getMonth();
    const anio = d.getFullYear();
    const egresosReales = gastos
      .filter(g => {
        const fecha = new Date(g.fecha || g.created_at);
        return fecha.getMonth() === mes && fecha.getFullYear() === anio;
      })
      .reduce((sum, g) => sum + (Number(g.monto) || 0), 0);
    const finalVal = egresosReales > 0 ? egresosReales : baseChartDefaults[i];
    return { name: meses[mes], egresos: Math.round(finalVal) };
  });

  // Hitos pendientes reales: la columna es `completado` (bool), no `estado`
  const hitosPendientes = (Array.isArray(hitos) ? hitos : [])
    .filter(h => h && !h.completado)
    .sort((a, b) => {
      const fa = a.fecha_vencimiento ? new Date(a.fecha_vencimiento).getTime() : Infinity;
      const fb = b.fecha_vencimiento ? new Date(b.fecha_vencimiento).getTime() : Infinity;
      return fa - fb;
    })
    .slice(0, 3);

  /** Traduce un proyecto_id (uuid) a su nombre legible. */
  const nombreProyecto = (id) => {
    const p = PROJECTS.find(x => String(x.id) === String(id));
    return p?.nombre || t('inv.proyectoNoDisponible');
  };

  const handleCardClick = (proyecto) => {
    changeView('project-details', proyecto);
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
  const totalCapital = proyectos.reduce((s, p) => s + (Number(p.presupuesto_total) || 0), 0);

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
    <div className="flex h-screen overflow-hidden bg-[#0B1B2C] dark:bg-zinc-900">

      {/* ════════════════════════════════════════════════
          SIDEBAR IZQUIERDO (solo desktop)
      ════════════════════════════════════════════════ */}
      <aside className="w-[230px] lg:w-[270px] hidden md:flex flex-col h-screen overflow-hidden bg-[#050D15] dark:bg-zinc-900 border-r border-white/5 dark:border-zinc-800 flex-shrink-0">

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

        {/* Nav Links compactos: empujan el chat hacia arriba */}
        <nav className="px-2 pt-1.5 pb-1 flex-shrink-0 space-y-0.5">
          {navItems.map(item => {
            const Icon = item.icon;
            const active = currentView === item.id || (item.id === 'portfolio' && currentView === 'project-details');
            return (
              <button
                key={item.id}
                onClick={() => changeView(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-1.5 transition-all text-left ${
                  active
                    ? 'border-l-4 border-[#C5A059] text-[#C5A059] bg-[#C5A059]/10 rounded-r-xl font-bold'
                    : 'text-white/50 hover:text-white/90 hover:bg-white/5 border-l-4 border-transparent font-medium'
                }`}
              >
                <Icon size={16} className={active ? 'text-[#C5A059]' : 'text-white/40'} />
                <span className="text-sm tracking-wide flex-1 truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Chat Grupal: ocupa el alto sobrante y solo los mensajes hacen scroll.
            Fondo oscuro FIJO en ambos temas por decisión de diseño: no lleva
            variantes dark: porque no debe cambiar con el modo día/noche. */}
        <div className="mx-3 mt-1 mb-2 rounded-xl bg-zinc-800 border border-zinc-700 p-3.5 flex-1 min-h-0 flex flex-col overflow-hidden shadow-inner">
          <div className="flex-shrink-0">
            <div className="flex items-center gap-1.5 mb-1.5">
              <MessageSquare size={11} className="text-[#C5A059]" />
              <span className="text-[10px] font-bold text-white/70 tracking-wider uppercase">{t('nav.chatGrupal')}</span>
            </div>
            <div className="text-[9px] text-white/60 mb-2">{t('nav.equipoAdmin')}</div>
          </div>

          {/* Único elemento con scroll: el historial. El menú lateral no se mueve. */}
          <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1 my-1 [scrollbar-width:thin] [scrollbar-color:rgba(255,255,255,0.22)_transparent] [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-white/20 [&::-webkit-scrollbar-thumb]:rounded-full">
            {mensajesGeneral.map((m) => (
              <div key={m.id} className={`flex ${m.propio ? 'justify-end' : 'justify-start'}`}>
                <div className={`rounded-lg p-2 text-[9px] max-w-[95%] ${
                  m.propio
                    ? 'bg-blue-500/20 border border-blue-500/30 text-white/90'
                    : 'bg-white/10 text-white/80'
                }`}>
                  {!m.propio && <p className="text-[8px] font-bold text-[#C5A059] mb-0.5">{m.autor}</p>}
                  <p className="break-words">{m.claveTexto ? t(m.claveTexto) : m.texto}</p>
                </div>
              </div>
            ))}
            <div ref={finChatSidebarRef} />
          </div>

          <form onSubmit={handleEnviarSidebar} className="relative mt-2 flex-shrink-0">
            <input
              type="text"
              value={borradorSidebar}
              onChange={(e) => setBorradorSidebar(e.target.value)}
              placeholder={t('nav.enviarMensaje')}
              className="w-full bg-zinc-950 border border-zinc-700 rounded-lg py-1.5 pl-7 pr-7 text-[10px] text-white placeholder-white/30 focus:outline-none focus:border-[#C5A059] transition-colors"
            />
            <button type="button" className="absolute left-2 top-1/2 -translate-y-1/2 text-white/40 hover:text-[#C5A059] transition-colors" title={t('nav.adjuntar')}>
              <Paperclip size={11} />
            </button>
            <button type="submit" disabled={!borradorSidebar.trim()} className="absolute right-2 top-1/2 -translate-y-1/2 text-white/40 hover:text-white transition-colors disabled:opacity-30">
              <Send size={10} />
            </button>
          </form>
        </div>

        {/* Perfil del Usuario en el Sidebar (Clic redirige a Perfil) */}
        <div
          onClick={() => changeView('profile')}
          className="px-4 py-2.5 border-t border-white/5 flex-shrink-0 bg-[#071320]/60 cursor-pointer hover:bg-[#071320] transition-colors group"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-slate-800 border border-[#C5A059] flex items-center justify-center flex-shrink-0 overflow-hidden">
              {userAvatarUrl ? (
                <img src={userAvatarUrl} alt="Avatar" className="w-full h-full object-cover" />
              ) : (
                <span className="text-white text-xs font-bold tracking-wider">LP</span>
              )}
            </div>
            <div className="flex flex-col overflow-hidden">
              <span className="text-white text-[12px] font-bold truncate group-hover:text-[#C5A059] transition-colors">Ing. Luis Panameño</span>
              <span className="text-[#C5A059] text-[10px] font-semibold truncate">{t('rol.socioAdmin')}</span>
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
            <p className="text-xs text-slate-500 dark:text-zinc-400 font-normal tracking-wide">{t('dash.gestionInmob')}</p>
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
            <div className="hidden lg:flex items-center gap-3 text-xs font-semibold tracking-widest text-slate-500 dark:text-zinc-400 bg-slate-50 dark:bg-zinc-900 px-4 py-2 rounded-full border border-gray-200 dark:border-zinc-700 uppercase">
              <span className="flex items-center gap-1.5">SV <span className="text-sm text-slate-900 dark:text-white font-bold tracking-wide">{timeCST || '--:--'}</span></span>
              <span className="text-gray-300 dark:text-zinc-600">|</span>
              <span className="flex items-center gap-1.5">US <span className="text-sm text-slate-900 dark:text-white font-bold tracking-wide">{timePDT || '--:--'}</span></span>
            </div>

            {/* Campana de notificaciones */}
            <div className="relative">
              <button
                onClick={() => { setShowNotifications(!showNotifications); setShowSettings(false); }}
                className="text-slate-500 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-white transition-colors relative p-1"
              >
                <Bell size={20} />
                {notificaciones && notificaciones.length > 0 && (
                  <div className="absolute top-0 right-0 w-2 h-2 bg-red-500 rounded-full border-2 border-white animate-pulse"></div>
                )}
              </button>
              {showNotifications && (
                <div className="absolute top-10 right-0 w-80 bg-white rounded-xl shadow-xl border border-gray-100 dark:border-zinc-700 z-50 overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-100 dark:border-zinc-700 flex justify-between items-center bg-gray-50 dark:bg-zinc-800">
                    <span className="text-xs font-bold text-slate-800 dark:text-zinc-100">{t('notif.titulo')}</span>
                    <span className="text-[10px] text-[#C5A059] font-semibold cursor-pointer">{t('notif.marcarLeidas')}</span>
                  </div>
                  <div className="max-h-60 overflow-y-auto">
                    {notificaciones && notificaciones.length > 0 ? notificaciones.map(n => (
                      <button
                        key={n.id}
                        onClick={() => abrirNotificacion(n)}
                        className="w-full text-left px-4 py-3 border-b border-gray-50 dark:border-zinc-700 hover:bg-gray-50 dark:hover:bg-zinc-700/50 cursor-pointer transition-colors"
                      >
                        <p className="text-[11px] font-bold text-red-500 flex items-center gap-1.5"><AlertTriangle size={12} /> {t('notif.vencimientoCritico')}</p>
                        <p className="text-[10px] text-slate-500 dark:text-zinc-400 mt-0.5">
                          {t('notif.tareaProyecto', { tarea: n.tarea, proyecto: n.proyectoNombre || t('inv.proyectoNoDisponible') })}
                        </p>
                        <p className="text-[9px] text-slate-400 dark:text-zinc-400 mt-1">{t('notif.vence')} {n.fecha_vencimiento}</p>
                      </button>
                    )) : (
                      <div className="px-4 py-3 text-center text-xs text-slate-500 dark:text-zinc-400">{t('notif.sinNotificaciones')}</div>
                    )}
                  </div>
                  <div className="px-4 py-2 border-t border-gray-100 dark:border-zinc-700 text-center bg-gray-50 dark:bg-zinc-800">
                    <span className="text-[10px] font-semibold text-slate-500 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-white cursor-pointer">{t('dash.verTodas')}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Ajustes */}
            <div className="relative" ref={settingsRef}>
              <button
                onClick={() => { setShowSettings(!showSettings); setShowNotifications(false); }}
                aria-haspopup="menu"
                aria-expanded={showSettings}
                title={t('pref.config')}
                className={`p-1 rounded-lg transition-colors ${
                  showSettings
                    ? 'text-[#C5A059] bg-amber-50 dark:bg-amber-500/10 dark:bg-white/10'
                    : 'text-slate-500 dark:text-zinc-400 hover:text-slate-800 dark:text-zinc-300 dark:hover:text-white'
                }`}
              >
                <Settings size={20} />
              </button>

              {showSettings && (
                <div
                  role="menu"
                  className="absolute top-10 right-0 w-60 bg-white dark:bg-zinc-800 rounded-xl shadow-xl border border-gray-100 dark:border-zinc-700 z-50 overflow-hidden"
                >
                  <div className="px-4 pt-3 pb-2">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 dark:text-zinc-400 dark:text-white/40">
                      {t('pref.titulo')}
                    </p>
                  </div>

                  <div className="pb-1">
                    {/* ── Modo Oscuro / Modo Claro ── */}
                    <button
                      role="menuitem"
                      onClick={alternarTema}
                      className="w-full px-4 py-2.5 text-left text-[11px] font-semibold text-slate-700 dark:text-zinc-200 dark:text-white/80 hover:bg-gray-50 dark:hover:bg-zinc-700/50 dark:hover:bg-white/5 hover:text-[#C5A059] dark:hover:text-[#C5A059] transition-colors flex items-center justify-between gap-2"
                    >
                      <span className="flex items-center gap-2">
                        {modoOscuro
                          ? <Sun size={14} className="text-[#C5A059]" />
                          : <Moon size={14} className="text-slate-400 dark:text-zinc-400 dark:text-white/40" />}
                        {modoOscuro ? t('pref.modoClaro') : t('pref.modoOscuro')}
                      </span>
                      {/* Interruptor visual */}
                      <span
                        aria-hidden="true"
                        className={`w-8 h-4 rounded-full flex items-center px-0.5 transition-colors flex-shrink-0 ${
                          modoOscuro ? 'bg-[#C5A059] justify-end' : 'bg-slate-200 justify-start'
                        }`}
                      >
                        <span className="w-3 h-3 rounded-full bg-white dark:bg-zinc-800 shadow-sm" />
                      </span>
                    </button>

                    {/* ── Idioma ── */}
                    <button
                      role="menuitem"
                      onClick={alternarIdioma}
                      className="w-full px-4 py-2.5 text-left text-[11px] font-semibold text-slate-700 dark:text-zinc-200 dark:text-white/80 hover:bg-gray-50 dark:hover:bg-zinc-700/50 dark:hover:bg-white/5 hover:text-[#C5A059] dark:hover:text-[#C5A059] transition-colors flex items-center justify-between gap-2"
                    >
                      <span className="flex items-center gap-2">
                        <Globe size={14} className="text-slate-400 dark:text-zinc-400 dark:text-white/40" />
                        {language === 'es' ? t('pref.verIngles') : t('pref.verEspanol')}
                      </span>
                      <span className="text-[9px] font-black tracking-widest text-slate-400 dark:text-zinc-400 dark:text-white/40 border border-gray-200 dark:border-white/15 rounded px-1.5 py-0.5 flex-shrink-0">
                        {language.toUpperCase()}
                      </span>
                    </button>
                  </div>

                  <div className="border-t border-gray-100 dark:border-zinc-700 dark:border-white/10 py-1">
                    {/* Las opciones de administrador viven solo en Mi Perfil */}
                    <button
                      role="menuitem"
                      onClick={() => { changeView('profile'); setShowSettings(false); }}
                      className="w-full px-4 py-2.5 text-left text-[11px] font-semibold text-slate-700 dark:text-zinc-200 dark:text-white/80 hover:bg-gray-50 dark:hover:bg-zinc-700/50 dark:hover:bg-white/5 hover:text-[#C5A059] dark:hover:text-[#C5A059] transition-colors flex items-center gap-2"
                    >
                      <Users size={14} className="text-slate-400 dark:text-zinc-400 dark:text-white/40" /> {t('pref.miPerfil')}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Avatar NAVEGA A PERFIL (NUNCA cierra sesión) */}
            <button
              onClick={() => changeView('profile')}
              title="Ir a Mi Perfil"
              className="flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-zinc-700 px-2 py-1 rounded-xl transition-colors ml-1 border border-transparent hover:border-gray-200"
            >
              <div className="w-10 h-10 bg-[#0B1B2C] rounded-full flex items-center justify-center border-2 border-[#C5A059] shadow-sm overflow-hidden">
                {userAvatarUrl ? (
                  <img src={userAvatarUrl} alt="Avatar" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-[12px] font-bold text-white tracking-wider">LP</span>
                )}
              </div>
              <ChevronDown size={14} className="text-slate-400 dark:text-zinc-400" />
            </button>
          </div>
        </header>

        {/* ── ÁREA DINÁMICA DE VISTAS ── */}
        <div className="flex-1 flex flex-col overflow-hidden relative">
          {currentView === 'project-details' && activeProject ? (
            <ProjectDetails project={activeProject} onBack={handleBack} userRole={rol} isEditMode={isEditMode} onUpdateProject={refetchData} />
          ) : currentView === 'vault' ? (
            <VaultView userRole={rol} onBack={handleBack} />
          ) : currentView === 'investors' ? (
            <InvestorsView
              onBack={handleBack}
              proyectos={PROJECTS}
              onAbrirProyecto={(p) => changeView('project-details', p)}
              isEditMode={isEditMode}
              isAdmin={isAdmin}
            />
          ) : currentView === 'chat' ? (
            <ChatModule onBack={handleBack} usuarioNombre={user?.email?.split('@')[0] || 'Luis Panameño'} />
          ) : currentView === 'admin-users' ? (
            <AdminUsersView onBack={handleBack} currentUserId={user?.id} isEditMode={isEditMode} isAdmin={isAdmin} />
          ) : currentView === 'ai-chat' ? (
            <AIChatView onBack={handleBack} />
          ) : currentView === 'new-project' ? (
            <NewProjectView onBack={handleBack} />
          ) : currentView === 'all-projects' ? (
            <AllProjectsView projects={PROJECTS} onCardClick={handleCardClick} onBack={handleBack} isEditMode={isEditMode} />
          ) : currentView === 'profile' ? (
            <ProfileView user={user} onLogout={onLogout} onBack={handleBack} isAdmin={isAdmin} onNavigate={changeView} avatarUrl={userAvatarUrl} setAvatarUrl={setUserAvatarUrl} />
          ) : (
            /* ── Vista Portfolio (Principal) ── */
            <main className="flex-1 flex flex-col overflow-hidden bg-[#F5F6F8] dark:bg-zinc-900">

              {/* ── Mobile Top Bar (solo mobile) ── */}
              <div className="md:hidden flex items-center justify-between px-4 py-3 bg-[#0B1B2C] dark:bg-zinc-900 text-white border-b border-white/5 dark:border-zinc-800">
                <div className="flex items-center gap-1.5">
                  <div className="h-10 flex items-center justify-center">
                    <img
                      src="/logo1.png"
                      alt="MM Capital"
                      className="h-full w-auto object-contain"
                      style={{ filter: 'brightness(0) invert(1)' }}
                    />
                  </div>
                  <div className="flex flex-col justify-center ml-1">
                    <span className="text-[13px] font-bold leading-none tracking-wide text-white">{t('dash.panelSocios')}</span>
                    <span className="text-[9px] text-white/60 font-medium leading-none mt-[2px]">{t('dash.gestionInmobMin')}</span>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="relative">
                    <Bell size={20} className="text-white" />
                    {notificaciones && notificaciones.length > 0 && (
                      <span className="absolute top-0 right-0 w-2 h-2 bg-amber-500 rounded-full border border-[#0B1B2C]"></span>
                    )}
                  </div>
                  <button onClick={() => changeView('profile')} className="w-9 h-9 rounded-full border border-[#C5A059] flex items-center justify-center bg-transparent">
                    <span className="text-[12px] font-bold text-[#C5A059] tracking-wider">LP</span>
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto custom-scrollbar w-full pb-20 bg-[#F8FAFC] dark:bg-zinc-900">

                {/* ── Header móvil (solo mobile) ── */}
                <header className="md:hidden px-4 pt-6 pb-4 flex flex-row justify-between items-start w-full">
                  <div className="text-left">
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight leading-tight">
                      {t('dash.saludo')}<br />
                      <span className="text-[#C5A059]">Ing. Luis Panameño</span>
                    </h1>
                    <p className="text-slate-500 dark:text-zinc-400 text-sm mt-1.5 font-medium">
                      {t('dash.panelEjecutivo')}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] font-bold tracking-widest text-slate-700 dark:text-zinc-200 bg-white dark:bg-zinc-800 px-3 py-2 rounded-xl border border-gray-100 dark:border-zinc-700 shadow-sm uppercase">
                    <span>ES | EN</span>
                    <ChevronDown size={14} className="text-slate-400 dark:text-zinc-400" />
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
                          <p className="text-[9px] text-white/50">{t('dash.resumenSub')}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-400"></div>
                        <span className="text-[9px] text-white/60">{t('dash.enLinea')}</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-4 gap-1.5 pb-1 mt-2">
                      <div className="bg-[#16273B] dark:bg-zinc-700 rounded-xl p-2 flex flex-col items-center justify-center text-center border border-white/5 dark:border-zinc-600">
                        <div className="w-5 h-5 rounded-full border border-[#C5A059]/30 flex items-center justify-center mb-1.5">
                          <Building2 size={10} className="text-[#C5A059]" />
                        </div>
                        <p className="text-sm font-bold mb-0.5">{loading ? '–' : PROJECTS.length}</p>
                        <p className="text-[7px] text-white/60 mb-1 leading-tight">{t('dash.proyectosActivos')}</p>
                      </div>
                      <div className="bg-[#16273B] dark:bg-zinc-700 rounded-xl p-2 flex flex-col items-center justify-center text-center border border-white/5 dark:border-zinc-600">
                        <div className="w-5 h-5 rounded-full border border-[#C5A059]/30 flex items-center justify-center mb-1.5">
                          <DollarSign size={10} className="text-[#C5A059]" />
                        </div>
                        <p className="text-sm font-bold mb-0.5">{loading ? '–' : formatMoney(totalCapital)}</p>
                        <p className="text-[7px] text-white/60 mb-1 leading-tight">{t('dash.capitalTotal')}</p>
                      </div>
                      <div className="bg-[#16273B] dark:bg-zinc-700 rounded-xl p-2 flex flex-col items-center justify-center text-center border border-white/5 dark:border-zinc-600">
                        <div className="w-5 h-5 rounded-full border border-[#C5A059]/30 flex items-center justify-center mb-1.5">
                          <PieChart size={10} className="text-[#C5A059]" />
                        </div>
                        <p className="text-sm font-bold mb-0.5">{loading ? '–' : `${avanceProm}%`}</p>
                        <p className="text-[7px] text-white/60 mb-1 leading-tight">{t('dash.avancePromedioMin')}</p>
                        {!loading && <span className="text-[7px] text-emerald-400 flex items-center gap-0.5 font-medium"><ArrowUp size={6} /> {t('dash.ejecAbrev')}</span>}
                      </div>
                      <div className="bg-[#16273B] dark:bg-zinc-700 rounded-xl p-2 flex flex-col items-center justify-center text-center border border-white/5 dark:border-zinc-600">
                        <div className="w-5 h-5 rounded-full border border-[#C5A059]/30 flex items-center justify-center mb-1.5">
                          <Wallet size={10} className="text-[#C5A059]" />
                        </div>
                        <p className="text-sm font-bold mb-0.5">{loading ? '–' : formatMoney(flujoMes)}</p>
                        <p className="text-[7px] text-white/60 mb-1 leading-tight">{t('dash.egresosMes')}</p>
                      </div>
                    </div>
                  </div>

                  {/* Botones de acción (móvil) */}
                  <div className="md:hidden px-0 mt-4 grid grid-cols-2 gap-3">
                    <button
                      onClick={() => changeView('new-project')}
                      className="flex items-center justify-center gap-1.5 bg-[#0B1B2C] text-white rounded-lg py-2.5 text-xs font-semibold shadow-md active:scale-95 transition-transform"
                    >
                      <Plus size={14} className="text-[#9A7B4F]" /> {t('proyNuevo.titulo')}
                    </button>
                    <button
                      onClick={() => changeView('all-projects')}
                      className="flex items-center justify-center gap-1.5 bg-white dark:bg-zinc-800 text-slate-700 dark:text-zinc-200 border border-gray-200 dark:border-zinc-700 rounded-lg py-2.5 text-xs font-semibold shadow-sm active:scale-95 transition-transform"
                    >
                      <Layers size={14} className="text-slate-400 dark:text-zinc-400" /> {t('proys.titulo')}
                    </button>
                  </div>
{/* ── Desktop: Saludo + KPIs ── */}
                  <div className="hidden md:flex flex-col w-full">
                    <div className="px-8 mt-6 mb-8">
                      {/* El reloj dual se movió al header superior; este bloque
                          ya no necesita ser flex de dos columnas. */}
                      <div className="mb-8">
                        <h1 className="text-[32px] lg:text-4xl font-bold text-slate-900 dark:text-white tracking-tight leading-tight">
                          {t('dash.saludo')} <span className="text-[#C5A059]">Ing. Luis Panameño</span>
                        </h1>
                        <p className="text-slate-500 dark:text-zinc-400 text-sm mt-1 font-medium flex items-center gap-2">
                          {t('dash.panelEjec')} <span className="text-slate-300 dark:text-zinc-400">•</span> {t('dash.accesoSocios')}
                        </p>
                      </div>

                  {/* 4 Tarjetas KPI desktop */}
                  <div className="grid grid-cols-4 gap-5 lg:gap-6">
                    {/* KPI 1 */}
                    <div className="bg-white dark:bg-zinc-800 rounded-[20px] p-4 lg:p-5 xl:p-8 border border-gray-100/80 dark:border-zinc-700/80 shadow-[0_4px_24px_rgba(0,0,0,0.09)] flex items-center gap-4 hover:shadow-[0_8px_32px_rgba(0,0,0,0.13)] transition-shadow">
                      <div className="w-[44px] h-[44px] rounded-full bg-[#0B1B2C] flex items-center justify-center flex-shrink-0">
                        <Building2 size={18} className="text-[#C5A059]" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] text-slate-400 dark:text-zinc-400 font-bold tracking-widest uppercase mb-1 truncate">{t('dash.proyectosActivosMay')}</p>
                        <p className="text-lg lg:text-xl xl:text-[28px] font-bold text-slate-900 dark:text-white mb-0.5 leading-none">
                          {loading ? '–' : (PROJECTS.length || 3)}
                        </p>
                        <p className="text-slate-400 dark:text-zinc-400 text-[10px] font-medium flex items-center gap-1 mt-1.5 truncate">
                          {t('dash.enPortafolio')}
                        </p>
                      </div>
                    </div>
                    {/* KPI 2 */}
                    <div className="bg-white dark:bg-zinc-800 rounded-[20px] p-4 lg:p-5 xl:p-8 border border-gray-100/80 dark:border-zinc-700/80 shadow-[0_4px_24px_rgba(0,0,0,0.09)] flex items-center gap-4 hover:shadow-[0_8px_32px_rgba(0,0,0,0.13)] transition-shadow">
                      <div className="w-[44px] h-[44px] rounded-full bg-[#0B1B2C] flex items-center justify-center flex-shrink-0">
                        <DollarSign size={18} className="text-[#C5A059]" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] text-slate-400 dark:text-zinc-400 font-bold tracking-widest uppercase mb-1 truncate">{t('dash.capitalTotalMay')}</p>
                        <p className="text-lg lg:text-xl xl:text-[28px] font-bold text-slate-900 dark:text-white mb-0.5 leading-none">
                          $1M
                        </p>
                        <p className="text-emerald-500 text-[10px] font-bold flex items-center gap-1 mt-1.5">
                          <ArrowUp size={10} /> <span className="text-slate-400 dark:text-zinc-400 font-medium">{t('dash.presupuestado')}</span>
                        </p>
                      </div>
                    </div>
                    {/* KPI 3 */}
                    <div className="bg-white dark:bg-zinc-800 rounded-[20px] p-4 lg:p-5 xl:p-8 border border-gray-100/80 dark:border-zinc-700/80 shadow-[0_4px_24px_rgba(0,0,0,0.09)] flex items-center gap-4 hover:shadow-[0_8px_32px_rgba(0,0,0,0.13)] transition-shadow">
                      <div className="w-[44px] h-[44px] rounded-full bg-[#0B1B2C] flex items-center justify-center flex-shrink-0">
                        <TrendingUp size={18} className="text-[#C5A059]" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] text-slate-400 dark:text-zinc-400 font-bold tracking-widest uppercase mb-1 truncate">{t('dash.avancePromedio')}</p>
                        <p className="text-lg lg:text-xl xl:text-[28px] font-bold text-slate-900 dark:text-white mb-0.5 leading-none">
                          {loading ? '–' : `${avanceProm}%`}
                        </p>
                        <p className="text-emerald-500 text-[10px] font-bold flex items-center gap-1 mt-1.5">
                          <ArrowUp size={10} /> <span className="text-slate-400 dark:text-zinc-400 font-medium">{t('dash.avanceSufijo')}</span>
                        </p>
                      </div>
                    </div>
                    {/* KPI 4 */}
                    <div className="bg-white dark:bg-zinc-800 rounded-[20px] p-4 lg:p-5 xl:p-8 border border-gray-100/80 dark:border-zinc-700/80 shadow-[0_4px_24px_rgba(0,0,0,0.09)] flex items-center gap-4 hover:shadow-[0_8px_32px_rgba(0,0,0,0.13)] transition-shadow">
                      <div className="w-[44px] h-[44px] rounded-full bg-[#0B1B2C] flex items-center justify-center flex-shrink-0">
                        <Wallet size={18} className="text-[#C5A059]" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] text-slate-400 dark:text-zinc-400 font-bold tracking-widest uppercase mb-1 truncate">{t('dash.egresosTotales')}</p>
                        <p className="text-lg lg:text-xl xl:text-[28px] font-bold text-slate-900 dark:text-white mb-0.5 leading-none">
                          $37,000
                        </p>
                        <p className="text-slate-400 dark:text-zinc-400 text-[10px] font-medium flex items-center gap-1 mt-1.5 truncate">
                          {t('dash.ejecutadosReales')}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* ── Layout central: Proyecto Destacado + Gráfica ── */}
                <div className="px-8 grid grid-cols-[1.2fr_1fr] lg:grid-cols-[1.5fr_1fr] gap-7 mb-7">

                  {/* Proyecto Destacado */}
                  {(() => {
                    if (loading) return (
                      <div className="bg-white dark:bg-zinc-800 rounded-[24px] border border-gray-100 dark:border-zinc-700 p-6 flex items-center justify-center min-h-[340px] shadow-sm">
                        <div className="flex flex-col items-center gap-3">
                          <div className="w-8 h-8 border-2 border-[#C5A059] border-t-transparent rounded-full animate-spin" />
                          <p className="text-slate-400 dark:text-zinc-400 text-xs">{t('dash.cargandoProyectos')}</p>
                        </div>
                      </div>
                    );
                    if (!fp) return (
                      <div className="bg-white dark:bg-zinc-800 rounded-[24px] border border-gray-100 dark:border-zinc-700 p-6 flex items-center justify-center min-h-[340px] shadow-sm">
                        <div className="text-center">
                          <Building2 size={40} className="text-slate-200 mx-auto mb-3" />
                          <p className="text-slate-400 dark:text-zinc-400 text-sm font-medium">{t('dash.sinProyectos')}</p>
                          <p className="text-slate-300 dark:text-zinc-400 text-xs mt-1">{t('dash.verificaConexion')}</p>
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

                        {/* Contenido Principal: Imagen + Detalles con transición suave */}
                        <div className="flex gap-5 mb-5">
                          {/* Selector de portada del proyecto (modo edición) */}
                          <input
                            type="file"
                            ref={portadaProyectoRef}
                            onChange={handlePortadaProyecto}
                            accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
                            className="hidden"
                          />

                          {/* Imagen Grande */}
                          <div
                            onClick={() => handleCardClick(fp)}
                            className="w-[42%] rounded-2xl overflow-hidden flex-shrink-0 cursor-pointer group bg-slate-100 dark:bg-zinc-700 h-[190px] lg:h-[220px] relative shadow-sm"
                          >
                            {fp.imagen_url ? (
                              <img
                                src={fp.imagen_url}
                                alt={fp.nombre}
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 ease-out"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center bg-slate-100 dark:bg-zinc-700">
                                <Building2 size={48} className="text-slate-300 dark:text-zinc-400" />
                              </div>
                            )}
                            {/* Cambiar la portada del proyecto: sube a Storage y
                                actualiza proyectos.imagen_url */}
                            {isEditMode && (
                              <button
                                onClick={(e) => { e.stopPropagation(); portadaProyectoRef.current?.click(); }}
                                disabled={subiendoPortada}
                                className="absolute inset-0 bg-black/45 flex flex-col items-center justify-center gap-2 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity cursor-pointer disabled:opacity-100"
                                title={t('dash.cambiarPortada')}
                              >
                                <span className="bg-white/90 p-2.5 rounded-full text-slate-900">
                                  {subiendoPortada
                                    ? <Loader2 size={18} className="animate-spin" />
                                    : <Camera size={18} />}
                                </span>
                                <span className="text-[10px] font-bold text-white tracking-wide">
                                  {subiendoPortada ? t('comun.subiendo') : t('dash.cambiarPortada')}
                                </span>
                              </button>
                            )}
                          </div>

                          {/* Detalles del proyecto */}
                          <div className="flex-1 flex flex-col py-0.5">
                            {/* Badge */}
                            <div className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[10px] font-bold bg-[#FAF4EA] dark:bg-amber-500/10 text-[#8B6914] dark:text-[#E3C77B] mb-2.5 w-fit border border-[#F0E2CD] dark:border-amber-500/30">
                              <span className="text-[8px]">★</span> {etiquetaEstado(fp.estado, t).toUpperCase()}
                            </div>

                            {/* Título & % Avance */}
                            <div className="flex items-start justify-between gap-3 mb-1">
                              <h3
                                onClick={() => handleCardClick(fp)}
                                className="text-xl lg:text-2xl font-bold text-slate-900 dark:text-white leading-tight uppercase cursor-pointer hover:text-[#C5A059] transition-colors flex-1"
                              >
                                {fp.nombre}
                              </h3>
                              <div className="text-right flex-shrink-0">
                                <p className="text-3xl lg:text-4xl font-bold text-slate-900 dark:text-white leading-none">{pct.toFixed(0)}%</p>
                                <p className="text-[11px] text-slate-400 dark:text-zinc-400 font-medium">{t('dash.avanceObraCorto')}</p>
                              </div>
                            </div>

                            {/* Ubicación */}
                            {fp.ubicacion && (
                              <p className="text-xs text-slate-500 dark:text-zinc-400 flex items-center gap-1 mb-2 font-medium">
                                <MapPin size={13} className="text-slate-400 dark:text-zinc-400" /> {fp.ubicacion}
                              </p>
                            )}

                            {/* Descripción */}
                            {fp.descripcion && (
                              <p className="text-xs text-slate-500 dark:text-zinc-400 leading-relaxed line-clamp-2 mb-4">
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
                                  <span className="text-[10px] font-bold text-slate-400 dark:text-zinc-500 tabular-nums px-1">
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
                        <div className="grid grid-cols-4 items-center gap-3 pt-4 border-t border-gray-100/80 dark:border-zinc-700/80">
                          <div>
                            <p className="text-[11px] text-slate-400 dark:text-zinc-400 font-medium mb-0.5">{t('dash.inversionTotal')}</p>
                            <p className="text-base lg:text-lg font-bold text-slate-900 dark:text-white">{formatMoney(fp.presupuesto_total)}</p>
                          </div>
                          <div>
                            <p className="text-[11px] text-slate-400 dark:text-zinc-400 font-medium mb-0.5">{t('dash.ejecutado')}</p>
                            <p className="text-base lg:text-lg font-bold text-slate-900 dark:text-white">
                              {formatMoney(fp.totalGastado)} <span className="text-xs text-slate-500 dark:text-zinc-400 font-normal">({pct.toFixed(0)}%)</span>
                            </p>
                          </div>
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-xl bg-slate-50 dark:bg-zinc-800 border border-gray-100 dark:border-zinc-700 flex items-center justify-center flex-shrink-0 text-slate-400 dark:text-zinc-400">
                              <Calendar size={15} />
                            </div>
                            <div>
                              <p className="text-[11px] text-slate-400 dark:text-zinc-400 font-medium mb-0.5">{t('dash.entregaEstimada')}</p>
                              <p className="text-xs lg:text-sm font-bold text-slate-900 dark:text-white">
                                {fp.fecha_entrega
                                  ? new Date(fp.fecha_entrega).toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' })
                                  : '30 Nov 2025'}
                              </p>
                            </div>
                          </div>
                          <div className="flex justify-end">
                            <button
                              onClick={() => handleCardClick(fp)}
                              className="px-5 py-2.5 bg-[#FAF4EA] dark:bg-amber-500/10 text-[#8B6914] dark:text-[#E3C77B] rounded-xl text-xs font-bold hover:bg-[#F3E7D3] dark:hover:bg-amber-500/20 transition-colors flex items-center gap-1 border border-[#F0E2CD] dark:border-amber-500/30"
                            >
                              {t('dash.verProyecto')} <ChevronRight size={14} />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Gráfica Sincronizada con el Carrusel Activo (PieChart / Donut) */}
                  <div className="bg-white dark:bg-zinc-800 rounded-[20px] shadow-[0_1px_8px_rgba(0,0,0,0.05)] border border-gray-100/80 dark:border-zinc-700/80 flex flex-col p-5 lg:p-6 justify-between">
                    <div>
                      <div className="flex justify-between items-center mb-2">
                        <h2 className="text-[11px] font-bold text-slate-900 dark:text-white tracking-[0.12em] uppercase">{t('dash.avanceObra')}</h2>
                        <span className="text-[10px] font-extrabold bg-amber-50 dark:bg-amber-500/10 text-[#8B6914] dark:text-[#E3C77B] px-2.5 py-1 rounded-full border border-amber-200 dark:border-amber-500/30 uppercase">
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
                            <span className="text-[10px] font-bold text-slate-400 dark:text-zinc-400 uppercase tracking-wider mt-0.5">{t('dash.avanceFisico')}</span>
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
                            <p className="text-[10px] font-bold text-slate-500 dark:text-zinc-400 uppercase">{t('dash.pendiente')}</p>
                            <p className="text-sm font-black text-slate-700 dark:text-zinc-200">{100 - avanceProyectoActivo}%</p>
                          </div>
                        </div>
                        <p className="text-[10px] text-slate-400 dark:text-zinc-400 font-medium text-center">
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
                    <button className="text-[10px] text-[#C5A059] font-semibold hover:underline">{t('dash.verTodas')}</button>
                  </div>
                  <div className="space-y-3">
                    {loading ? (
                      <p className="text-xs text-slate-400 dark:text-zinc-400">{t('comun.cargando')}</p>
                    ) : gastos.slice(0, 4).length > 0 ? gastos.slice(0, 4).map((g, i) => (
                      <div key={i} className="flex items-start gap-3">
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
                          g.tipo === 'pago' ? 'bg-emerald-50 dark:bg-emerald-500/10' : g.tipo === 'documento' ? 'bg-blue-50 dark:bg-blue-500/10' : 'bg-amber-50 dark:bg-amber-500/10'
                        }`}>
                          {g.tipo === 'pago' ? <DollarSign size={11} className="text-emerald-500" /> :
                           g.tipo === 'documento' ? <FileText size={11} className="text-blue-500" /> :
                           <Activity size={11} className="text-amber-500" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] font-semibold text-slate-800 dark:text-zinc-100 truncate">{g.descripcion || g.concepto || 'Gasto registrado'}</p>
                          <p className="text-[10px] text-slate-400 dark:text-zinc-400">{g.fecha ? new Date(g.fecha).toLocaleDateString(locale) : '–'}</p>
                        </div>
                        {g.monto && <span className="text-[10px] font-bold text-emerald-600 flex-shrink-0">+{formatMoney(g.monto)}</span>}
                      </div>
                    )) : [
                      { icon: DollarSign, color: 'bg-emerald-50 dark:bg-emerald-500/10', iconColor: 'text-emerald-500', label: t('act.pagoRegistrado'), sub: t('act.subPago'), val: '+$12,500' },
                      { icon: FileText, color: 'bg-blue-50 dark:bg-blue-500/10', iconColor: 'text-blue-500', label: t('act.docAprobado'), sub: t('act.subDocAprobado'), val: null },
                      { icon: TrendingUp, color: 'bg-amber-50 dark:bg-amber-500/10', iconColor: 'text-amber-500', label: t('act.avanceActualizado'), sub: t('act.subAvance'), val: '67%' },
                      { icon: Activity, color: 'bg-purple-50 dark:bg-purple-500/10', iconColor: 'text-purple-500 dark:text-purple-300', label: t('act.docSubido'), sub: t('act.subDocSubido'), val: null },
                    ].map((item, i) => {
                      const Icon = item.icon;
                      return (
                        <div key={i} className="flex items-start gap-3">
                          <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${item.color}`}>
                            <Icon size={11} className={item.iconColor} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[11px] font-semibold text-slate-800 dark:text-zinc-100 truncate">{item.label}</p>
                            <p className="text-[10px] text-slate-400 dark:text-zinc-400">{item.sub}</p>
                          </div>
                          {item.val && <span className="text-[10px] font-bold text-emerald-600 flex-shrink-0">{item.val}</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Próximos Hitos */}
                <div className="bg-white dark:bg-zinc-800 rounded-[20px] border border-gray-100/80 dark:border-zinc-700/80 shadow-sm p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-[11px] font-bold text-slate-900 dark:text-white tracking-[0.12em] uppercase">{t('dash.proximosHitos')}</h3>
                    <button className="text-[10px] text-[#C5A059] font-semibold hover:underline">{t('comun.verTodos')}</button>
                  </div>
                  <div className="space-y-3">
                    {loading ? (
                      <p className="text-xs text-slate-400 dark:text-zinc-400">{t('comun.cargando')}</p>
                    ) : hitosPendientes.length > 0 ? hitosPendientes.map((h) => {
                        const dias = h.fecha_vencimiento
                          ? Math.ceil((new Date(h.fecha_vencimiento) - new Date()) / (1000 * 60 * 60 * 24))
                          : null;
                        return (
                          <div key={h.id} className="flex items-start gap-3">
                            <div className="w-6 h-6 rounded-full bg-slate-100 dark:bg-zinc-700 flex items-center justify-center flex-shrink-0 mt-0.5">
                              <MapPin size={11} className="text-slate-500 dark:text-zinc-400" />
                            </div>
                            <div className="flex-1 min-w-0">
                              {/* La columna real es `titulo`, no `tarea` */}
                              <p className="text-[11px] font-semibold text-slate-800 dark:text-zinc-100 truncate">
                                {h.titulo || t('proy.hitoSinTitulo')}
                              </p>
                              {/* Nombre del proyecto, no su UUID */}
                              <p className="text-[10px] text-slate-400 dark:text-zinc-400 truncate">
                                {nombreProyecto(h.proyecto_id)}
                              </p>
                            </div>
                            {dias !== null && (
                              <span className={`text-[10px] font-bold flex-shrink-0 ${dias <= 7 ? 'text-red-500' : 'text-slate-400 dark:text-zinc-400'}`}>
                                {t('act.enDiasCorto', { dias })}
                              </span>
                            )}
                          </div>
                        );
                      }) : (
                        <p className="text-xs text-slate-400 dark:text-zinc-500 py-4 text-center">{t('dash.sinHitosPendientes')}</p>
                      )}
                  </div>
                </div>

                {/* Tareas Críticas */}
                <div className="bg-white dark:bg-zinc-800 rounded-[20px] border border-gray-100/80 dark:border-zinc-700/80 shadow-sm p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-[11px] font-bold text-slate-900 dark:text-white tracking-[0.12em] uppercase">{t('dash.tareasCriticas')}</h3>
                    <button className="text-[10px] text-[#C5A059] font-semibold hover:underline">{t('dash.verTodas')}</button>
                  </div>
                  <div className="space-y-3">
                    {loading ? (
                      <p className="text-xs text-slate-400 dark:text-zinc-400">{t('comun.cargando')}</p>
                    ) : notificaciones.slice(0, 3).length > 0 ? notificaciones.slice(0, 3).map((n, i) => (
                      <button
                        key={n.id || i}
                        onClick={() => abrirNotificacion(n)}
                        className="w-full text-left flex items-start gap-3 rounded-lg -mx-1 px-1 py-0.5 hover:bg-slate-50 dark:hover:bg-zinc-700/40 transition-colors"
                      >
                        <div className="w-6 h-6 rounded-full bg-red-50 dark:bg-red-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <AlertTriangle size={11} className="text-red-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] font-semibold text-slate-800 dark:text-zinc-100 truncate">{n.tarea}</p>
                          <p className="text-[10px] text-slate-400 dark:text-zinc-400 truncate">
                            {n.proyectoNombre ? `${n.proyectoNombre} · ` : ''}{t('notif.vence')} {n.fecha_vencimiento}
                          </p>
                        </div>
                        <span className="text-[9px] font-bold text-red-400 flex-shrink-0 bg-red-50 dark:bg-red-500/10 px-1.5 py-0.5 rounded">{t('notif.urgente')}</span>
                      </button>
                    )) : [
                      { label: t('act.tareaPagos'), sub: t('act.subTotalPagos'), color: 'bg-red-50 dark:bg-red-500/10', iconColor: 'text-red-500', tag: t('act.tagUrgente'), tagColor: 'bg-red-50 dark:bg-red-500/10 text-red-400' },
                      { label: t('act.tareaCriticas'), sub: t('act.subRequieren'), color: 'bg-amber-50 dark:bg-amber-500/10', iconColor: 'text-amber-500', tag: t('act.tagPronto'), tagColor: 'bg-amber-50 dark:bg-amber-500/10 text-amber-500' },
                      { label: t('act.tareaDocs'), sub: t('act.subDocsRevisar'), color: 'bg-blue-50 dark:bg-blue-500/10', iconColor: 'text-blue-500', tag: t('act.tagPendiente'), tagColor: 'bg-blue-50 dark:bg-blue-500/10 text-blue-500' },
                    ].map((tarea, i) => (
                      <div key={i} className="flex items-start gap-3">
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${tarea.color}`}>
                          <AlertTriangle size={11} className={tarea.iconColor} />
                        </div>
                        <div className="flex-1">
                          <p className="text-[11px] font-semibold text-slate-800 dark:text-zinc-100">{tarea.label}</p>
                          <p className="text-[10px] text-slate-400 dark:text-zinc-400">{tarea.sub}</p>
                        </div>
                        <span className={`text-[9px] font-bold flex-shrink-0 px-1.5 py-0.5 rounded ${tarea.tagColor}`}>{tarea.tag}</span>
                      </div>
                    ))}
                  </div>
                </div>

              </div>
            </section>

            {/* Bottom nav móvil */}
            <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white dark:bg-zinc-800 border-t border-gray-200 dark:border-zinc-700 flex items-center justify-around px-4 py-2 z-50 safe-bottom">
              {[
                { id: 'portfolio', label: t('nav.dashboard'), icon: Activity },
                { id: 'all-projects', label: t('nav.proyectos'), icon: Building2 },
                { id: 'vault', label: t('nav.boveda'), icon: FileText },
                { id: 'chat', label: t('nav.chat'), icon: Send },
                { id: 'profile', label: t('nav.perfil'), icon: Users },
              ].map(item => {
                const Icon = item.icon;
                const active = currentView === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setCurrentView(item.id)}
                    className={`flex flex-col items-center gap-0.5 px-2 py-1 rounded-lg transition-all ${active ? 'text-[#C5A059]' : 'text-slate-400 dark:text-zinc-400'}`}
                  >
                    <Icon size={20} />
                    <span className="text-[9px] font-semibold">{item.label}</span>
                  </button>
                );
              })}
            </nav>

          </div>
        </main>
      )}
      </div>
      </div>
    </div>
  );
}
