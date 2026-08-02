import React, { useState, useEffect, useRef } from 'react';
import {
  ArrowLeft, CheckSquare, Square, Upload, Image, TrendingUp, FileText, LayoutGrid,
  ChevronDown, ChevronUp, Edit2, Save, Plus, Trash2, AlertTriangle, Loader2, CheckCircle2,
  ExternalLink, Download, Calendar, DollarSign, FolderPlus, X, Eye, Receipt, ShieldAlert, Building
} from 'lucide-react';
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import {
  uploadArchivoProyecto, getArchivosProyecto, renombrarArchivo, eliminarArchivo
} from '../services/storageService';
import { supabase } from '../supabaseClient';
import {
  guardarFinanzas, agruparGastosPorMes, formatearMoneda, aNumero
} from '../services/finanzasService';
import {
  getAlbumes, crearAlbum, actualizarAlbum, eliminarAlbum, subirFotoAlbum, eliminarFoto
} from '../services/galeriaService';
import { usePrefs } from '../context/PreferenciasContext';
import {
  fetchChecklist, saveChecklist, deleteHito, updateHito, calcularAvance
} from '../services/checklistService';
import { getChecklistSeed } from '../data/checklistSeeds';

// Se guarda la CLAVE de traducción, no el texto: la etiqueta se resuelve en
// cada render para que el cambio de idioma se refleje al instante.
const TABS = [
  { id: 'summary',   claveLabel: 'proy.tab.resumen',  icon: CheckSquare },
  { id: 'finances',  claveLabel: 'proy.tab.finanzas', icon: TrendingUp },
  { id: 'documents', claveLabel: 'proy.tab.docs',     icon: FileText },
  { id: 'gallery',   claveLabel: 'proy.tab.galeria',  icon: LayoutGrid },
];

const PROJECT_DATA = {
  '1': {
    budget: 1480000,
    advancePayment: 148000,
    spent: 527000,
    monthlyData: [
      { name: 'Ene', value: 45000 }, { name: 'Feb', value: 82000 }, { name: 'Mar', value: 120000 },
      { name: 'Abr', value: 95000 }, { name: 'May', value: 110000 }, { name: 'Jun', value: 75000 }
    ],
    documents: ['Contrato_Constructor_SanMartin.pdf', 'Planos_Arquitectonicos_SanMartin.pdf', 'Permiso_Municipal_SanMartin.pdf'],
    galleryAlbums: [
      {
        id: 101,
        title: 'Rehabilitación y Obra Gris',
        date: 'Julio 2025',
        photoCount: 6,
        cover: 'https://images.unsplash.com/photo-1541888081-37d4251752b5?auto=format&fit=crop&w=600&q=80',
        photos: [
          'https://images.unsplash.com/photo-1541888081-37d4251752b5?auto=format&fit=crop&w=800&q=80',
          'https://images.unsplash.com/photo-1503387762-592deb58ef4e?auto=format&fit=crop&w=800&q=80',
          'https://images.unsplash.com/photo-1504307651254-35680f356dfd?auto=format&fit=crop&w=800&q=80',
          'https://images.unsplash.com/photo-1581094794329-c8112a89af12?auto=format&fit=crop&w=800&q=80',
          'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=800&q=80',
          'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=800&q=80'
        ]
      },
      {
        id: 102,
        title: 'Acabados y Fachada Principal',
        date: 'Junio 2025',
        photoCount: 4,
        cover: 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=600&q=80',
        photos: [
          'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=800&q=80',
          'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=800&q=80',
          'https://images.unsplash.com/photo-1541888081-37d4251752b5?auto=format&fit=crop&w=800&q=80',
          'https://images.unsplash.com/photo-1503387762-592deb58ef4e?auto=format&fit=crop&w=800&q=80'
        ]
      }
    ],
  },
  '2': {
    budget: 850000,
    advancePayment: 85000,
    spent: 590000,
    monthlyData: [
      { name: 'Mar', value: 85000 }, { name: 'Abr', value: 120000 }, { name: 'May', value: 165000 }, { name: 'Jun', value: 220000 }
    ],
    documents: ['Escritura_Terreno_Chalchuapa.pdf', 'Permiso_Alcaldia_Chalchuapa.pdf', 'Planos_Estructurales_v2.pdf'],
    galleryAlbums: [
      {
        id: 201,
        title: 'Levantamiento Topográfico y Terracería',
        date: 'Mayo 2025',
        photoCount: 5,
        cover: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=600&q=80',
        photos: [
          'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=800&q=80',
          'https://images.unsplash.com/photo-1541888081-37d4251752b5?auto=format&fit=crop&w=800&q=80',
          'https://images.unsplash.com/photo-1503387762-592deb58ef4e?auto=format&fit=crop&w=800&q=80',
          'https://images.unsplash.com/photo-1504307651254-35680f356dfd?auto=format&fit=crop&w=800&q=80',
          'https://images.unsplash.com/photo-1581094794329-c8112a89af12?auto=format&fit=crop&w=800&q=80'
        ]
      },
      {
        id: 202,
        title: 'Primera Piedra y Cimentación',
        date: 'Junio 2025',
        photoCount: 4,
        cover: 'https://images.unsplash.com/photo-1503387762-592deb58ef4e?auto=format&fit=crop&w=600&q=80',
        photos: [
          'https://images.unsplash.com/photo-1503387762-592deb58ef4e?auto=format&fit=crop&w=800&q=80',
          'https://images.unsplash.com/photo-1541888081-37d4251752b5?auto=format&fit=crop&w=800&q=80',
          'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=800&q=80',
          'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=800&q=80'
        ]
      }
    ],
  },
  '3': {
    budget: 100000,
    advancePayment: 5000,
    spent: 55000,
    monthlyData: [
      { name: 'Ene', value: 200000 }, { name: 'Feb', value: 350000 }, { name: 'Mar', value: 400000 }, { name: 'Abr', value: 330000 }
    ],
    documents: ['Escritura_Terreno_Opico.pdf', 'Permiso_Ambiental_MARN.pdf'],
    galleryAlbums: [
      {
        id: 301,
        title: 'Estudio de Suelos y Terracería',
        date: 'Junio 2025',
        photoCount: 4,
        cover: 'https://images.unsplash.com/photo-1503387762-592deb58ef4e?auto=format&fit=crop&w=600&q=80',
        photos: [
          'https://images.unsplash.com/photo-1503387762-592deb58ef4e?auto=format&fit=crop&w=800&q=80',
          'https://images.unsplash.com/photo-1541888081-37d4251752b5?auto=format&fit=crop&w=800&q=80',
          'https://images.unsplash.com/photo-1504307651254-35680f356dfd?auto=format&fit=crop&w=800&q=80',
          'https://images.unsplash.com/photo-1581094794329-c8112a89af12?auto=format&fit=crop&w=800&q=80'
        ]
      }
    ],
  }
};

/**
 * Tarjeta de monto financiero. En modo lectura muestra la cifra formateada;
 * en modo edición se convierte en un input controlado.
 */
function TarjetaMonto({ etiqueta, pie, valor, editando, onChange, colorValor }) {
  return (
    <div className={`border shadow-sm rounded-2xl p-5 transition-colors ${
      editando
        ? 'bg-amber-50/40 dark:bg-amber-500/5 border-[#C5A059]/50'
        : 'bg-white dark:bg-zinc-800 border-gray-100 dark:border-zinc-700'
    }`}>
      <p className="text-xs text-slate-400 dark:text-zinc-400 uppercase font-bold tracking-wider mb-2">{etiqueta}</p>

      {editando ? (
        <div className="flex items-center gap-1">
          <span className={`text-2xl md:text-3xl font-black ${colorValor}`}>$</span>
          <input
            type="text"
            inputMode="decimal"
            value={valor}
            onChange={(e) => onChange(e.target.value)}
            onFocus={(e) => e.target.select()}
            className={`w-full min-w-0 bg-transparent border-b-2 border-[#C5A059]/60 focus:border-[#C5A059] outline-none text-2xl md:text-3xl font-black ${colorValor}`}
          />
        </div>
      ) : (
        <p className={`text-2xl md:text-3xl font-black ${colorValor}`}>
          ${Number(valor || 0).toLocaleString()}
        </p>
      )}

      <p className="text-xs text-slate-400 dark:text-zinc-400 mt-1 font-semibold">{pie}</p>
    </div>
  );
}

