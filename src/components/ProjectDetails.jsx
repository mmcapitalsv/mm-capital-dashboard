import React, { useState, useEffect, useRef } from 'react';
import {
  ArrowLeft, CheckSquare, Square, Circle, Upload, Image, TrendingUp, FileText, LayoutGrid,
  ChevronDown, ChevronUp, Edit2, Save, Plus, Trash2, AlertTriangle, Loader2, CheckCircle2,
  ExternalLink, Download, Calendar, DollarSign, FolderPlus, X, Eye, Receipt, ShieldAlert, Building,
  Sparkles, FileImage, ZoomIn, ZoomOut
} from 'lucide-react';
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import {
  uploadArchivoProyecto, getArchivosProyecto, renombrarArchivo, eliminarArchivo,
  subirComprobanteFactura, validarComprobante, descargarArchivo
} from '../services/storageService';
import { supabase } from '../supabaseClient';
import {
  guardarFinanzas, agruparGastosPorMes, formatearMoneda, aNumero,
  getFacturas, crearFactura, actualizarFactura, eliminarFactura,
  esComprobanteArchivo, esComprobantePdf, nombreArchivoFactura,
  sumarGastos, ejecucionMensualReal
} from '../services/finanzasService';
import {
  getAlbumes, crearAlbum, actualizarAlbum, eliminarAlbum, subirFotoAlbum, eliminarFoto
} from '../services/galeriaService';
import { usePrefs } from '../context/PreferenciasContext';
import {
  fetchChecklist, saveChecklist, deleteHito, updateHito, calcularAvance
} from '../services/checklistService';
import { getChecklistSeed } from '../data/checklistSeeds';
import { puedeEditarHitos } from '../lib/perfilUsuario';
import { analizarComprobante } from '../services/geminiService';

// Se guarda la CLAVE de traducción, no el texto: la etiqueta se resuelve en
// cada render para que el cambio de idioma se refleje al instante.
const TABS = [
  { id: 'summary',   claveLabel: 'proy.tab.resumen',  icon: CheckSquare },
  { id: 'finances',  claveLabel: 'proy.tab.finanzas', icon: TrendingUp },
  { id: 'documents', claveLabel: 'proy.tab.docs',     icon: FileText },
  { id: 'gallery',   claveLabel: 'proy.tab.galeria',  icon: LayoutGrid },
];

/**
 * Tarjeta de monto financiero. En modo lectura muestra la cifra formateada;
 * en modo edición se convierte en un input controlado.
 */
