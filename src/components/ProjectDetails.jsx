import React, { useState, useEffect, useRef } from 'react';
import {
  ArrowLeft, CheckSquare, Square, Circle, Upload, Image, TrendingUp, FileText, LayoutGrid,
  ChevronDown, ChevronUp, Edit2, Save, Plus, Trash2, AlertTriangle, Loader2, CheckCircle2,
  ExternalLink, Download, Calendar, DollarSign, FolderPlus, X, Eye, Receipt, ShieldAlert, Building,
  Sparkles, FileImage, ZoomIn, ZoomOut, Lock, GripVertical
} from 'lucide-react';
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import {
  uploadArchivoProyecto, getArchivosProyecto, renombrarArchivo, eliminarArchivo,
  subirComprobanteFactura, validarComprobante, descargarArchivo
} from '../services/storageService';
import { supabase } from '../supabaseClient';
import {
  guardarFinanzas, agruparGastosPorMes, formatearMoneda, aNumero, aAjuste,
  getFacturas, crearFactura, actualizarFactura, eliminarFactura,
  esComprobanteArchivo, esComprobantePdf, nombreArchivoFactura,
  sumarGastos, ejecucionMensualReal, componerCostoEjecutado
} from '../services/finanzasService';
import {
  getAlbumes, crearAlbum, actualizarAlbum, eliminarAlbum, subirFotoAlbum, eliminarFoto
} from '../services/galeriaService';
import { usePrefs } from '../context/PreferenciasContext';
import InputMonto from './ui/InputMonto';
import {
  // El lápiz y el basurero ya no escriben solos: todo el checklist viaja a
  // Supabase en un único `saveChecklist` al presionar "Guardar Cambios".
  fetchChecklist, saveChecklist, calcularAvance,
  sumarValoresCompletados, aMonto
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

/* La numeración del checklist es AUTOMÁTICA: la posición manda y se pinta
   "1., 2., 3." según el orden actual de la lista. Los títulos que ya traían el
   número escrito a mano (las plantillas semilla y lo guardado antes de esto)
   se limpian al mostrarlos y al guardarlos, para que mover una tarea nunca
   deje un "3." arriba del todo ni un "1. 1." duplicado. */
const RE_NUMERACION = /^\s*\d+\s*[.)\-–—]\s*/;

export function sinNumeracion(texto) {
  return String(texto || '').replace(RE_NUMERACION, '').trim();
}

/**
 * Tarjeta de monto financiero. En modo lectura muestra la cifra formateada;
 * en modo edición se convierte en un input controlado.
 */
