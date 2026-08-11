import React, { useState, useEffect, useRef } from 'react';
import {
  ArrowLeft, CheckSquare, Square, Circle, Upload, Image, TrendingUp, FileText, LayoutGrid,
  ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Edit2, Save, Plus, Trash2, AlertTriangle, Loader2, CheckCircle2,
  Download, Calendar, DollarSign, FolderPlus, X, Eye, Receipt, ShieldAlert,
  Sparkles, FileImage, ZoomIn, ZoomOut, Lock, GripVertical
} from 'lucide-react';
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import {
  uploadArchivoProyecto, getArchivosProyecto, renombrarArchivo, eliminarArchivo,
  subirComprobanteFactura, validarComprobante, descargarArchivo, puedeGestionar
} from '../services/storageService';
import { useDirectorioUsuarios } from '../hooks/useDirectorioUsuarios';
import { supabase } from '../supabaseClient';
import {
  guardarFinanzas, agruparGastosPorMes, formatearMoneda, aNumero,
  getFacturas, crearFactura, actualizarFactura, eliminarFactura,
  esComprobanteArchivo, esComprobantePdf, nombreArchivoFactura,
  sumarGastos, ejecucionMensualReal, componerCostoEjecutado, normalizarFactura,
  eliminarProyecto
} from '../services/finanzasService';
import {
  getAlbumes, crearAlbum, actualizarAlbum, eliminarAlbum, subirFotoAlbum, eliminarFoto
} from '../services/galeriaService';
import { usePrefs } from '../context/PreferenciasContext';
import { VideoBackground } from './ui/VideoBackground';
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
import { useConfirmacion } from '../hooks/useConfirmacion';
import { aNumeroSeguro, sumarDinero, porcentajeEntero } from '../lib/numeros';
import { parchearLista } from '../lib/realtime';
import { useTemporizadores } from '../hooks/useTemporizadores';

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
  /* Ficha financiera, no formulario. Antes cada cifra vivía en una tarjeta con
     borde y sombra propios: cuatro cajas iguales que se leían como campos de
     captura. Ahora la cifra respira sobre la superficie y solo hay marco
     cuando algo lo pide — al editar, o cuando hay sobrecosto. */
  return (
    <div className={`rounded-2xl px-5 py-5 transition-colors ${
      editando
        ? 'bg-mm-oro-lavado dark:bg-amber-500/[0.07] ring-1 ring-mm-oro/40'
        : resaltado
        ? 'bg-red-50/60 dark:bg-red-500/[0.08] ring-1 ring-red-200 dark:ring-red-500/25'
        : 'bg-mm-tarjeta-alt'
    }`}>
      <p className="t-label text-mm-3">{etiqueta}</p>

      {editando ? (
        <div className="flex items-center gap-1 mt-2.5">
          <span className={`t-kpi ${colorValor}`}>$</span>
          {/* Se escribe con comas de miles, igual que se lee */}
          <InputMonto
            value={valor}
            onChange={onChange}
            placeholder="0.00"
            className={`w-full min-w-0 bg-transparent border-b border-mm-oro/60 focus:border-mm-oro outline-none t-kpi ${colorValor}`}
          />
        </div>
      ) : (
        /* Formato SIEMPRE en notación de dólar (coma para los miles, punto
           para los centavos). `toLocaleString()` a secas usaba el idioma del
           navegador y en español pintaba "$18.685,36", que se lee como $18. */
        <p className={`t-kpi mt-2.5 ${colorValor}`}>
          {formatearMoneda(valor)}
        </p>
      )}

      {pie && <p className="t-meta text-mm-3 mt-2">{pie}</p>}
      {children}
    </div>
  );
}