function TarjetaMonto({ etiqueta, pie, valor, editando, onChange, colorValor, resaltado }) {
  return (
    <div className={`border shadow-sm rounded-2xl p-5 transition-colors ${
      editando
        ? 'bg-amber-50/40 dark:bg-amber-500/5 border-[#C5A059]/50'
        : resaltado
        ? 'bg-red-50/50 dark:bg-red-500/10 border-red-200 dark:border-red-500/30'
        : 'bg-white dark:bg-zinc-800 border-gray-100 dark:border-zinc-700'
    }`}>
      <p className="text-xs text-slate-400 dark:text-zinc-200 uppercase font-bold tracking-wider mb-2">{etiqueta}</p>

      {editando ? (
        <div className="flex items-center gap-1">
          <span className={`text-2xl md:text-3xl font-black ${colorValor}`}>$</span>
          <input
            type="number"
            step="0.01"
            min="0"
            inputMode="decimal"
            value={valor}
            onChange={(e) => onChange(e.target.value)}
            onFocus={(e) => e.target.select()}
            onWheel={(e) => e.currentTarget.blur()}
            className={`w-full min-w-0 bg-transparent border-b-2 border-[#C5A059]/60 focus:border-[#C5A059] outline-none text-2xl md:text-3xl font-black ${colorValor}`}
          />
        </div>
      ) : (
        <p className={`text-2xl md:text-3xl font-black ${colorValor}`}>
          ${Number(valor || 0).toLocaleString()}
        </p>
      )}

      <p className="text-xs text-slate-400 dark:text-zinc-200 mt-1 font-semibold">{pie}</p>
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

  // Facturas de proveedores: filas REALES de la tabla `gastos` de Supabase
  const [facturas, setFacturas] = useState([]);
  const [facturasMsg, setFacturasMsg] = useState(null);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [newInvoice, setNewInvoice] = useState({ proveedor: '', concepto: '', monto: '' });
  // Comprobante adjunto: archivo elegido + previsualización local antes de subir
  const [comprobanteFile, setComprobanteFile] = useState(null);
  const [comprobantePreview, setComprobantePreview] = useState(null);
  const [arrastrandoComprobante, setArrastrandoComprobante] = useState(false);
  const [extrayendoIA, setExtrayendoIA] = useState(false);
  const [guardandoFactura, setGuardandoFactura] = useState(false);
  const [facturaEnVisor, setFacturaEnVisor] = useState(null);
  // Edición y borrado de una factura ya registrada (solo en Modo Edición)
  const [facturaEditando, setFacturaEditando] = useState(null);
  const [edicionFactura, setEdicionFactura] = useState({ proveedor: '', concepto: '', monto: '' });
  const [guardandoEdicion, setGuardandoEdicion] = useState(false);
  const [facturaEliminando, setFacturaEliminando] = useState(null);
  const [visorAmpliado, setVisorAmpliado] = useState(false);
  const [descargandoVisor, setDescargandoVisor] = useState(false);
  const comprobanteInputRef = useRef(null);

  // Gallery Albums & Modals state (los álbumes REALES llegan de Supabase)
  const [albums, setAlbums] = useState([]);
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
  // Los checks de avance son EXCLUSIVOS del administrador: socios e
  // inversionistas ven el estado real pero no pueden modificarlo.
  const puedeEditarChecklist = puedeEditarHitos(userRole);
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

  // Al cambiar de proyecto se vacía la galería hasta que Supabase responda:
  // así nunca se ven los álbumes del proyecto anterior.
  useEffect(() => {
    setAlbums([]);
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

  // Marca / desmarca un checkbox (se persiste al presionar "Guardar Cambios").
  // Blindaje: aunque alguien fuerce el clic, sin rol admin no se toca el estado.
  const handleToggleHito = (index) => {
    if (!puedeEditarChecklist) return;
    setChecklist(prev => (Array.isArray(prev) ? prev : []).map((item, i) =>
      i === index ? { ...item, done: !item.done } : item
    ));
    setHayCambiosSinGuardar(true);
    limpiarMensajes();
  };

  // Elimina el hito PERMANENTEMENTE de Supabase (icono de basurero)
  const handleDeleteHito = async (index) => {
    if (!puedeEditarChecklist) return;
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
    if (!puedeEditarChecklist) return;
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
    if (!puedeEditarChecklist) return;
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
    if (!puedeEditarChecklist) return;
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
   * "Guardar Cambios": sincroniza TODO contra Supabase en una sola pasada.
   * · Checklist: INSERT de tareas nuevas, UPDATE de checkboxes/textos, DELETE
   *   de las quitadas, y el porcentaje de avance en la tabla `proyectos`.
   * · Finanzas: si el Administrador está en Modo Edición, se guardan además
   *   presupuesto, anticipo, cuota, costo ejecutado y la ejecución mensual,
   *   para que un único botón deje la base completamente al día.
   */
  const handleSaveAllChanges = async () => {
    if (!puedeEditarChecklist) return;
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

      // Las cifras y la identidad editadas viajan en el MISMO clic que el checklist
      if (modoEdicionFinanzas) {
        const fin = await guardarFinanzas(project.id, { ...finanzas, ...identidad });
        if (!fin.success) {
          setSaveErrorMsg(t('msg.errorGuardarCambios', { error: fin.error || t('msg.errorDesconocido') }));
          return;
        }
        aplicarIdentidadGuardada(fin.valores);
        if (project) {
          project.presupuesto_total = fin.valores.presupuesto_total;
          project.anticipo = fin.valores.anticipo;
          project.cuota_asignada = fin.valores.cuota_asignada;
          project.costo_ejecutado = fin.valores.costo_ejecutado;
          project.ejecucion_mensual = fin.valores.ejecucion_mensual;
        }
      }

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

  /** Carga las facturas reales del proyecto desde `gastos`. */
  const cargarFacturas = async () => {
    if (!project?.id) { setFacturas([]); return; }
    const { facturas: lista, error } = await getFacturas(project.id);
    setFacturas(Array.isArray(lista) ? lista : []);
    setFacturasMsg(error ? { tipo: 'error', texto: error } : null);
  };

  useEffect(() => {
    cargarFacturas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  // Realtime: una factura nueva aparece sola en todas las sesiones abiertas
  useEffect(() => {
    if (!project?.id) return;
    const canal = supabase
      .channel(`gastos-proyecto-${project.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gastos' }, cargarFacturas)
      .subscribe();
    return () => { supabase.removeChannel(canal); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  /* ── Modal de registro de factura ──────────────────────────────────────── */

  /** Deja el modal como recién abierto y libera la URL de previsualización. */
  const limpiarFormularioFactura = () => {
    setComprobantePreview((previa) => {
      if (previa) URL.revokeObjectURL(previa);
      return null;
    });
    setNewInvoice({ proveedor: '', concepto: '', monto: '' });
    setComprobanteFile(null);
    setArrastrandoComprobante(false);
    setExtrayendoIA(false);
    setGuardandoFactura(false);
  };

  const cerrarModalFactura = () => {
    limpiarFormularioFactura();
    setShowInvoiceModal(false);
  };


  /** Acepta el archivo del input o del drag & drop y prepara su vista previa. */
  const adjuntarComprobante = (file) => {
    if (!file) return;

    const invalido = validarComprobante(file);
    if (invalido) {
      setFacturasMsg({ tipo: 'error', texto: invalido });
      return;
    }

    setComprobantePreview((previa) => {
      if (previa) URL.revokeObjectURL(previa);
      return file.type === 'application/pdf' ? null : URL.createObjectURL(file);
    });
    setComprobanteFile(file);
    setFacturasMsg(null);
  };

  /** Quita el comprobante adjunto sin tocar el resto del formulario. */
  const limpiarComprobanteAdjunto = () => {
    setComprobantePreview((previa) => {
      if (previa) URL.revokeObjectURL(previa);
      return null;
    });
    setComprobanteFile(null);
  };

  const handleSoltarComprobante = (e) => {
    e.preventDefault();
    setArrastrandoComprobante(false);
    adjuntarComprobante(e.dataTransfer?.files?.[0]);
  };

  /**
   * Extracción REAL: el comprobante adjunto viaja en Base64 a `gemini-1.5-flash`,
   * que devuelve un JSON estricto {proveedor, concepto, monto} con el que se
   * rellenan los inputs. Los campos siguen siendo editables a mano.
   */
  const handleExtraerConIA = async () => {
    if (extrayendoIA) return;

    if (!comprobanteFile) {
      setFacturasMsg({ tipo: 'error', texto: t('modal.iaSinArchivo') });
      return;
    }

    setExtrayendoIA(true);
    setFacturasMsg(null);

    const { datos, error } = await analizarComprobante(comprobanteFile);
    setExtrayendoIA(false);

    if (error || !datos) {
      setFacturasMsg({ tipo: 'error', texto: error || t('msg.errorSupabase') });
      return;
    }

    // Un campo vacío en la lectura no borra lo que el usuario ya había escrito
    setNewInvoice(previo => ({
      proveedor: datos.proveedor || previo.proveedor,
      concepto: datos.concepto || previo.concepto,
      monto: datos.monto || previo.monto
    }));
  };

  const handleCreateInvoice = async (e) => {
    e.preventDefault();
    if (!newInvoice.proveedor || !newInvoice.monto || guardandoFactura) return;

    setGuardandoFactura(true);

    // 1. El comprobante viaja primero: sin URL la factura quedaría sin respaldo
    let urlComprobante = '';
    if (comprobanteFile) {
      const subida = await subirComprobanteFactura(comprobanteFile, project?.id);
      if (!subida.success) {
        setFacturasMsg({ tipo: 'error', texto: subida.error });
        setGuardandoFactura(false);
        return;
      }
      urlComprobante = subida.url;
    }

    // 2. Fila en `gastos` con la URL pública en `comprobante`
    const { success, error } = await crearFactura(project?.id, {
      proveedor: newInvoice.proveedor,
      concepto: newInvoice.concepto || t('fb.comprobantePago'),
      monto: newInvoice.monto,
      comprobante: urlComprobante
    });

    if (!success) {
      setFacturasMsg({ tipo: 'error', texto: error });
      setGuardandoFactura(false);
      return;
    }

    cerrarModalFactura();
    setFacturasMsg(null);
    await cargarFacturas();
  };

  /* ── Edición y borrado de facturas ya registradas ──────────────────────── */

  /** Abre el modal de edición con los datos actuales de la fila. */
  const abrirEdicionFactura = (fac) => {
    setFacturaEditando(fac);
    setEdicionFactura({
      proveedor: fac.proveedor || '',
      concepto: fac.concepto || '',
      monto: fac.monto ? String(fac.monto) : ''
    });
    setFacturasMsg(null);
  };

  const cerrarEdicionFactura = () => {
    setFacturaEditando(null);
    setGuardandoEdicion(false);
  };

  const handleActualizarFactura = async (e) => {
    e.preventDefault();
    if (!facturaEditando || guardandoEdicion) return;

    setGuardandoEdicion(true);
    const { success, error } = await actualizarFactura(facturaEditando.id, edicionFactura);

    if (!success) {
      setFacturasMsg({ tipo: 'error', texto: error });
      setGuardandoEdicion(false);
      return;
    }

    cerrarEdicionFactura();
    setFacturasMsg(null);
    await cargarFacturas();
  };

  const handleEliminarFactura = async (fac) => {
    if (facturaEliminando) return;
    if (!confirm(t('dlg.eliminarFactura', { proveedor: fac.proveedor }))) return;

    setFacturaEliminando(fac.id);
    const { success, error } = await eliminarFactura(fac.id);
    setFacturaEliminando(null);

    if (!success) {
      setFacturasMsg({ tipo: 'error', texto: error });
      return;
    }

    // El visor no puede quedar mostrando un comprobante que ya no existe
    setFacturaEnVisor((previa) => (previa?.id === fac.id ? null : previa));
    setFacturasMsg(null);
    await cargarFacturas();
  };

  /** Descarga el comprobante abierto en el visor. */
  const handleDescargarComprobante = async () => {
    if (!facturaEnVisor?.comprobante || descargandoVisor) return;
    setDescargandoVisor(true);
    await descargarArchivo(facturaEnVisor.comprobante, nombreArchivoFactura(facturaEnVisor));
    setDescargandoVisor(false);
  };

  // Escape cierra el visor y el scroll del fondo se congela mientras está abierto
  useEffect(() => {
    if (!facturaEnVisor) return;
    const alPulsar = (e) => { if (e.key === 'Escape') setFacturaEnVisor(null); };
    window.addEventListener('keydown', alPulsar);
    const overflowPrevio = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', alPulsar);
      document.body.style.overflow = overflowPrevio;
    };
  }, [facturaEnVisor]);

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
     trae Supabase (jamás con cifras de demostración) y se actualiza en vivo
     mientras el administrador escribe, así la gráfica y la alerta de
     sobrecosto reaccionan al instante.

     Costo ejecutado: NO se edita a mano. Es la suma real de la tabla `gastos`
     filtrada por `proyecto_id`, de modo que cada factura registrada mueve la
     cifra al instante (ver `totalSpent`). */
  const finanzasDesdeProyecto = () => ({
    presupuesto: Number(project?.presupuesto_total ?? 0),
    anticipo: Number(project?.anticipo ?? 0),
    cuota: Number(project?.cuota_asignada ?? 0)
  });

  /* Identidad editable del proyecto (título y ubicación del header).
     Se guarda en las columnas `nombre` y `ubicacion` de la tabla `proyectos`,
     en el mismo UPDATE que las cifras financieras. */
  const identidadDesdeProyecto = () => ({
    nombre: project?.nombre || project?.title || '',
    ubicacion: project?.ubicacion || project?.location || ''
  });

  const [identidad, setIdentidad] = useState(identidadDesdeProyecto);

  const [finanzas, setFinanzas] = useState(finanzasDesdeProyecto);
  const [editandoFinanzas, setEditandoFinanzas] = useState(false);
  const [guardandoFinanzas, setGuardandoFinanzas] = useState(false);
  const [finanzasMsg, setFinanzasMsg] = useState(null);

  /* En "Modo Edición" TODOS los campos financieros son inputs, sin tener que
     pulsar además "Editar cifras": basta con que el Administrador active el
     modo desde el header. El botón local sigue existiendo para editar sin
     encender el modo global. */
  const modoEdicionFinanzas = editandoFinanzas || (isAdmin && !!isEditMode);

  /* Editar o eliminar una factura ya registrada es exclusivo del Administrador
     con el Modo Edición encendido: en lectura la lista es intocable. */
  const puedeEditarFacturas = isAdmin && modoEdicionFinanzas;

  // Re-sincroniza si cambia el proyecto o llegan datos nuevos por Realtime
  useEffect(() => {
    if (modoEdicionFinanzas) return;   // no pisar lo que se está escribiendo
    setFinanzas(finanzasDesdeProyecto());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    project?.id, project?.presupuesto_total, project?.anticipo,
    project?.cuota_asignada
  ]);

  // Lo mismo para el título y la ubicación del header
  useEffect(() => {
    if (modoEdicionFinanzas) return;
    setIdentidad(identidadDesdeProyecto());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, project?.nombre, project?.title, project?.ubicacion, project?.location]);

  const handleCampoIdentidad = (campo, valor) => {
    setIdentidad(prev => ({ ...prev, [campo]: valor }));
    setFinanzasMsg(null);
  };

  /** Refleja en memoria el nombre/ubicación que devolvió Supabase. */
  const aplicarIdentidadGuardada = (valores) => {
    if (!project || !valores) return;
    if (valores.nombre !== undefined) {
      project.nombre = valores.nombre;
      project.title = valores.nombre;
    }
    if (valores.ubicacion !== undefined) {
      project.ubicacion = valores.ubicacion;
      project.location = valores.ubicacion;
    }
    setIdentidad({
      nombre: valores.nombre ?? identidad.nombre,
      ubicacion: valores.ubicacion ?? identidad.ubicacion
    });
  };

  const handleCampoFinanzas = (campo, valor) => {
    setFinanzas(prev => ({ ...prev, [campo]: aNumero(valor) }));
    setFinanzasMsg(null);
  };

  const handleGuardarFinanzas = async () => {
    setGuardandoFinanzas(true);
    setFinanzasMsg(null);

    const { success, valores, error } = await guardarFinanzas(project?.id, { ...finanzas, ...identidad });

    setGuardandoFinanzas(false);

    if (success) {
      aplicarIdentidadGuardada(valores);
      if (project) {
        project.presupuesto_total = valores.presupuesto_total;
        project.anticipo = valores.anticipo;
        project.cuota_asignada = valores.cuota_asignada;
      }
      // Lo guardado por Supabase es lo que se muestra: nada de valores locales
      setFinanzas({
        presupuesto: Number(valores.presupuesto_total || 0),
        anticipo: Number(valores.anticipo || 0),
        cuota: Number(valores.cuota_asignada || 0)
      });
      setEditandoFinanzas(false);
      setFinanzasMsg({ tipo: 'exito', texto: t('fin.guardado') });
      if (typeof onUpdateProject === 'function') await onUpdateProject();
      setTimeout(() => setFinanzasMsg(null), 5000);
    } else {
      setFinanzasMsg({ tipo: 'error', texto: error });
    }
  };

  const handleCancelarFinanzas = () => {
    setFinanzas(finanzasDesdeProyecto());
    setIdentidad(identidadDesdeProyecto());
    setEditandoFinanzas(false);
    setFinanzasMsg(null);
  };

  // Cálculos derivados: reaccionan a cada tecla mientras se edita
  const totalBudget = Number(finanzas.presupuesto) || 0;
  /* Costo ejecutado DINÁMICO: suma de `gastos.monto` del proyecto. `facturas`
     se recarga tras cada alta/edición/borrado y por Realtime, así que la cifra
     y la gráfica se mueven solas en cuanto se registra una factura. */
  const totalSpent = sumarGastos(facturas);
  const ejecucionMensual = ejecucionMensualReal(facturas, language);
  const isOverBudget = totalSpent > totalBudget;
  const overBudgetAmount = isOverBudget ? totalSpent - totalBudget : 0;

  /* Estado del proyecto: NO es texto fijo, sale del % de hitos completados.
     0% = Planificación · 1–99% = En progreso · 100% = Finalizado. */
  const estadoAutomatico = safeChecklist.length === 0 || avancePct === 0
    ? t('estado.planificacion')
    : avancePct >= 100
    ? t('estado.finalizado')
    : t('estado.enProgreso');

  // Datos de la gráfica de facturas agrupados por mes
  const gastosPorMes = agruparGastosPorMes(facturas, language);

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-zinc-900 relative">

      {/* ── Header ── */}
      <header className="flex-shrink-0 px-6 md:px-10 pt-8 pb-5 border-b border-gray-100 dark:border-zinc-700 flex items-center justify-between gap-5">
        <div className="flex items-center gap-5">
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-slate-400 dark:text-zinc-200 hover:text-slate-800 dark:hover:text-white text-base font-medium transition-colors rounded-xl px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-zinc-700/50 -ml-3"
          >
            <ArrowLeft size={20} />
            {t('proy.volver')}
          </button>
          <div className="h-6 w-px bg-gray-200" />
          <div className="min-w-0">
            {/* En Modo Edición el título y la ubicación son inputs reales:
                se persisten en `proyectos.nombre` y `proyectos.ubicacion`
                con el mismo botón "Guardar Cambios". */}
            {modoEdicionFinanzas ? (
              <input
                type="text"
                value={identidad.nombre}
                onChange={(e) => handleCampoIdentidad('nombre', e.target.value)}
                placeholder={t('proy.nombreProyecto')}
                aria-label={t('proy.nombreProyecto')}
                className="w-full min-w-0 md:min-w-[26rem] bg-transparent border-b-2 border-[#C5A059]/60 focus:border-[#C5A059] outline-none text-xl md:text-2xl font-bold text-slate-900 dark:text-white tracking-tight uppercase"
              />
            ) : (
              <h1 className="text-xl md:text-2xl font-bold text-slate-900 dark:text-white tracking-tight uppercase flex items-center gap-2">
                {project.title || project.nombre}
              </h1>
            )}
            {/* El estado ya NO es texto estático: se calcula con el avance
                real de los hitos (0% Planificación · 1-99% En progreso · 100%
                Finalizado). Junto a él se conserva la ubicación del proyecto. */}
            <p className="text-xs md:text-sm text-slate-400 dark:text-zinc-200 mt-0.5 uppercase tracking-widest font-medium flex flex-wrap items-center gap-2">
              <span className={`normal-case tracking-normal text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${
                avancePct >= 100 && safeChecklist.length > 0
                  ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30'
                  : avancePct > 0
                  ? 'bg-amber-50 dark:bg-amber-500/10 text-[#8B6914] dark:text-[#E3C77B] border-amber-200 dark:border-amber-500/30'
                  : 'bg-slate-100 dark:bg-zinc-700 text-slate-600 dark:text-zinc-300 border-gray-200 dark:border-zinc-600'
              }`}>
                {estadoAutomatico} · {avancePct}%
              </span>
              {modoEdicionFinanzas ? (
                <input
                  type="text"
                  value={identidad.ubicacion}
                  onChange={(e) => handleCampoIdentidad('ubicacion', e.target.value)}
                  placeholder={t('proy.ubicacionProyecto')}
                  aria-label={t('proy.ubicacionProyecto')}
                  className="flex-1 min-w-0 md:min-w-[18rem] bg-transparent border-b-2 border-[#C5A059]/60 focus:border-[#C5A059] outline-none text-xs md:text-sm text-slate-500 dark:text-zinc-300 uppercase tracking-widest font-medium"
                />
              ) : (
                project.ubicacion || project.location
              )}
            </p>
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
                  : 'text-slate-400 dark:text-zinc-200 border-transparent hover:text-slate-600 dark:hover:text-zinc-200 hover:border-slate-300'
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
                <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-zinc-200 flex items-center gap-2">
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
                    <span className="text-xs font-semibold text-slate-500 dark:text-zinc-200 bg-white dark:bg-zinc-800 px-3.5 py-1.5 rounded-xl border border-dashed border-gray-300 dark:border-zinc-600">
                      {t('proy.plantillaInicial')}
                    </span>
                  )}
                  {puedeEditarChecklist ? (
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
                  ) : (
                    <span
                      className="flex items-center gap-1.5 text-xs font-bold text-slate-500 dark:text-zinc-300 bg-slate-100 dark:bg-zinc-700/60 border border-gray-200 dark:border-zinc-600 px-3.5 py-1.5 rounded-xl"
                      title={t('proy.checksSoloAdmin')}
                    >
                      <ShieldAlert size={13} className="text-slate-400 dark:text-zinc-200" />
                      {t('proy.checksSoloLectura')}
                    </span>
                  )}
                </div>
              </div>

              {isLoadingChecklist && (
                <div className="flex items-center justify-center gap-3 py-16 text-slate-400 dark:text-zinc-200">
                  <Loader2 size={20} className="animate-spin text-[#C5A059]" />
                  <span className="text-sm font-semibold">{t('proy.cargandoChecklist')}</span>
                </div>
              )}

              {!isLoadingChecklist && safeChecklist.length === 0 && (
                <div className="border border-dashed border-gray-300 dark:border-zinc-600 rounded-[20px] bg-slate-50/60 dark:bg-zinc-800/60 py-12 px-6 text-center">
                  <CheckSquare size={28} className="text-slate-300 dark:text-zinc-200 mx-auto mb-3" />
                  <p className="text-sm font-bold text-slate-600 dark:text-zinc-300">{t('proy.sinHitos')}</p>
                  <p className="text-xs text-slate-400 dark:text-zinc-200 mt-1">
                    {puedeEditarChecklist
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
                          {/* Administrador: casilla real que marca y desmarca.
                              Invitado: NO es un control desactivado, es un
                              indicador estático de estado — sin hover, sin
                              cursor de "prohibido" y sin opacidad de apagado. */}
                          {puedeEditarChecklist ? (
                            <button
                              type="button"
                              onClick={() => handleToggleHito(i)}
                              className="mt-0.5 focus:outline-none"
                              title={isDone ? t('proy.marcarPendiente') : t('proy.marcarHecho')}
                            >
                              {isDone
                                ? <CheckSquare size={22} className="text-[#C5A059] flex-shrink-0" />
                                : <Square size={22} className="flex-shrink-0 text-slate-300 dark:text-zinc-200 hover:text-slate-500" />
                              }
                            </button>
                          ) : (
                            <span
                              className="mt-0.5 flex-shrink-0"
                              role="img"
                              aria-label={isDone ? t('proy.hitoCompletado') : t('proy.hitoPendiente')}
                              title={isDone ? t('proy.hitoCompletado') : t('proy.hitoPendiente')}
                            >
                              {isDone
                                ? <CheckCircle2 size={22} className="text-emerald-500 flex-shrink-0" />
                                : <Circle size={22} className="text-slate-300 dark:text-zinc-300 flex-shrink-0" />
                              }
                            </span>
                          )}

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
                                    <Calendar size={12} className="text-slate-400 dark:text-zinc-200" />
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
                          {puedeEditarChecklist && (
                            <>
                              <button
                                onClick={() => handleStartEditHito(i)}
                                disabled={isSavingChanges}
                                className="p-1.5 text-slate-400 dark:text-zinc-200 hover:text-[#C5A059] rounded-lg hover:bg-amber-50 transition-colors disabled:opacity-40"
                                title={t('proy.editarTarea')}
                              >
                                <Edit2 size={16} />
                              </button>
                              <button
                                onClick={() => handleDeleteHito(i)}
                                disabled={isSavingChanges}
                                className="p-1.5 text-slate-300 dark:text-zinc-200 hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-40"
                                title={t('proy.eliminarTarea')}
                              >
                                <Trash2 size={16} />
                              </button>
                            </>
                          )}
                          <button onClick={() => setOpenAccordion(openAccordion === i ? null : i)}>
                            {openAccordion === i ? <ChevronUp size={20} className="text-slate-400 dark:text-zinc-200" /> : <ChevronDown size={20} className="text-slate-400 dark:text-zinc-200" />}
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
              {puedeEditarChecklist && (
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
                    <p className="text-[11px] text-slate-400 dark:text-zinc-200 font-medium">
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
                <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-zinc-200 w-full mb-3 text-center">{t('proy.avanceCronologico')}</h3>
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
                    <span className="text-[10px] font-bold text-slate-400 dark:text-zinc-200 uppercase tracking-widest">{t('dash.ejecutado')}</span>
                  </div>
                </div>
              </div>

              <div className="bg-slate-50 dark:bg-zinc-800 border border-gray-100 dark:border-zinc-700 rounded-2xl p-6 relative">
                <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-zinc-200 mb-3">{t('proy.descripcionGeneral')}</h3>
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
              <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-400 dark:text-zinc-200">{t('fin.titulo')}</h2>
              <div className="flex flex-wrap items-center gap-2">
                {/* Edición de cifras: solo administrador */}
                {isAdmin && (
                  modoEdicionFinanzas ? (
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
                editando={modoEdicionFinanzas}
                onChange={(v) => handleCampoFinanzas('presupuesto', v)}
                colorValor="text-slate-900 dark:text-white"
              />

              <TarjetaMonto
                etiqueta={t('fin.anticipo')}
                pie={t('fin.anticipoDesc')}
                valor={finanzas.anticipo}
                editando={modoEdicionFinanzas}
                onChange={(v) => handleCampoFinanzas('anticipo', v)}
                colorValor="text-[#C5A059]"
              />

              <TarjetaMonto
                etiqueta={t('fin.cuotaAsignada')}
                pie={t('fin.cuotaAsignadaDesc')}
                valor={finanzas.cuota}
                editando={modoEdicionFinanzas}
                onChange={(v) => handleCampoFinanzas('cuota', v)}
                colorValor="text-slate-900 dark:text-white"
              />

              {/* Costo ejecutado: SIEMPRE la suma real de `gastos`, nunca editable */}
              <TarjetaMonto
                etiqueta={t('fin.costoEjecutado')}
                pie={`${Math.round((totalSpent / (totalBudget || 1)) * 100)}% ${t('fin.presupuestoEjecutado')}`}
                valor={totalSpent}
                editando={false}
                colorValor={isOverBudget ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-white'}
                resaltado={isOverBudget}
              />
            </div>

            {/* Gráfica de Ejecución financiera mensual.
                Las barras son las sumas REALES de `gastos` agrupadas por mes:
                cero datos de relleno y cero edición manual. Si aún no hay
                facturas registradas no se dibuja una gráfica vacía. */}
            <div className="bg-white dark:bg-zinc-800 border border-gray-100 dark:border-zinc-700 shadow-sm rounded-2xl p-6">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                <p className="text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-zinc-200">{t('fin.ejecucionMensual')}</p>
                <span className="text-xs font-black text-slate-900 dark:text-white">
                  {formatearMoneda(totalSpent)}
                </span>
              </div>

              {ejecucionMensual.length === 0 ? (
                <div className="h-56 w-full flex flex-col items-center justify-center gap-2 text-center">
                  <Receipt size={26} className="text-slate-300 dark:text-zinc-600" />
                  <p className="text-xs font-semibold text-slate-400 dark:text-zinc-400">{t('fin.sinFacturas')}</p>
                </div>
              ) : (
                <div className="h-56 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={ejecucionMensual}>
                      <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#94a3b8' }} dy={10} />
                      <Tooltip
                        cursor={{ fill: '#f8fafc' }}
                        contentStyle={{ borderRadius: '12px', border: '1px solid #f1f5f9', boxShadow: '0 10px 25px rgba(0,0,0,0.05)' }}
                        formatter={(value) => [`$${Number(value || 0).toLocaleString()}`, t('fin.gasto')]}
                      />
                      <Bar dataKey="value" fill="#0B1B2C" radius={[6, 6, 0, 0]} maxBarSize={44} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>
        )}

        {/* SUBPANEL DE FACTURAS DE PROVEEDORES */}
        {activeTab === 'finances' && showExpenses && (
          <div className="space-y-6">
            <div className="flex items-center justify-between pb-4 border-b border-gray-200 dark:border-zinc-700">
              <div className="flex items-center gap-3">
                <button onClick={() => setShowExpenses(false)} className="text-slate-400 dark:text-zinc-200 hover:text-slate-800 dark:hover:text-white p-1.5 rounded-lg border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 shadow-sm">
                  <ArrowLeft size={18} />
                </button>
                <div>
                  <h2 className="text-lg font-bold text-slate-900 dark:text-white">{t('fin.facturasTitulo')}</h2>
                  <p className="text-xs text-slate-400 dark:text-zinc-200 font-medium">{t('fin.facturasSub')}</p>
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
                  <p className="text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-zinc-200">
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

            {facturasMsg && (
              <div className="p-4 rounded-2xl border flex items-start gap-3 text-xs font-semibold bg-red-50 dark:bg-red-500/10 text-red-800 dark:text-red-300 border-red-200 dark:border-red-500/30">
                <ShieldAlert size={16} className="flex-shrink-0 mt-px" />
                <span>{facturasMsg.texto}</span>
              </div>
            )}

            {facturas.length === 0 && !facturasMsg && (
              <div className="border border-dashed border-gray-300 dark:border-zinc-600 rounded-2xl bg-slate-50/60 dark:bg-zinc-800/60 py-12 px-6 text-center">
                <Receipt size={28} className="text-slate-300 dark:text-zinc-200 mx-auto mb-3" />
                <p className="text-sm font-bold text-slate-600 dark:text-zinc-300">{t('fin.sinFacturas')}</p>
                <p className="text-xs text-slate-400 dark:text-zinc-200 mt-1">
                  {isAdmin ? t('fin.sinFacturasAdmin') : t('fin.sinFacturasLector')}
                </p>
              </div>
            )}

            {/* Lista de documentos: miniatura cuadrada a la izquierda, datos a la derecha */}
            <div className="flex flex-col gap-3">
              {facturas.map((fac) => {
                const tieneArchivo = esComprobanteArchivo(fac.comprobante);
                const esPdf = esComprobantePdf(fac.comprobante);

                return (
                  <div
                    key={fac.id}
                    className="group flex items-stretch gap-4 p-3 sm:p-4 bg-white dark:bg-zinc-800 border border-gray-100 dark:border-zinc-700 rounded-2xl shadow-sm hover:shadow-md hover:border-[#C5A059]/50 transition-all"
                  >
                    {/* Miniatura cuadrada */}
                    <button
                      type="button"
                      disabled={!tieneArchivo}
                      onClick={() => { setVisorAmpliado(false); setFacturaEnVisor(fac); }}
                      title={tieneArchivo ? t('fac.verComprobante') : t('fac.sinComprobante')}
                      className={`relative w-20 h-20 sm:w-24 sm:h-24 flex-shrink-0 rounded-xl overflow-hidden border border-gray-200 dark:border-zinc-600 bg-slate-50 dark:bg-zinc-900 ${
                        tieneArchivo ? 'cursor-zoom-in hover:border-[#C5A059]' : 'cursor-default'
                      }`}
                    >
                      {tieneArchivo && !esPdf ? (
                        <>
                          <img
                            src={fac.comprobante}
                            alt={fac.proveedor}
                            loading="lazy"
                            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                          />
                          <span className="absolute inset-0 bg-black/0 group-hover:bg-black/35 transition-colors flex items-center justify-center">
                            <Eye size={18} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                          </span>
                        </>
                      ) : (
                        <span className="w-full h-full flex flex-col items-center justify-center gap-1 text-[#8B6914] dark:text-[#E3C77B]">
                          {tieneArchivo
                            ? <><FileText size={24} /><span className="text-[9px] font-black tracking-wider">PDF</span></>
                            : <><FileImage size={22} className="text-slate-300 dark:text-zinc-300" /><span className="text-[9px] font-bold text-slate-400 dark:text-zinc-300">{t('fac.sinArchivo')}</span></>}
                        </span>
                      )}
                    </button>

                    {/* Información detallada */}
                    <div className="flex-1 min-w-0 flex flex-col sm:flex-row sm:items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-bold text-slate-900 dark:text-white truncate">{fac.proveedor}</h4>
                        <p className="text-xs text-slate-500 dark:text-zinc-200 mt-0.5 line-clamp-2">{fac.concepto}</p>
                        <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-slate-400 dark:text-zinc-200 mt-1.5">
                          <Calendar size={11} /> {fac.fecha}
                          {tieneArchivo && (
                            <span className="inline-flex items-center gap-1 text-[#8B6914] dark:text-[#E3C77B]">
                              • <Receipt size={11} /> {t('fac.conComprobante')}
                            </span>
                          )}
                        </span>
                      </div>

                      <div className="flex items-center justify-between sm:flex-col sm:items-end gap-2 sm:gap-2.5 flex-shrink-0">
                        <span className="text-base font-black text-slate-900 dark:text-white whitespace-nowrap">
                          {formatearMoneda(fac.monto)}
                        </span>
                        <div className="flex items-center gap-1.5">
                          {tieneArchivo && (
                            <button
                              onClick={() => { setVisorAmpliado(false); setFacturaEnVisor(fac); }}
                              className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-zinc-200 bg-slate-100 dark:bg-zinc-700 px-3 py-1.5 rounded-xl hover:bg-slate-200 dark:hover:bg-zinc-600 transition-colors"
                            >
                              <Eye size={13} /> {t('fac.ver')}
                            </button>
                          )}

                          {/* Editar / Eliminar: solo con el Modo Edición encendido */}
                          {puedeEditarFacturas && (
                            <>
                              <button
                                onClick={() => abrirEdicionFactura(fac)}
                                title={t('fac.editar')}
                                className="p-2 rounded-xl text-slate-500 dark:text-zinc-300 bg-slate-100 dark:bg-zinc-700 hover:text-[#8B6914] dark:hover:text-[#E3C77B] hover:bg-amber-50 dark:hover:bg-amber-500/10 transition-colors"
                              >
                                <Edit2 size={13} />
                              </button>
                              <button
                                onClick={() => handleEliminarFactura(fac)}
                                disabled={facturaEliminando === fac.id}
                                title={t('fac.eliminar')}
                                className="p-2 rounded-xl text-slate-500 dark:text-zinc-300 bg-slate-100 dark:bg-zinc-700 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors disabled:opacity-50 disabled:cursor-wait"
                              >
                                {facturaEliminando === fac.id
                                  ? <Loader2 size={13} className="animate-spin" />
                                  : <Trash2 size={13} />}
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
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
                <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-400 dark:text-zinc-200">{t('doc.archivos')}</h2>
                <p className="text-[11px] text-slate-400 dark:text-zinc-200 mt-0.5">{t('doc.bucket')} <span className="font-mono font-semibold text-slate-500 dark:text-zinc-200">archivos_mmcapital</span></p>
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
                    <FileText size={28} className="text-slate-300 dark:text-zinc-200 mx-auto mb-3" />
                    <p className="text-sm font-bold text-slate-600 dark:text-zinc-300">{t('doc.vacio')}</p>
                    <p className="text-xs text-slate-400 dark:text-zinc-200 mt-1">
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
                          <p className="text-xs text-slate-400 dark:text-zinc-200 mt-0.5 flex items-center gap-2 flex-wrap">
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
                              className="p-2 text-slate-400 dark:text-zinc-200 hover:text-[#C5A059] rounded-xl hover:bg-amber-50 border border-gray-200 dark:border-zinc-700 transition-colors disabled:opacity-40"
                              title={t('doc.editarNombre')}
                            >
                              <Edit2 size={15} />
                            </button>
                            <button
                              onClick={() => handleDeleteArchivo(doc)}
                              disabled={isUploading}
                              className="p-2 text-slate-300 dark:text-zinc-200 hover:text-red-500 rounded-xl hover:bg-red-50 border border-gray-200 dark:border-zinc-700 transition-colors disabled:opacity-40"
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
                <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-zinc-200">{t('gal.titulo')}</h2>
                <p className="text-xs text-slate-500 dark:text-zinc-200 mt-0.5">{t('gal.subtitulo')}</p>
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
                      <p className="text-xs text-slate-400 dark:text-zinc-200 mt-1 font-medium">{album.date}</p>
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
                            className="p-1.5 text-slate-400 dark:text-zinc-200 hover:text-[#C5A059] rounded-lg hover:bg-amber-50 dark:hover:bg-amber-500/10 transition-colors disabled:opacity-40"
                            title={t('gal.editarAlbum')}
                          >
                            <Edit2 size={15} />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleEliminarAlbum(album); }}
                            disabled={subiendoGaleria}
                            className="p-1.5 text-slate-300 dark:text-zinc-300 hover:text-red-500 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors disabled:opacity-40"
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
                <p className="text-xs text-slate-500 dark:text-zinc-200">{activeAlbumModal.date} • {activeAlbumModal.photoCount || (activeAlbumModal.photos || []).length} {t('gal.fotosRegistradas')}</p>
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
                  className="w-9 h-9 rounded-full bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 flex items-center justify-center text-slate-400 dark:text-zinc-200 hover:text-slate-800 dark:hover:text-white shadow-sm"
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
                      className="absolute top-2 right-2 z-10 w-9 h-9 rounded-full bg-black/60 backdrop-blur-sm text-white/90 hover:bg-red-600 hover:text-white flex items-center justify-center opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-all disabled:opacity-40"
                      title={t('gal.eliminarFoto')}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}

                  <div
                    onClick={() => setSelectedPhotoLightbox(photoUrl)}
                    className="absolute inset-0 bg-black/30 opacity-0 md:group-hover:opacity-100 transition-opacity flex items-center justify-center text-white cursor-pointer"
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
              <button onClick={() => setShowDestinoModal(false)} className="text-slate-400 dark:text-zinc-200 hover:text-slate-700 dark:hover:text-white">
                <X size={18} />
              </button>
            </div>

            {albums.length === 0 ? (
              <div className="text-center py-6">
                <p className="text-sm font-bold text-slate-600 dark:text-zinc-300">{t('gal.sinAlbumes')}</p>
                <p className="text-xs text-slate-400 dark:text-zinc-300 mt-1">{t('gal.sinAlbumesAyuda')}</p>
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
              <button onClick={() => setShowCreateAlbumModal(false)} className="text-slate-400 dark:text-zinc-200 hover:text-slate-700 dark:hover:text-zinc-100">
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
                <p className="text-[11px] text-slate-400 dark:text-zinc-300 mt-1">{t('perfil.formatosAceptados')}</p>
              </div>

              {galeriaMsg?.tipo === 'error' && (
                <div className="p-3 rounded-xl border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 text-xs font-semibold text-red-700 dark:text-red-300">
                  {galeriaMsg.texto}
                </div>
              )}

              <div className="pt-2 flex justify-end gap-2">
                <button type="button" onClick={() => { setShowCreateAlbumModal(false); setPortadaFile(null); }} className="px-4 py-2 text-xs font-bold text-slate-500 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-700 rounded-xl">
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
              <button onClick={() => setAlbumEditando(null)} className="text-slate-400 dark:text-zinc-200 hover:text-slate-700 dark:hover:text-zinc-100">
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
                <button type="button" onClick={() => { setAlbumEditando(null); setNuevaPortadaFile(null); }} className="px-4 py-2 text-xs font-bold text-slate-500 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-700 rounded-xl">
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
          <div className="bg-white dark:bg-zinc-800 rounded-3xl max-w-md w-full p-6 shadow-2xl border border-gray-100 dark:border-zinc-700 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100 dark:border-zinc-700">
              <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Receipt size={18} className="text-[#C5A059]" /> {t('modal.registrarFactura')}
              </h3>
              <button onClick={cerrarModalFactura} className="text-slate-400 dark:text-zinc-200 hover:text-slate-700 dark:hover:text-zinc-100">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleCreateInvoice} className="space-y-4">

              {/* ── Comprobante: arrastrar y soltar o seleccionar ── */}
              <input
                type="file"
                ref={comprobanteInputRef}
                accept="image/*,application/pdf"
                className="hidden"
                onChange={(e) => { adjuntarComprobante(e.target.files?.[0]); e.target.value = ''; }}
              />

              <div
                onDragOver={(e) => { e.preventDefault(); setArrastrandoComprobante(true); }}
                onDragLeave={() => setArrastrandoComprobante(false)}
                onDrop={handleSoltarComprobante}
                onClick={() => comprobanteInputRef.current?.click()}
                className={`relative rounded-2xl border-2 border-dashed cursor-pointer transition-colors overflow-hidden ${
                  arrastrandoComprobante
                    ? 'border-[#C5A059] bg-amber-50 dark:bg-amber-500/10'
                    : comprobanteFile
                    ? 'border-[#C5A059]/60 bg-amber-50/40 dark:bg-amber-500/5'
                    : 'border-gray-300 dark:border-zinc-600 bg-slate-50/70 dark:bg-zinc-900/50 hover:border-[#C5A059]/70'
                }`}
              >
                {comprobantePreview ? (
                  <div className="flex items-center gap-3 p-3">
                    <img src={comprobantePreview} alt={t('modal.comprobanteFoto')} className="w-20 h-20 rounded-xl object-cover border border-gray-200 dark:border-zinc-600 flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-slate-800 dark:text-white truncate">{comprobanteFile?.name}</p>
                      <p className="text-[10px] font-semibold text-slate-400 dark:text-zinc-200 mt-0.5">{t('modal.cambiarArchivo')}</p>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); limpiarComprobanteAdjunto(); }}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 flex-shrink-0"
                    >
                      <X size={16} />
                    </button>
                  </div>
                ) : comprobanteFile ? (
                  <div className="flex items-center gap-3 p-3">
                    <div className="w-20 h-20 rounded-xl border border-gray-200 dark:border-zinc-600 bg-white dark:bg-zinc-800 flex flex-col items-center justify-center gap-1 text-[#8B6914] dark:text-[#E3C77B] flex-shrink-0">
                      <FileText size={22} /><span className="text-[9px] font-black tracking-wider">PDF</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-slate-800 dark:text-white truncate">{comprobanteFile.name}</p>
                      <p className="text-[10px] font-semibold text-slate-400 dark:text-zinc-200 mt-0.5">{t('modal.cambiarArchivo')}</p>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); limpiarComprobanteAdjunto(); }}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 flex-shrink-0"
                    >
                      <X size={16} />
                    </button>
                  </div>
                ) : (
                  <div className="py-7 px-4 text-center">
                    <div className="w-11 h-11 mx-auto mb-2 rounded-2xl bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-600 shadow-sm flex items-center justify-center text-[#C5A059]">
                      <Upload size={20} />
                    </div>
                    <p className="text-xs font-bold text-slate-700 dark:text-zinc-200">{t('modal.soltarComprobante')}</p>
                    <p className="text-[10px] font-semibold text-slate-400 dark:text-zinc-200 mt-1">{t('modal.formatosComprobante')}</p>
                  </div>
                )}
              </div>

              {/* ── Extracción automática con Gemini (gemini-1.5-flash) ── */}
              <button
                type="button"
                onClick={handleExtraerConIA}
                disabled={extrayendoIA || !comprobanteFile}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-xs font-black uppercase tracking-wider text-white shadow-lg shadow-amber-500/20 bg-gradient-to-r from-[#0B1B2C] via-[#8B6914] to-[#C5A059] hover:brightness-110 active:scale-[0.99] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {extrayendoIA
                  ? <><Loader2 size={15} className="animate-spin" /> {t('modal.procesandoComprobante')}</>
                  : <><Sparkles size={15} /> {t('modal.extraerIA')}</>}
              </button>

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
              <div className="pt-2 flex justify-end gap-2">
                <button type="button" onClick={cerrarModalFactura} className="px-4 py-2 text-xs font-bold text-slate-500 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-700 rounded-xl">
                  {t('comun.cancelar')}
                </button>
                <button
                  type="submit"
                  disabled={guardandoFactura || extrayendoIA}
                  className="px-5 py-2 text-xs font-bold text-white bg-[#0B1B2C] hover:bg-slate-800 rounded-xl shadow-sm disabled:opacity-50 flex items-center gap-2"
                >
                  {guardandoFactura && <Loader2 size={14} className="animate-spin text-[#C5A059]" />}
                  {guardandoFactura ? t('modal.guardandoFactura') : t('modal.guardarFactura')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ════ MODAL EDITAR FACTURA (ADMIN · MODO EDICIÓN) ════ */}
      {facturaEditando && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-800 rounded-3xl max-w-md w-full p-6 shadow-2xl border border-gray-100 dark:border-zinc-700 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100 dark:border-zinc-700">
              <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Edit2 size={18} className="text-[#C5A059]" /> {t('modal.editarFactura')}
              </h3>
              <button onClick={cerrarEdicionFactura} className="text-slate-400 dark:text-zinc-200 hover:text-slate-700 dark:hover:text-zinc-100">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleActualizarFactura} className="space-y-4">
              <p className="text-[11px] font-semibold text-slate-400 dark:text-zinc-200">
                {t('modal.editarFacturaNota')}
              </p>

              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-zinc-300 mb-1 uppercase">{t('modal.proveedor')}</label>
                <input
                  type="text"
                  required
                  placeholder={t('modal.proveedorPh')}
                  value={edicionFactura.proveedor}
                  onChange={(e) => setEdicionFactura({ ...edicionFactura, proveedor: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-slate-800"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-zinc-300 mb-1 uppercase">{t('modal.concepto')}</label>
                <input
                  type="text"
                  placeholder={t('modal.conceptoPh')}
                  value={edicionFactura.concepto}
                  onChange={(e) => setEdicionFactura({ ...edicionFactura, concepto: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-slate-800"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-zinc-300 mb-1 uppercase">{t('modal.monto')}</label>
                <input
                  type="number"
                  required
                  step="0.01"
                  min="0"
                  placeholder="42500"
                  value={edicionFactura.monto}
                  onChange={(e) => setEdicionFactura({ ...edicionFactura, monto: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-slate-800"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button type="button" onClick={cerrarEdicionFactura} className="px-4 py-2 text-xs font-bold text-slate-500 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-700 rounded-xl">
                  {t('comun.cancelar')}
                </button>
                <button
                  type="submit"
                  disabled={guardandoEdicion}
                  className="px-5 py-2 text-xs font-bold text-white bg-[#0B1B2C] hover:bg-slate-800 rounded-xl shadow-sm disabled:opacity-50 flex items-center gap-2"
                >
                  {guardandoEdicion && <Loader2 size={14} className="animate-spin text-[#C5A059]" />}
                  {guardandoEdicion ? t('modal.guardandoFactura') : t('comun.guardar')}
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
              <button onClick={() => setShowAddHitoModal(false)} className="text-slate-400 dark:text-zinc-200 hover:text-slate-700 dark:hover:text-zinc-100">
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
                <button type="button" onClick={() => setShowAddHitoModal(false)} className="px-4 py-2 text-xs font-bold text-slate-500 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-700 rounded-xl">
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

      {/* ════ VISOR DE ALTA CALIDAD DEL COMPROBANTE ════ */}
      {facturaEnVisor && (
        <div
          className="fixed inset-0 z-[60] bg-black/90 backdrop-blur-sm flex flex-col"
          onClick={() => setFacturaEnVisor(null)}
        >
          {/* Cabecera: datos de la factura + acciones */}
          <div
            className="flex items-center justify-between gap-4 px-4 sm:px-6 py-3 border-b border-white/10 flex-shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-white truncate">{facturaEnVisor.proveedor}</h3>
              <p className="text-[11px] font-semibold text-white/50 truncate">
                {facturaEnVisor.concepto} · {formatearMoneda(facturaEnVisor.monto)} · {facturaEnVisor.fecha}
              </p>
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              {!esComprobantePdf(facturaEnVisor.comprobante) && (
                <button
                  onClick={() => setVisorAmpliado(v => !v)}
                  title={visorAmpliado ? t('fac.ajustarPantalla') : t('fac.tamanoReal')}
                  className="p-2 rounded-xl text-white/80 bg-white/10 hover:bg-white/20 transition-colors"
                >
                  {visorAmpliado ? <ZoomOut size={16} /> : <ZoomIn size={16} />}
                </button>
              )}
              <button
                onClick={handleDescargarComprobante}
                disabled={descargandoVisor}
                className="flex items-center gap-2 text-xs font-bold text-[#0B1B2C] bg-[#C5A059] hover:bg-[#d4b06a] px-4 py-2 rounded-xl transition-colors disabled:opacity-60"
              >
                {descargandoVisor ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                <span className="hidden sm:inline">{t('fac.descargar')}</span>
              </button>
              <button
                onClick={() => setFacturaEnVisor(null)}
                className="p-2 rounded-xl text-white/80 bg-white/10 hover:bg-white/20 transition-colors"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Lienzo: el archivo original a resolución completa, sin recomprimir.
              "Ajustar a pantalla" usa object-contain; "tamaño real" deja el
              scroll para leer los importes al 100%. */}
          <div
            className={`flex-1 min-h-0 p-3 sm:p-6 ${visorAmpliado ? 'overflow-auto' : 'overflow-hidden flex items-center justify-center'}`}
            onClick={(e) => e.stopPropagation()}
          >
            {esComprobantePdf(facturaEnVisor.comprobante) ? (
              <iframe
                src={facturaEnVisor.comprobante}
                title={facturaEnVisor.proveedor}
                className="w-full h-full rounded-xl bg-white shadow-2xl"
              />
            ) : (
              <img
                src={facturaEnVisor.comprobante}
                alt={facturaEnVisor.proveedor}
                onClick={() => setVisorAmpliado(v => !v)}
                className={`rounded-xl shadow-2xl bg-white ${
                  visorAmpliado
                    ? 'max-w-none cursor-zoom-out'
                    : 'max-w-full max-h-full object-contain cursor-zoom-in'
                }`}
              />
            )}
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
              <button onClick={() => setEditingHitoIndex(null)} className="text-slate-400 dark:text-zinc-200 hover:text-slate-700 dark:hover:text-zinc-100">
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
                <button type="button" onClick={() => setEditingHitoIndex(null)} className="px-4 py-2 text-xs font-bold text-slate-500 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-700 rounded-xl">
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