function TarjetaMonto({ etiqueta, pie, valor, editando, onChange, colorValor, resaltado, children }) {
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
          {/* Se escribe con comas de miles, igual que se lee */}
          <InputMonto
            value={valor}
            onChange={onChange}
            placeholder="0.00"
            className={`w-full min-w-0 bg-transparent border-b-2 border-[#C5A059]/60 focus:border-[#C5A059] outline-none text-2xl md:text-3xl font-black ${colorValor}`}
          />
        </div>
      ) : (
        /* Formato SIEMPRE en notación de dólar (coma para los miles, punto
           para los centavos). `toLocaleString()` a secas usaba el idioma del
           navegador y en español pintaba "$18.685,36", que se lee como $18. */
        <p className={`text-2xl md:text-3xl font-black ${colorValor}`}>
          {formatearMoneda(valor)}
        </p>
      )}

      <p className="text-xs text-slate-400 dark:text-zinc-200 mt-1 font-semibold">{pie}</p>
      {children}
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

  /* Facturas de proveedores: filas REALES de la tabla `gastos` de Supabase.
     Igual que el checklist, `facturas` es un BORRADOR en pantalla: registrar,
     corregir o quitar una factura solo cambia esta lista, y nada toca Supabase
     hasta que se presiona "Guardar Cambios". Las que aún no existen en la base
     llevan `_nueva` (y su archivo pendiente de subir en `_archivo`), las
     corregidas llevan `_editada`, y las quitadas se apuntan en
     `facturasPorEliminar` hasta confirmar el borrado definitivo. */
  const [facturas, setFacturas] = useState([]);
  const [facturasMsg, setFacturasMsg] = useState(null);
  const [facturasOkMsg, setFacturasOkMsg] = useState(null);
  const [facturasPorEliminar, setFacturasPorEliminar] = useState([]);
  const [hayCambiosFacturas, setHayCambiosFacturas] = useState(false);
  const [guardandoFacturas, setGuardandoFacturas] = useState(false);
  const [confirmandoBorradoFacturas, setConfirmandoBorradoFacturas] = useState(false);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [newInvoice, setNewInvoice] = useState({ proveedor: '', concepto: '', monto: '' });
  // Comprobante adjunto: archivo elegido + previsualización local antes de subir
  const [comprobanteFile, setComprobanteFile] = useState(null);
  const [comprobantePreview, setComprobantePreview] = useState(null);
  const [arrastrandoComprobante, setArrastrandoComprobante] = useState(false);
  const [extrayendoIA, setExtrayendoIA] = useState(false);
  const [facturaEnVisor, setFacturaEnVisor] = useState(null);
  // Edición y borrado de una factura ya registrada (solo en Modo Edición)
  const [facturaEditando, setFacturaEditando] = useState(null);
  const [edicionFactura, setEdicionFactura] = useState({ proveedor: '', concepto: '', monto: '' });
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
  // {actual, total} mientras se sube un lote de fotos; null si no hay subida
  const [progresoFotos, setProgresoFotos] = useState(null);
  const [galeriaMsg, setGaleriaMsg] = useState(null);
  const [showDestinoModal, setShowDestinoModal] = useState(false);
  const [destinoFoto, setDestinoFoto] = useState('');
  const [nuevaPortadaFile, setNuevaPortadaFile] = useState(null);

  // Checklist State & Admin Controls
  const isAdmin = ['admin', 'socio_administrador'].includes(userRole);
  /* El checklist es EXCLUSIVO del administrador: socios e inversionistas ven
     el estado real pero no pueden modificarlo. Y ni siquiera el administrador
     lo toca en lectura: hace falta ADEMÁS el Modo Edición encendido. Marcar un
     hito mueve dinero al Costo Ejecutado, así que no puede pasar de un clic
     despistado mientras se revisa el avance. */
  const esAdminChecklist = puedeEditarHitos(userRole);
  const puedeEditarChecklist = esAdminChecklist && !!isEditMode;
  const [checklist, setChecklist] = useState([]);
  const [isLoadingChecklist, setIsLoadingChecklist] = useState(true);
  // true = lo que se ve son datos reales de Supabase; false = semilla aún sin guardar
  const [checklistPersistido, setChecklistPersistido] = useState(false);
  const [showAddHitoModal, setShowAddHitoModal] = useState(false);
  const [newItemText, setNewItemText] = useState('');
  const [newHitoDetail, setNewHitoDetail] = useState('');
  const [newHitoDate, setNewHitoDate] = useState('');
  const [newHitoValor, setNewHitoValor] = useState('');

  /* Reordenamiento del checklist. `hitoArrastrado` es la tarea que viaja y
     `hitoSobre` la posición donde se soltaría: con las dos se pinta la guía de
     dónde va a caer. `handleActivo` existe porque el <li> solo se vuelve
     arrastrable mientras el dedo/ratón está sobre el asa, así escribir un
     monto dentro de la tarjeta no arranca un arrastre por accidente. */
  const [hitoArrastrado, setHitoArrastrado] = useState(null);
  const [hitoSobre, setHitoSobre] = useState(null);
  const [handleActivo, setHandleActivo] = useState(null);

  // Edit Hito State
  const [editingHitoIndex, setEditingHitoIndex] = useState(null);
  const [editHitoText, setEditHitoText] = useState('');
  const [editHitoDetail, setEditHitoDetail] = useState('');
  const [editHitoDate, setEditHitoDate] = useState('');
  const [editHitoValor, setEditHitoValor] = useState('');

  // Save Manual & Global Sync State
  const [isSavingChanges, setIsSavingChanges] = useState(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState(null);
  const [saveErrorMsg, setSaveErrorMsg] = useState(null);
  const [hayCambiosSinGuardar, setHayCambiosSinGuardar] = useState(false);
  /* Hitos que YA existen en Supabase y el administrador quitó de la lista.
     Solo desaparecieron de la pantalla: la fila sigue en la base hasta que se
     presiona "Guardar Cambios" y se confirma el borrado definitivo. Se guarda
     el título para poder enumerarlos en esa confirmación. */
  const [hitosPorEliminar, setHitosPorEliminar] = useState([]);
  const [confirmandoBorrado, setConfirmandoBorrado] = useState(false);

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
        setChecklist(getChecklistSeed(project.id, project.nombre || project.title)
          .map((item, i) => ({ ...item, text: sinNumeracion(item.text), id: null, orden: i })));
        setChecklistPersistido(false);
      }
      setHayCambiosSinGuardar(false);
      setHitosPorEliminar([]);
    } catch (err) {
      console.error('Error cargando el checklist desde Supabase:', err);
      setChecklist(getChecklistSeed(project?.id, project?.nombre || project?.title)
        .map((item, i) => ({ ...item, text: sinNumeracion(item.text), id: null, orden: i })));
      setChecklistPersistido(false);
    } finally {
      setIsLoadingChecklist(false);
    }
  };

  useEffect(() => {
    cargarChecklist();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  /* ── Facturas como paso propio del historial ────────────────────────────────
     El subpanel de Facturas vive dentro de la pestaña Finanzas, así que sin
     esto el botón "Atrás" del teléfono (y el "Volver" del header) saltaban
     hasta el Dashboard y había que volver a entrar al proyecto. Al abrirlo se
     empuja una entrada de historial propia: retroceder cierra las facturas y
     deja al usuario justo donde estaba, en Finanzas.

     La entrada CONSERVA el `state` del Dashboard (`view`/`activeProject`), así
     que su propio `popstate` sigue viendo el mismo proyecto y no cambia nada. */
  const abrirFacturas = () => {
    setShowExpenses(true);
    window.history.pushState(
      { ...(window.history.state || {}), subvista: 'facturas' },
      ''
    );
  };

  const cerrarFacturas = () => {
    // Si la apertura dejó su marca en el historial se retrocede de verdad (así
    // no queda una entrada huérfana); si no, basta con cerrar el panel.
    if (window.history.state?.subvista === 'facturas') window.history.back();
    else setShowExpenses(false);
  };

  useEffect(() => {
    if (!showExpenses) return;
    const alRetroceder = () => setShowExpenses(false);
    window.addEventListener('popstate', alRetroceder);
    return () => window.removeEventListener('popstate', alRetroceder);
  }, [showExpenses]);

  /** "Volver" del header: primero cierra Facturas, y solo después sale al panel. */
  const handleVolver = () => {
    if (showExpenses) cerrarFacturas();
    else onBack?.();
  };

  /* Apagar el Modo Edición equivale a cancelar: se relee el checklist de
     Supabase y se descarta lo que no llegó a guardarse. Sin esto quedarían
     tareas "borradas" en pantalla que ya nadie puede confirmar, porque el
     botón de Guardar Cambios también vive detrás del Modo Edición. */
  useEffect(() => {
    if (isEditMode) return;
    setEditingHitoIndex(null);
    setConfirmandoBorrado(false);
    if (hayCambiosSinGuardar) cargarChecklist();
    // Las facturas siguen la misma regla: salir del Modo Edición es cancelar,
    // así que el borrador se descarta y vuelve lo que hay en Supabase.
    if (hayCambiosFacturas) descartarCambiosFacturas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditMode]);

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

  /* Dinero que representa la tarea. Si ya está marcada como hecha, cambiar el
     monto mueve el Costo Ejecutado en el acto (`totalHitos` se recalcula solo);
     si está pendiente, el monto queda esperando a que se marque. */
  const handleValorHito = (index, valor) => {
    if (!puedeEditarChecklist) return;
    setChecklist(prev => (Array.isArray(prev) ? prev : []).map((item, i) =>
      i === index ? { ...item, valor: aMonto(valor) } : item
    ));
    setHayCambiosSinGuardar(true);
    limpiarMensajes();
  };

  /**
   * Mueve una tarea a otra posición de la lista.
   *
   * La numeración (1., 2., 3.) sale de la posición, así que reordenar renumera
   * solo: lo que quede de primero SIEMPRE es el 1. El nuevo orden viaja a
   * Supabase en la columna `orden` con el mismo "Guardar Cambios" que todo lo
   * demás, así que un arrastre por error se descarta saliendo del Modo Edición.
   */
  const moverHito = (desde, hacia) => {
    if (!puedeEditarChecklist) return;
    if (desde === hacia) return;
    if (desde < 0 || desde >= safeChecklist.length) return;
    if (hacia < 0 || hacia >= safeChecklist.length) return;

    const lista = [...safeChecklist];
    const [movido] = lista.splice(desde, 1);
    lista.splice(hacia, 0, movido);

    // El acordeón y la edición apuntan a índices: tras mover señalarían a otra
    // tarea, así que se cierran en vez de quedar apuntando a lo que no es.
    setOpenAccordion(null);
    setEditingHitoIndex(null);
    setChecklist(lista.map((item, i) => ({ ...item, orden: i })));
    setHayCambiosSinGuardar(true);
    limpiarMensajes();
  };

  /** Suelta la tarea arrastrada sobre la posición `destino`. */
  const soltarHito = (destino) => {
    if (hitoArrastrado !== null) moverHito(hitoArrastrado, destino);
    setHitoArrastrado(null);
    setHitoSobre(null);
    setHandleActivo(null);
  };

  /**
   * Quita el hito de la LISTA, no de la base.
   *
   * Así se puede sacar una tarea y ver al instante cómo queda el avance y la
   * gráfica sin comprometerse a nada: si no se presiona "Guardar Cambios", la
   * fila sigue intacta en Supabase y basta con salir para recuperarla.
   */
  const handleDeleteHito = (index) => {
    if (!puedeEditarChecklist) return;
    const item = safeChecklist[index];
    if (!item) return;

    limpiarMensajes();
    setChecklist(safeChecklist.filter((_, i) => i !== index));

    // Los que ya existían en la base se anotan para confirmarlos al guardar.
    // Los que nunca llegaron a Supabase (id null) no hay nada que borrar.
    if (item.id !== null && item.id !== undefined) {
      setHitosPorEliminar(prev => (
        prev.some(h => String(h.id) === String(item.id))
          ? prev
          : [...prev, { id: item.id, text: sinNumeracion(item.text) || t('proy.hitoSinTitulo') }]
      ));
    }
    setHayCambiosSinGuardar(true);
  };

  const handleStartEditHito = (index) => {
    if (!puedeEditarChecklist) return;
    const item = safeChecklist[index];
    if (!item) return;
    setEditingHitoIndex(index);
    // El número lo pone la posición: no se edita a mano ni viaja en el título.
    setEditHitoText(sinNumeracion(item.text || item.titulo || ''));
    setEditHitoDetail(item.detail || item.descripcion || '');
    setEditHitoDate(item.fecha || item.fecha_vencimiento || '');
    setEditHitoValor(aMonto(item.valor) || '');
  };

  /**
   * Aplica la edición del hito a la LISTA. Igual que el basurero, no toca la
   * base: el texto, la fecha y el monto nuevos viajan a Supabase en el mismo
   * "Guardar Cambios" que todo lo demás.
   */
  const handleSaveEditHito = (e) => {
    e.preventDefault();
    if (!puedeEditarChecklist) return;
    if (editingHitoIndex === null || !editHitoText.trim()) return;

    const actualizado = {
      ...safeChecklist[editingHitoIndex],
      text: sinNumeracion(editHitoText),
      detail: editHitoDetail.trim() || t('fb.hitoActualizadoBitacora'),
      fecha: editHitoDate.trim() || 'Proyectado',
      valor: aMonto(editHitoValor)
    };
    const nuevaLista = safeChecklist.map((item, i) => i === editingHitoIndex ? actualizado : item);

    limpiarMensajes();
    setChecklist(nuevaLista);
    setEditingHitoIndex(null);
    setHayCambiosSinGuardar(true);
  };

  // Agrega una tarea nueva (se persiste al presionar "Guardar Cambios")
  const handleAddHito = (e) => {
    e.preventDefault();
    if (!puedeEditarChecklist) return;
    if (!newItemText.trim()) return;
    const newItem = {
      id: null,
      done: false,
      text: sinNumeracion(newItemText),
      detail: newHitoDetail.trim() || t('fb.hitoBitacora'),
      fecha: newHitoDate.trim() || 'Proyectado',
      valor: aMonto(newHitoValor),
      orden: safeChecklist.length,
      persisted: false
    };
    setChecklist([...safeChecklist, newItem]);
    setNewItemText('');
    setNewHitoDetail('');
    setNewHitoDate('');
    setNewHitoValor('');
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

    /* Este es el único punto sin retorno: hasta aquí quitar una tarea solo la
       escondía. Si hay hitos que ya existen en Supabase esperando borrado, se
       enumeran y se pide confirmación antes de tocar la base. */
    if (hitosPorEliminar.length > 0 && !confirmandoBorrado) {
      setConfirmandoBorrado(true);
      return;
    }
    setConfirmandoBorrado(false);

    setIsSavingChanges(true);
    limpiarMensajes();

    try {
      /* El ORDEN de la lista es el que se persiste (`orden` = posición) y los
         títulos van sin el número escrito a mano: la numeración se pinta sola
         desde la posición, así que guardarla dentro del texto solo generaría
         "3. 1. Adquisición" la próxima vez que se mueva la tarea. */
      const listaAGuardar = safeChecklist.map((item, i) => ({
        ...item, text: sinNumeracion(item.text), orden: i
      }));
      const { success, items, porcentaje, error } = await saveChecklist(project.id, listaAGuardar);

      if (!success) {
        setSaveErrorMsg(t('msg.errorGuardarCambios', { error: error || t('msg.errorDesconocido') }));
        return;
      }

      const listaFinal = Array.isArray(items) && items.length > 0 ? items : listaAGuardar;
      setChecklist(listaFinal);
      setChecklistPersistido(true);
      setHayCambiosSinGuardar(false);
      // `saveChecklist` ya borró en Supabase las filas que faltaban en la lista
      setHitosPorEliminar([]);

      /* Las cifras y la identidad editadas viajan en el MISMO clic que el
         checklist. El costo ejecutado se recalcula con la lista RECIÉN
         guardada, no con la que había al abrir la pantalla: así el dinero de
         un hito marcado hace un segundo ya entra en el total que se persiste. */
      if (modoEdicionFinanzas) {
        const costoFinal = componerCostoEjecutado({
          facturas: totalFacturas,
          hitos: sumarValoresCompletados(listaFinal),
          ajuste: finanzas.ajusteManual
        });

        const fin = await guardarFinanzas(project.id, {
          ...finanzas, ...identidad, costoEjecutado: costoFinal
        });
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
          project.ajuste_costo_manual = fin.valores.ajuste_costo_manual;
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

  /* ── Identidad y estado de una factura del borrador ────────────────────────
     Las facturas nuevas todavía no tienen `id` de Supabase, así que se las
     distingue con la clave temporal `_key`; y su comprobante aún no está en el
     bucket, así que la miniatura se pinta con la URL local del archivo. */
  const claveFactura = (fac) => fac?.id ?? fac?._key ?? null;
  const urlComprobante = (fac) => fac?._preview || fac?.comprobante || '';
  const tieneComprobante = (fac) => !!fac?._archivo || esComprobanteArchivo(fac?.comprobante);
  const comprobanteEsPdf = (fac) => (
    fac?._archivo ? fac._archivo.type === 'application/pdf' : esComprobantePdf(fac?.comprobante)
  );

  /**
   * Carga las facturas reales del proyecto desde `gastos`.
   * Con cambios sin guardar NO se relee: pisar el borrador borraría lo que el
   * administrador acaba de registrar o corregir. `forzar` es para los momentos
   * en que sí se quiere descartar el borrador (guardar o cancelar).
   */
  const cargarFacturas = async (forzar = false) => {
    if (!project?.id) { setFacturas([]); return; }
    if (hayCambiosFacturas && !forzar) return;
    const { facturas: lista, error } = await getFacturas(project.id);
    setFacturas(Array.isArray(lista) ? lista : []);
    setFacturasMsg(error ? { tipo: 'error', texto: error } : null);
  };

  useEffect(() => {
    cargarFacturas(true);
    setFacturasPorEliminar([]);
    setHayCambiosFacturas(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  // Realtime: una factura nueva aparece sola en todas las sesiones abiertas
  useEffect(() => {
    if (!project?.id) return;
    const canal = supabase
      .channel(`gastos-proyecto-${project.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gastos' }, () => cargarFacturas())
      .subscribe();
    return () => { supabase.removeChannel(canal); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, hayCambiosFacturas]);

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

  /**
   * Registra la factura en el BORRADOR, no en Supabase.
   *
   * Ni la fila ni el archivo se suben aquí: el comprobante se queda en memoria
   * (`_archivo`) con una URL local para la miniatura, y todo viaja junto al
   * presionar "Guardar Cambios". Así se pueden encolar varias facturas, revisar
   * cómo queda el costo ejecutado y arrepentirse sin haber tocado la base.
   */
  const handleCreateInvoice = (e) => {
    e.preventDefault();
    if (!String(newInvoice.proveedor || '').trim()) {
      setFacturasMsg({ tipo: 'error', texto: t('fac.faltaProveedor') });
      return;
    }
    if (aNumero(newInvoice.monto) <= 0) {
      setFacturasMsg({ tipo: 'error', texto: t('fac.faltaMonto') });
      return;
    }

    const archivo = comprobanteFile || null;
    const nueva = {
      id: null,
      _key: `nueva-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      _nueva: true,
      _archivo: archivo,
      // URL local propia: la del modal se libera al cerrarlo
      _preview: archivo ? URL.createObjectURL(archivo) : '',
      proveedor: String(newInvoice.proveedor).trim(),
      concepto: String(newInvoice.concepto || '').trim() || t('fb.comprobantePago'),
      monto: aNumero(newInvoice.monto),
      comprobante: '',
      fecha: new Date().toISOString().slice(0, 10)
    };

    // Arriba del todo: la lista del servidor llega de la más reciente a la más
    // antigua, y una factura recién escrita es lo más reciente que hay.
    setFacturas(prev => [nueva, ...(Array.isArray(prev) ? prev : [])]);
    setHayCambiosFacturas(true);
    setFacturasMsg(null);
    setFacturasOkMsg(null);
    cerrarModalFactura();
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
  };

  /** Aplica la corrección al BORRADOR; el UPDATE real espera a "Guardar Cambios". */
  const handleActualizarFactura = (e) => {
    e.preventDefault();
    if (!facturaEditando) return;

    if (!String(edicionFactura.proveedor || '').trim()) {
      setFacturasMsg({ tipo: 'error', texto: t('fac.faltaProveedor') });
      return;
    }
    if (aNumero(edicionFactura.monto) <= 0) {
      setFacturasMsg({ tipo: 'error', texto: t('fac.faltaMonto') });
      return;
    }

    const clave = claveFactura(facturaEditando);
    setFacturas(prev => (Array.isArray(prev) ? prev : []).map(f => (
      claveFactura(f) === clave
        ? {
            ...f,
            proveedor: String(edicionFactura.proveedor).trim(),
            concepto: String(edicionFactura.concepto || '').trim(),
            monto: aNumero(edicionFactura.monto),
            // Una factura nueva sigue siendo nueva: no hay nada que "actualizar"
            _editada: f._nueva ? false : true
          }
        : f
    )));

    setHayCambiosFacturas(true);
    setFacturasMsg(null);
    setFacturasOkMsg(null);
    cerrarEdicionFactura();
  };

  /**
   * Quita la factura de la LISTA, no de la base.
   *
   * Las que ya existen en Supabase se anotan en `facturasPorEliminar` y se
   * enumeran al guardar para confirmar el borrado definitivo; las que solo
   * estaban en el borrador desaparecen sin más.
   */
  const handleEliminarFactura = (fac) => {
    const clave = claveFactura(fac);
    if (clave === null) return;

    if (fac._preview) URL.revokeObjectURL(fac._preview);

    setFacturas(prev => (Array.isArray(prev) ? prev : []).filter(f => claveFactura(f) !== clave));

    if (fac.id !== null && fac.id !== undefined) {
      setFacturasPorEliminar(prev => (
        prev.some(x => String(x.id) === String(fac.id))
          ? prev
          : [...prev, { id: fac.id, proveedor: fac.proveedor || t('fac.sinProveedor') }]
      ));
    }

    // El visor no puede quedar mostrando un comprobante que ya no está en la lista
    setFacturaEnVisor((previa) => (claveFactura(previa) === clave ? null : previa));
    setHayCambiosFacturas(true);
    setFacturasMsg(null);
    setFacturasOkMsg(null);
  };

  /** Libera las URL locales de los comprobantes que aún no se han subido. */
  const liberarPreviasFacturas = (lista) => {
    (Array.isArray(lista) ? lista : []).forEach(f => { if (f?._preview) URL.revokeObjectURL(f._preview); });
  };

  /** Cancela el borrador completo y vuelve a lo que hay en Supabase. */
  const descartarCambiosFacturas = async () => {
    liberarPreviasFacturas(facturas);
    setFacturasPorEliminar([]);
    setHayCambiosFacturas(false);
    setConfirmandoBorradoFacturas(false);
    setFacturasMsg(null);
    setFacturasOkMsg(null);
    setFacturaEnVisor(null);
    await cargarFacturas(true);
  };

  /**
   * "Guardar Cambios" de Facturas: vuelca el borrador entero contra Supabase.
   *   · DELETE de las quitadas (previa confirmación, como los hitos).
   *   · Subida del comprobante + INSERT de cada factura nueva.
   *   · UPDATE de las corregidas.
   * Al terminar se relee la base y se vuelven a colocar encima los pendientes
   * que hayan fallado, para que un error de red no borre trabajo ni duplique
   * lo que sí se guardó al reintentar.
   */
  const handleGuardarFacturas = async () => {
    if (!isAdmin || guardandoFacturas) return;
    if (!hayCambiosFacturas) return;

    // Único punto sin retorno: se enumeran las facturas que se van de verdad.
    if (facturasPorEliminar.length > 0 && !confirmandoBorradoFacturas) {
      setConfirmandoBorradoFacturas(true);
      return;
    }
    setConfirmandoBorradoFacturas(false);

    setGuardandoFacturas(true);
    setFacturasMsg(null);
    setFacturasOkMsg(null);

    let primerError = null;
    let creadas = 0;
    let actualizadas = 0;
    let eliminadas = 0;

    const borrado = [...facturasPorEliminar];
    const borradoPendiente = [];
    const nuevasPendientes = [];
    const edicionesPendientes = new Map();

    try {
      // 1. Borrados confirmados
      for (const f of borrado) {
        const { success, error } = await eliminarFactura(f.id);
        if (success) eliminadas += 1;
        else { primerError = primerError || error; borradoPendiente.push(f); }
      }

      // 2. Altas (comprobante primero: sin URL la factura quedaría sin respaldo)
      // 3. Correcciones de las que ya existían
      for (const fac of (Array.isArray(facturas) ? facturas : [])) {
        if (fac._nueva) {
          let url = '';
          if (fac._archivo) {
            const subida = await subirComprobanteFactura(fac._archivo, project?.id);
            if (!subida.success) {
              primerError = primerError || subida.error;
              nuevasPendientes.push(fac);
              continue;
            }
            url = subida.url;
          }

          const { success, error } = await crearFactura(project?.id, {
            proveedor: fac.proveedor,
            concepto: fac.concepto,
            monto: fac.monto,
            comprobante: url
          });

          if (success) {
            creadas += 1;
            if (fac._preview) URL.revokeObjectURL(fac._preview);
          } else {
            primerError = primerError || error;
            nuevasPendientes.push(fac);
          }
        } else if (fac._editada && fac.id) {
          const { success, error } = await actualizarFactura(fac.id, fac);
          if (success) {
            actualizadas += 1;
          } else {
            primerError = primerError || error;
            edicionesPendientes.set(String(fac.id), fac);
          }
        }
      }

      // 4. Se relee la base y encima se reponen los pendientes que fallaron
      const { facturas: enBase, error: errorLectura } = await getFacturas(project?.id);
      const base = (Array.isArray(enBase) ? enBase : [])
        .filter(f => !borradoPendiente.some(x => String(x.id) === String(f.id)))
        .map(f => edicionesPendientes.get(String(f.id)) || f);

      setFacturas([...nuevasPendientes, ...base]);
      setFacturasPorEliminar(borradoPendiente);

      const quedanPendientes = borradoPendiente.length > 0 || nuevasPendientes.length > 0 || edicionesPendientes.size > 0;
      setHayCambiosFacturas(quedanPendientes);

      if (primerError || errorLectura) {
        setFacturasMsg({ tipo: 'error', texto: primerError || errorLectura });
        return;
      }

      setFacturasOkMsg(t('fac.cambiosGuardados', { creadas, actualizadas, eliminadas }));
      setTimeout(() => setFacturasOkMsg(null), 6000);

      // El costo ejecutado del panel depende de estas cifras
      if (typeof onUpdateProject === 'function') {
        try { await onUpdateProject(); } catch (err) { console.warn('Aviso refrescando el dashboard:', err); }
      }
    } catch (err) {
      console.error('Error guardando las facturas:', err);
      setFacturasMsg({ tipo: 'error', texto: String(err?.message || err) });
    } finally {
      setGuardandoFacturas(false);
    }
  };

  /** Descarga el comprobante abierto en el visor (solo los ya subidos al bucket). */
  const handleDescargarComprobante = async () => {
    if (!esComprobanteArchivo(facturaEnVisor?.comprobante) || descargandoVisor) return;
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

  /**
   * Sube al álbum TODAS las fotos seleccionadas, una tras otra.
   *
   * Antes solo se tomaba `files[0]` y había que repetir el proceso foto a
   * foto. Ahora el input acepta selección múltiple y aquí se recorren en
   * orden, avisando por cuál va (`progresoFotos`). Si una falla, las demás
   * siguen subiendo y al final se dice cuántas entraron y cuántas no.
   */
  const handleSubirFoto = async (e, albumId) => {
    const archivos = Array.from(e.target.files || []);
    e.target.value = '';
    if (archivos.length === 0) return;

    setSubiendoGaleria(true);
    setGaleriaMsg(null);

    let subidas = 0;
    let primerError = null;

    for (let i = 0; i < archivos.length; i += 1) {
      setProgresoFotos({ actual: i + 1, total: archivos.length });
      const { success, error } = await subirFotoAlbum(archivos[i], project?.id, albumId);
      if (success) subidas += 1;
      else primerError = primerError || error;
    }

    setProgresoFotos(null);
    setSubiendoGaleria(false);

    // Lo que sí entró se refleja aunque alguna foto haya fallado
    if (subidas > 0) {
      const { albumes } = await getAlbumes(project.id);
      setAlbums(albumes);
      // Mantener abierto el mismo álbum con sus fotos ya actualizadas
      if (albumId) setActiveAlbumModal(albumes.find(a => String(a.id) === String(albumId)) || null);
    }

    if (primerError) {
      setGaleriaMsg({
        tipo: 'error',
        texto: subidas > 0
          ? t('gal.fotosParciales', { subidas, total: archivos.length, error: primerError })
          : primerError
      });
      return;
    }

    setGaleriaMsg({
      tipo: 'exito',
      texto: subidas === 1 ? t('gal.fotoSubida') : t('gal.fotosSubidas', { n: subidas })
    });
    setTimeout(() => setGaleriaMsg(null), 5000);
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

     Costo ejecutado: se COMPONE de tres orígenes (ver `totalSpent`).
       · Facturas       — suma real de `gastos`, se mueve sola con cada factura.
       · Hitos marcados — `valor` de las tareas del checklist ya completadas.
       · Ajuste manual  — lo que el Administrador escribe encima en la tarjeta.
     Solo el ajuste se guarda como tal (`proyectos.ajuste_costo_manual`): los
     otros dos se recalculan siempre, así que corregir una factura o desmarcar
     un hito nunca pisa la corrección escrita a mano. */
  const finanzasDesdeProyecto = () => ({
    presupuesto: Number(project?.presupuesto_total ?? 0),
    anticipo: Number(project?.anticipo ?? 0),
    cuota: Number(project?.cuota_asignada ?? 0),
    ajusteManual: Number(project?.ajuste_costo_manual ?? 0)
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
    project?.cuota_asignada, project?.ajuste_costo_manual
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

    const { success, valores, error } = await guardarFinanzas(project?.id, {
      ...finanzas, ...identidad, costoEjecutado: totalSpent
    });

    setGuardandoFinanzas(false);

    if (success) {
      aplicarIdentidadGuardada(valores);
      if (project) {
        project.presupuesto_total = valores.presupuesto_total;
        project.anticipo = valores.anticipo;
        project.cuota_asignada = valores.cuota_asignada;
        project.costo_ejecutado = valores.costo_ejecutado;
        project.ajuste_costo_manual = valores.ajuste_costo_manual;
      }
      // Lo guardado por Supabase es lo que se muestra: nada de valores locales
      setFinanzas({
        presupuesto: Number(valores.presupuesto_total || 0),
        anticipo: Number(valores.anticipo || 0),
        cuota: Number(valores.cuota_asignada || 0),
        ajusteManual: Number(valores.ajuste_costo_manual || 0)
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

  /* Costo ejecutado DINÁMICO, con sus tres orígenes sumados:
       · `totalFacturas` — suma de `gastos.monto`; `facturas` se recarga tras
         cada alta/edición/borrado y por Realtime, así que se mueve sola.
       · `totalHitos`    — dinero de las tareas del checklist ya marcadas: al
         marcar una de $1,000 la cifra sube $1,000 y al desmarcarla baja igual.
         Se recalcula desde la lista, nunca se acumulan deltas, así que marcar
         y desmarcar mil veces deja exactamente el mismo número.
       · `ajusteManual`  — la corrección escrita a mano en la tarjeta. */
  const totalFacturas = sumarGastos(facturas);
  const totalHitos = sumarValoresCompletados(safeChecklist);
  const ajusteManual = Number(finanzas.ajusteManual) || 0;
  const totalSpent = componerCostoEjecutado({
    facturas: totalFacturas, hitos: totalHitos, ajuste: ajusteManual
  });

  /* Al escribir un total a mano no se guarda el total, se guarda la DIFERENCIA
     contra lo que la app sí sabe calcular. Así una factura registrada mañana
     sigue sumando sobre la corrección de hoy en vez de borrarla. */
  const handleCostoEjecutadoManual = (valor) => {
    setFinanzas(prev => ({
      ...prev,
      ajusteManual: aAjuste(valor) - totalFacturas - totalHitos
    }));
    setFinanzasMsg(null);
  };

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

  /* Distintivo de estado del proyecto ("En progreso · 40%").
     Se pinta DOS veces con la misma función y solo una es visible a la vez:
     en escritorio va a la par del título, donde sobra espacio, y en móvil baja
     a la línea de la ubicación, que es donde sí cabe. */
  const claseEstado = avancePct >= 100 && safeChecklist.length > 0
    ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30'
    : avancePct > 0
    ? 'bg-amber-50 dark:bg-amber-500/10 text-[#8B6914] dark:text-[#E3C77B] border-amber-200 dark:border-amber-500/30'
    : 'bg-slate-100 dark:bg-zinc-700 text-slate-600 dark:text-zinc-300 border-gray-200 dark:border-zinc-600';

  /* Con varias fotos en fila el botón dice por cuál va ("Subiendo 2 de 7"):
     una subida larga sin cifras parece congelada. */
  const textoSubiendoFotos = progresoFotos
    ? t('gal.subiendoLote', { actual: progresoFotos.actual, total: progresoFotos.total })
    : t('comun.subiendo');

  const distintivoEstado = (visibilidad) => (
    <span className={`normal-case tracking-normal text-[11px] font-bold px-2.5 py-0.5 rounded-full border whitespace-nowrap flex-shrink-0 ${claseEstado} ${visibilidad}`}>
      {estadoAutomatico} · {avancePct}%
    </span>
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-zinc-900 relative">

      {/* ── Header ── */}
      <header className="flex-shrink-0 px-6 md:px-10 pt-8 pb-5 border-b border-gray-100 dark:border-zinc-700 flex items-center justify-between gap-5">
        {/* `min-w-0` en toda la cadena: sin él los hijos se niegan a encogerse y
            el distintivo de estado se sale del panel en pantallas medianas. */}
        <div className="flex items-center gap-5 min-w-0 flex-1">
          <button
            onClick={handleVolver}
            className="flex items-center gap-2 flex-shrink-0 text-slate-400 dark:text-zinc-200 hover:text-slate-800 dark:hover:text-white text-base font-medium transition-colors rounded-xl px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-zinc-700/50 -ml-3"
          >
            <ArrowLeft size={20} />
            {t('proy.volver')}
          </button>
          <div className="h-6 w-px bg-gray-200 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            {/* En Modo Edición el título y la ubicación son inputs reales:
                se persisten en `proyectos.nombre` y `proyectos.ubicacion`
                con el mismo botón "Guardar Cambios". */}
            {/* El estado ya NO es texto estático: se calcula con el avance real
                de los hitos (0% Planificación · 1-99% En progreso · 100%
                Finalizado). En escritorio acompaña al título en la misma línea;
                en móvil baja con la ubicación. */}
            <div className="flex items-center gap-3 min-w-0">
              {modoEdicionFinanzas ? (
                <input
                  type="text"
                  value={identidad.nombre}
                  onChange={(e) => handleCampoIdentidad('nombre', e.target.value)}
                  placeholder={t('proy.nombreProyecto')}
                  aria-label={t('proy.nombreProyecto')}
                  /* El ancho holgado para escribir se reserva a partir de `lg`:
                     exigirlo desde `md` empujaba el distintivo fuera del panel. */
                  className="flex-1 w-full min-w-0 lg:min-w-[20rem] bg-transparent border-b-2 border-[#C5A059]/60 focus:border-[#C5A059] outline-none text-xl md:text-2xl font-bold text-slate-900 dark:text-white tracking-tight uppercase"
                />
              ) : (
                <h1 className="min-w-0 text-xl md:text-2xl font-bold text-slate-900 dark:text-white tracking-tight uppercase">
                  {project.title || project.nombre}
                </h1>
              )}
              {distintivoEstado('hidden md:inline-flex')}
            </div>

            <p className="text-xs md:text-sm text-slate-400 dark:text-zinc-200 mt-0.5 uppercase tracking-widest font-medium flex flex-wrap items-center gap-2">
              {distintivoEstado('md:hidden')}
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
                  {/* Las tareas quitadas siguen vivas en Supabase: el contador
                      recuerda cuántas se van de verdad al guardar. */}
                  {hitosPorEliminar.length > 0 && (
                    <span className="text-xs font-bold text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-500/10 px-3.5 py-1.5 rounded-xl border border-red-200 dark:border-red-500/30 flex items-center gap-1.5">
                      <Trash2 size={13} className="text-red-500" />
                      {t('proy.porEliminar', { n: hitosPorEliminar.length })}
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
                    /* Dos motivos distintos para no poder tocar el checklist, y
                       cada uno merece su propio aviso: al administrador hay que
                       decirle que le falta encender el Modo Edición, no que no
                       tiene permiso. */
                    <span
                      className="flex items-center gap-1.5 text-xs font-bold text-slate-500 dark:text-zinc-300 bg-slate-100 dark:bg-zinc-700/60 border border-gray-200 dark:border-zinc-600 px-3.5 py-1.5 rounded-xl"
                      title={esAdminChecklist ? t('proy.checklistSoloEdicion') : t('proy.checksSoloAdmin')}
                    >
                      {esAdminChecklist
                        ? <Lock size={13} className="text-slate-400 dark:text-zinc-200" />
                        : <ShieldAlert size={13} className="text-slate-400 dark:text-zinc-200" />}
                      {esAdminChecklist ? t('proy.checklistSoloEdicion') : t('proy.checksSoloLectura')}
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
                  // El número NO se guarda en el título: lo pone la posición.
                  const title = sinNumeracion(item.text || item.titulo) || t('proy.hitoSinTitulo');
                  const detail = item.detail || item.descripcion || t('proy.sinDetalle');
                  const dateStr = item.fecha || item.fecha_vencimiento || t('proy.sinFecha');
                  const valorHito = aMonto(item.valor);
                  const arrastrando = hitoArrastrado === i;
                  const esDestino = hitoSobre === i && hitoArrastrado !== null && hitoArrastrado !== i;

                  return (
                    <li
                      key={item.id ?? `nuevo-${i}`}
                      /* Solo es arrastrable mientras el dedo está sobre el asa:
                         de lo contrario seleccionar el texto o teclear el monto
                         arrancaría un arrastre. */
                      draggable={puedeEditarChecklist && handleActivo === i}
                      onDragStart={() => setHitoArrastrado(i)}
                      onDragOver={(e) => {
                        if (hitoArrastrado === null) return;
                        e.preventDefault();
                        setHitoSobre(i);
                      }}
                      onDrop={(e) => { e.preventDefault(); soltarHito(i); }}
                      onDragEnd={() => { setHitoArrastrado(null); setHitoSobre(null); setHandleActivo(null); }}
                      className={`border rounded-[20px] bg-white dark:bg-zinc-800 shadow-sm hover:shadow-md transition-all overflow-hidden ${
                        arrastrando
                          ? 'opacity-50 border-[#C5A059]'
                          : esDestino
                          ? 'border-[#C5A059] ring-2 ring-[#C5A059]/40'
                          : 'border-gray-100 dark:border-zinc-700'
                      }`}
                    >
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
                              {/* Numeración AUTOMÁTICA: sale de la posición en
                                  la lista, así que mover una tarea renumera
                                  todas al instante y el primero siempre es 1. */}
                              <div className="flex flex-wrap items-baseline gap-2">
                                <span className="text-base md:text-lg font-black text-[#C5A059] tabular-nums flex-shrink-0">
                                  {i + 1}.
                                </span>
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
                                {/* Monto de la tarea, JUSTO a la par de la fecha.
                                    El Administrador lo escribe; los demás solo
                                    lo ven, y únicamente si tiene valor. Va fuera
                                    del div que abre el acordeón para que teclear
                                    una cifra no despliegue el detalle. */}
                                {puedeEditarChecklist ? (
                                  <span
                                    onClick={(e) => e.stopPropagation()}
                                    className={`inline-flex items-center gap-0.5 text-[11px] font-bold pl-2 pr-1 py-0.5 rounded-full border transition-colors ${
                                      valorHito > 0 && isDone
                                        ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30'
                                        : valorHito > 0
                                        ? 'bg-amber-50 dark:bg-amber-500/10 text-[#8B6914] dark:text-[#E3C77B] border-amber-200 dark:border-amber-500/30'
                                        : 'bg-slate-50 dark:bg-zinc-700/50 text-slate-500 dark:text-zinc-300 border-gray-200 dark:border-zinc-600'
                                    }`}
                                    title={t('proy.valorHitoTooltip')}
                                  >
                                    <DollarSign size={11} className="flex-shrink-0 opacity-70" />
                                    {/* El monto del hito también se escribe con
                                        comas de miles: 5000 se ve "5,000". */}
                                    <InputMonto
                                      value={valorHito || ''}
                                      placeholder="0"
                                      aria-label={t('proy.valorHito')}
                                      onChange={(v) => handleValorHito(i, v)}
                                      className="w-20 bg-transparent border-none outline-none focus:ring-0 p-0 text-[11px] font-bold placeholder-slate-300 dark:placeholder-zinc-500"
                                    />
                                  </span>
                                ) : valorHito > 0 && (
                                  <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${
                                    isDone
                                      ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30'
                                      : 'bg-slate-100 dark:bg-zinc-700 text-slate-600 dark:text-zinc-300 border-gray-200 dark:border-zinc-700'
                                  }`}>
                                    <DollarSign size={11} className="opacity-70" />
                                    {formatearMoneda(valorHito).replace('$', '')}
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
                          {/* Mover la tarea: las flechas funcionan en teléfono
                              (donde arrastrar no existe) y el asa permite el
                              arrastre completo en escritorio. Ambas hacen lo
                              mismo: cambiar la posición y, con ella, el número. */}
                          {puedeEditarChecklist && (
                            <div className="flex flex-col items-center -my-1">
                              <button
                                type="button"
                                onClick={() => moverHito(i, i - 1)}
                                disabled={i === 0 || isSavingChanges}
                                title={t('proy.moverArriba')}
                                aria-label={t('proy.moverArriba')}
                                className="p-0.5 text-slate-400 dark:text-zinc-300 hover:text-[#C5A059] rounded disabled:opacity-25 disabled:hover:text-slate-400"
                              >
                                <ChevronUp size={15} />
                              </button>
                              <span
                                onMouseDown={() => setHandleActivo(i)}
                                onMouseUp={() => setHandleActivo(null)}
                                title={t('proy.arrastrarHito')}
                                className="hidden sm:block text-slate-300 dark:text-zinc-500 hover:text-[#C5A059] cursor-grab active:cursor-grabbing"
                              >
                                <GripVertical size={14} />
                              </span>
                              <button
                                type="button"
                                onClick={() => moverHito(i, i + 1)}
                                disabled={i === safeChecklist.length - 1 || isSavingChanges}
                                title={t('proy.moverAbajo')}
                                aria-label={t('proy.moverAbajo')}
                                className="p-0.5 text-slate-400 dark:text-zinc-300 hover:text-[#C5A059] rounded disabled:opacity-25 disabled:hover:text-slate-400"
                              >
                                <ChevronDown size={15} />
                              </button>
                            </div>
                          )}
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
                      {' '}
                      {t('proy.ayudaOrden')}
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
                  onClick={abrirFacturas}
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
                      gastado: `${formatearMoneda(totalSpent)} USD`,
                      presupuesto: `${formatearMoneda(totalBudget)} USD`,
                      exceso: `${formatearMoneda(overBudgetAmount)} USD`
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

              {/* Costo ejecutado: facturas + hitos marcados + ajuste manual.
                  En Modo Edición el Administrador escribe el total que quiera y
                  la diferencia se guarda como ajuste, sin perder lo que la app
                  calcula sola. El desglose se muestra debajo para que la cifra
                  nunca sea una caja negra. */}
              <TarjetaMonto
                etiqueta={t('fin.costoEjecutado')}
                pie={`${Math.round((totalSpent / (totalBudget || 1)) * 100)}% ${t('fin.presupuestoEjecutado')}`}
                valor={totalSpent}
                editando={modoEdicionFinanzas}
                onChange={handleCostoEjecutadoManual}
                colorValor={isOverBudget ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-white'}
                resaltado={isOverBudget}
              >
                {(totalHitos > 0 || ajusteManual !== 0 || modoEdicionFinanzas) && (
                  <p className="text-[11px] text-slate-400 dark:text-zinc-300 mt-1.5 leading-relaxed font-medium">
                    {t('fin.desgloseFacturas')} {formatearMoneda(totalFacturas)}
                    {' · '}
                    {t('fin.desgloseHitos')} {formatearMoneda(totalHitos)}
                    {ajusteManual !== 0 && (
                      <> {' · '}{t('fin.desgloseAjuste')} {ajusteManual > 0 ? '+' : '−'}{formatearMoneda(Math.abs(ajusteManual))}</>
                    )}
                  </p>
                )}
              </TarjetaMonto>
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
                        formatter={(value) => [formatearMoneda(value), t('fin.gasto')]}
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
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-gray-200 dark:border-zinc-700">
              <div className="flex items-center gap-3">
                <button onClick={cerrarFacturas} className="text-slate-400 dark:text-zinc-200 hover:text-slate-800 dark:hover:text-white p-1.5 rounded-lg border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 shadow-sm">
                  <ArrowLeft size={18} />
                </button>
                <div>
                  <h2 className="text-lg font-bold text-slate-900 dark:text-white">{t('fin.facturasTitulo')}</h2>
                  <p className="text-xs text-slate-400 dark:text-zinc-200 font-medium">{t('fin.facturasSub')}</p>
                </div>
              </div>

              {/* Mismo trato que el checklist: registrar, corregir o quitar solo
                  mueve el borrador, y aquí está el único botón que escribe en
                  Supabase. Mientras haya pendientes se avisa con distintivos. */}
              <div className="flex flex-wrap items-center gap-2">
                {hayCambiosFacturas && (
                  <span className="text-xs font-bold text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 px-3 py-1.5 rounded-xl border border-amber-200 dark:border-amber-500/30 flex items-center gap-1.5">
                    <AlertTriangle size={13} className="text-amber-600" />
                    {t('proy.cambiosSinGuardar')}
                  </span>
                )}
                {facturasPorEliminar.length > 0 && (
                  <span className="text-xs font-bold text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-500/10 px-3 py-1.5 rounded-xl border border-red-200 dark:border-red-500/30 flex items-center gap-1.5">
                    <Trash2 size={13} className="text-red-500" />
                    {t('proy.porEliminar', { n: facturasPorEliminar.length })}
                  </span>
                )}

                {isAdmin && hayCambiosFacturas && (
                  <>
                    <button
                      onClick={descartarCambiosFacturas}
                      disabled={guardandoFacturas}
                      className="inline-flex items-center gap-1.5 bg-white dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 border border-gray-200 dark:border-zinc-700 text-xs font-bold px-3.5 py-2.5 rounded-xl hover:bg-slate-50 dark:hover:bg-zinc-700 transition-colors disabled:opacity-50"
                    >
                      <X size={14} /> {t('comun.cancelar')}
                    </button>
                    <button
                      onClick={handleGuardarFacturas}
                      disabled={guardandoFacturas}
                      className="flex items-center gap-1.5 bg-[#FAF4EA] dark:bg-amber-500/10 text-[#8B6914] dark:text-[#E3C77B] border border-[#F0E2CD] dark:border-amber-500/30 text-xs font-bold px-3.5 py-2.5 rounded-xl hover:bg-[#F3E7D3] dark:hover:bg-amber-500/20 transition-colors shadow-sm disabled:opacity-50 active:scale-95"
                    >
                      {guardandoFacturas
                        ? <><Loader2 size={14} className="animate-spin text-[#C5A059]" /> {t('proy.guardando')}</>
                        : <><Save size={14} className="text-[#C5A059]" /> {t('proy.guardarCambios')}</>}
                    </button>
                  </>
                )}

                {isAdmin && (
                  <button
                    onClick={() => setShowInvoiceModal(true)}
                    disabled={guardandoFacturas}
                    className="flex items-center gap-2 bg-[#0B1B2C] text-white text-xs font-bold px-4 py-2.5 rounded-xl hover:bg-slate-800 transition-colors shadow-sm disabled:opacity-50"
                  >
                    <Plus size={14} className="text-[#C5A059]" /> {t('fin.registrarFactura')}
                  </button>
                )}
              </div>
            </div>

            {isAdmin && (
              <p className="text-[11px] text-slate-400 dark:text-zinc-200 font-medium -mt-3">
                {t('fac.ayudaGuardado', { boton: t('proy.guardarCambios') })}
              </p>
            )}

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

            {facturasOkMsg && (
              <div className="p-4 rounded-2xl border flex items-start gap-3 text-xs font-semibold bg-emerald-50 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30">
                <CheckCircle2 size={16} className="flex-shrink-0 mt-px" />
                <span>{facturasOkMsg}</span>
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
                const tieneArchivo = tieneComprobante(fac);
                const esPdf = comprobanteEsPdf(fac);
                // Una factura del borrador se puede quitar aunque el Modo
                // Edición esté apagado: nunca llegó a existir en Supabase.
                const puedeTocarla = isAdmin && (puedeEditarFacturas || !!fac._nueva);

                return (
                  <div
                    key={claveFactura(fac)}
                    className={`group flex items-stretch gap-4 p-3 sm:p-4 bg-white dark:bg-zinc-800 border rounded-2xl shadow-sm hover:shadow-md hover:border-[#C5A059]/50 transition-all ${
                      fac._nueva || fac._editada
                        ? 'border-amber-300 dark:border-amber-500/40'
                        : 'border-gray-100 dark:border-zinc-700'
                    }`}
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
                            src={urlComprobante(fac)}
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
                        <span className="inline-flex flex-wrap items-center gap-1.5 text-[10px] font-semibold text-slate-400 dark:text-zinc-200 mt-1.5">
                          <Calendar size={11} /> {fac.fecha}
                          {tieneArchivo && (
                            <span className="inline-flex items-center gap-1 text-[#8B6914] dark:text-[#E3C77B]">
                              • <Receipt size={11} /> {t('fac.conComprobante')}
                            </span>
                          )}
                          {/* Lo que todavía no existe en Supabase se marca:
                              así se sabe qué se pierde si se cancela. */}
                          {(fac._nueva || fac._editada) && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-300 px-2 py-0.5 rounded-full border border-amber-200 dark:border-amber-500/30">
                              <AlertTriangle size={10} className="text-amber-600" />
                              {fac._nueva ? t('proy.sinGuardarSupabase') : t('fac.editadaSinGuardar')}
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

                          {/* Editar / Quitar: cambian el borrador, no la base */}
                          {puedeTocarla && (
                            <>
                              <button
                                onClick={() => abrirEdicionFactura(fac)}
                                disabled={guardandoFacturas}
                                title={t('fac.editar')}
                                className="p-2 rounded-xl text-slate-500 dark:text-zinc-300 bg-slate-100 dark:bg-zinc-700 hover:text-[#8B6914] dark:hover:text-[#E3C77B] hover:bg-amber-50 dark:hover:bg-amber-500/10 transition-colors disabled:opacity-50"
                              >
                                <Edit2 size={13} />
                              </button>
                              <button
                                onClick={() => handleEliminarFactura(fac)}
                                disabled={guardandoFacturas}
                                title={t('fac.eliminar')}
                                className="p-2 rounded-xl text-slate-500 dark:text-zinc-300 bg-slate-100 dark:bg-zinc-700 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors disabled:opacity-50"
                              >
                                <Trash2 size={13} />
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
                        {textoSubiendoFotos}
                      </>
                    ) : (
                      <>
                        <Upload size={15} className="text-[#C5A059]" />
                        {t('gal.subirFotos')}
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
                      ? <><Loader2 size={14} className="animate-spin text-[#C5A059]" /> {textoSubiendoFotos}</>
                      : <><Upload size={14} className="text-[#C5A059]" /> {t('gal.subirFotos')}</>}
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

            {/* `multiple`: se eligen varias fotos de una vez y se suben en fila */}
            <input
              type="file"
              ref={albumPhotoInputRef}
              multiple
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
                <p className="text-[11px] text-slate-400 dark:text-zinc-300">{t('gal.variasFotos')}</p>
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
              multiple
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
                <Upload size={14} className="text-[#C5A059]" /> {t('gal.elegirFotos')}
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

              <p className="text-[11px] font-semibold text-slate-400 dark:text-zinc-200 leading-relaxed">
                {t('fac.ayudaGuardado', { boton: t('proy.guardarCambios') })}
              </p>

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
                <InputMonto
                  required
                  placeholder="42,500.00"
                  value={newInvoice.monto}
                  onChange={(v) => setNewInvoice({ ...newInvoice, monto: v })}
                  className="w-full bg-slate-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-slate-800"
                />
              </div>
              <div className="pt-2 flex justify-end gap-2">
                <button type="button" onClick={cerrarModalFactura} className="px-4 py-2 text-xs font-bold text-slate-500 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-700 rounded-xl">
                  {t('comun.cancelar')}
                </button>
                <button
                  type="submit"
                  disabled={extrayendoIA}
                  className="px-5 py-2 text-xs font-bold text-white bg-[#0B1B2C] hover:bg-slate-800 rounded-xl shadow-sm disabled:opacity-50 flex items-center gap-2"
                >
                  {t('modal.agregarFactura')}
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
              <p className="text-[11px] font-semibold text-slate-400 dark:text-zinc-200 leading-relaxed">
                {t('modal.editarFacturaNota')}
                {' '}
                {t('fac.ayudaGuardado', { boton: t('proy.guardarCambios') })}
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
                <InputMonto
                  required
                  placeholder="42,500.00"
                  value={edicionFactura.monto}
                  onChange={(v) => setEdicionFactura({ ...edicionFactura, monto: v })}
                  className="w-full bg-slate-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-slate-800"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button type="button" onClick={cerrarEdicionFactura} className="px-4 py-2 text-xs font-bold text-slate-500 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-700 rounded-xl">
                  {t('comun.cancelar')}
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-bold text-white bg-[#0B1B2C] hover:bg-slate-800 rounded-xl shadow-sm flex items-center gap-2"
                >
                  {t('comun.aplicar')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ════ CONFIRMACIÓN DEL BORRADO DEFINITIVO DE HITOS ════
          Quitar una tarea de la lista es reversible; guardar no lo es. Aquí se
          enumeran por nombre las que van a desaparecer de Supabase, para que la
          decisión se tome viendo exactamente qué se pierde. */}
      {confirmandoBorrado && hitosPorEliminar.length > 0 && (
        <div className="fixed inset-0 z-[55] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-800 rounded-3xl max-w-md w-full p-6 shadow-2xl border border-gray-100 dark:border-zinc-700">
            <div className="flex items-center gap-3 mb-3">
              <span className="w-10 h-10 rounded-2xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 flex items-center justify-center flex-shrink-0">
                <Trash2 size={18} className="text-red-500" />
              </span>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                {t('dlg.eliminarHitosTitulo', { n: hitosPorEliminar.length })}
              </h3>
            </div>

            <p className="text-[13px] leading-relaxed text-slate-600 dark:text-zinc-300">
              {t('dlg.eliminarHitosAviso')}
            </p>

            <ul className="mt-3 max-h-44 overflow-y-auto space-y-1.5 rounded-2xl border border-gray-100 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 p-3">
              {hitosPorEliminar.map(h => (
                <li key={h.id} className="flex items-start gap-2 text-[13px] text-slate-700 dark:text-zinc-200 font-medium">
                  <Trash2 size={12} className="text-red-400 flex-shrink-0 mt-1" />
                  <span className="break-words">{h.text}</span>
                </li>
              ))}
            </ul>

            <div className="pt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmandoBorrado(false)}
                className="px-4 py-2 text-xs font-bold text-slate-500 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-700 rounded-xl"
              >
                {t('comun.cancelar')}
              </button>
              <button
                type="button"
                onClick={handleSaveAllChanges}
                className="flex items-center gap-2 px-5 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-xl shadow-sm"
              >
                <Trash2 size={13} />
                {t('dlg.eliminarHitosConfirmar')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════ CONFIRMACIÓN DEL BORRADO DEFINITIVO DE FACTURAS ════
          Quitar una factura de la lista es reversible; guardar no lo es. Se
          enumeran por proveedor las que van a desaparecer de `gastos`. */}
      {confirmandoBorradoFacturas && facturasPorEliminar.length > 0 && (
        <div className="fixed inset-0 z-[55] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-800 rounded-3xl max-w-md w-full p-6 shadow-2xl border border-gray-100 dark:border-zinc-700">
            <div className="flex items-center gap-3 mb-3">
              <span className="w-10 h-10 rounded-2xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 flex items-center justify-center flex-shrink-0">
                <Trash2 size={18} className="text-red-500" />
              </span>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                {t('dlg.eliminarFacturasTitulo', { n: facturasPorEliminar.length })}
              </h3>
            </div>

            <p className="text-[13px] leading-relaxed text-slate-600 dark:text-zinc-300">
              {t('dlg.eliminarFacturasAviso')}
            </p>

            <ul className="mt-3 max-h-44 overflow-y-auto space-y-1.5 rounded-2xl border border-gray-100 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 p-3">
              {facturasPorEliminar.map(f => (
                <li key={f.id} className="flex items-start gap-2 text-[13px] text-slate-700 dark:text-zinc-200 font-medium">
                  <Trash2 size={12} className="text-red-400 flex-shrink-0 mt-1" />
                  <span className="break-words">{f.proveedor}</span>
                </li>
              ))}
            </ul>

            <div className="pt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmandoBorradoFacturas(false)}
                className="px-4 py-2 text-xs font-bold text-slate-500 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-700 rounded-xl"
              >
                {t('comun.cancelar')}
              </button>
              <button
                type="button"
                onClick={handleGuardarFacturas}
                disabled={guardandoFacturas}
                className="flex items-center gap-2 px-5 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-xl shadow-sm disabled:opacity-60"
              >
                <Trash2 size={13} />
                {t('dlg.eliminarHitosConfirmar')}
              </button>
            </div>
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
              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-zinc-300 mb-1 uppercase">{t('modal.valorHito')}</label>
                <div className="flex items-center gap-2 bg-slate-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 focus-within:border-slate-800">
                  <DollarSign size={15} className="text-[#C5A059] flex-shrink-0" />
                  <InputMonto
                    value={newHitoValor}
                    onChange={setNewHitoValor}
                    className="w-full bg-transparent border-none outline-none focus:ring-0 p-0 text-sm"
                  />
                </div>
                <p className="text-[11px] text-slate-400 dark:text-zinc-400 mt-1 leading-relaxed">{t('modal.valorHitoAyuda')}</p>
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
              {!comprobanteEsPdf(facturaEnVisor) && (
                <button
                  onClick={() => setVisorAmpliado(v => !v)}
                  title={visorAmpliado ? t('fac.ajustarPantalla') : t('fac.tamanoReal')}
                  className="p-2 rounded-xl text-white/80 bg-white/10 hover:bg-white/20 transition-colors"
                >
                  {visorAmpliado ? <ZoomOut size={16} /> : <ZoomIn size={16} />}
                </button>
              )}
              {/* Solo se descarga lo que ya está en el bucket: un comprobante
                  del borrador todavía vive en el dispositivo del usuario. */}
              {esComprobanteArchivo(facturaEnVisor.comprobante) && (
                <button
                  onClick={handleDescargarComprobante}
                  disabled={descargandoVisor}
                  className="flex items-center gap-2 text-xs font-bold text-[#0B1B2C] bg-[#C5A059] hover:bg-[#d4b06a] px-4 py-2 rounded-xl transition-colors disabled:opacity-60"
                >
                  {descargandoVisor ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                  <span className="hidden sm:inline">{t('fac.descargar')}</span>
                </button>
              )}
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
            {comprobanteEsPdf(facturaEnVisor) ? (
              <iframe
                src={urlComprobante(facturaEnVisor)}
                title={facturaEnVisor.proveedor}
                className="w-full h-full rounded-xl bg-white shadow-2xl"
              />
            ) : (
              <img
                src={urlComprobante(facturaEnVisor)}
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
              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-zinc-300 mb-1 uppercase">{t('modal.valorHito')}</label>
                <div className="flex items-center gap-2 bg-slate-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 focus-within:border-slate-800">
                  <DollarSign size={15} className="text-[#C5A059] flex-shrink-0" />
                  <InputMonto
                    value={editHitoValor}
                    onChange={setEditHitoValor}
                    className="w-full bg-transparent border-none outline-none focus:ring-0 p-0 text-sm"
                  />
                </div>
                <p className="text-[11px] text-slate-400 dark:text-zinc-400 mt-1 leading-relaxed">{t('modal.valorHitoAyuda')}</p>
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