export default function ProjectDetails({ project, onBack, userRole, userId, isEditMode, onUpdateProject, aportaciones = [] }) {
  const { t, locale, language, modoOscuro } = usePrefs();
  // Los avisos se borran solos; el temporizador se cancela al desmontar la vista
  const { programar } = useTemporizadores();
  const { confirmar, dialogoConfirmacion } = useConfirmacion();
  // Nombres para la firma "Subido por" de documentos, álbumes y fotos
  const { nombreDe } = useDirectorioUsuarios();
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
  /* Guarda el ÍNDICE de la foto abierta, no su URL: con la posición se puede
     pasar a la anterior y a la siguiente sin cerrar el visor. Antes solo se
     recordaba la dirección de la imagen, así que para ver la de al lado había
     que salir y volver a entrar.
     `null` = visor cerrado. Ojo: el índice 0 es válido, así que la comprobación
     tiene que ser `!== null` y nunca un simple truthy. */
  const [indiceFoto, setIndiceFoto] = useState(null);
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

  /* ── Archivos, fotos y álbumes: manda quien los subió ─────────────────────
     Subir es de todos (migración 014). Renombrar y borrar es del autor; el
     Administrador manda sobre cualquiera. Esto solo decide qué botones se
     dibujan: las políticas RLS lo vuelven a comprobar en el servidor.

     `autorDe` resuelve el nombre para la firma bajo cada archivo; lo anterior
     a la 014 no tiene autor guardado y firma «Admin». */
  const puedeGestionarSubida = (fila) => puedeGestionar(fila, { userId, esAdmin: isAdmin });
  const autorDe = (fila) => nombreDe(fila?.subido_por) || t('fb.autorDesconocido');
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
  const safeChecklist = React.useMemo(
    () => (Array.isArray(checklist) ? checklist.filter(Boolean) : []),
    [checklist]
  );
  const completados = safeChecklist.filter(c => c && (c.done || c.estado === 'completado')).length;
  const avancePct = calcularAvance(safeChecklist);

  const docInputRef = useRef(null);
  const photoInputRef = useRef(null);
  const albumPhotoInputRef = useRef(null);

  /* ── Respuestas que llegan tarde ──────────────────────────────────────────
     Saltar rápido entre proyectos dejaba varias lecturas en vuelo a la vez, y
     pintaba la que respondiera ÚLTIMA: bastaba con que la consulta del proyecto
     A fuera más lenta para acabar viendo sus facturas dentro del proyecto B.
     Toda lectura asíncrona pasa ahora por `vigente()`: si el usuario ya cambió
     de proyecto —o cerró la ficha— la respuesta se descarta en silencio. */
  const montado = useRef(true);
  const proyectoActivo = useRef(project?.id);
  proyectoActivo.current = project?.id;

  useEffect(() => {
    montado.current = true;
    return () => { montado.current = false; };
  }, []);

  const vigente = (idPedido) => (
    montado.current && String(proyectoActivo.current ?? '') === String(idPedido ?? '')
  );

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
    const idPedido = project?.id;
    if (!idPedido) {
      setChecklist([]);
      setChecklistPersistido(false);
      setIsLoadingChecklist(false);
      return;
    }

    setIsLoadingChecklist(true);
    try {
      const { items } = await fetchChecklist(idPedido);
      if (!vigente(idPedido)) return;

      if (Array.isArray(items) && items.length > 0) {
        setChecklist(items);
        setChecklistPersistido(true);
      } else {
        setChecklist(getChecklistSeed(project.id)
          .map((item, i) => ({ ...item, text: sinNumeracion(item.text), id: null, orden: i })));
        setChecklistPersistido(false);
      }
      setHayCambiosSinGuardar(false);
      setHitosPorEliminar([]);
    } catch (err) {
      console.error('Error cargando el checklist desde Supabase:', err);
      if (!vigente(idPedido)) return;
      setChecklist(getChecklistSeed(idPedido)
        .map((item, i) => ({ ...item, text: sinNumeracion(item.text), id: null, orden: i })));
      setChecklistPersistido(false);
    } finally {
      if (vigente(idPedido)) setIsLoadingChecklist(false);
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
    // El diálogo de borrar el proyecto vive detrás del Modo Edición: si se
    // apaga con el diálogo abierto, se cierra y se olvida lo tecleado.
    setConfirmarBorradoProyecto(false);
    setConfirmacionNombre('');
    setErrorBorrado(null);
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
        setSaveErrorMsg(t('msg.errorGuardarCambios', { error: t(error) || t('msg.errorDesconocido') }));
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
        // El costo ejecutado que se persiste es la suma real de `gastos`: ni el
        // checklist recién guardado ni un ajuste a mano lo alteran (P1-9).
        const costoFinal = componerCostoEjecutado({ facturas: totalFacturas });

        const fin = await guardarFinanzas(project.id, {
          ...finanzas, ...identidad, costoEjecutado: costoFinal,
          updatedAt: versionProyecto.current
        });
        if (!fin.success) {
          // Un choque de guardados o una cifra ilegible se cuentan tal cual:
          // ambos mensajes ya explican qué hacer, envolverlos los diluye.
          setSaveErrorMsg(
            fin.conflicto || fin.montoInvalido
              ? fin.error
              : t('msg.errorGuardarCambios', { error: t(fin.error) || t('msg.errorDesconocido') })
          );
          if (fin.conflicto && fin.updatedAtRemoto) versionProyecto.current = fin.updatedAtRemoto;
          return;
        }
        versionProyecto.current = fin.updatedAt ?? versionProyecto.current;
        aplicarIdentidadGuardada(fin.valores);
        if (project) {
          project.updated_at = fin.updatedAt ?? project.updated_at;
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
      programar(() => setSaveSuccessMsg(null), 6000);
    } catch (err) {
      console.error('Error guardando cambios:', err);
      setSaveErrorMsg(t('msg.errorGuardar', { error: err?.message || err }));
    } finally {
      setIsSavingChanges(false);
    }
  };

  const loadProjectArchivos = async () => {
    const idPedido = project?.id;
    if (!idPedido) {
      setArchivosDB([]);
      return;
    }
    const list = await getArchivosProyecto(idPedido);
    if (!vigente(idPedido)) return;
    setArchivosDB(Array.isArray(list) ? list : []);
  };

  useEffect(() => {
    loadProjectArchivos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  /* ── Reactividad tipo Excel: los documentos se mueven solos ────────────────
     La fila del evento se aplica sobre la lista en memoria en vez de releer
     TODOS los archivos del proyecto: subir seis documentos disparaba seis
     lecturas completas de la tabla para acabar en el mismo sitio. `pertenece`
     descarta los archivos de otros proyectos, que también llegan por el canal. */
  useEffect(() => {
    if (!project?.id) return;
    const idProyecto = project.id;
    const canal = supabase
      .channel(`archivos-proyecto-${idProyecto}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'archivos' }, (payload) => {
        if (!vigente(idProyecto)) return;
        setArchivosDB(parchearLista(payload, {
          pertenece: (fila) => String(fila?.proyecto_id ?? '') === String(idProyecto)
        }));
      })
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

  /* ── Renombrar / eliminar documentos ──
     Del autor del archivo; el Administrador sobre cualquiera. El guardia se
     repite aquí porque un botón oculto no es un permiso: el handler puede
     llegar por teclado, por un estado viejo o por la consola. */
  const handleRenameArchivo = async (archivo) => {
    if (!puedeGestionarSubida(archivo)) return;
    const actual = archivo?.nombre_archivo || '';
    const nuevo = prompt(t('doc.nuevoNombre'), actual);
    if (nuevo === null) return;
    if (!nuevo.trim() || nuevo.trim() === actual) return;

    setIsUploading(true);
    const { success, error } = await renombrarArchivo(archivo.id, nuevo.trim());
    setIsUploading(false);

    setUploadMessage(success
      ? { type: 'success', text: t('msg.archivoRenombrado', { nombre: nuevo.trim() }) }
      : { type: 'error', text: t(error) || t('msg.errorRenombrar') });

    await loadProjectArchivos();
    programar(() => setUploadMessage(null), 5000);
  };

  const handleDeleteArchivo = async (archivo) => {
    if (!puedeGestionarSubida(archivo)) return;
    if (!await confirmar({ mensaje: t('dlg.eliminarArchivo', { nombre: archivo?.nombre_archivo }) })) return;

    setIsUploading(true);
    const { success, error } = await eliminarArchivo(archivo);
    setIsUploading(false);

    setUploadMessage(success
      ? { type: 'success', text: t('msg.archivoEliminado', { nombre: archivo.nombre_archivo }) }
      : { type: 'error', text: t(error) || t('msg.errorEliminarArchivo') });

    await loadProjectArchivos();
    programar(() => setUploadMessage(null), 6000);
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
      setUploadMessage({ type: 'error', text: t(result.error) || t('msg.errorSubir') });
    }

    event.target.value = '';
    programar(() => setUploadMessage(null), 5000);
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
    const idPedido = project?.id;
    if (!idPedido) { setFacturas([]); return; }
    if (hayCambiosFacturas && !forzar) return;
    const { facturas: lista, error } = await getFacturas(idPedido);
    if (!vigente(idPedido)) return;
    setFacturas(Array.isArray(lista) ? lista : []);
    setFacturasMsg(error ? { tipo: 'error', texto: t(error) } : null);
  };

  useEffect(() => {
    cargarFacturas(true);
    setFacturasPorEliminar([]);
    setHayCambiosFacturas(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  /* Realtime: una factura nueva aparece sola en todas las sesiones abiertas.
     Se inserta la fila del evento —ya con la forma que usa la vista— en lugar
     de releer las facturas del proyecto entero. Con un borrador abierto no se
     toca nada: pisar lo que el administrador está escribiendo sería perder su
     trabajo, exactamente igual que en `cargarFacturas`. */
  useEffect(() => {
    if (!project?.id) return;
    const idProyecto = project.id;
    const canal = supabase
      .channel(`gastos-proyecto-${idProyecto}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gastos' }, (payload) => {
        if (!vigente(idProyecto) || hayCambiosFacturas) return;
        setFacturas(parchearLista(payload, {
          pertenece: (fila) => String(fila?.proyecto_id ?? '') === String(idProyecto),
          normalizar: normalizarFactura
        }));
      })
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
      setFacturasMsg({ tipo: 'error', texto: t(error) || t('msg.errorSupabase') });
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
            // El rol viaja explícito: el bucket `facturas` solo acepta
            // comprobantes del Administrador y bajo la carpeta del proyecto.
            const subida = await subirComprobanteFactura(fac._archivo, project?.id, { esAdmin });
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
      programar(() => setFacturasOkMsg(null), 6000);

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

  /* ── Visor de la galería ──────────────────────────────────────────────────
     Una foto puede venir como objeto de Supabase o como una URL suelta, según
     de dónde se haya cargado el álbum: `urlFoto` normaliza las dos formas. */
  const urlFoto = (foto) => foto?.url_archivo || foto || '';

  const fotosAlbum = React.useMemo(
    () => (activeAlbumModal?.photos || []).filter(Boolean),
    [activeAlbumModal]
  );

  const abrirVisorFoto = (idx) => setIndiceFoto(idx);
  const cerrarVisorFoto = () => setIndiceFoto(null);

  /** Avanza o retrocede dando la vuelta al llegar a los extremos. */
  const moverFoto = (paso) => {
    const total = fotosAlbum.length;
    if (total === 0) return;
    setIndiceFoto((actual) => {
      if (actual === null) return null;
      return ((actual + paso) % total + total) % total;
    });
  };

  // Teclado: flechas para pasar de foto, Escape para cerrar
  useEffect(() => {
    if (indiceFoto === null) return;
    const alPulsar = (e) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); moverFoto(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); moverFoto(-1); }
      else if (e.key === 'Escape') cerrarVisorFoto();
    };
    window.addEventListener('keydown', alPulsar);
    return () => window.removeEventListener('keydown', alPulsar);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indiceFoto, fotosAlbum.length]);

  // Si el álbum cambia o se borra la foto abierta, el índice deja de ser válido
  useEffect(() => {
    if (indiceFoto !== null && indiceFoto >= fotosAlbum.length) {
      setIndiceFoto(fotosAlbum.length > 0 ? fotosAlbum.length - 1 : null);
    }
  }, [fotosAlbum.length, indiceFoto]);

  /* Deslizamiento con el dedo. Se mide solo el eje X y se exige un recorrido
     mínimo para no confundir un toque con un gesto. */
  const inicioTocarX = useRef(0);
  const alTocarVisor = (e) => { inicioTocarX.current = e.touches?.[0]?.clientX ?? 0; };
  const alSoltarVisor = (e) => {
    const recorrido = (e.changedTouches?.[0]?.clientX ?? 0) - inicioTocarX.current;
    if (Math.abs(recorrido) < 45) return;
    moverFoto(recorrido < 0 ? 1 : -1);
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
    const idPedido = project?.id;
    if (!idPedido) return;
    const { albumes, error } = await getAlbumes(idPedido);
    if (!vigente(idPedido)) return;
    setAlbums(Array.isArray(albumes) ? albumes : []);
    if (error) setGaleriaMsg({ tipo: 'error', texto: t(error) });
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
      programar(() => setGaleriaMsg(null), 5000);
    } else {
      setGaleriaMsg({ tipo: 'error', texto: t(error) });
    }
  };

  /** Guarda título y fecha de un álbum existente. */
  const handleGuardarAlbum = async (e) => {
    e.preventDefault();
    if (!albumEditando?.id || !puedeGestionarSubida(albumEditando)) return;

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
      programar(() => setGaleriaMsg(null), 5000);
    } else {
      setGaleriaMsg({ tipo: 'error', texto: t(error) });
    }
  };

  const handleEliminarAlbum = async (album) => {
    if (!puedeGestionarSubida(album)) return;
    if (!await confirmar({ mensaje: t('dlg.eliminarAlbum', { titulo: album?.title }) })) return;

    setSubiendoGaleria(true);
    /* Un álbum ajeno solo lo vacía el Administrador: quien lo creó no puede
       arrastrarse por delante las fotos que subieron los demás. El servicio
       lo comprueba foto a foto y responde con un aviso legible. */
    const { success, error } = await eliminarAlbum(album, { userId, esAdmin: isAdmin });
    setSubiendoGaleria(false);

    if (success) {
      setActiveAlbumModal(null);
      setGaleriaMsg({ tipo: 'exito', texto: t('gal.albumEliminado') });
      await cargarAlbumes();
      programar(() => setGaleriaMsg(null), 5000);
    } else {
      setGaleriaMsg({ tipo: 'error', texto: t(error) });
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
    programar(() => setGaleriaMsg(null), 5000);
  };

  /** Elimina una foto concreta dentro del álbum. */
  const handleEliminarFoto = async (foto, albumId) => {
    if (!puedeGestionarSubida(foto)) return;
    if (!await confirmar({ mensaje: t('dlg.eliminarFoto') })) return;

    setSubiendoGaleria(true);
    const { success, error } = await eliminarFoto(foto);
    setSubiendoGaleria(false);

    if (success) {
      const { albumes } = await getAlbumes(project.id);
      setAlbums(albumes);
      if (albumId) setActiveAlbumModal(albumes.find(a => String(a.id) === String(albumId)) || null);
      setGaleriaMsg({ tipo: 'exito', texto: t('gal.fotoEliminada') });
      programar(() => setGaleriaMsg(null), 5000);
    } else {
      setGaleriaMsg({ tipo: 'error', texto: t(error) });
    }
  };


  /* ── Finanzas editables ──────────────────────────────────────────────────
     `finanzas` es la fuente de verdad de la pestaña: se inicializa con lo que
     trae Supabase (jamás con cifras de demostración) y se actualiza en vivo
     mientras el administrador escribe, así la gráfica y la alerta de
     sobrecosto reaccionan al instante.

     El costo ejecutado NO está aquí: es la suma real de `gastos` (ver
     `totalSpent`) y no se escribe a mano. `ajuste_costo_manual` sigue en la
     tabla como historial, pero esta pantalla ya no lo lee ni lo reescribe: era
     la pieza que permitía que la cifra se despegara de las facturas. */
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

  /* Borrado del proyecto entero: el diálogo pide teclear el nombre, así que
     necesita su propio estado además del interruptor de apertura. */
  const [confirmarBorradoProyecto, setConfirmarBorradoProyecto] = useState(false);
  const [confirmacionNombre, setConfirmacionNombre] = useState('');
  const [borrandoProyecto, setBorrandoProyecto] = useState(false);
  const [errorBorrado, setErrorBorrado] = useState(null);

  /* P2-17 · Testigo de versión para el bloqueo optimista.
     Guarda el `updated_at` que tenía el proyecto cuando esta pantalla lo leyó.
     Viaja en cada guardado: si otro administrador escribió entretanto, el
     UPDATE no encuentra fila y `guardarFinanzas` devuelve `conflicto: true`.
     Es un ref, no estado: cambiarlo no debe repintar nada. */
  const versionProyecto = useRef(project?.updated_at ?? null);

  useEffect(() => {
    versionProyecto.current = project?.updated_at ?? null;
  }, [project?.id, project?.updated_at]);

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

  /* ── Borrado del proyecto entero (solo Admin en Modo Edición) ─────────────
     Es la acción menos reversible de la ficha, así que no basta con el clic:
     hay que teclear el nombre del proyecto. Lo mismo que exige la IA cuando
     propone `eliminar_proyecto`, pero desde la interfaz. */
  const nombreProyecto = project?.nombre || project?.title || '';
  const puedeEliminarProyecto = isAdmin && !!isEditMode;

  const handleEliminarProyecto = async () => {
    if (!puedeEliminarProyecto || borrandoProyecto) return;
    if (confirmacionNombre.trim().toLowerCase() !== nombreProyecto.trim().toLowerCase()) return;

    setBorrandoProyecto(true);
    setErrorBorrado(null);

    const { success, error } = await eliminarProyecto(project?.id);

    setBorrandoProyecto(false);

    if (!success) {
      setErrorBorrado(error || t('msg.errorSupabase'));
      return;
    }

    // La ficha que se está viendo ya no existe: se cierra y se releen los datos
    // del panel para que la tarjeta desaparezca de la lista.
    setConfirmarBorradoProyecto(false);
    onUpdateProject?.();
    onBack?.();
  };

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

    const {
      success, valores, error, updatedAt, conflicto, updatedAtRemoto
    } = await guardarFinanzas(project?.id, {
      ...finanzas, ...identidad, costoEjecutado: totalSpent,
      updatedAt: versionProyecto.current
    });

    setGuardandoFinanzas(false);

    if (success) {
      versionProyecto.current = updatedAt ?? versionProyecto.current;
      aplicarIdentidadGuardada(valores);
      if (project) {
        project.updated_at = updatedAt ?? project.updated_at;
        project.presupuesto_total = valores.presupuesto_total;
        project.anticipo = valores.anticipo;
        project.cuota_asignada = valores.cuota_asignada;
        project.costo_ejecutado = valores.costo_ejecutado;
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
      programar(() => setFinanzasMsg(null), 5000);
    } else {
      // Conflicto de concurrencia: se adopta el testigo remoto y se recargan
      // las cifras reales, para que el reintento parta de lo que hay guardado
      // y no del formulario que ya quedó obsoleto.
      if (conflicto) {
        if (updatedAtRemoto) versionProyecto.current = updatedAtRemoto;
        if (typeof onUpdateProject === 'function') await onUpdateProject();
      }
      setFinanzasMsg({ tipo: 'error', texto: t(error) });
    }
  };

  const handleCancelarFinanzas = () => {
    setFinanzas(finanzasDesdeProyecto());
    setIdentidad(identidadDesdeProyecto());
    setEditandoFinanzas(false);
    setFinanzasMsg(null);
  };

  // Cálculos derivados: reaccionan a cada tecla mientras se edita
  const totalBudget = aNumeroSeguro(finanzas.presupuesto);

  /* ── Costo ejecutado: FUENTE ÚNICA, `gastos` ───────────────────────────────
     `totalFacturas` es la suma real de `gastos.monto`; `facturas` se recarga
     tras cada alta/edición/borrado y por Realtime, así que se mueve sola.

     Ya NO se le suman los hitos marcados ni un ajuste manual. Sumarlos contaba
     el mismo dinero dos veces —la factura del proveedor que ejecutó el hito ya
     estaba registrada— y producía un sobrecosto inventado que alguien tenía que
     corregir a mano cada semana. `totalHitos` sigue calculándose, pero como lo
     que es: obra cerrada valorizada, que se muestra aparte y no como gasto. */
  const totalFacturas = React.useMemo(() => sumarGastos(facturas), [facturas]);
  const totalHitos = React.useMemo(() => sumarValoresCompletados(safeChecklist), [safeChecklist]);
  const totalSpent = componerCostoEjecutado({ facturas: totalFacturas });

  /* Las dos series de la gráfica recorren TODAS las facturas y agrupan por mes:
     es el cálculo más caro de la ficha y no tenía por qué rehacerse al escribir
     una letra en el nombre del proyecto o al abrir un modal. */
  const ejecucionMensual = React.useMemo(
    () => ejecucionMensualReal(facturas, language),
    [facturas, language]
  );
  const isOverBudget = totalSpent > totalBudget;
  const overBudgetAmount = isOverBudget ? totalSpent - totalBudget : 0;

  /* Saldo por ejecutar: lo que queda del presupuesto para terminar la obra.
     Puede ser negativo — y se muestra en rojo — porque ocultar el sobregiro
     sería justamente esconder el dato que hay que ver. */
  const saldoPorEjecutar = totalBudget - totalSpent;

  /* Capital inyectado: suma REAL de las aportaciones registradas para este
     proyecto en la sección de Inversionistas. Nunca es una cifra escrita a
     mano: si se registra o corrige una aportación, esto se mueve solo. */
  const capitalInyectado = React.useMemo(() => sumarDinero(
    (Array.isArray(aportaciones) ? aportaciones : [])
      .filter(a => String(a?.proyecto_id ?? '') === String(project?.id ?? '')),
    a => a?.monto
  ), [aportaciones, project?.id]);

  /* Estado del proyecto: NO es texto fijo, sale del % de hitos completados.
     0% = Planificación · 1–99% = En progreso · 100% = Finalizado. */
  const estadoAutomatico = safeChecklist.length === 0 || avancePct === 0
    ? t('estado.planificacion')
    : avancePct >= 100
    ? t('estado.finalizado')
    : t('estado.enProgreso');

  // Datos de la gráfica de facturas agrupados por mes
  const gastosPorMes = React.useMemo(
    () => agruparGastosPorMes(facturas, language),
    [facturas, language]
  );

  /* Distintivo de estado del proyecto ("En progreso · 40%").
     Se pinta DOS veces con la misma función y solo una es visible a la vez:
     en escritorio va a la par del título, donde sobra espacio, y en móvil baja
     a la línea de la ubicación, que es donde sí cabe. */
  const claseEstado = avancePct >= 100 && safeChecklist.length > 0
    ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30'
    : avancePct > 0
    ? 'bg-amber-50 dark:bg-amber-500/10 text-mm-oro-tinta dark:text-mm-oro-claro border-amber-200 dark:border-amber-500/30'
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
    <div className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-zinc-900 relative isolate">

      {/* ── Fondo animado de marca ──
          El mismo video del panel, detrás de todo: header, pestañas (Resumen,
          Finanzas, Docs, Galería) y contenido. Va con `-z-10` dentro de un
          `isolate`, así que se pinta sobre el lienzo blanco/navy pero por
          debajo de cualquier contenido, y las tarjetas opacas siguen legibles.
          `pointer-events-none` para que no robe ni un clic. */}
      <div className="absolute inset-0 -z-10 pointer-events-none" aria-hidden="true">
        <VideoBackground oscuro={modoOscuro} />
      </div>

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
                  className="flex-1 w-full min-w-0 lg:min-w-[20rem] bg-transparent border-b-2 border-mm-oro/60 focus:border-mm-oro outline-none text-xl md:text-2xl font-bold text-slate-900 dark:text-white tracking-tight uppercase"
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
                  className="flex-1 min-w-0 md:min-w-[18rem] bg-transparent border-b-2 border-mm-oro/60 focus:border-mm-oro outline-none text-xs md:text-sm text-slate-500 dark:text-zinc-300 uppercase tracking-widest font-medium"
                />
              ) : (
                project.ubicacion || project.location
              )}
            </p>
          </div>
        </div>

        {/* Basurero rojo: solo aparece con el Modo Edición encendido y siendo
            Administrador. No borra al pulsarlo, abre el diálogo que exige
            teclear el nombre del proyecto. */}
        {puedeEliminarProyecto && (
          <button
            type="button"
            onClick={() => {
              setConfirmacionNombre('');
              setErrorBorrado(null);
              setConfirmarBorradoProyecto(true);
            }}
            title={t('dlg.eliminarProyecto')}
            aria-label={t('dlg.eliminarProyecto')}
            className="flex-shrink-0 flex items-center gap-2 px-3 py-2 rounded-xl border border-red-200 dark:border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 hover:border-red-400 transition-colors active:scale-95"
          >
            <Trash2 size={17} />
            <span className="hidden md:inline text-xs font-bold">{t('dlg.eliminarProyecto')}</span>
          </button>
        )}
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
                  ? 'text-slate-900 dark:text-white border-slate-900 dark:border-mm-oro'
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
                  <CheckSquare size={14} className="text-mm-oro" /> {t('proy.checklist')}
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
                      className="flex items-center gap-1.5 bg-mm-oro-lavado dark:bg-amber-500/10 text-mm-oro-tinta dark:text-mm-oro-claro border border-mm-oro-borde dark:border-amber-500/30 text-xs font-bold px-3.5 py-1.5 rounded-xl hover:bg-mm-oro-hover dark:hover:bg-amber-500/20 transition-colors shadow-sm disabled:opacity-50 active:scale-95"
                    >
                      {isSavingChanges ? (
                        <>
                          <Loader2 size={14} className="animate-spin text-mm-3" />
                          {t('proy.guardando')}
                        </>
                      ) : (
                        <>
                          <Save size={14} className="text-mm-3" />
                          {t('proy.guardarCambios')}
                        </>
                      )}
                    </button>
                  ) : esAdminChecklist ? (
                    /* Al administrador sí hay que decirle que le falta encender
                       el Modo Edición. Al resto no se le avisa nada: la vista
                       simplemente no trae controles de edición. */
                    <span
                      className="flex items-center gap-1.5 text-xs font-bold text-slate-500 dark:text-zinc-300 bg-slate-100 dark:bg-zinc-700/60 border border-gray-200 dark:border-zinc-600 px-3.5 py-1.5 rounded-xl"
                      title={t('proy.checklistSoloEdicion')}
                    >
                      <Lock size={13} className="text-slate-400 dark:text-zinc-200" />
                      {t('proy.checklistSoloEdicion')}
                    </span>
                  ) : null}
                </div>
              </div>

              {isLoadingChecklist && (
                <div className="flex items-center justify-center gap-3 py-16 text-slate-400 dark:text-zinc-200">
                  <Loader2 size={20} className="animate-spin text-mm-3" />
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
                          ? 'opacity-50 border-mm-oro'
                          : esDestino
                          ? 'border-mm-oro ring-2 ring-mm-oro/40'
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
                                ? <CheckSquare size={22} className="text-mm-oro flex-shrink-0" />
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
                                <span className="text-base md:text-lg font-black text-mm-oro tabular-nums flex-shrink-0">
                                  {i + 1}.
                                </span>
                                <span className={`text-base md:text-lg font-bold ${isDone ? 'text-slate-900 dark:text-white' : 'text-slate-800 dark:text-zinc-100'}`}>
                                  {title}
                                </span>
                              </div>
                              <div className="flex flex-wrap items-center gap-2 mt-1.5">
                                {/* `whitespace-nowrap`: sin esto la cápsula deja
                                    que "Proyectado para el 2 de agosto 2026"
                                    parta dentro de sí misma y la fecha cae a un
                                    segundo renglón, separada de su etiqueta.
                                    Ahora la cápsula crece a lo ancho y, si no
                                    cabe, el `flex-wrap` del padre la baja
                                    entera — pero el texto no se rompe. */}
                                {isDone ? (
                                  <span className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-bold bg-emerald-50 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 px-2.5 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-500/30">
                                    <CheckCircle2 size={12} className="text-emerald-600 flex-shrink-0" />
                                    {t('proy.hecho')} {dateStr}
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-semibold bg-slate-100 dark:bg-zinc-700 text-slate-600 dark:text-zinc-300 px-2.5 py-0.5 rounded-full border border-gray-200 dark:border-zinc-700">
                                    <Calendar size={12} className="text-slate-400 dark:text-zinc-200 flex-shrink-0" />
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
                                        ? 'bg-amber-50 dark:bg-amber-500/10 text-mm-oro-tinta dark:text-mm-oro-claro border-amber-200 dark:border-amber-500/30'
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
                                className="p-0.5 text-slate-400 dark:text-zinc-300 hover:text-mm-oro rounded disabled:opacity-25 disabled:hover:text-slate-400"
                              >
                                <ChevronUp size={15} />
                              </button>
                              <span
                                onMouseDown={() => setHandleActivo(i)}
                                onMouseUp={() => setHandleActivo(null)}
                                title={t('proy.arrastrarHito')}
                                className="hidden sm:block text-slate-300 dark:text-zinc-500 hover:text-mm-oro cursor-grab active:cursor-grabbing"
                              >
                                <GripVertical size={14} />
                              </span>
                              <button
                                type="button"
                                onClick={() => moverHito(i, i + 1)}
                                disabled={i === safeChecklist.length - 1 || isSavingChanges}
                                title={t('proy.moverAbajo')}
                                aria-label={t('proy.moverAbajo')}
                                className="p-0.5 text-slate-400 dark:text-zinc-300 hover:text-mm-oro rounded disabled:opacity-25 disabled:hover:text-slate-400"
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
                                className="p-1.5 text-slate-400 dark:text-zinc-200 hover:text-mm-oro rounded-lg hover:bg-amber-50 transition-colors disabled:opacity-40"
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
                  <form onSubmit={handleAddHito} className="mt-4 flex flex-col sm:flex-row sm:items-center gap-3 bg-white dark:bg-zinc-800 p-3 rounded-2xl border border-gray-200 dark:border-zinc-700 shadow-sm focus-within:border-mm-oro focus-within:ring-1 focus-within:ring-mm-oro transition-all">
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
                      className="flex items-center justify-center gap-2 flex-shrink-0 bg-mm-navy text-white px-4 py-2 rounded-xl hover:bg-slate-800 transition-colors disabled:opacity-50"
                      title={t('proy.agregarChecklist')}
                    >
                      <Plus size={16} className="text-mm-oro" />
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
                      className="flex items-center gap-1.5 text-[11px] font-bold text-mm-oro-tinta dark:text-mm-oro-claro bg-mm-oro-lavado dark:bg-amber-500/10 border border-mm-oro-borde dark:border-amber-500/30 px-3 py-1.5 rounded-xl hover:bg-mm-oro-hover dark:hover:bg-amber-500/20 transition-colors flex-shrink-0"
                      title={t('proy.hitoConDetalleTooltip')}
                    >
                      <Plus size={13} className="text-mm-oro" /> {t('proy.hitoConDetalle')}
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
                    <span className="text-[11px] font-bold text-slate-400 dark:text-zinc-200 uppercase tracking-widest">{t('dash.ejecutado')}</span>
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
                        className="inline-flex items-center gap-1.5 bg-mm-oro-lavado dark:bg-amber-500/15 text-mm-oro-tinta dark:text-mm-oro-claro border border-mm-oro-borde dark:border-amber-500/30 font-bold px-4 py-2.5 rounded-xl text-xs hover:bg-mm-oro-hover transition-all shadow-sm disabled:opacity-50 active:scale-95"
                      >
                        {guardandoFinanzas
                          ? <><Loader2 size={15} className="animate-spin text-mm-3" /> {t('proy.guardando')}</>
                          : <><Save size={15} className="text-mm-oro" /> {t('proy.guardarCambios')}</>}
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setEditandoFinanzas(true)}
                      className="inline-flex items-center gap-1.5 bg-white dark:bg-zinc-800 text-slate-700 dark:text-zinc-200 border border-gray-200 dark:border-zinc-700 font-bold px-4 py-2.5 rounded-xl text-xs hover:bg-slate-50 dark:hover:bg-zinc-700 transition-all shadow-sm"
                    >
                      <Edit2 size={15} className="text-mm-oro" /> {t('fin.editarCifras')}
                    </button>
                  )
                )}
                <button
                  onClick={abrirFacturas}
                  className="inline-flex items-center gap-2 bg-mm-navy text-white font-bold px-4 py-2.5 rounded-xl text-xs sm:text-sm hover:bg-mm-navy-alto transition-all shadow-sm"
                >
                  <Receipt size={16} className="text-mm-oro" /> {t('fin.verFacturas')} ({facturas.length})
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
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <TarjetaMonto
                etiqueta={t('fin.presupuestoTotal')}
                pie={t('fin.usdProyectado')}
                valor={finanzas.presupuesto}
                editando={modoEdicionFinanzas}
                onChange={(v) => handleCampoFinanzas('presupuesto', v)}
                colorValor="text-mm-1"
              />

              {/* Saldo por ejecutar y Capital inyectado son cifras DERIVADAS
                  (presupuesto − ejecutado, y la suma de aportaciones reales):
                  no se editan ni en Modo Edición, porque escribirlas a mano
                  las desconectaría de los datos que las producen. */}
              <TarjetaMonto
                etiqueta={t('fin.saldoEjecutar')}
                pie={t('fin.saldoEjecutarDesc')}
                valor={saldoPorEjecutar}
                editando={false}
                colorValor={saldoPorEjecutar < 0 ? 'text-red-700 dark:text-red-400' : 'text-mm-1'}
              />

              <TarjetaMonto
                etiqueta={t('fin.capitalInyectado')}
                pie={t('fin.capitalInyectadoDesc')}
                valor={capitalInyectado}
                editando={false}
                colorValor="text-mm-1"
              />

              {/* Costo ejecutado: SOLO las facturas registradas. No se edita a
                  mano ni siquiera en Modo Edición — escribir el total encima lo
                  desconectaría de los gastos que lo producen, que es justo lo
                  que obligaba a re-corregirlo cada semana. Para moverlo se
                  registra o se corrige una factura. */}
              <TarjetaMonto
                etiqueta={t('fin.costoEjecutado')}
                pie={`${porcentajeEntero(totalSpent, totalBudget)}% ${t('fin.presupuestoEjecutado')}`}
                valor={totalSpent}
                editando={false}
                colorValor={isOverBudget ? 'text-red-700 dark:text-red-400' : 'text-mm-1'}
                resaltado={isOverBudget}
              >
                <p className="text-[11px] text-slate-400 dark:text-zinc-300 mt-1.5 leading-relaxed font-medium">
                  {t('fin.desgloseFacturas')} {formatearMoneda(totalFacturas)}
                  {totalHitos > 0 && (
                    <> {' · '}{t('fin.desgloseObraCerrada')} {formatearMoneda(totalHitos)}</>
                  )}
                </p>
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
                      className="flex items-center gap-1.5 bg-mm-oro-lavado dark:bg-amber-500/10 text-mm-oro-tinta dark:text-mm-oro-claro border border-mm-oro-borde dark:border-amber-500/30 text-xs font-bold px-3.5 py-2.5 rounded-xl hover:bg-mm-oro-hover dark:hover:bg-amber-500/20 transition-colors shadow-sm disabled:opacity-50 active:scale-95"
                    >
                      {guardandoFacturas
                        ? <><Loader2 size={14} className="animate-spin text-mm-3" /> {t('proy.guardando')}</>
                        : <><Save size={14} className="text-mm-3" /> {t('proy.guardarCambios')}</>}
                    </button>
                  </>
                )}

                {isAdmin && (
                  <button
                    onClick={() => setShowInvoiceModal(true)}
                    disabled={guardandoFacturas}
                    className="flex items-center gap-2 bg-mm-navy text-white text-xs font-bold px-4 py-2.5 rounded-xl hover:bg-slate-800 transition-colors shadow-sm disabled:opacity-50"
                  >
                    <Plus size={14} className="text-mm-oro" /> {t('fin.registrarFactura')}
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
                    {formatearMoneda(sumarDinero(gastosPorMes, m => m?.total))}
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
                    className={`group flex items-stretch gap-4 p-3 sm:p-4 bg-white dark:bg-zinc-800 border rounded-2xl shadow-sm hover:shadow-md hover:border-mm-oro/50 transition-all ${
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
                        tieneArchivo ? 'cursor-zoom-in hover:border-mm-oro' : 'cursor-default'
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
                        <span className="w-full h-full flex flex-col items-center justify-center gap-1 text-mm-oro-tinta dark:text-mm-oro-claro">
                          {tieneArchivo
                            ? <><FileText size={24} /><span className="text-[11px] font-black tracking-wider">PDF</span></>
                            : <><FileImage size={22} className="text-slate-300 dark:text-zinc-300" /><span className="text-[11px] font-bold text-slate-400 dark:text-zinc-300">{t('fac.sinArchivo')}</span></>}
                        </span>
                      )}
                    </button>

                    {/* Información detallada */}
                    <div className="flex-1 min-w-0 flex flex-col sm:flex-row sm:items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-bold text-slate-900 dark:text-white truncate">{fac.proveedor}</h4>
                        <p className="text-xs text-slate-500 dark:text-zinc-200 mt-0.5 line-clamp-2">{fac.concepto}</p>
                        <span className="inline-flex flex-wrap items-center gap-1.5 text-[11px] font-semibold text-slate-400 dark:text-zinc-200 mt-1.5">
                          <Calendar size={11} /> {fac.fecha}
                          {tieneArchivo && (
                            <span className="inline-flex items-center gap-1 text-mm-oro-tinta dark:text-mm-oro-claro">
                              • <Receipt size={11} /> {t('fac.conComprobante')}
                            </span>
                          )}
                          {/* Lo que todavía no existe en Supabase se marca:
                              así se sabe qué se pierde si se cancela. */}
                          {(fac._nueva || fac._editada) && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-300 px-2 py-0.5 rounded-full border border-amber-200 dark:border-amber-500/30">
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
                                className="p-2 rounded-xl text-slate-500 dark:text-zinc-300 bg-slate-100 dark:bg-zinc-700 hover:text-mm-oro-tinta dark:hover:text-mm-oro-claro hover:bg-amber-50 dark:hover:bg-amber-500/10 transition-colors disabled:opacity-50"
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
              accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.webp,.heic"
              className="archivo-oculto"
            />

            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-400 dark:text-zinc-200">{t('doc.archivos')}</h2>
                <p className="text-[11px] text-slate-400 dark:text-zinc-200 mt-0.5">{t('doc.bucket')} <span className="font-mono font-semibold text-slate-500 dark:text-zinc-200">archivos_mmcapital</span></p>
              </div>
              {/* Subir documento: cualquier usuario con sesión. Lo que suba
                  queda a su nombre y solo él (o el Administrador) lo borra. */}
              <button
                onClick={() => docInputRef.current?.click()}
                disabled={isUploading}
                className="inline-flex items-center gap-2 border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-700 dark:text-zinc-200 text-xs font-medium px-4 py-2.5 rounded-xl hover:bg-slate-50 dark:hover:bg-zinc-700/50 active:scale-[0.97] transition-all shadow-sm disabled:opacity-50"
              >
                {isUploading ? (
                  <>
                    <Loader2 size={14} className="animate-spin text-mm-3" />
                    {t('comun.procesando')}
                  </>
                ) : (
                  <>
                    <Upload size={14} className="text-mm-3" />
                    {t('doc.subirDoc')}
                  </>
                )}
              </button>
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
                          {/* Firma: de quién es el documento y, por tanto,
                              quién puede renombrarlo o borrarlo. */}
                          <p className="text-[11px] text-slate-400 dark:text-zinc-300 mt-0.5">
                            {t('fb.subidoPor')} <span className="font-bold text-slate-500 dark:text-zinc-200">{autorDe(doc)}</span>
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
                            className="flex items-center gap-1.5 text-xs font-bold text-white bg-mm-navy px-3.5 py-1.5 rounded-xl hover:bg-slate-800 transition-colors shadow-sm"
                          >
                            <Download size={13} className="text-mm-oro" /> {t('comun.descargar')}
                          </a>
                        )}

                        {/* Renombrar y eliminar: el autor del documento, y el
                            Administrador sobre cualquiera */}
                        {puedeGestionarSubida(doc) && (
                          <>
                            <button
                              onClick={() => handleRenameArchivo(doc)}
                              disabled={isUploading}
                              className="p-2 text-slate-400 dark:text-zinc-200 hover:text-mm-oro rounded-xl hover:bg-amber-50 border border-gray-200 dark:border-zinc-700 transition-colors disabled:opacity-40"
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
              {/* Subir fotos y crear álbumes: cualquier usuario con sesión.
                  Cada foto y cada álbum quedan a nombre de quien los creó. */}
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
                        <Loader2 size={15} className="animate-spin text-mm-3" />
                        {textoSubiendoFotos}
                      </>
                    ) : (
                      <>
                        <Upload size={15} className="text-mm-oro" />
                        {t('gal.subirFotos')}
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => setShowCreateAlbumModal(true)}
                    className="flex items-center gap-2 bg-mm-navy text-white text-xs font-bold px-4 py-2.5 rounded-xl hover:bg-slate-800 transition-colors shadow-sm"
                  >
                    <FolderPlus size={15} className="text-mm-oro" /> {t('gal.crearAlbum')}
                  </button>
              </div>
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
                    <div className="absolute bottom-3 right-3 bg-black/70 backdrop-blur-md text-white text-[11px] font-bold px-2.5 py-1 rounded-lg border border-white/10 flex items-center gap-1.5">
                      <Image size={12} className="text-mm-oro" />
                      {album.photoCount || (album.photos || []).length} {t('gal.fotos')}
                    </div>
                  </div>
                  <div className="p-4 flex flex-col flex-1 justify-between">
                    <div>
                      <h3 className="text-base font-bold text-slate-900 dark:text-white group-hover:text-mm-oro-tinta dark:group-hover:text-mm-oro-claro transition-colors">{album.title}</h3>
                      <p className="text-xs text-slate-400 dark:text-zinc-200 mt-1 font-medium">{album.date}</p>
                      {/* Quién creó el álbum: es quien puede editarlo o borrarlo */}
                      <p className="text-[11px] text-slate-400 dark:text-zinc-300 mt-1">
                        {t('fb.subidoPor')} <span className="font-bold text-slate-500 dark:text-zinc-200">{autorDe(album)}</span>
                      </p>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-slate-700 dark:text-zinc-200 flex items-center gap-1 group-hover:translate-x-1 transition-transform">
                        {t('gal.verFotografias')}
                      </span>

                      {/* Editar / eliminar álbum: quien lo creó, y el Administrador */}
                      {puedeGestionarSubida(album) && (
                        <span className="flex items-center gap-1 flex-shrink-0">
                          <button
                            onClick={(e) => { e.stopPropagation(); setAlbumEditando({ ...album }); }}
                            disabled={subiendoGaleria}
                            className="p-1.5 text-slate-400 dark:text-zinc-200 hover:text-mm-oro rounded-lg hover:bg-amber-50 dark:hover:bg-amber-500/10 transition-colors disabled:opacity-40"
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
                {/* Subir foto directamente a este álbum: abierto a todos, aunque
                    el álbum lo haya creado otra persona. Cada foto queda a
                    nombre de quien la sube, no del dueño del álbum. */}
                <button
                  onClick={() => albumPhotoInputRef.current?.click()}
                  disabled={subiendoGaleria}
                  className="flex items-center gap-1.5 bg-mm-navy text-white text-xs font-bold px-3.5 py-2 rounded-xl hover:bg-slate-800 transition-colors disabled:opacity-50"
                >
                  {subiendoGaleria
                    ? <><Loader2 size={14} className="animate-spin text-mm-3" /> {textoSubiendoFotos}</>
                    : <><Upload size={14} className="text-mm-3" /> {t('gal.subirFotos')}</>}
                </button>
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
              accept="image/*"
              className="archivo-oculto"
            />

            {/* Rejilla real desde móvil: 2 columnas de miniaturas cuadradas.
                Con `grid-cols-1` las fotos se veían apiladas una tras otra. */}
            <div className="flex-1 overflow-y-auto p-4 md:p-6 grid grid-cols-2 md:grid-cols-3 gap-2 md:gap-4 auto-rows-min content-start">
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
                  className="relative group aspect-square w-full rounded-2xl overflow-hidden bg-slate-100 dark:bg-zinc-700 border border-gray-100 dark:border-zinc-700 shadow-sm"
                >
                  <img
                    src={photoUrl}
                    alt={foto?.nombre_archivo || `${idx + 1}`}
                    loading="lazy"
                    onClick={() => abrirVisorFoto(idx)}
                    className="block w-full h-full aspect-square object-cover group-hover:scale-105 transition-transform cursor-pointer"
                  />

                  {/* Eliminar esta foto: quien la subió, y el Administrador */}
                  {foto?.id && puedeGestionarSubida(foto) && (
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
                    onClick={() => abrirVisorFoto(idx)}
                    className="absolute inset-0 bg-black/30 opacity-0 md:group-hover:opacity-100 transition-opacity flex items-center justify-center text-white cursor-pointer"
                  >
                    <Eye size={24} />
                  </div>

                  {/* Firma de la foto, sobre la propia miniatura: en una
                      cuadrícula cuadrada no cabe debajo sin romper la retícula. */}
                  <p className="absolute inset-x-0 bottom-0 z-10 px-2 py-1 bg-gradient-to-t from-black/75 to-transparent text-[10px] font-semibold text-white/90 truncate pointer-events-none">
                    {t('fb.subidoPor')} {autorDe(foto)}
                  </p>
                </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ════ VISOR DE GALERÍA ════
          Se navega entre fotos sin cerrarlo: flechas en pantalla, teclado en
          escritorio y deslizamiento con el dedo en el teléfono. Da la vuelta al
          llegar al final, igual que el carrusel del panel. */}
      {indiceFoto !== null && fotosAlbum.length > 0 && (
        <div
          className="fixed inset-0 z-50 bg-black/92 flex flex-col"
          onClick={cerrarVisorFoto}
          role="dialog"
          aria-modal="true"
          aria-label={t('gal.vistaAmpliada')}
        >
          {/* Cabecera: posición y cierre */}
          <div
            className="flex items-center justify-between gap-4 px-4 sm:px-6 py-3 flex-shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="text-[13px] font-semibold text-white/70 tabular-nums">
              {indiceFoto + 1} / {fotosAlbum.length}
            </span>
            <button
              onClick={cerrarVisorFoto}
              title={t('comun.cerrar')}
              className="p-2 rounded-xl text-white/80 bg-white/10 hover:bg-white/20 transition-colors"
            >
              <X size={18} />
            </button>
          </div>

          {/* Imagen + zonas de navegación */}
          <div
            className="flex-1 min-h-0 relative flex items-center justify-center p-3 sm:p-6"
            onClick={(e) => e.stopPropagation()}
            onTouchStart={alTocarVisor}
            onTouchEnd={alSoltarVisor}
          >
            <img
              src={urlFoto(fotosAlbum[indiceFoto])}
              alt={fotosAlbum[indiceFoto]?.nombre_archivo || t('gal.vistaAmpliada')}
              className="max-w-full max-h-full rounded-2xl shadow-2xl object-contain select-none"
              draggable={false}
            />

            {fotosAlbum.length > 1 && (
              <>
                <button
                  onClick={() => moverFoto(-1)}
                  aria-label={t('gal.fotoAnterior')}
                  title={t('gal.fotoAnterior')}
                  className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-black/50 hover:bg-black/70 text-white flex items-center justify-center backdrop-blur-sm transition-colors active:scale-95"
                >
                  <ChevronLeft size={22} />
                </button>
                <button
                  onClick={() => moverFoto(1)}
                  aria-label={t('gal.fotoSiguiente')}
                  title={t('gal.fotoSiguiente')}
                  className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-black/50 hover:bg-black/70 text-white flex items-center justify-center backdrop-blur-sm transition-colors active:scale-95"
                >
                  <ChevronRight size={22} />
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ════ MODAL: ¿A QUÉ ÁLBUM AGREGAR LA FOTO? ════ */}
      {showDestinoModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-800 rounded-3xl max-w-md w-full p-6 shadow-2xl border border-gray-100 dark:border-zinc-700">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100 dark:border-zinc-700">
              <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Image size={18} className="text-mm-oro" /> {t('gal.destinoTitulo')}
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
                  className="w-full bg-slate-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-slate-800 dark:text-zinc-100 focus:outline-none focus:border-mm-oro cursor-pointer"
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
              accept="image/*"
              className="archivo-oculto"
            />

            <div className="pt-5 flex flex-col sm:flex-row justify-end gap-2">
              <button
                type="button"
                onClick={() => { setShowDestinoModal(false); setShowCreateAlbumModal(true); }}
                className="flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold text-slate-600 dark:text-zinc-300 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 hover:bg-slate-50 dark:hover:bg-zinc-700 rounded-xl"
              >
                <FolderPlus size={14} className="text-mm-oro" /> {t('gal.crearAlbum')}
              </button>
              <button
                type="button"
                onClick={() => photoInputRef.current?.click()}
                disabled={!destinoFoto || albums.length === 0}
                className="flex items-center justify-center gap-2 px-5 py-2.5 text-xs font-bold text-white bg-mm-navy hover:bg-slate-800 rounded-xl shadow-sm disabled:opacity-40"
              >
                <Upload size={14} className="text-mm-3" /> {t('gal.elegirFotos')}
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
                <FolderPlus size={18} className="text-mm-oro" /> {t('gal.crearAlbum')}
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
                  accept="image/*"
                  onChange={(e) => setPortadaFile(e.target.files?.[0] || null)}
                  className="w-full text-xs text-slate-600 dark:text-zinc-300 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-mm-navy file:text-white hover:file:bg-slate-800 file:cursor-pointer cursor-pointer"
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
                  className="px-5 py-2 text-xs font-bold text-white bg-mm-navy hover:bg-slate-800 rounded-xl shadow-sm disabled:opacity-50 flex items-center gap-2"
                >
                  {subiendoGaleria && <Loader2 size={14} className="animate-spin text-mm-3" />}
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
                <Edit2 size={18} className="text-mm-2" /> {t('gal.editarAlbum')}
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
                  className="w-full bg-slate-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-slate-800 dark:text-zinc-100 focus:outline-none focus:border-mm-oro"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-zinc-300 mb-1 uppercase">{t('gal.fechaPeriodo')}</label>
                <input
                  type="text"
                  placeholder={t('gal.fechaPeriodoPh')}
                  value={albumEditando.date || ''}
                  onChange={(e) => setAlbumEditando({ ...albumEditando, date: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-slate-800 dark:text-zinc-100 focus:outline-none focus:border-mm-oro"
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
                  accept="image/*"
                  onChange={(e) => setNuevaPortadaFile(e.target.files?.[0] || null)}
                  className="w-full text-xs text-slate-600 dark:text-zinc-300 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-mm-navy file:text-white hover:file:bg-slate-800 file:cursor-pointer cursor-pointer"
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
                  className="px-5 py-2 text-xs font-bold text-white bg-mm-navy hover:bg-slate-800 rounded-xl shadow-sm disabled:opacity-50 flex items-center gap-2"
                >
                  {subiendoGaleria && <Loader2 size={14} className="animate-spin text-mm-3" />}
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
                <Receipt size={18} className="text-mm-oro" /> {t('modal.registrarFactura')}
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
                className="archivo-oculto"
                onChange={(e) => { adjuntarComprobante(e.target.files?.[0]); e.target.value = ''; }}
              />

              <div
                onDragOver={(e) => { e.preventDefault(); setArrastrandoComprobante(true); }}
                onDragLeave={() => setArrastrandoComprobante(false)}
                onDrop={handleSoltarComprobante}
                onClick={() => comprobanteInputRef.current?.click()}
                className={`relative rounded-2xl border-2 border-dashed cursor-pointer transition-colors overflow-hidden ${
                  arrastrandoComprobante
                    ? 'border-mm-oro bg-amber-50 dark:bg-amber-500/10'
                    : comprobanteFile
                    ? 'border-mm-oro/60 bg-amber-50/40 dark:bg-amber-500/5'
                    : 'border-gray-300 dark:border-zinc-600 bg-slate-50/70 dark:bg-zinc-900/50 hover:border-mm-oro/70'
                }`}
              >
                {comprobantePreview ? (
                  <div className="flex items-center gap-3 p-3">
                    <img src={comprobantePreview} alt={t('modal.comprobanteFoto')} className="w-20 h-20 rounded-xl object-cover border border-gray-200 dark:border-zinc-600 flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-slate-800 dark:text-white truncate">{comprobanteFile?.name}</p>
                      <p className="text-[11px] font-semibold text-slate-400 dark:text-zinc-200 mt-0.5">{t('modal.cambiarArchivo')}</p>
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
                    <div className="w-20 h-20 rounded-xl border border-gray-200 dark:border-zinc-600 bg-white dark:bg-zinc-800 flex flex-col items-center justify-center gap-1 text-mm-oro-tinta dark:text-mm-oro-claro flex-shrink-0">
                      <FileText size={22} /><span className="text-[11px] font-black tracking-wider">PDF</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-slate-800 dark:text-white truncate">{comprobanteFile.name}</p>
                      <p className="text-[11px] font-semibold text-slate-400 dark:text-zinc-200 mt-0.5">{t('modal.cambiarArchivo')}</p>
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
                    <div className="w-11 h-11 mx-auto mb-2 rounded-2xl bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-600 shadow-sm flex items-center justify-center text-mm-oro">
                      <Upload size={20} />
                    </div>
                    <p className="text-xs font-bold text-slate-700 dark:text-zinc-200">{t('modal.soltarComprobante')}</p>
                    <p className="text-[11px] font-semibold text-slate-400 dark:text-zinc-200 mt-1">{t('modal.formatosComprobante')}</p>
                  </div>
                )}
              </div>

              {/* ── Extracción automática con Gemini (gemini-1.5-flash) ── */}
              <button
                type="button"
                onClick={handleExtraerConIA}
                disabled={extrayendoIA || !comprobanteFile}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-xs font-black uppercase tracking-wider text-white shadow-lg shadow-amber-500/20 bg-gradient-to-r from-mm-navy via-mm-oro-tinta to-mm-oro hover:brightness-110 active:scale-[0.99] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
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
                  className="px-5 py-2 text-xs font-bold text-white bg-mm-navy hover:bg-slate-800 rounded-xl shadow-sm disabled:opacity-50 flex items-center gap-2"
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
                <Edit2 size={18} className="text-mm-2" /> {t('modal.editarFactura')}
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
                  className="px-5 py-2 text-xs font-bold text-white bg-mm-navy hover:bg-slate-800 rounded-xl shadow-sm flex items-center gap-2"
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

      {/* ════ CONFIRMACIÓN DEL BORRADO DEL PROYECTO COMPLETO ════
          Un clic de más aquí borra la obra entera: gastos, aportaciones, hitos
          y galería. Por eso el botón rojo no se habilita hasta que el nombre
          tecleado coincide con el del proyecto. */}
      {confirmarBorradoProyecto && puedeEliminarProyecto && (
        <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-800 rounded-3xl max-w-md w-full p-6 shadow-2xl border border-gray-100 dark:border-zinc-700">
            <div className="flex items-center gap-3 mb-3">
              <span className="w-10 h-10 rounded-2xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 flex items-center justify-center flex-shrink-0">
                <Trash2 size={18} className="text-red-500" />
              </span>
              <h3 className="text-base font-bold text-slate-900 dark:text-white break-words">
                {t('dlg.eliminarProyectoTitulo', { nombre: nombreProyecto })}
              </h3>
            </div>

            <p className="text-[13px] leading-relaxed text-slate-600 dark:text-zinc-300">
              {t('dlg.eliminarProyectoAviso')}
            </p>

            <label className="block mt-4 text-[12px] font-bold text-slate-500 dark:text-zinc-300">
              {t('dlg.eliminarProyectoEscribe')}
              <input
                type="text"
                autoFocus
                value={confirmacionNombre}
                onChange={(e) => setConfirmacionNombre(e.target.value)}
                placeholder={nombreProyecto}
                className="mt-1.5 w-full bg-slate-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-600 rounded-xl px-3 py-2 text-sm font-medium text-slate-800 dark:text-zinc-100 placeholder:text-slate-300 dark:placeholder:text-zinc-600 focus:outline-none focus:border-red-400"
              />
            </label>

            {errorBorrado && (
              <p className="mt-3 flex items-start gap-2 text-[12px] font-semibold text-red-600 dark:text-red-400">
                <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
                <span className="break-words">{errorBorrado}</span>
              </p>
            )}

            <div className="pt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmarBorradoProyecto(false)}
                disabled={borrandoProyecto}
                className="px-4 py-2 text-xs font-bold text-slate-500 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-700 rounded-xl disabled:opacity-60"
              >
                {t('comun.cancelar')}
              </button>
              <button
                type="button"
                onClick={handleEliminarProyecto}
                disabled={
                  borrandoProyecto ||
                  confirmacionNombre.trim().toLowerCase() !== nombreProyecto.trim().toLowerCase()
                }
                className="flex items-center gap-2 px-5 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-xl shadow-sm disabled:opacity-40 disabled:hover:bg-red-600"
              >
                {borrandoProyecto
                  ? <><Loader2 size={13} className="animate-spin" /> {t('dlg.eliminarProyectoEliminando')}</>
                  : <><Trash2 size={13} /> {t('dlg.eliminarProyectoConfirmar')}</>}
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
                <Plus size={18} className="text-mm-oro" /> {t('modal.agregarHito')}
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
                  <DollarSign size={15} className="text-mm-oro flex-shrink-0" />
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
                <button type="submit" className="px-5 py-2 text-xs font-bold text-white bg-mm-navy hover:bg-slate-800 rounded-xl shadow-sm">
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
                  className="flex items-center gap-2 text-xs font-bold text-mm-navy bg-mm-oro hover:bg-mm-oro-vivo px-4 py-2 rounded-xl transition-colors disabled:opacity-60"
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
                <Edit2 size={18} className="text-mm-2" /> {t('modal.editarHito')}
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
                  <DollarSign size={15} className="text-mm-oro flex-shrink-0" />
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
                <button type="submit" className="px-5 py-2 text-xs font-bold text-white bg-mm-navy hover:bg-slate-800 rounded-xl shadow-sm">
                  {t('modal.actualizarHito')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {dialogoConfirmacion}
    </div>
  );
}
