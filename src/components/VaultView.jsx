import React, { useState, useEffect, useRef } from 'react';
import {
  AlertTriangle, CheckCircle2, ChevronLeft, Download, Edit3, FileText, FolderLock,
  Image as ImageIcon, Loader2, Lock, Save, Trash2, Upload, X
} from 'lucide-react';
import { usePrefs } from '../context/usePrefs';
import { useConfirmacion } from '../hooks/useConfirmacion';
import { useDirectorioUsuarios } from '../hooks/useDirectorioUsuarios';
import { useTemporizadores } from '../hooks/useTemporizadores';
import { parchearLista } from '../lib/realtime';
import { supabase } from '../supabaseClient';
import {
  uploadArchivoProyecto, getArchivosProyecto,
  renombrarArchivo, eliminarArchivo, actualizarArchivo, puedeGestionar
} from '../services/storageService';
import { etiquetaCategoria } from '../i18n/diccionario';
import { formatoArchivo, claveFormato, ACEPTA_BOVEDA } from '../lib/archivos';

/**
 * Bóveda documental corporativa.
 *
 * Vivía dentro de Dashboard.jsx, que pasaba de las cinco mil líneas. Se sale
 * entera —estado, subida, realtime y sus tres modales— porque no comparte nada
 * con el resto del panel: el Dashboard solo la monta y le dice quién la mira.
 */
export default function VaultView({ userRole, onBack, isAdmin, isEditMode, userId }) {
  const { t, locale } = usePrefs();
  // Confirmación con la estética de la app en vez del `confirm()` del navegador
  const { confirmar, dialogoConfirmacion } = useConfirmacion();
  // Los avisos se borran solos a los 5 s, y se cancelan si se sale de la bóveda
  const { programar } = useTemporizadores();
  // Nombre de quien subió cada documento, para la firma bajo el archivo
  const { nombreDe } = useDirectorioUsuarios();
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
    programar(() => setUploadMsg(null), 5000);
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

  /* ── Realtime de la bóveda ─────────────────────────────────────────────────
     Estaba roto y de la peor manera: en silencio. El filtro era
     `proyecto_id=eq.global_vault`, pero 'global_vault' no es un valor guardado
     en ninguna fila — es la etiqueta que usa la aplicación para decir "esto es
     de la bóveda, no de un proyecto"; en la tabla `archivos` esas filas llevan
     `proyecto_id` en NULL (ver `getArchivosProyecto`, que consulta con
     `.is('proyecto_id', null)`). Comparar una columna uuid contra ese texto no
     casa con NADA, así que el canal se suscribía correctamente y no entregaba
     un solo evento: los documentos nuevos no aparecían hasta recargar la
     página. Y tampoco servía cambiar el filtro a `is.null`, porque
     `postgres_changes` solo admite eq/neq/lt/lte/gt/gte/in.

     El alcance se decide aquí, en el cliente: llegan todos los eventos de
     `archivos` y `pertenece` deja pasar únicamente los que no tienen proyecto.
     Es lo mismo que ya hace el detalle de proyecto con los suyos.

     Y en vez de releer la tabla entera en cada evento, la fila se aplica sobre
     la lista en memoria (`parchearLista`): subir seis documentos disparaba seis
     lecturas completas para acabar en el mismo sitio. */
  useEffect(() => {
    loadVaultFiles();

    const esDeLaBoveda = (fila) => fila?.proyecto_id === null || fila?.proyecto_id === undefined;

    const canal = supabase
      .channel('boveda-archivos')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'archivos' }, (payload) => {
        setDbFiles(parchearLista(payload, { pertenece: esDeLaBoveda }));
      })
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
      programar(() => setUploadMsg(null), 5000);
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
      programar(() => setUploadMsg(null), 5000);
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
      setUploadMsg({ type: 'error', text: t(res.error) || t('msg.errorSupabase') });
    }

    programar(() => setUploadMsg(null), 5000);
  };

  const handleSaveEditDoc = async (e) => {
    e.preventDefault();
    if (!editingDoc || !puedeGestionarDoc(editingDoc)) return;

    const { success, error } = await actualizarArchivo(editingDoc.id, {
      nombre_archivo: editDocName,
      tipo: editDocCategory
    });

    if (!success) {
      setUploadMsg({ type: 'error', text: t(error) || t('msg.errorSupabase') });
      programar(() => setUploadMsg(null), 5000);
      return;
    }

    setEditingDoc(null);
    setCambiosPendientes(true);
    await loadVaultFiles();
  };

  const handleDeleteDoc = async (doc) => {
    if (!puedeGestionarDoc(doc)) return;
    if (!await confirmar({
      mensaje: t('vault.confirmEliminar'),
      detalle: doc?.nombre_archivo,
      textoConfirmar: t('vault.eliminarDoc')
    })) return;

    const { success, error } = await eliminarArchivo(doc.raw || doc);
    if (!success) {
      setUploadMsg({ type: 'error', text: t(error) || t('msg.errorSupabase') });
      programar(() => setUploadMsg(null), 5000);
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
    /* `subido_por` es el uuid del autor —lo que decide el permiso— y `autor`
       su nombre para leer. Los archivos anteriores a la migración 014 no
       tienen autor guardado: eran todos del Administrador, y firman «Admin». */
    subido_por: f.subido_por || null,
    autor: nombreDe(f.subido_por) || t('fb.autorDesconocido'),
    created_at: f.created_at,
    url_archivo: f.url_archivo,
    raw: f
  }));

  const adminAccess = isAdmin || userRole === 'admin';

  /* Quién puede tocar QUÉ documento (regla de la migración 014):
       · Quien lo subió — siempre, sin depender del Modo Edición: es suyo.
       · El Administrador — sobre cualquiera, pero solo con el Modo Edición
         encendido. Ese candado extra existe para que un escritura ajena no se
         borre de un clic despistado; sobre lo propio no hace falta.
     Es la interfaz del permiso, no el permiso: la base lo vuelve a comprobar. */
  const puedeGestionarDoc = (doc) =>
    puedeGestionar(doc, { userId, esAdmin: adminAccess && !!isEditMode });

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
                  en vez de suelto en la cabecera de la pantalla.

                  Subir es de TODOS: cualquier usuario con sesión aporta a la
                  bóveda, y lo que sube queda a su nombre y bajo su control. Lo
                  que sigue siendo del Administrador es mandar sobre lo ajeno. */}
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
                    renombrar y borrar sobre documentos ajenos sin entender por
                    qué no están. Sobre los suyos los tiene siempre. */}
                {adminAccess && !isEditMode && (
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
                      {/* Firma del documento. Con la bóveda abierta a todos,
                          saber de quién es cada archivo es lo que explica por
                          qué unos se pueden borrar y otros no. */}
                      <p className="text-[11px] text-slate-400 dark:text-zinc-300 font-medium mt-1">
                        {t('fb.subidoPor')} <span className="font-bold text-slate-500 dark:text-zinc-200">{doc.autor}</span>
                      </p>
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

                    {/* Editar / Eliminar: el autor del documento siempre; el
                        Administrador sobre cualquiera, en Modo Edición */}
                    {puedeGestionarDoc(doc) && (
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
                  placeholder={t('vault.nombreDocPh')}
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