export default function ProjectDetails({ project, onBack, userRole, isEditMode, onUpdateProject }) {
  const { t, locale, language } = usePrefs();
  const [activeTab, setActiveTab] = useState('summary');
  const [openAccordion, setOpenAccordion] = useState(null);
  const [showExpenses, setShowExpenses] = useState(false);

  // Storage Upload & Archivos state
  const [archivosDB, setArchivosDB] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState(null);

  // Invoices & Facturas state
  const [facturas, setFacturas] = useState([
    { id: 1, proveedor: 'BOMEL S.A. de C.V.', concepto: 'Subestructura y Cimentación', monto: 42500, comprobante: 'Factura Crédito Fiscal #F-9482', fecha: '2025-07-12' },
    { id: 2, proveedor: 'Constructora El Salvador', concepto: 'Obra Gris Etapa 1', monto: 38000, comprobante: 'Factura #4029', fecha: '2025-06-28' },
    { id: 3, proveedor: 'Distribuidora Ferretera', concepto: 'Cemento y Varillas de Hierro 1/2"', monto: 17500, comprobante: 'Factura #1092', fecha: '2025-06-15' }
  ]);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [newInvoice, setNewInvoice] = useState({ proveedor: '', concepto: '', monto: '', comprobante: '' });

  // Gallery Albums & Modals state
  const data = PROJECT_DATA[project.id] || PROJECT_DATA['1'];
  const [albums, setAlbums] = useState(data.galleryAlbums || []);
  const [activeAlbumModal, setActiveAlbumModal] = useState(null);
  const [selectedPhotoLightbox, setSelectedPhotoLightbox] = useState(null);
  const [showCreateAlbumModal, setShowCreateAlbumModal] = useState(false);
  const [newAlbumForm, setNewAlbumForm] = useState({ title: '', date: '', cover: '' });
  const [portadaFile, setPortadaFile] = useState(null);
  const [albumEditando, setAlbumEditando] = useState(null);
  const [subiendoGaleria, setSubiendoGaleria] = useState(false);
  const [galeriaMsg, setGaleriaMsg] = useState(null);
  const [showDestinoModal, setShowDestinoModal] = useState(false);
  const [destinoFoto, setDestinoFoto] = useState('');
  const [nuevaPortadaFile, setNuevaPortadaFile] = useState(null);

  // Checklist State & Admin Controls
  const isAdmin = ['admin', 'socio_administrador'].includes(userRole);
  const [checklist, setChecklist] = useState([]);
  const [isLoadingChecklist, setIsLoadingChecklist] = useState(true);
  // true = lo que se ve son datos reales de Supabase; false = semilla aún sin guardar
  const [checklistPersistido, setChecklistPersistido] = useState(false);
  const [showAddHitoModal, setShowAddHitoModal] = useState(false);
  const [newItemText, setNewItemText] = useState('');
  const [newHitoDetail, setNewHitoDetail] = useState('');
  const [newHitoDate, setNewHitoDate] = useState('');

  // Edit Hito State
  const [editingHitoIndex, setEditingHitoIndex] = useState(null);
  const [editHitoText, setEditHitoText] = useState('');
  const [editHitoDetail, setEditHitoDetail] = useState('');
  const [editHitoDate, setEditHitoDate] = useState('');

  // Save Manual & Global Sync State
  const [isSavingChanges, setIsSavingChanges] = useState(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState(null);
  const [saveErrorMsg, setSaveErrorMsg] = useState(null);
  const [hayCambiosSinGuardar, setHayCambiosSinGuardar] = useState(false);

  // Lista blindada: nunca es null/undefined aunque la BD devuelva algo raro
  const safeChecklist = Array.isArray(checklist) ? checklist.filter(Boolean) : [];
  const completados = safeChecklist.filter(c => c && (c.done || c.estado === 'completado')).length;
  const avancePct = calcularAvance(safeChecklist);

  const docInputRef = useRef(null);
  const photoInputRef = useRef(null);
  const albumPhotoInputRef = useRef(null);

  // Sync albums cuando cambia el proyecto
  useEffect(() => {
    const currentData = PROJECT_DATA[project?.id] || PROJECT_DATA['1'];
    setAlbums(currentData.galleryAlbums || []);
  }, [project?.id]);

  /**
   * Carga el checklist REAL desde Supabase.
   * Si la base todavía no tiene hitos para este proyecto, se muestra la
   * checklist semilla marcada como "sin guardar" para que el administrador
   * pueda persistirla con un clic en "Guardar Cambios".
   */
  const cargarChecklist = async () => {
    if (!project?.id) {
      setChecklist([]);
      setChecklistPersistido(false);
      setIsLoadingChecklist(false);
      return;
    }

    setIsLoadingChecklist(true);
    try {
      const { items } = await fetchChecklist(project.id);

      if (Array.isArray(items) && items.length > 0) {
        setChecklist(items);
        setChecklistPersistido(true);
      } else {
        setChecklist(getChecklistSeed(project.id, project.nombre || project.title).map((item, i) => ({ ...item, id: null, orden: i })));
        setChecklistPersistido(false);
      }
      setHayCambiosSinGuardar(false);
    } catch (err) {
      console.error('Error cargando el checklist desde Supabase:', err);
      setChecklist(getChecklistSeed(project?.id, project?.nombre || project?.title).map((item, i) => ({ ...item, id: null, orden: i })));
      setChecklistPersistido(false);
    } finally {
      setIsLoadingChecklist(false);
    }
  };

  useEffect(() => {
    cargarChecklist();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  const limpiarMensajes = () => {
    setSaveSuccessMsg(null);
    setSaveErrorMsg(null);
  };

  // Marca / desmarca un checkbox (se persiste al presionar "Guardar Cambios")
  const handleToggleHito = (index) => {
    setChecklist(prev => (Array.isArray(prev) ? prev : []).map((item, i) =>
      i === index ? { ...item, done: !item.done } : item
    ));
    setHayCambiosSinGuardar(true);
    limpiarMensajes();
  };

  // Elimina el hito PERMANENTEMENTE de Supabase (icono de basurero)
  const handleDeleteHito = async (index) => {
    const item = safeChecklist[index];
    if (!item) return;
    if (!confirm(t('dlg.eliminarHito', { titulo: item.text }))) return;

    limpiarMensajes();
    const restantes = safeChecklist.filter((_, i) => i !== index);
    setChecklist(restantes);

    if (item.id === null || item.id === undefined) {
      // Todavía no existía en la base: basta con quitarlo de la lista local
      setHayCambiosSinGuardar(true);
      return;
    }

    setIsSavingChanges(true);
    const { success, error } = await deleteHito(item.id);
    if (success) {
      const pct = calcularAvance(restantes);
      await sincronizarProyecto(pct, restantes);
      setSaveSuccessMsg(t('msg.hitoEliminado', { pct }));
      setTimeout(() => setSaveSuccessMsg(null), 6000);
    } else {
      setSaveErrorMsg(t('msg.errorEliminarHito', { error }));
      await cargarChecklist();
    }
    setIsSavingChanges(false);
  };

  const handleStartEditHito = (index) => {
    const item = safeChecklist[index];
    if (!item) return;
    setEditingHitoIndex(index);
    setEditHitoText(item.text || item.titulo || '');
    setEditHitoDetail(item.detail || item.descripcion || '');
    setEditHitoDate(item.fecha || item.fecha_vencimiento || '');
  };

  // Guarda la edición del hito PERMANENTEMENTE en Supabase (icono de lápiz)
  const handleSaveEditHito = async (e) => {
    e.preventDefault();
    if (editingHitoIndex === null || !editHitoText.trim()) return;

    const actualizado = {
      ...safeChecklist[editingHitoIndex],
      text: editHitoText.trim(),
      detail: editHitoDetail.trim() || t('fb.hitoActualizadoBitacora'),
      fecha: editHitoDate.trim() || 'Proyectado'
    };
    const nuevaLista = safeChecklist.map((item, i) => i === editingHitoIndex ? actualizado : item);

    limpiarMensajes();
    setChecklist(nuevaLista);
    setEditingHitoIndex(null);

    if (actualizado.id === null || actualizado.id === undefined) {
      setHayCambiosSinGuardar(true);
      return;
    }

    setIsSavingChanges(true);
    const { success, error } = await updateHito(actualizado.id, actualizado, editingHitoIndex, project?.id);
    if (success) {
      setSaveSuccessMsg(t('msg.hitoActualizado', { titulo: actualizado.text }));
      setTimeout(() => setSaveSuccessMsg(null), 6000);
    } else {
      setSaveErrorMsg(t('msg.errorActualizarHito', { error }));
      await cargarChecklist();
    }
    setIsSavingChanges(false);
  };

  // Agrega una tarea nueva (se persiste al presionar "Guardar Cambios")
  const handleAddHito = (e) => {
    e.preventDefault();
    if (!newItemText.trim()) return;
    const newItem = {
      id: null,
      done: false,
      text: newItemText.trim(),
      detail: newHitoDetail.trim() || t('fb.hitoBitacora'),
      fecha: newHitoDate.trim() || 'Proyectado',
      orden: safeChecklist.length,
      persisted: false
    };
    setChecklist([...safeChecklist, newItem]);
    setNewItemText('');
    setNewHitoDetail('');
    setNewHitoDate('');
    setShowAddHitoModal(false);
    setHayCambiosSinGuardar(true);
    limpiarMensajes();
  };

  // Propaga el nuevo avance al objeto de proyecto en memoria y refresca el Dashboard
  const sincronizarProyecto = async (pct, items) => {
    if (project) {
      project.checklist = items;
      project.avanceFisico = pct;
      project.avanceObra = `${pct}%`;
    }
    if (typeof onUpdateProject === 'function') {
      try {
        await onUpdateProject(project?.id, pct, items);
      } catch (err) {
        console.warn('Aviso refrescando el dashboard:', err);
      }
    }
  };

  /**
   * "Guardar Cambios": sincroniza TODO el checklist contra Supabase
   * (INSERT de tareas nuevas, UPDATE de checkboxes/textos, DELETE de las quitadas)
   * y guarda el porcentaje de avance en la tabla `proyectos`.
   */
  const handleSaveAllChanges = async () => {
    if (!project?.id) {
      setSaveErrorMsg(t('msg.idInvalido'));
      return;
    }

    setIsSavingChanges(true);
    limpiarMensajes();

    try {
      const { success, items, porcentaje, error } = await saveChecklist(project.id, safeChecklist);

      if (!success) {
        setSaveErrorMsg(t('msg.errorGuardarCambios', { error: error || t('msg.errorDesconocido') }));
        return;
      }

      const listaFinal = Array.isArray(items) && items.length > 0 ? items : safeChecklist;
      setChecklist(listaFinal);
      setChecklistPersistido(true);
      setHayCambiosSinGuardar(false);

      await sincronizarProyecto(porcentaje, listaFinal);

      const hechos = listaFinal.filter(c => c && c.done).length;
      setSaveSuccessMsg(t('msg.cambiosGuardados', { pct: porcentaje, hechos, total: listaFinal.length }));
      setTimeout(() => setSaveSuccessMsg(null), 6000);
    } catch (err) {
      console.error('Error guardando cambios:', err);
      setSaveErrorMsg(t('msg.errorGuardar', { error: err?.message || err }));
    } finally {
      setIsSavingChanges(false);
    }
  };

  const loadProjectArchivos = async () => {
    if (project?.id) {
      const list = await getArchivosProyecto(project.id);
      setArchivosDB(Array.isArray(list) ? list : []);
    } else {
      setArchivosDB([]);
    }
  };

  useEffect(() => {
    loadProjectArchivos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  // ── Reactividad tipo Excel: cualquier cambio en `archivos` refresca la lista ──
  useEffect(() => {
    if (!project?.id) return;
    const canal = supabase
      .channel(`archivos-proyecto-${project.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'archivos' }, loadProjectArchivos)
      .subscribe();
    return () => { supabase.removeChannel(canal); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  // ── Reactividad del checklist: se sincroniza solo entre pestañas/usuarios ──
  useEffect(() => {
    if (!project?.id) return;
    const canal = supabase
      .channel(`hitos-proyecto-${project.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'checklist_hitos' }, () => {
        // No pisar lo que el usuario está editando en este momento
        if (!hayCambiosSinGuardar && !isSavingChanges && editingHitoIndex === null) cargarChecklist();
      })
      .subscribe();
    return () => { supabase.removeChannel(canal); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, hayCambiosSinGuardar, isSavingChanges, editingHitoIndex]);

  // ── Renombrar / eliminar documentos (solo Administrador) ──
  const handleRenameArchivo = async (archivo) => {
    const actual = archivo?.nombre_archivo || '';
    const nuevo = prompt(t('doc.nuevoNombre'), actual);
    if (nuevo === null) return;
    if (!nuevo.trim() || nuevo.trim() === actual) return;

    setIsUploading(true);
    const { success, error } = await renombrarArchivo(archivo.id, nuevo.trim());
    setIsUploading(false);

    setUploadMessage(success
      ? { type: 'success', text: t('msg.archivoRenombrado', { nombre: nuevo.trim() }) }
      : { type: 'error', text: error || t('msg.errorRenombrar') });

    await loadProjectArchivos();
    setTimeout(() => setUploadMessage(null), 5000);
  };

  const handleDeleteArchivo = async (archivo) => {
    if (!confirm(t('dlg.eliminarArchivo', { nombre: archivo?.nombre_archivo }))) return;

    setIsUploading(true);
    const { success, error } = await eliminarArchivo(archivo);
    setIsUploading(false);

    setUploadMessage(success
      ? { type: 'success', text: t('msg.archivoEliminado', { nombre: archivo.nombre_archivo }) }
      : { type: 'error', text: error || t('msg.errorEliminarArchivo') });

    await loadProjectArchivos();
    setTimeout(() => setUploadMessage(null), 6000);
  };

  const handleFileUpload = async (event, tipo) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadMessage(null);

    const result = await uploadArchivoProyecto(file, project.id, tipo);

    setIsUploading(false);

    if (result.success) {
      setUploadMessage({ type: 'success', text: t('msg.archivoSubido', { nombre: file.name }) });
      await loadProjectArchivos();
    } else {
      setUploadMessage({ type: 'error', text: result.error || t('msg.errorSubir') });
    }

    event.target.value = '';
    setTimeout(() => setUploadMessage(null), 5000);
  };

  const handleCreateInvoice = (e) => {
    e.preventDefault();
    if (!newInvoice.proveedor || !newInvoice.monto) return;
    const item = {
      id: Date.now(),
      proveedor: newInvoice.proveedor,
      concepto: newInvoice.concepto || 'Gasto registrado',
      monto: Number(newInvoice.monto) || 0,
      comprobante: newInvoice.comprobante || t('fb.comprobantePago'),
      fecha: new Date().toISOString().split('T')[0]
    };
    setFacturas([item, ...facturas]);
    setNewInvoice({ proveedor: '', concepto: '', monto: '', comprobante: '' });
    setShowInvoiceModal(false);
  };

  /* ── Galería contra Supabase ───────────────────────────────────────────── */

  const cargarAlbumes = async () => {
    if (!project?.id) return;
    const { albumes, error } = await getAlbumes(project.id);
    setAlbums(Array.isArray(albumes) ? albumes : []);
    if (error) setGaleriaMsg({ tipo: 'error', texto: error });
  };

  useEffect(() => {
    cargarAlbumes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  // Realtime: los álbumes se refrescan solos al cambiar en la base
  useEffect(() => {
    if (!project?.id) return;
    const canal = supabase
      .channel(`galeria-${project.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'galeria_albumes' }, cargarAlbumes)
      .subscribe();
    return () => { supabase.removeChannel(canal); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  /** Crea el álbum subiendo la portada elegida desde el dispositivo. */
  const handleCreateAlbum = async (e) => {
    e.preventDefault();
    if (!newAlbumForm.title.trim()) return;

    setSubiendoGaleria(true);
    setGaleriaMsg(null);

    const { success, error } = await crearAlbum(project?.id, {
      titulo: newAlbumForm.title,
      fecha: newAlbumForm.date,
      portadaFile: portadaFile
    });

    setSubiendoGaleria(false);

    if (success) {
      setNewAlbumForm({ title: '', date: '', cover: '' });
      setPortadaFile(null);
      setShowCreateAlbumModal(false);
      setGaleriaMsg({ tipo: 'exito', texto: t('gal.albumCreado') });
      await cargarAlbumes();
      setTimeout(() => setGaleriaMsg(null), 5000);
    } else {
      setGaleriaMsg({ tipo: 'error', texto: error });
    }
  };

  /** Guarda título y fecha de un álbum existente. */
  const handleGuardarAlbum = async (e) => {
    e.preventDefault();
    if (!albumEditando?.id) return;

    setSubiendoGaleria(true);
    const { success, error } = await actualizarAlbum(albumEditando.id, {
      titulo: albumEditando.title,
      fecha: albumEditando.date,
      portadaFile: nuevaPortadaFile,
      proyectoId: project?.id
    });
    setSubiendoGaleria(false);

    if (success) {
      setAlbumEditando(null);
      setNuevaPortadaFile(null);
      setGaleriaMsg({ tipo: 'exito', texto: t('gal.albumActualizado') });
      await cargarAlbumes();
      setTimeout(() => setGaleriaMsg(null), 5000);
    } else {
      setGaleriaMsg({ tipo: 'error', texto: error });
    }
  };

  const handleEliminarAlbum = async (album) => {
    if (!confirm(t('dlg.eliminarAlbum', { titulo: album?.title }))) return;

    setSubiendoGaleria(true);
    const { success, error } = await eliminarAlbum(album);
    setSubiendoGaleria(false);

    if (success) {
      setActiveAlbumModal(null);
      setGaleriaMsg({ tipo: 'exito', texto: t('gal.albumEliminado') });
      await cargarAlbumes();
      setTimeout(() => setGaleriaMsg(null), 5000);
    } else {
      setGaleriaMsg({ tipo: 'error', texto: error });
    }
  };

  /** Sube una foto al álbum abierto. */
  const handleSubirFoto = async (e, albumId) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setSubiendoGaleria(true);
    setGaleriaMsg(null);

    const { success, error } = await subirFotoAlbum(file, project?.id, albumId);

    setSubiendoGaleria(false);

    if (success) {
      setGaleriaMsg({ tipo: 'exito', texto: t('gal.fotoSubida') });
      const { albumes } = await getAlbumes(project.id);
      setAlbums(albumes);
      // Mantener abierto el mismo álbum con sus fotos ya actualizadas
      if (albumId) setActiveAlbumModal(albumes.find(a => String(a.id) === String(albumId)) || null);
      setTimeout(() => setGaleriaMsg(null), 5000);
    } else {
      setGaleriaMsg({ tipo: 'error', texto: error });
    }
  };

  /** Elimina una foto concreta dentro del álbum. */
  const handleEliminarFoto = async (foto, albumId) => {
    if (!confirm(t('dlg.eliminarFoto'))) return;

    setSubiendoGaleria(true);
    const { success, error } = await eliminarFoto(foto);
    setSubiendoGaleria(false);

    if (success) {
      const { albumes } = await getAlbumes(project.id);
      setAlbums(albumes);
      if (albumId) setActiveAlbumModal(albumes.find(a => String(a.id) === String(albumId)) || null);
      setGaleriaMsg({ tipo: 'exito', texto: t('gal.fotoEliminada') });
      setTimeout(() => setGaleriaMsg(null), 5000);
    } else {
      setGaleriaMsg({ tipo: 'error', texto: error });
    }
  };


  /* ── Finanzas editables ──────────────────────────────────────────────────
     `finanzas` es la fuente de verdad de la pestaña: se inicializa con lo que
     trae Supabase y se actualiza en vivo mientras el administrador escribe,
     así la gráfica y la alerta de sobrecosto reaccionan al instante. */
  const [finanzas, setFinanzas] = useState({
    presupuesto: Number(project?.presupuesto_total ?? data.budget ?? 0),
    anticipo: Number(project?.anticipo ?? data.advancePayment ?? 0),
    cuota: Number(project?.cuota_asignada ?? 0)
  });
  const [editandoFinanzas, setEditandoFinanzas] = useState(false);
  const [guardandoFinanzas, setGuardandoFinanzas] = useState(false);
  const [finanzasMsg, setFinanzasMsg] = useState(null);

  // Re-sincroniza si cambia el proyecto o llegan datos nuevos por Realtime
  useEffect(() => {
    if (editandoFinanzas) return;   // no pisar lo que se está escribiendo
    setFinanzas({
      presupuesto: Number(project?.presupuesto_total ?? data.budget ?? 0),
      anticipo: Number(project?.anticipo ?? data.advancePayment ?? 0),
      cuota: Number(project?.cuota_asignada ?? 0)
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, project?.presupuesto_total, project?.anticipo, project?.cuota_asignada]);

  const handleCampoFinanzas = (campo, valor) => {
    setFinanzas(prev => ({ ...prev, [campo]: aNumero(valor) }));
    setFinanzasMsg(null);
  };

  const handleGuardarFinanzas = async () => {
    setGuardandoFinanzas(true);
    setFinanzasMsg(null);

    const { success, valores, error } = await guardarFinanzas(project?.id, finanzas);

    setGuardandoFinanzas(false);

    if (success) {
      if (project) {
        project.presupuesto_total = valores.presupuesto_total;
        project.anticipo = valores.anticipo;
        project.cuota_asignada = valores.cuota_asignada;
      }
      setEditandoFinanzas(false);
      setFinanzasMsg({ tipo: 'exito', texto: t('fin.guardado') });
      if (typeof onUpdateProject === 'function') await onUpdateProject();
      setTimeout(() => setFinanzasMsg(null), 5000);
    } else {
      setFinanzasMsg({ tipo: 'error', texto: error });
    }
  };

  const handleCancelarFinanzas = () => {
    setFinanzas({
      presupuesto: Number(project?.presupuesto_total ?? data.budget ?? 0),
      anticipo: Number(project?.anticipo ?? data.advancePayment ?? 0),
      cuota: Number(project?.cuota_asignada ?? 0)
    });
    setEditandoFinanzas(false);
    setFinanzasMsg(null);
  };

  // Cálculos derivados: reaccionan a cada tecla mientras se edita
  const totalBudget = Number(finanzas.presupuesto) || 0;
  const totalSpent = Number(project.totalGastado || data.spent || 0);
  const advancePayment = Number(finanzas.anticipo) || 0;
  const cuotaAsignada = Number(finanzas.cuota) || 0;
  const isOverBudget = totalSpent > totalBudget;
  const overBudgetAmount = isOverBudget ? totalSpent - totalBudget : 0;

  // Datos de la gráfica de facturas agrupados por mes
  const gastosPorMes = agruparGastosPorMes(facturas, language);

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-zinc-900 relative">

      {/* ── Header ── */}
      <header className="flex-shrink-0 px-6 md:px-10 pt-8 pb-5 border-b border-gray-100 dark:border-zinc-700 flex items-center justify-between gap-5">
        <div className="flex items-center gap-5">
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-slate-400 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-white text-base font-medium transition-colors rounded-xl px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-zinc-700/50 -ml-3"
          >
            <ArrowLeft size={20} />
            {t('proy.volver')}
          </button>
          <div className="h-6 w-px bg-gray-200" />
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-slate-900 dark:text-white tracking-tight uppercase flex items-center gap-2">
              {project.title || project.nombre}
            </h1>
            <p className="text-xs md:text-sm text-slate-400 dark:text-zinc-400 mt-0.5 uppercase tracking-widest font-medium">{project.tag || project.ubicacion}</p>
          </div>
        </div>
      </header>

      {/* Banner Notificación de Guardado */}
      {saveSuccessMsg && (
        <div className="bg-emerald-50 dark:bg-emerald-500/10 border-b border-emerald-200 dark:border-emerald-500/30 text-emerald-900 dark:text-emerald-200 px-6 py-2.5 text-xs md:text-sm font-bold flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={18} className="text-emerald-600 flex-shrink-0" />
            <span>{saveSuccessMsg}</span>
          </div>
          <button onClick={() => setSaveSuccessMsg(null)} className="text-emerald-500 hover:text-emerald-800"><X size={16} /></button>
        </div>
      )}

      {/* Banner de Error de Guardado (nunca se oculta un fallo real de Supabase) */}
      {saveErrorMsg && (
        <div className="bg-red-50 dark:bg-red-500/10 border-b border-red-200 dark:border-red-500/30 text-red-900 dark:text-red-200 px-6 py-2.5 text-xs md:text-sm font-bold flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldAlert size={18} className="text-red-600 flex-shrink-0" />
            <span>{saveErrorMsg}</span>
          </div>
          <button onClick={() => setSaveErrorMsg(null)} className="text-red-500 hover:text-red-800"><X size={16} /></button>
        </div>
      )}

      {/* ── Tabs ── */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 md:px-10 border-b border-gray-100 dark:border-zinc-700 w-full">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex flex-col md:flex-row justify-center items-center gap-1.5 md:gap-2.5 py-4 text-xs md:text-base font-medium border-b-[3px] transition-all -mb-px ${
                active
                  ? 'text-slate-900 dark:text-white border-slate-900 dark:border-[#C5A059]'
                  : 'text-slate-400 dark:text-zinc-400 border-transparent hover:text-slate-600 dark:hover:text-zinc-200 hover:border-slate-300'
              }`}
            >
              <Icon size={18} />
              {t(tab.claveLabel)}
            </button>
          );
        })}
      </div>

      {/* ── Content Area ── */}
      <div className="flex-1 overflow-y-auto px-6 md:px-10 pt-8 pb-32 md:pb-10">

        {/* ════ RESUMEN (Checklist Cronológico Inteligente) ════ */}
        {activeTab === 'summary' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            
            <div className="lg:col-span-2">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
                <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-zinc-400 flex items-center gap-2">
                  <CheckSquare size={14} className="text-[#C5A059]" /> {t('proy.checklist')}
                </h2>
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="text-xs font-bold text-slate-600 dark:text-zinc-300 bg-slate-100 dark:bg-zinc-700 px-3.5 py-1.5 rounded-xl border border-gray-200 dark:border-zinc-700">
                    {completados} / {safeChecklist.length} {t('proy.completados')}
                  </span>
                  {hayCambiosSinGuardar && (
                    <span className="text-xs font-bold text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 px-3.5 py-1.5 rounded-xl border border-amber-200 dark:border-amber-500/30 flex items-center gap-1.5">
                      <AlertTriangle size={13} className="text-amber-600" />
                      {t('proy.cambiosSinGuardar')}
                    </span>
                  )}
                  {!isLoadingChecklist && !checklistPersistido && safeChecklist.length > 0 && (
                    <span className="text-xs font-semibold text-slate-500 dark:text-zinc-400 bg-white dark:bg-zinc-800 px-3.5 py-1.5 rounded-xl border border-dashed border-gray-300 dark:border-zinc-600">
                      {t('proy.plantillaInicial')}
                    </span>
                  )}
                  <button
                    onClick={handleSaveAllChanges}
                    disabled={isSavingChanges || isLoadingChecklist}
                    className="flex items-center gap-1.5 bg-[#FAF4EA] dark:bg-amber-500/10 text-[#8B6914] dark:text-[#E3C77B] border border-[#F0E2CD] dark:border-amber-500/30 text-xs font-bold px-3.5 py-1.5 rounded-xl hover:bg-[#F3E7D3] dark:hover:bg-amber-500/20 transition-colors shadow-sm disabled:opacity-50 active:scale-95"
                  >
                    {isSavingChanges ? (
                      <>
                        <Loader2 size={14} className="animate-spin text-[#C5A059]" />
                        {t('proy.guardando')}
                      </>
                    ) : (
                      <>
                        <Save size={14} className="text-[#C5A059]" />
                        {t('proy.guardarCambios')}
                      </>
                    )}
                  </button>
                </div>
              </div>

              {isLoadingChecklist && (
                <div className="flex items-center justify-center gap-3 py-16 text-slate-400 dark:text-zinc-400">
                  <Loader2 size={20} className="animate-spin text-[#C5A059]" />
                  <span className="text-sm font-semibold">{t('proy.cargandoChecklist')}</span>
                </div>
              )}

              {!isLoadingChecklist && safeChecklist.length === 0 && (
                <div className="border border-dashed border-gray-300 dark:border-zinc-600 rounded-[20px] bg-slate-50/60 dark:bg-zinc-800/60 py-12 px-6 text-center">
                  <CheckSquare size={28} className="text-slate-300 dark:text-zinc-400 mx-auto mb-3" />
                  <p className="text-sm font-bold text-slate-600 dark:text-zinc-300">{t('proy.sinHitos')}</p>
                  <p className="text-xs text-slate-400 dark:text-zinc-400 mt-1">
                    {(isAdmin || isEditMode)
                      ? t('proy.sinHitosAdmin')
                      : t('proy.sinHitosLector')}
                  </p>
                </div>
              )}

              <ul className="space-y-3.5">
                {!isLoadingChecklist && safeChecklist.map((item, i) => {
                  const isDone = !!item.done;
                  const title = item.text || item.titulo || t('proy.hitoSinTitulo');
                  const detail = item.detail || item.descripcion || t('proy.sinDetalle');
                  const dateStr = item.fecha || item.fecha_vencimiento || t('proy.sinFecha');

                  return (
                    <li key={item.id ?? `nuevo-${i}`} className="border border-gray-100 dark:border-zinc-700 rounded-[20px] bg-white dark:bg-zinc-800 shadow-sm hover:shadow-md transition-shadow overflow-hidden">
                      <div className="w-full flex items-start justify-between gap-4 p-5 hover:bg-slate-50/50 dark:hover:bg-zinc-700/30 transition-colors text-left">
                        <div className="flex items-start gap-4 flex-1 min-w-0">
                          {/* Checkbox toggle */}
                          <button
                            onClick={() => handleToggleHito(i)}
                            className="mt-0.5 focus:outline-none"
                            title={isDone ? t('proy.marcarPendiente') : t('proy.marcarHecho')}
                          >
                            {isDone
                              ? <CheckSquare size={22} className="text-[#C5A059] flex-shrink-0" />
                              : <Square size={22} className="text-slate-300 dark:text-zinc-400 hover:text-slate-500 flex-shrink-0" />
                            }
                          </button>

                          <div className="flex-1 min-w-0">
                            <div className="cursor-pointer" onClick={() => setOpenAccordion(openAccordion === i ? null : i)}>
                              <div className="flex flex-wrap items-center gap-2">
                                <span className={`text-base md:text-lg font-bold ${isDone ? 'text-slate-900 dark:text-white' : 'text-slate-800 dark:text-zinc-100'}`}>
                                  {title}
                                </span>
                              </div>
                              <div className="flex flex-wrap items-center gap-2 mt-1.5">
                                {isDone ? (
                                  <span className="inline-flex items-center gap-1 text-[11px] font-bold bg-emerald-50 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 px-2.5 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-500/30">
                                    <CheckCircle2 size={12} className="text-emerald-600" />
                                    {t('proy.hecho')} {dateStr}
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-slate-100 dark:bg-zinc-700 text-slate-600 dark:text-zinc-300 px-2.5 py-0.5 rounded-full border border-gray-200 dark:border-zinc-700">
                                    <Calendar size={12} className="text-slate-400 dark:text-zinc-400" />
                                    {t('proy.proyectadoPara')} {dateStr}
                                  </span>
                                )}
                                {(item.id === null || item.id === undefined) && (
                                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-300 px-2.5 py-0.5 rounded-full border border-amber-200 dark:border-amber-500/30">
                                    <AlertTriangle size={12} className="text-amber-600" />
                                    {t('proy.sinGuardarSupabase')}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {(isAdmin || isEditMode) && (
                            <>
                              <button
                                onClick={() => handleStartEditHito(i)}
                                disabled={isSavingChanges}
                                className="p-1.5 text-slate-400 dark:text-zinc-400 hover:text-[#C5A059] rounded-lg hover:bg-amber-50 transition-colors disabled:opacity-40"
                                title={t('proy.editarTarea')}
                              >
                                <Edit2 size={16} />
                              </button>
                              <button
                                onClick={() => handleDeleteHito(i)}
                                disabled={isSavingChanges}
                                className="p-1.5 text-slate-300 dark:text-zinc-400 hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-40"
                                title={t('proy.eliminarTarea')}
                              >
                                <Trash2 size={16} />
                              </button>
                            </>
                          )}
                          <button onClick={() => setOpenAccordion(openAccordion === i ? null : i)}>
                            {openAccordion === i ? <ChevronUp size={20} className="text-slate-400 dark:text-zinc-400" /> : <ChevronDown size={20} className="text-slate-400 dark:text-zinc-400" />}
                          </button>
                        </div>
                      </div>

                      {openAccordion === i && (
                        <div className="px-5 pb-5 pt-1 text-sm md:text-base text-slate-600 dark:text-zinc-300 pl-[52px] leading-relaxed relative border-t border-gray-50 dark:border-zinc-700 bg-slate-50/30 dark:bg-zinc-700/20">
                          <p className="mt-2 text-slate-600 dark:text-zinc-300 font-medium">{detail}</p>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
              {/* ── CRUD de Checklist: alta de tareas (solo Administrador) ── */}
              {(isAdmin || isEditMode) && (
                <>
                  <form onSubmit={handleAddHito} className="mt-4 flex flex-col sm:flex-row sm:items-center gap-3 bg-white dark:bg-zinc-800 p-3 rounded-2xl border border-gray-200 dark:border-zinc-700 shadow-sm focus-within:border-[#C5A059] focus-within:ring-1 focus-within:ring-[#C5A059] transition-all">
                    <input
                      type="text"
                      placeholder={t('proy.nuevaTarea')}
                      value={newItemText}
                      onChange={(e) => setNewItemText(e.target.value)}
                      className="flex-1 bg-transparent border-none outline-none focus:ring-0 text-sm text-slate-700 dark:text-zinc-200 px-2 placeholder-slate-400"
                    />
                    <button
                      type="submit"
                      disabled={!newItemText.trim() || isSavingChanges}
                      className="flex items-center justify-center gap-2 flex-shrink-0 bg-[#0B1B2C] text-white px-4 py-2 rounded-xl hover:bg-slate-800 transition-colors disabled:opacity-50"
                      title={t('proy.agregarChecklist')}
                    >
                      <Plus size={16} className="text-[#C5A059]" />
                      <span className="text-xs font-bold">{t('proy.agregarTarea')}</span>
                    </button>
                  </form>

                  <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 px-1">
                    <p className="text-[11px] text-slate-400 dark:text-zinc-400 font-medium">
                      {t('proy.ayudaGuardado', { boton: t('proy.guardarCambios') })}
                    </p>
                    <button
                      type="button"
                      onClick={() => setShowAddHitoModal(true)}
                      className="flex items-center gap-1.5 text-[11px] font-bold text-[#8B6914] dark:text-[#E3C77B] bg-[#FAF4EA] dark:bg-amber-500/10 border border-[#F0E2CD] dark:border-amber-500/30 px-3 py-1.5 rounded-xl hover:bg-[#F3E7D3] dark:hover:bg-amber-500/20 transition-colors flex-shrink-0"
                      title={t('proy.hitoConDetalleTooltip')}
                    >
                      <Plus size={13} className="text-[#C5A059]" /> {t('proy.hitoConDetalle')}
                    </button>
                  </div>
                </>
              )}
            </div>

            <div className="space-y-6">
              <div className="bg-white dark:bg-zinc-800 border border-gray-100 dark:border-zinc-700 rounded-2xl p-6 shadow-sm flex flex-col items-center">
                <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-zinc-400 w-full mb-3 text-center">{t('proy.avanceCronologico')}</h3>
                <div className="w-full h-44 relative">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={[
                          { name: t('proy.completado'), value: completados },
                          { name: t('dash.pendiente'), value: Math.max(safeChecklist.length - completados, 0) }
                        ]}
                        cx="50%"
                        cy="50%"
                        innerRadius={45}
                        outerRadius={65}
                        startAngle={90}
                        endAngle={-270}
                        dataKey="value"
                        stroke="none"
                      >
                        <Cell key="cell-0" fill="#0B1B2C" />
                        <Cell key="cell-1" fill="#f1f5f9" />
                      </Pie>
                      <Tooltip 
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)' }}
                        itemStyle={{ color: '#0f172a', fontSize: '12px', fontWeight: 700 }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-2xl font-black text-slate-900 dark:text-white">{avancePct}%</span>
                    <span className="text-[10px] font-bold text-slate-400 dark:text-zinc-400 uppercase tracking-widest">{t('dash.ejecutado')}</span>
                  </div>
                </div>
              </div>

              <div className="bg-slate-50 dark:bg-zinc-800 border border-gray-100 dark:border-zinc-700 rounded-2xl p-6 relative">
                <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-zinc-400 mb-3">{t('proy.descripcionGeneral')}</h3>
                <p className="text-sm text-slate-600 dark:text-zinc-300 leading-relaxed font-medium">{project.description || project.descripcion}</p>
              </div>
            </div>
          </div>
        )}

        {/* ════ FINANZAS & CONTROL DE FACTURACIÓN ════ */}
        {activeTab === 'finances' && !showExpenses && (
          <div className="flex flex-col gap-6">
            
            {/* Action Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-400 dark:text-zinc-400">{t('fin.titulo')}</h2>
              <div className="flex flex-wrap items-center gap-2">
                {/* Edición de cifras: solo administrador */}
                {(isAdmin || isEditMode) && (
                  editandoFinanzas ? (
                    <>
                      <button
                        onClick={handleCancelarFinanzas}
                        disabled={guardandoFinanzas}
                        className="inline-flex items-center gap-1.5 bg-white dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 border border-gray-200 dark:border-zinc-700 font-bold px-3.5 py-2.5 rounded-xl text-xs hover:bg-slate-50 dark:hover:bg-zinc-700 transition-all disabled:opacity-50"
                      >
                        <X size={15} /> {t('comun.cancelar')}
                      </button>
                      <button
                        onClick={handleGuardarFinanzas}
                        disabled={guardandoFinanzas}
                        className="inline-flex items-center gap-1.5 bg-[#FAF4EA] dark:bg-amber-500/15 text-[#8B6914] dark:text-[#E3C77B] border border-[#F0E2CD] dark:border-amber-500/30 font-bold px-4 py-2.5 rounded-xl text-xs hover:bg-[#F3E7D3] transition-all shadow-sm disabled:opacity-50 active:scale-95"
                      >
                        {guardandoFinanzas
                          ? <><Loader2 size={15} className="animate-spin text-[#C5A059]" /> {t('proy.guardando')}</>
                          : <><Save size={15} className="text-[#C5A059]" /> {t('proy.guardarCambios')}</>}
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setEditandoFinanzas(true)}
                      className="inline-flex items-center gap-1.5 bg-white dark:bg-zinc-800 text-slate-700 dark:text-zinc-200 border border-gray-200 dark:border-zinc-700 font-bold px-4 py-2.5 rounded-xl text-xs hover:bg-slate-50 dark:hover:bg-zinc-700 transition-all shadow-sm"
                    >
                      <Edit2 size={15} className="text-[#C5A059]" /> {t('fin.editarCifras')}
                    </button>
                  )
                )}
                <button
                  onClick={() => setShowExpenses(true)}
                  className="inline-flex items-center gap-2 bg-[#0B1B2C] text-white font-bold px-4 py-2.5 rounded-xl text-xs sm:text-sm hover:bg-[#16273B] transition-all shadow-sm"
                >
                  <Receipt size={16} className="text-[#C5A059]" /> {t('fin.verFacturas')} ({facturas.length})
                </button>
              </div>
            </div>

            {/* ⚠️ ALERTA VISUAL DE SOBRECOSTO ⚠️ */}
            {isOverBudget && (
              <div className="bg-red-50 dark:bg-red-500/10 border-2 border-red-200 dark:border-red-500/30 rounded-2xl p-5 flex items-center gap-4 text-red-900 dark:text-red-200 shadow-sm animate-pulse">
                <div className="w-12 h-12 rounded-xl bg-red-100 flex items-center justify-center flex-shrink-0 text-red-600">
                  <AlertTriangle size={26} />
                </div>
                <div className="flex-1">
                  <h4 className="text-sm font-bold uppercase tracking-wider text-red-800 dark:text-red-300">{t('fin.alertaSobrecosto')}</h4>
                  <p className="text-xs md:text-sm text-red-700 mt-1 font-medium">
                    {t('fin.sobrecostoDetalle', {
                      gastado: `$${totalSpent.toLocaleString()} USD`,
                      presupuesto: `$${totalBudget.toLocaleString()} USD`,
                      exceso: `$${overBudgetAmount.toLocaleString()} USD`
                    })}
                  </p>
                </div>
              </div>
            )}

            {/* Aviso de guardado de finanzas */}
            {finanzasMsg && (
              <div className={`p-4 rounded-2xl border flex items-start gap-3 text-xs font-semibold ${
                finanzasMsg.tipo === 'exito'
                  ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30'
                  : 'bg-red-50 dark:bg-red-500/10 text-red-800 dark:text-red-300 border-red-200 dark:border-red-500/30'
              }`}>
                {finanzasMsg.tipo === 'exito'
                  ? <CheckCircle2 size={16} className="flex-shrink-0 mt-px" />
                  : <ShieldAlert size={16} className="flex-shrink-0 mt-px" />}
                <span>{finanzasMsg.texto}</span>
              </div>
            )}

            {/* 4 TARJETAS DE MÉTRICAS (editables para administrador) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              <TarjetaMonto
                etiqueta={t('fin.presupuestoTotal')}
                pie={t('fin.usdProyectado')}
                valor={finanzas.presupuesto}
                editando={editandoFinanzas}
                onChange={(v) => handleCampoFinanzas('presupuesto', v)}
                colorValor="text-slate-900 dark:text-white"
              />

              <TarjetaMonto
                etiqueta={t('fin.anticipo')}
                pie={t('fin.anticipoDesc')}
                valor={finanzas.anticipo}
                editando={editandoFinanzas}
                onChange={(v) => handleCampoFinanzas('anticipo', v)}
                colorValor="text-[#C5A059]"
              />

              <TarjetaMonto
                etiqueta={t('fin.cuotaAsignada')}
                pie={t('fin.cuotaAsignadaDesc')}
                valor={finanzas.cuota}
                editando={editandoFinanzas}
                onChange={(v) => handleCampoFinanzas('cuota', v)}
                colorValor="text-slate-900 dark:text-white"
              />

              {/* Costo ejecutado: se calcula desde los gastos, no se edita */}
              <div className={`border shadow-sm rounded-2xl p-5 ${isOverBudget ? 'bg-red-50/50 dark:bg-red-500/10 border-red-200 dark:border-red-500/30' : 'bg-white dark:bg-zinc-800 border-gray-100 dark:border-zinc-700'}`}>
                <p className="text-xs text-slate-400 dark:text-zinc-400 uppercase font-bold tracking-wider mb-2">{t('fin.costoEjecutado')}</p>
                <p className={`text-2xl md:text-3xl font-black ${isOverBudget ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-white'}`}>${totalSpent.toLocaleString()}</p>
                <p className="text-xs text-slate-400 dark:text-zinc-400 mt-1 font-semibold">
                  {Math.round((totalSpent / (totalBudget || 1)) * 100)}% {t('fin.presupuestoEjecutado')}
                </p>
              </div>
            </div>

            {/* Gráfica de Ejecución */}
            <div className="bg-white dark:bg-zinc-800 border border-gray-100 dark:border-zinc-700 shadow-sm rounded-2xl p-6">
              <p className="text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-zinc-400 mb-4">{t('fin.ejecucionMensual')}</p>
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.monthlyData || []}>
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#94a3b8' }} dy={10} />
                    <Tooltip 
                      cursor={{ fill: '#f8fafc' }} 
                      contentStyle={{ borderRadius: '12px', border: '1px solid #f1f5f9', boxShadow: '0 10px 25px rgba(0,0,0,0.05)' }} 
                      formatter={(value) => [`$${value.toLocaleString()}`, t('fin.gasto')]}
                    />
                    <Bar dataKey="value" fill="#0B1B2C" radius={[6, 6, 0, 0]} maxBarSize={44} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}

        {/* SUBPANEL DE FACTURAS DE PROVEEDORES */}
        {activeTab === 'finances' && showExpenses && (
          <div className="space-y-6">
            <div className="flex items-center justify-between pb-4 border-b border-gray-200 dark:border-zinc-700">
              <div className="flex items-center gap-3">
                <button onClick={() => setShowExpenses(false)} className="text-slate-400 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-white p-1.5 rounded-lg border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 shadow-sm">
                  <ArrowLeft size={18} />
                </button>
                <div>
                  <h2 className="text-lg font-bold text-slate-900 dark:text-white">{t('fin.facturasTitulo')}</h2>
                  <p className="text-xs text-slate-400 dark:text-zinc-400 font-medium">{t('fin.facturasSub')}</p>
                </div>
              </div>
              {isAdmin && (
                <button
                  onClick={() => setShowInvoiceModal(true)}
                  className="flex items-center gap-2 bg-[#0B1B2C] text-white text-xs font-bold px-4 py-2.5 rounded-xl hover:bg-slate-800 transition-colors shadow-sm"
                >
                  <Plus size={14} className="text-[#C5A059]" /> {t('fin.registrarFactura')}
                </button>
              )}
            </div>

            {/* Gráfica de gastos agrupados por mes */}
            {gastosPorMes.length > 0 && (
              <div className="bg-white dark:bg-zinc-800 border border-gray-100 dark:border-zinc-700 shadow-sm rounded-2xl p-6">
                <div className="flex items-center justify-between mb-4">
                  <p className="text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-zinc-400">
                    {t('fin.gastosPorMes')}
                  </p>
                  <span className="text-xs font-black text-slate-900 dark:text-white">
                    {formatearMoneda(gastosPorMes.reduce((s, m) => s + m.total, 0))}
                  </span>
                </div>
                <div className="h-56 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={gastosPorMes} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                      <XAxis
                        dataKey="name"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 11, fill: '#94a3b8' }}
                        dy={8}
                      />
                      <Tooltip
                        cursor={{ fill: 'rgba(197,160,89,0.10)' }}
                        contentStyle={{
                          borderRadius: '12px',
                          border: '1px solid rgba(148,163,184,0.25)',
                          background: 'rgba(24,24,27,0.95)',
                          boxShadow: '0 10px 25px rgba(0,0,0,0.25)'
                        }}
                        labelStyle={{ color: '#E3C77B', fontWeight: 700, fontSize: 12 }}
                        itemStyle={{ color: '#fff', fontSize: 12, fontWeight: 700 }}
                        formatter={(value, _n, item) => [
                          `${formatearMoneda(value)}  ·  ${item?.payload?.cantidad ?? 0} ${t('fin.facturasAbrev')}`,
                          t('fin.totalMes')
                        ]}
                      />
                      <Bar dataKey="total" fill="#C5A059" radius={[6, 6, 0, 0]} maxBarSize={48} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 gap-3">
              {facturas.map((fac) => (
                <div key={fac.id} className="p-4 bg-white dark:bg-zinc-800 border border-gray-100 dark:border-zinc-700 rounded-2xl shadow-sm hover:shadow-md transition-shadow flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="w-11 h-11 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200/80 flex items-center justify-center flex-shrink-0 text-[#8B6914] dark:text-[#E3C77B]">
                      <Receipt size={20} />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-slate-900 dark:text-white">{fac.proveedor}</h4>
                      <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">{fac.concepto}</p>
                      <span className="inline-block text-[10px] font-semibold text-slate-400 dark:text-zinc-400 mt-1">{fac.comprobante} • {fac.fecha}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between sm:justify-end gap-4 border-t sm:border-t-0 pt-3 sm:pt-0">
                    <span className="text-base font-black text-slate-900 dark:text-white">${fac.monto.toLocaleString()} USD</span>
                    <button
                      onClick={() => alert(t('proy.visualizando', { comprobante: fac.comprobante, proveedor: fac.proveedor }))}
                      className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-zinc-200 bg-slate-100 dark:bg-zinc-700 px-3 py-1.5 rounded-xl hover:bg-slate-200 transition-colors"
                    >
                      <Eye size={13} /> {t('fin.verPDF')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ════ DOCUMENTOS ════ */}
        {activeTab === 'documents' && (
          <div className="max-w-3xl">
            <input
              type="file"
              ref={docInputRef}
              onChange={(e) => handleFileUpload(e, 'documento_pdf')}
              accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
              className="hidden"
            />

            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-400 dark:text-zinc-400">{t('doc.archivos')}</h2>
                <p className="text-[11px] text-slate-400 dark:text-zinc-400 mt-0.5">{t('doc.bucket')} <span className="font-mono font-semibold text-slate-500 dark:text-zinc-400">archivos_mmcapital</span></p>
              </div>
              {isAdmin && (
                <button
                  onClick={() => docInputRef.current?.click()}
                  disabled={isUploading}
                  className="inline-flex items-center gap-2 border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-700 dark:text-zinc-200 text-xs font-medium px-4 py-2.5 rounded-xl hover:bg-slate-50 dark:hover:bg-zinc-700/50 active:scale-[0.97] transition-all shadow-sm disabled:opacity-50"
                >
                  {isUploading ? (
                    <>
                      <Loader2 size={14} className="animate-spin text-[#C5A059]" />
                      {t('comun.procesando')}
                    </>
                  ) : (
                    <>
                      <Upload size={14} className="text-[#C5A059]" />
                      {t('doc.subirDoc')}
                    </>
                  )}
                </button>
              )}
            </div>

            {uploadMessage && (
              <div className={`mb-5 p-4 rounded-2xl border flex items-center gap-3 text-xs font-semibold ${
                uploadMessage.type === 'success' ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30' : 'bg-red-50 dark:bg-red-500/10 text-red-800 dark:text-red-300 border-red-200 dark:border-red-500/30'
              }`}>
                {uploadMessage.type === 'success' ? <CheckCircle2 size={16} className="text-emerald-600 flex-shrink-0" /> : <AlertTriangle size={16} className="text-red-600 flex-shrink-0" />}
                <span>{uploadMessage.text}</span>
              </div>
            )}

            {(() => {
              const docs = (Array.isArray(archivosDB) ? archivosDB : [])
                .filter(a => a && a.tipo !== 'foto_galeria');

              if (docs.length === 0) {
                return (
                  <div className="border border-dashed border-gray-300 dark:border-zinc-600 rounded-2xl bg-slate-50/60 dark:bg-zinc-800/60 py-12 px-6 text-center">
                    <FileText size={28} className="text-slate-300 dark:text-zinc-400 mx-auto mb-3" />
                    <p className="text-sm font-bold text-slate-600 dark:text-zinc-300">{t('doc.vacio')}</p>
                    <p className="text-xs text-slate-400 dark:text-zinc-400 mt-1">
                      {isAdmin
                        ? t('doc.vacioAdmin')
                        : t('doc.vacioLector')}
                    </p>
                  </div>
                );
              }

              return (
                <ul className="space-y-3">
                  {docs.map((doc, i) => (
                    <li key={doc.id ?? i} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 p-4 bg-white dark:bg-zinc-800 border border-gray-100 dark:border-zinc-700 rounded-2xl shadow-sm hover:shadow-md transition-shadow group">
                      <div className="flex items-center gap-3.5 min-w-0 flex-1">
                        <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                          <FileText size={18} className="text-blue-600 dark:text-blue-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-slate-800 dark:text-zinc-100 truncate">{doc.nombre_archivo}</p>
                          <p className="text-xs text-slate-400 dark:text-zinc-400 mt-0.5 flex items-center gap-2 flex-wrap">
                            <span>{doc.created_at ? new Date(doc.created_at).toLocaleDateString(locale) : t('doc.delProyecto')}</span>
                            {doc.url_archivo && <span className="text-emerald-600 font-semibold">{t('doc.enBucket')}</span>}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 flex-shrink-0">
                        {doc.url_archivo && (
                          <a
                            href={doc.url_archivo}
                            download={doc.nombre_archivo}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1.5 text-xs font-bold text-white bg-[#0B1B2C] px-3.5 py-1.5 rounded-xl hover:bg-slate-800 transition-colors shadow-sm"
                          >
                            <Download size={13} className="text-[#C5A059]" /> {t('comun.descargar')}
                          </a>
                        )}

                        {/* Poderes de Administrador sobre el documento */}
                        {isAdmin && (
                          <>
                            <button
                              onClick={() => handleRenameArchivo(doc)}
                              disabled={isUploading}
                              className="p-2 text-slate-400 dark:text-zinc-400 hover:text-[#C5A059] rounded-xl hover:bg-amber-50 border border-gray-200 dark:border-zinc-700 transition-colors disabled:opacity-40"
                              title={t('doc.editarNombre')}
                            >
                              <Edit2 size={15} />
                            </button>
                            <button
                              onClick={() => handleDeleteArchivo(doc)}
                              disabled={isUploading}
                              className="p-2 text-slate-300 dark:text-zinc-400 hover:text-red-500 rounded-xl hover:bg-red-50 border border-gray-200 dark:border-zinc-700 transition-colors disabled:opacity-40"
                              title={t('doc.eliminarArchivo')}
                            >
                              <Trash2 size={15} />
                            </button>
                          </>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              );
            })()}
          </div>
        )}

        {/* ════ GALERÍA DE ÁLBUMES REGISTRADOS ════ */}
        {activeTab === 'gallery' && (
          <div className="max-w-5xl space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-zinc-400">{t('gal.titulo')}</h2>
                <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">{t('gal.subtitulo')}</p>
              </div>
              {isAdmin && (
                <div className="flex items-center gap-2">
                  {/* Abre el selector de destino en vez de subir a la nada:
                      una foto siempre tiene que caer dentro de un álbum. */}
                  <button
                    onClick={() => { setDestinoFoto(albums[0]?.id || ''); setShowDestinoModal(true); }}
                    disabled={subiendoGaleria}
                    className="flex items-center gap-1.5 bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 text-slate-700 dark:text-zinc-200 text-xs font-bold px-3.5 py-2.5 rounded-xl hover:bg-slate-50 dark:hover:bg-zinc-700/50 transition-colors shadow-sm disabled:opacity-50"
                  >
                    {subiendoGaleria ? (
                      <>
                        <Loader2 size={15} className="animate-spin text-[#C5A059]" />
                        {t('comun.subiendo')}
                      </>
                    ) : (
                      <>
                        <Upload size={15} className="text-[#C5A059]" />
                        {t('gal.subirFoto')}
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => setShowCreateAlbumModal(true)}
                    className="flex items-center gap-2 bg-[#0B1B2C] text-white text-xs font-bold px-4 py-2.5 rounded-xl hover:bg-slate-800 transition-colors shadow-sm"
                  >
                    <FolderPlus size={15} className="text-[#C5A059]" /> {t('gal.crearAlbum')}
                  </button>
                </div>
              )}
            </div>

            {uploadMessage && (
              <div className={`p-4 rounded-2xl border flex items-center gap-3 text-xs font-semibold ${
                uploadMessage.type === 'success' ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30' : 'bg-red-50 dark:bg-red-500/10 text-red-800 dark:text-red-300 border-red-200 dark:border-red-500/30'
              }`}>
                {uploadMessage.type === 'success' ? <CheckCircle2 size={16} className="text-emerald-600 flex-shrink-0" /> : <AlertTriangle size={16} className="text-red-600 flex-shrink-0" />}
                <span>{uploadMessage.text}</span>
              </div>
            )}

            {/* ALBUMS GRID */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {albums.map((album) => (
                <div
                  key={album.id}
                  onClick={() => setActiveAlbumModal(album)}
                  className="group cursor-pointer bg-white dark:bg-zinc-800 border border-gray-100 dark:border-zinc-700 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-all flex flex-col"
                >
                  <div className="w-full aspect-[4/3] overflow-hidden relative bg-slate-100 dark:bg-zinc-700">
                    <img
                      src={album.cover}
                      alt={album.title}
                      className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-60 group-hover:opacity-40 transition-opacity" />
                    <div className="absolute bottom-3 right-3 bg-black/70 backdrop-blur-md text-white text-[10px] font-bold px-2.5 py-1 rounded-lg border border-white/10 flex items-center gap-1.5">
                      <Image size={12} className="text-[#C5A059]" />
                      {album.photoCount || (album.photos || []).length} {t('gal.fotos')}
                    </div>
                  </div>
                  <div className="p-4 flex flex-col flex-1 justify-between">
                    <div>
                      <h3 className="text-base font-bold text-slate-900 dark:text-white group-hover:text-[#C5A059] transition-colors">{album.title}</h3>
                      <p className="text-xs text-slate-400 dark:text-zinc-400 mt-1 font-medium">{album.date}</p>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-slate-700 dark:text-zinc-200 flex items-center gap-1 group-hover:translate-x-1 transition-transform">
                        {t('gal.verFotografias')}
                      </span>

                      {/* Editar / eliminar álbum (solo administrador) */}
                      {isAdmin && (
                        <span className="flex items-center gap-1 flex-shrink-0">
                          <button
                            onClick={(e) => { e.stopPropagation(); setAlbumEditando({ ...album }); }}
                            disabled={subiendoGaleria}
                            className="p-1.5 text-slate-400 dark:text-zinc-400 hover:text-[#C5A059] rounded-lg hover:bg-amber-50 dark:hover:bg-amber-500/10 transition-colors disabled:opacity-40"
                            title={t('gal.editarAlbum')}
                          >
                            <Edit2 size={15} />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleEliminarAlbum(album); }}
                            disabled={subiendoGaleria}
                            className="p-1.5 text-slate-300 dark:text-zinc-500 hover:text-red-500 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors disabled:opacity-40"
                            title={t('gal.eliminarAlbum')}
                          >
                            <Trash2 size={15} />
                          </button>
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>

      {/* ════ MODAL ÁLBUM LIGHTBOX VIEWER ════ */}
      {activeAlbumModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 md:p-8">
          <div className="bg-white rounded-3xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="px-6 py-4 border-b border-gray-100 dark:border-zinc-700 flex items-center justify-between bg-slate-50 dark:bg-zinc-800">
              <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">{activeAlbumModal.title}</h3>
                <p className="text-xs text-slate-500 dark:text-zinc-400">{activeAlbumModal.date} • {activeAlbumModal.photoCount || (activeAlbumModal.photos || []).length} {t('gal.fotosRegistradas')}</p>
              </div>
              <div className="flex items-center gap-2">
                {/* Subir foto directamente a este álbum */}
                {isAdmin && (
                  <button
                    onClick={() => albumPhotoInputRef.current?.click()}
                    disabled={subiendoGaleria}
                    className="flex items-center gap-1.5 bg-[#0B1B2C] text-white text-xs font-bold px-3.5 py-2 rounded-xl hover:bg-slate-800 transition-colors disabled:opacity-50"
                  >
                    {subiendoGaleria
                      ? <><Loader2 size={14} className="animate-spin text-[#C5A059]" /> {t('comun.subiendo')}</>
                      : <><Upload size={14} className="text-[#C5A059]" /> {t('gal.subirFoto')}</>}
                  </button>
                )}
                <button
                  onClick={() => setActiveAlbumModal(null)}
                  className="w-9 h-9 rounded-full bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 flex items-center justify-center text-slate-400 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-white shadow-sm"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <input
              type="file"
              ref={albumPhotoInputRef}
              onChange={(e) => handleSubirFoto(e, activeAlbumModal.id)}
              accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
              className="hidden"
            />

            <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {(activeAlbumModal.photos || []).length === 0 && (
                <div className="col-span-full border border-dashed border-gray-300 dark:border-zinc-600 rounded-2xl py-12 text-center">
                  <Image size={26} className="text-slate-300 dark:text-zinc-600 mx-auto mb-2" />
                  <p className="text-sm font-bold text-slate-600 dark:text-zinc-300">{t('gal.albumVacio')}</p>
                </div>
              )}

              {(activeAlbumModal.photos || []).map((foto, idx) => {
                const photoUrl = foto?.url_archivo || foto;
                return (
                <div
                  key={foto?.id ?? idx}
                  className="aspect-square rounded-2xl overflow-hidden relative group bg-slate-100 dark:bg-zinc-700 border border-gray-100 dark:border-zinc-700 shadow-sm"
                >
                  <img
                    src={photoUrl}
                    alt={foto?.nombre_archivo || `${idx + 1}`}
                    onClick={() => setSelectedPhotoLightbox(photoUrl)}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform cursor-pointer"
                  />

                  {/* Eliminar esta foto en concreto */}
                  {isAdmin && foto?.id && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleEliminarFoto(foto, activeAlbumModal.id); }}
                      disabled={subiendoGaleria}
                      className="absolute top-2 right-2 z-10 w-8 h-8 rounded-full bg-black/60 backdrop-blur-sm text-white/80 hover:bg-red-600 hover:text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all disabled:opacity-40"
                      title={t('gal.eliminarFoto')}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}

                  <div
                    onClick={() => setSelectedPhotoLightbox(photoUrl)}
                    className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white cursor-pointer"
                  >
                    <Eye size={24} />
                  </div>
                </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ════ LIGHTBOX ZOOM PHOTO ════ */}
      {selectedPhotoLightbox && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4" onClick={() => setSelectedPhotoLightbox(null)}>
          <img src={selectedPhotoLightbox} alt={t('gal.vistaAmpliada')} className="max-w-full max-h-full rounded-2xl shadow-2xl object-contain" />
        </div>
      )}

      {/* ════ MODAL: ¿A QUÉ ÁLBUM AGREGAR LA FOTO? ════ */}
      {showDestinoModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-800 rounded-3xl max-w-md w-full p-6 shadow-2xl border border-gray-100 dark:border-zinc-700">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100 dark:border-zinc-700">
              <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Image size={18} className="text-[#C5A059]" /> {t('gal.destinoTitulo')}
              </h3>
              <button onClick={() => setShowDestinoModal(false)} className="text-slate-400 dark:text-zinc-400 hover:text-slate-700 dark:hover:text-white">
                <X size={18} />
              </button>
            </div>

            {albums.length === 0 ? (
              <div className="text-center py-6">
                <p className="text-sm font-bold text-slate-600 dark:text-zinc-300">{t('gal.sinAlbumes')}</p>
                <p className="text-xs text-slate-400 dark:text-zinc-500 mt-1">{t('gal.sinAlbumesAyuda')}</p>
              </div>
            ) : (
              <div className="space-y-2">
                <label className="block text-xs font-bold text-slate-600 dark:text-zinc-300 uppercase">{t('gal.elegirAlbum')}</label>
                <select
                  value={destinoFoto}
                  onChange={(e) => setDestinoFoto(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-slate-800 dark:text-zinc-100 focus:outline-none focus:border-[#C5A059] cursor-pointer"
                >
                  {albums.map(a => (
                    <option key={a.id} value={a.id}>{a.title}</option>
                  ))}
                </select>
              </div>
            )}

            <input
              type="file"
              ref={photoInputRef}
              onChange={(e) => { setShowDestinoModal(false); handleSubirFoto(e, destinoFoto); }}
              accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
              className="hidden"
            />

            <div className="pt-5 flex flex-col sm:flex-row justify-end gap-2">
              <button
                type="button"
                onClick={() => { setShowDestinoModal(false); setShowCreateAlbumModal(true); }}
                className="flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold text-slate-600 dark:text-zinc-300 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 hover:bg-slate-50 dark:hover:bg-zinc-700 rounded-xl"
              >
                <FolderPlus size={14} className="text-[#C5A059]" /> {t('gal.crearAlbum')}
              </button>
              <button
                type="button"
                onClick={() => photoInputRef.current?.click()}
                disabled={!destinoFoto || albums.length === 0}
                className="flex items-center justify-center gap-2 px-5 py-2.5 text-xs font-bold text-white bg-[#0B1B2C] hover:bg-slate-800 rounded-xl shadow-sm disabled:opacity-40"
              >
                <Upload size={14} className="text-[#C5A059]" /> {t('gal.elegirFoto')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════ MODAL CREAR NUEVO ÁLBUM (ADMIN) ════ */}
      {showCreateAlbumModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-800 rounded-3xl max-w-md w-full p-6 shadow-2xl border border-gray-100 dark:border-zinc-700">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100 dark:border-zinc-700">
              <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <FolderPlus size={18} className="text-[#C5A059]" /> {t('gal.crearAlbum')}
              </h3>
              <button onClick={() => setShowCreateAlbumModal(false)} className="text-slate-400 dark:text-zinc-400 hover:text-slate-700 dark:hover:text-zinc-100">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleCreateAlbum} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-zinc-300 mb-1 uppercase">{t('gal.tituloAlbum')}</label>
                <input
                  type="text"
                  required
                  placeholder={t('gal.tituloAlbumPh')}
                  value={newAlbumForm.title}
                  onChange={(e) => setNewAlbumForm({ ...newAlbumForm, title: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-slate-800"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-zinc-300 mb-1 uppercase">{t('gal.fechaPeriodo')}</label>
                <input
                  type="text"
                  placeholder={t('gal.fechaPeriodoPh')}
                  value={newAlbumForm.date}
                  onChange={(e) => setNewAlbumForm({ ...newAlbumForm, date: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-slate-800"
                />
              </div>
              {/* Portada: archivo del dispositivo, ya no una URL */}
              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-zinc-300 mb-1 uppercase">{t('gal.portadaAlbum')}</label>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
                  onChange={(e) => setPortadaFile(e.target.files?.[0] || null)}
                  className="w-full text-xs text-slate-600 dark:text-zinc-300 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-[#0B1B2C] file:text-white hover:file:bg-slate-800 file:cursor-pointer cursor-pointer"
                />
                {portadaFile && (
                  <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1.5 font-semibold truncate">
                    {portadaFile.name} · {(portadaFile.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                )}
                <p className="text-[11px] text-slate-400 dark:text-zinc-500 mt-1">{t('perfil.formatosAceptados')}</p>
              </div>

              {galeriaMsg?.tipo === 'error' && (
                <div className="p-3 rounded-xl border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 text-xs font-semibold text-red-700 dark:text-red-300">
                  {galeriaMsg.texto}
                </div>
              )}

              <div className="pt-2 flex justify-end gap-2">
                <button type="button" onClick={() => { setShowCreateAlbumModal(false); setPortadaFile(null); }} className="px-4 py-2 text-xs font-bold text-slate-500 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-700 rounded-xl">
                  {t('comun.cancelar')}
                </button>
                <button
                  type="submit"
                  disabled={subiendoGaleria || !newAlbumForm.title.trim()}
                  className="px-5 py-2 text-xs font-bold text-white bg-[#0B1B2C] hover:bg-slate-800 rounded-xl shadow-sm disabled:opacity-50 flex items-center gap-2"
                >
                  {subiendoGaleria && <Loader2 size={14} className="animate-spin text-[#C5A059]" />}
                  {t('gal.guardarAlbum')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ════ MODAL EDITAR ÁLBUM (ADMIN) ════ */}
      {albumEditando && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-800 rounded-3xl max-w-md w-full p-6 shadow-2xl border border-gray-100 dark:border-zinc-700">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100 dark:border-zinc-700">
              <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Edit2 size={18} className="text-[#C5A059]" /> {t('gal.editarAlbum')}
              </h3>
              <button onClick={() => setAlbumEditando(null)} className="text-slate-400 dark:text-zinc-400 hover:text-slate-700 dark:hover:text-zinc-100">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleGuardarAlbum} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-zinc-300 mb-1 uppercase">{t('gal.tituloAlbum')}</label>
                <input
                  type="text"
                  required
                  value={albumEditando.title}
                  onChange={(e) => setAlbumEditando({ ...albumEditando, title: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-slate-800 dark:text-zinc-100 focus:outline-none focus:border-[#C5A059]"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-zinc-300 mb-1 uppercase">{t('gal.fechaPeriodo')}</label>
                <input
                  type="text"
                  placeholder={t('gal.fechaPeriodoPh')}
                  value={albumEditando.date || ''}
                  onChange={(e) => setAlbumEditando({ ...albumEditando, date: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-slate-800 dark:text-zinc-100 focus:outline-none focus:border-[#C5A059]"
                />
              </div>

              {/* Portada: se puede reemplazar con un archivo del dispositivo */}
              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-zinc-300 mb-1 uppercase">{t('gal.portadaAlbum')}</label>
                {albumEditando.cover && !nuevaPortadaFile && (
                  <img src={albumEditando.cover} alt="" className="w-full h-28 object-cover rounded-xl mb-2 border border-gray-200 dark:border-zinc-700" />
                )}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
                  onChange={(e) => setNuevaPortadaFile(e.target.files?.[0] || null)}
                  className="w-full text-xs text-slate-600 dark:text-zinc-300 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-[#0B1B2C] file:text-white hover:file:bg-slate-800 file:cursor-pointer cursor-pointer"
                />
                {nuevaPortadaFile && (
                  <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1.5 font-semibold truncate">
                    {nuevaPortadaFile.name} · {(nuevaPortadaFile.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                )}
              </div>

              {galeriaMsg?.tipo === 'error' && (
                <div className="p-3 rounded-xl border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 text-xs font-semibold text-red-700 dark:text-red-300">
                  {galeriaMsg.texto}
                </div>
              )}

              <div className="pt-2 flex justify-end gap-2">
                <button type="button" onClick={() => { setAlbumEditando(null); setNuevaPortadaFile(null); }} className="px-4 py-2 text-xs font-bold text-slate-500 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-700 rounded-xl">
                  {t('comun.cancelar')}
                </button>
                <button
                  type="submit"
                  disabled={subiendoGaleria}
                  className="px-5 py-2 text-xs font-bold text-white bg-[#0B1B2C] hover:bg-slate-800 rounded-xl shadow-sm disabled:opacity-50 flex items-center gap-2"
                >
                  {subiendoGaleria && <Loader2 size={14} className="animate-spin text-[#C5A059]" />}
                  {t('proy.guardarCambios')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ════ MODAL REGISTRAR FACTURA (ADMIN) ════ */}
      {showInvoiceModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-800 rounded-3xl max-w-md w-full p-6 shadow-2xl border border-gray-100 dark:border-zinc-700">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100 dark:border-zinc-700">
              <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Receipt size={18} className="text-[#C5A059]" /> {t('modal.registrarFactura')}
              </h3>
              <button onClick={() => setShowInvoiceModal(false)} className="text-slate-400 dark:text-zinc-400 hover:text-slate-700 dark:hover:text-zinc-100">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleCreateInvoice} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-zinc-300 mb-1 uppercase">{t('modal.proveedor')}</label>
                <input
                  type="text"
                  required
                  placeholder={t('modal.proveedorPh')}
                  value={newInvoice.proveedor}
                  onChange={(e) => setNewInvoice({ ...newInvoice, proveedor: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-slate-800"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-zinc-300 mb-1 uppercase">{t('modal.concepto')}</label>
                <input
                  type="text"
                  placeholder={t('modal.conceptoPh')}
                  value={newInvoice.concepto}
                  onChange={(e) => setNewInvoice({ ...newInvoice, concepto: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-slate-800"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-zinc-300 mb-1 uppercase">{t('modal.monto')}</label>
                <input
                  type="number"
                  required
                  placeholder="42500"
                  value={newInvoice.monto}
                  onChange={(e) => setNewInvoice({ ...newInvoice, monto: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-slate-800"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-zinc-300 mb-1 uppercase">{t('modal.comprobante')}</label>
                <input
                  type="text"
                  placeholder={t('modal.comprobantePh')}
                  value={newInvoice.comprobante}
                  onChange={(e) => setNewInvoice({ ...newInvoice, comprobante: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-slate-800"
                />
              </div>
              <div className="pt-2 flex justify-end gap-2">
                <button type="button" onClick={() => setShowInvoiceModal(false)} className="px-4 py-2 text-xs font-bold text-slate-500 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-700 rounded-xl">
                  {t('comun.cancelar')}
                </button>
                <button type="submit" className="px-5 py-2 text-xs font-bold text-white bg-[#0B1B2C] hover:bg-slate-800 rounded-xl shadow-sm">
                  {t('modal.guardarFactura')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ════ MODAL AGREGAR HITO AL CHECKLIST (ADMIN) ════ */}
      {showAddHitoModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-800 rounded-3xl max-w-md w-full p-6 shadow-2xl border border-gray-100 dark:border-zinc-700">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100 dark:border-zinc-700">
              <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Plus size={18} className="text-[#C5A059]" /> {t('modal.agregarHito')}
              </h3>
              <button onClick={() => setShowAddHitoModal(false)} className="text-slate-400 dark:text-zinc-400 hover:text-slate-700 dark:hover:text-zinc-100">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleAddHito} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-zinc-300 mb-1 uppercase">{t('modal.tituloHito')}</label>
                <input
                  type="text"
                  required
                  placeholder={t('modal.tituloHitoPh')}
                  value={newItemText}
                  onChange={(e) => setNewItemText(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-slate-800"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-zinc-300 mb-1 uppercase">{t('modal.detalleHito')}</label>
                <textarea
                  rows={2}
                  placeholder={t('modal.detalleHitoPh')}
                  value={newHitoDetail}
                  onChange={(e) => setNewHitoDetail(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-slate-800 resize-none"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-zinc-300 mb-1 uppercase">{t('modal.fechaHito')}</label>
                <input
                  type="text"
                  placeholder={t('modal.fechaHitoPh')}
                  value={newHitoDate}
                  onChange={(e) => setNewHitoDate(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-slate-800"
                />
              </div>
              <div className="pt-2 flex justify-end gap-2">
                <button type="button" onClick={() => setShowAddHitoModal(false)} className="px-4 py-2 text-xs font-bold text-slate-500 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-700 rounded-xl">
                  {t('comun.cancelar')}
                </button>
                <button type="submit" className="px-5 py-2 text-xs font-bold text-white bg-[#0B1B2C] hover:bg-slate-800 rounded-xl shadow-sm">
                  {t('modal.guardarHito')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ════ MODAL EDITAR HITO (ADMIN) ════ */}
      {editingHitoIndex !== null && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-800 rounded-3xl max-w-md w-full p-6 shadow-2xl border border-gray-100 dark:border-zinc-700">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100 dark:border-zinc-700">
              <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Edit2 size={18} className="text-[#C5A059]" /> {t('modal.editarHito')}
              </h3>
              <button onClick={() => setEditingHitoIndex(null)} className="text-slate-400 dark:text-zinc-400 hover:text-slate-700 dark:hover:text-zinc-100">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleSaveEditHito} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-zinc-300 mb-1 uppercase">{t('modal.tituloHito')}</label>
                <input
                  type="text"
                  required
                  placeholder={t('modal.tituloHitoPh')}
                  value={editHitoText}
                  onChange={(e) => setEditHitoText(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-slate-800"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-zinc-300 mb-1 uppercase">{t('modal.detalleHito')}</label>
                <textarea
                  rows={2}
                  placeholder={t('modal.detalleHitoPh')}
                  value={editHitoDetail}
                  onChange={(e) => setEditHitoDetail(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-slate-800 resize-none"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-zinc-300 mb-1 uppercase">{t('modal.fechaHito')}</label>
                <input
                  type="text"
                  placeholder={t('modal.fechaHitoPh')}
                  value={editHitoDate}
                  onChange={(e) => setEditHitoDate(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-slate-800"
                />
              </div>
              <div className="pt-2 flex justify-end gap-2">
                <button type="button" onClick={() => setEditingHitoIndex(null)} className="px-4 py-2 text-xs font-bold text-slate-500 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-700 rounded-xl">
                  {t('comun.cancelar')}
                </button>
                <button type="submit" className="px-5 py-2 text-xs font-bold text-white bg-[#0B1B2C] hover:bg-slate-800 rounded-xl shadow-sm">
                  {t('modal.actualizarHito')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
