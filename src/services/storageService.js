import imageCompression from 'browser-image-compression';
import { supabase } from '../supabaseClient';
import { comprimirImagen } from '../lib/comprimirImagen';

/** Formatos que sí conviene comprimir antes de subir a la bóveda. */
const TIPOS_COMPRIMIBLES = ['image/jpeg', 'image/png', 'image/webp'];

/** ¿Supabase rechazó el archivo por tamaño (413 / payload too large)? */
export function esErrorDeTamano(error) {
  if (!error) return false;
  const status = Number(error.statusCode ?? error.status ?? 0);
  if (status === 413) return true;
  const msg = String(error.message || error).toLowerCase();
  return msg.includes('413')
    || msg.includes('payload too large')
    || msg.includes('entity too large')
    || msg.includes('maximum allowed size')
    || msg.includes('exceeded the maximum');
}

/** Bucket general de la aplicación (documentos, portadas, avatares, galería). */
export const BUCKET = 'archivos_mmcapital';

/** Bucket dedicado a los comprobantes de las facturas de proveedores. */
export const BUCKET_FACTURAS = 'facturas';

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** La columna `archivos.proyecto_id` es uuid: los IDs demo '1','2','3' no sirven. */
export function esIdValidoDeSupabase(id) {
  return typeof id === 'string' && RE_UUID.test(id.trim());
}

/* ═══════════════════════════════════════════════════════════════════════════
   Autoría: quién subió cada cosa y quién puede tocarla
   ═══════════════════════════════════════════════════════════════════════════
   Subir es de todos; modificar y borrar es de quien subió. El Administrador
   manda sobre todo. Las políticas RLS de la migración 014 dicen exactamente lo
   mismo del lado del servidor: esto NO es el candado, es la interfaz del
   candado — sirve para no enseñar botones que la base va a rechazar.

   `subido_por` en NULL son las filas anteriores a la 014: sin autor conocido,
   solo el Administrador las gobierna. */

/** ¿La fila (archivo, foto o álbum) la subió este usuario? */
export function esMio(fila, userId) {
  const autor = fila?.subido_por ?? fila?.raw?.subido_por ?? null;
  if (!autor || !userId) return false;
  return String(autor) === String(userId);
}

/**
 * ¿Este usuario puede renombrar o eliminar esta fila?
 * @param {object} fila       registro de `archivos` o de `galeria_albumes`
 * @param {{userId?: string, esAdmin?: boolean}} quien
 */
export function puedeGestionar(fila, { userId, esAdmin } = {}) {
  return !!esAdmin || esMio(fila, userId);
}

/** Mensaje único para cuando la base rechaza por autoría. */
export const AVISO_SIN_PERMISO =
  'Solo puedes modificar o eliminar lo que tú subiste. Pídeselo al Administrador.';

/**
 * ¿El fallo de Supabase es «RLS te dejó fuera» y no un error de verdad?
 * PostgREST no responde 403 cuando una política filtra: devuelve cero filas.
 * Con `.single()` eso llega como PGRST116; en Storage, como un 403 explícito.
 */
export function esFalloDePermiso(error) {
  if (!error) return false;
  const code = String(error.code || error.statusCode || error.status || '');
  const msg = String(error.message || '').toLowerCase();
  return code === 'PGRST116' || code === '403' || code === '42501'
    || msg.includes('row-level security')
    || msg.includes('violates row-level security policy');
}

/** Deriva la ruta dentro del bucket a partir de la URL pública guardada. */
export function rutaDesdeUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const marca = `/object/public/${BUCKET}/`;
  const i = url.indexOf(marca);
  if (i === -1) return null;
  try {
    return decodeURIComponent(url.slice(i + marca.length).split('?')[0]);
  } catch {
    return url.slice(i + marca.length).split('?')[0];
  }
}

/**
 * Uploads a file to Supabase storage bucket 'archivos_mmcapital'
 * and records file metadata in the 'archivos' table.
 *
 * @param {File} file - The file object to upload
 * @param {string|number|null} proyectoId - The ID of the associated project or null/'global_vault' for corporate vault
 * @param {'foto_galeria'|'documento_pdf'} tipo - Type of file
 * @param {(p: {porcentaje: number, fase: 'comprimiendo'|'subiendo'|'registrando'|'listo'}) => void} [onProgreso]
 * @returns {Promise<{success: boolean, data?: object, publicUrl?: string, url?: string, error?: string, tamanoExcedido?: boolean}>}
 */
export async function uploadArchivoProyecto(file, proyectoId, tipo = 'documento_pdf', onProgreso) {
  const avisar = (porcentaje, fase) => {
    if (typeof onProgreso === 'function') onProgreso({ porcentaje: Math.round(porcentaje), fase });
  };

  try {
    if (!file) throw new Error('No se seleccionó ningún archivo.');

    // 1. Las imágenes se comprimen ANTES de viajar: un JPG de móvil pesa
    //    12 MB y el bucket lo rechaza con 413.
    let archivo = file;
    if (TIPOS_COMPRIMIBLES.includes(file.type)) {
      avisar(0, 'comprimiendo');
      try {
        archivo = await imageCompression(file, {
          maxSizeMB: 2,
          maxWidthOrHeight: 1920,
          useWebWorker: true,
          fileType: file.type,
          onProgress: (p) => avisar(Number(p) * 0.4, 'comprimiendo')
        });
      } catch (errComp) {
        console.warn('No se pudo comprimir la imagen, se sube original:', errComp);
        archivo = file;
      }
    }
    avisar(40, 'subiendo');

    // 2. Clean file path and unique timestamp name
    const timestamp = Date.now();
    const cleanFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const folder = (proyectoId === 'global_vault' || !proyectoId) ? 'corporate_vault' : `proyecto_${proyectoId}`;
    const filePath = `${folder}/${timestamp}_${cleanFileName}`;

    // 3. Subida al bucket `archivos_mmcapital` — un fallo aquí SÍ es fatal
    const { error: uploadError } = await supabase
      .storage
      .from(BUCKET)
      .upload(filePath, archivo, {
        cacheControl: '3600',
        upsert: true,
        contentType: archivo.type || file.type || 'application/octet-stream'
      });

    if (uploadError) {
      return {
        success: false,
        tamanoExcedido: esErrorDeTamano(uploadError),
        error: `No se pudo subir al bucket ${BUCKET}: ${uploadError.message}`
      };
    }
    avisar(85, 'registrando');

    // 4. URL pública
    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(filePath);
    const publicUrl = urlData?.publicUrl || null;

    // 5. Registro en la tabla `archivos`
    const targetProyectoId = esIdValidoDeSupabase(proyectoId) ? proyectoId : null;

    const { data: dbData, error: dbError } = await supabase
      .from('archivos')
      .insert([{
        proyecto_id: targetProyectoId,
        nombre_archivo: file.name,
        tipo: tipo,
        url_archivo: publicUrl,
        storage_path: filePath
      }])
      .select()
      .single();

    if (dbError) {
      // El binario ya está arriba pero no se registró: se limpia para no dejar huérfanos
      await supabase.storage.from(BUCKET).remove([filePath]);
      return {
        success: false,
        error: `El archivo se subió pero no se pudo registrar en la tabla archivos: ${dbError.message}`
      };
    }

    avisar(100, 'listo');
    return { success: true, data: dbData, publicUrl, url: publicUrl, path: filePath };
  } catch (err) {
    console.error('Upload Error:', err);
    return {
      success: false,
      tamanoExcedido: esErrorDeTamano(err),
      error: err.message || 'Error al subir archivo a Supabase'
    };
  }
}

/**
 * Actualiza nombre y/o categoría (`tipo`) de un archivo ya registrado.
 * La bóveda corporativa la usa para editar un documento sin volver a subirlo.
 */
export async function actualizarArchivo(archivoId, { nombre_archivo, tipo } = {}) {
  if (archivoId === null || archivoId === undefined) {
    return { success: false, error: 'El archivo no tiene un identificador válido.' };
  }

  const cambios = {};
  const nombre = String(nombre_archivo || '').trim();
  if (nombre) cambios.nombre_archivo = nombre;
  if (tipo) cambios.tipo = tipo;
  if (Object.keys(cambios).length === 0) return { success: true, data: null };

  const { data, error } = await supabase
    .from('archivos')
    .update(cambios)
    .eq('id', archivoId)
    .select()
    .single();

  // RLS no responde 403: filtra la fila y `.single()` se queda sin nada. Eso no
  // es un fallo técnico, es «esto no lo subiste tú», y así hay que decirlo.
  if (error) return { success: false, error: esFalloDePermiso(error) ? AVISO_SIN_PERMISO : error.message };
  return { success: true, data };
}

/** Renombra un archivo: actualiza `nombre_archivo` en la tabla. */
export async function renombrarArchivo(archivoId, nuevoNombre) {
  const nombre = String(nuevoNombre || '').trim();
  if (!nombre) return { success: false, error: 'El nombre no puede quedar vacío.' };
  if (archivoId === null || archivoId === undefined) {
    return { success: false, error: 'El archivo no tiene un identificador válido.' };
  }

  try {
    const { data, error } = await supabase
      .from('archivos')
      .update({ nombre_archivo: nombre })
      .eq('id', archivoId)
      .select()
      .single();

    if (error) return { success: false, error: esFalloDePermiso(error) ? AVISO_SIN_PERMISO : error.message };
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err.message || 'Error al renombrar el archivo.' };
  }
}

/** Elimina un archivo del bucket Y de la tabla `archivos`. */
export async function eliminarArchivo(archivo) {
  if (!archivo || archivo.id === null || archivo.id === undefined) {
    return { success: false, error: 'El archivo no tiene un identificador válido.' };
  }

  try {
    const path = archivo.storage_path || rutaDesdeUrl(archivo.url_archivo);

    // 1. Binario en el bucket (si no hay ruta, es un registro sin archivo físico)
    if (path) {
      const { error: storageError } = await supabase.storage.from(BUCKET).remove([path]);
      if (storageError) {
        return {
          success: false,
          error: esFalloDePermiso(storageError)
            ? AVISO_SIN_PERMISO
            : `No se pudo borrar del bucket ${BUCKET}: ${storageError.message}`
        };
      }
    }

    // 2. Fila en la base de datos. `.select()` para distinguir «borrado» de
    //    «RLS lo filtró y devolvió cero filas sin quejarse».
    const { data: borradas, error: dbError } = await supabase
      .from('archivos').delete().eq('id', archivo.id).select();
    if (dbError) return { success: false, error: `Se borró del bucket pero no de la tabla: ${dbError.message}` };
    if (!borradas || borradas.length === 0) return { success: false, error: AVISO_SIN_PERMISO };

    return { success: true, error: null };
  } catch (err) {
    return { success: false, error: err.message || 'Error al eliminar el archivo.' };
  }
}

/**
 * Fetches files for a specific project or global vault from the 'archivos' table
 */
export async function getArchivosProyecto(proyectoId) {
  try {
    const isGlobal = proyectoId === 'global_vault' || !proyectoId;

    // `proyecto_id` es uuid: filtrar con un ID demo ('1','2','3') daría 22P02
    if (!isGlobal && !esIdValidoDeSupabase(proyectoId)) return [];

    let query = supabase.from('archivos').select('*');

    if (isGlobal) {
      query = query.is('proyecto_id', null);
    } else {
      query = query.eq('proyecto_id', proyectoId);
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) {
      console.warn('Error leyendo archivos de Supabase DB:', error.message);
      return [];
    }
    return data || [];
  } catch (err) {
    console.warn('Excepción leyendo archivos:', err);
    return [];
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   Subida de avatar de perfil
   ═══════════════════════════════════════════════════════════════════════════ */

/** Tipos y tamaño aceptados para imágenes subidas desde el dispositivo. */
export const IMAGEN_MAX_MB = 5;
const TIPOS_IMAGEN = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];

/** Valida una imagen antes de gastar red. Devuelve null si está bien. */
export function validarImagen(file) {
  if (!file) return 'No se seleccionó ninguna imagen.';
  // Un Blob recortado trae type pero no name: se valida igual
  if (!TIPOS_IMAGEN.includes(file.type)) {
    return 'Formato no admitido. Usa JPG, PNG, WEBP, GIF o AVIF.';
  }
  if (file.size > IMAGEN_MAX_MB * 1024 * 1024) {
    return `La imagen pesa ${(file.size / 1024 / 1024).toFixed(1)} MB y el máximo es ${IMAGEN_MAX_MB} MB.`;
  }
  return null;
}

function rutaSegura(nombre) {
  return String(nombre || 'archivo').replace(/[^a-zA-Z0-9.-]/g, '_');
}

/* ── Caché local del avatar ───────────────────────────────────────────────
   Sin esto el avatar desaparece en cada F5: la consulta a `usuarios` es
   asíncrona y el Header y el Sidebar se pintan antes de que responda.
   La caché se lee de forma síncrona en el primer render y luego la base
   de datos confirma o corrige el valor. */

const CLAVE_AVATAR = 'mmcapital:avatar';

export function leerAvatarCache(usuarioId) {
  if (!usuarioId) return null;
  try {
    const bruto = window.localStorage.getItem(CLAVE_AVATAR);
    if (!bruto) return null;
    const datos = JSON.parse(bruto);
    // Se guarda junto al id para no mostrar el avatar de otra cuenta
    return datos?.id === usuarioId ? (datos.url || null) : null;
  } catch {
    return null;
  }
}

export function guardarAvatarCache(usuarioId, url) {
  if (!usuarioId) return;
  try {
    if (url) {
      window.localStorage.setItem(CLAVE_AVATAR, JSON.stringify({ id: usuarioId, url }));
    } else {
      window.localStorage.removeItem(CLAVE_AVATAR);
    }
  } catch {
    // Sin localStorage disponible: solo se pierde el arranque instantáneo
  }
}

/**
 * Sube la foto de perfil al bucket y la guarda en `usuarios.avatar_url`.
 * Acepta un File o el Blob que produce el recorte.
 *
 * @returns {Promise<{success: boolean, url?: string, error?: string}>}
 */
export async function subirAvatar(file, usuarioId, nombreSugerido = 'avatar.jpg') {
  const invalido = validarImagen(file);
  if (invalido) return { success: false, error: invalido };
  if (!esIdValidoDeSupabase(usuarioId)) {
    return { success: false, error: 'No se pudo identificar tu usuario para guardar el avatar.' };
  }

  // Compresión en el cliente: un avatar nunca necesita más de 512 px de lado,
  // así la subida es instantánea y no se cae por red lenta.
  const imagen = await comprimirImagen(file, {
    ladoMax: 512,
    pesoObjetivoKB: 150,
    nombre: file.name || nombreSugerido
  });

  const nombre = imagen.name || file.name || nombreSugerido;
  // La ruta DEBE ser `avatares/<uid>/...`: así la reconocen las políticas RLS
  // del bucket (migración 005) y cada quien solo toca sus propias imágenes.
  const filePath = `avatares/${usuarioId}/${Date.now()}_${rutaSegura(nombre)}`;

  try {
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(filePath, imagen, {
        cacheControl: '3600',
        upsert: true,
        contentType: imagen.type || 'image/jpeg'
      });

    if (upErr) return { success: false, error: `No se pudo subir la imagen: ${upErr.message}` };

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(filePath);
    const url = data?.publicUrl || null;

    const { error: dbErr } = await supabase
      .from('usuarios')
      .update({ avatar_url: url })
      .eq('id', usuarioId);

    if (dbErr) {
      // No dejar el binario huérfano si no se pudo registrar
      await supabase.storage.from(BUCKET).remove([filePath]);
      return { success: false, error: `La imagen subió pero no se guardó en tu perfil: ${dbErr.message}` };
    }

    guardarAvatarCache(usuarioId, url);
    return { success: true, url, path: filePath };
  } catch (err) {
    return { success: false, error: err.message || 'Error inesperado subiendo el avatar.' };
  }
}

/** Lee el avatar guardado del usuario (null si no tiene). */
export async function getAvatarUsuario(usuarioId) {
  if (!esIdValidoDeSupabase(usuarioId)) return null;
  try {
    const { data, error } = await supabase
      .from('usuarios')
      .select('avatar_url')
      .eq('id', usuarioId)
      .maybeSingle();
    if (error) return null;
    const url = data?.avatar_url || null;
    guardarAvatarCache(usuarioId, url);
    return url;
  } catch {
    return null;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   Comprobantes de facturas de proveedores · bucket `facturas`
   ═══════════════════════════════════════════════════════════════════════════ */

/** Un comprobante puede ser foto o PDF, y pesa más que un avatar. */
export const COMPROBANTE_MAX_MB = 15;
const TIPOS_COMPROBANTE = [...TIPOS_IMAGEN, 'application/pdf'];

/** Valida el comprobante antes de gastar red. Devuelve null si está bien. */
export function validarComprobante(file) {
  if (!file) return 'No se seleccionó ningún comprobante.';
  if (!TIPOS_COMPROBANTE.includes(file.type)) {
    return 'Formato no admitido. Sube una foto (JPG, PNG, WEBP) o un PDF.';
  }
  if (file.size > COMPROBANTE_MAX_MB * 1024 * 1024) {
    return `El archivo pesa ${(file.size / 1024 / 1024).toFixed(1)} MB y el máximo es ${COMPROBANTE_MAX_MB} MB.`;
  }
  return null;
}

/**
 * Sube la foto o el PDF de una factura al bucket `facturas` y devuelve su URL
 * pública, que es lo que se guarda en `gastos.comprobante`.
 *
 * Las fotos se comprimen a 2000 px de lado: suficiente para que los importes
 * se lean nítidos en el visor de alta calidad sin subir 12 MB desde el móvil.
 * Los PDF viajan intactos (comprimirlos rasterizaría el texto).
 *
 * @returns {Promise<{success: boolean, url?: string, path?: string, error?: string}>}
 */
export async function subirComprobanteFactura(file, proyectoId) {
  const invalido = validarComprobante(file);
  if (invalido) return { success: false, error: invalido };

  const esPdf = file.type === 'application/pdf';
  const archivo = esPdf
    ? file
    : await comprimirImagen(file, {
        ladoMax: 2000,
        pesoObjetivoKB: 900,
        nombre: file.name || 'factura.jpg'
      });

  const carpeta = esIdValidoDeSupabase(proyectoId) ? `proyecto_${proyectoId}` : 'sin_proyecto';
  const filePath = `${carpeta}/${Date.now()}_${rutaSegura(archivo.name || file.name || 'factura')}`;

  try {
    const { error: upErr } = await supabase.storage
      .from(BUCKET_FACTURAS)
      .upload(filePath, archivo, {
        cacheControl: '3600',
        upsert: true,
        contentType: archivo.type || file.type || 'application/octet-stream'
      });

    if (upErr) {
      return { success: false, error: `No se pudo subir el comprobante: ${upErr.message}` };
    }

    const url = supabase.storage.from(BUCKET_FACTURAS).getPublicUrl(filePath).data?.publicUrl || null;
    if (!url) return { success: false, error: 'El comprobante subió pero no se pudo obtener su enlace público.' };

    return { success: true, url, path: filePath };
  } catch (err) {
    return { success: false, error: err.message || 'Error inesperado subiendo el comprobante.' };
  }
}

/**
 * Descarga un archivo remoto forzando el diálogo de guardado.
 *
 * Un `<a download>` apuntando a otro origen es ignorado por el navegador y
 * termina abriendo la imagen en una pestaña; por eso se baja como blob. Si el
 * fetch falla (CORS, sin red) se abre en pestaña nueva como último recurso.
 */
export async function descargarArchivo(url, nombreSugerido = 'archivo') {
  if (!url) return { success: false, error: 'No hay archivo que descargar.' };

  try {
    const respuesta = await fetch(url);
    if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);

    const blob = await respuesta.blob();
    const objectUrl = URL.createObjectURL(blob);
    const enlace = document.createElement('a');
    enlace.href = objectUrl;
    enlace.download = rutaSegura(nombreSugerido);
    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    return { success: true };
  } catch (err) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return { success: false, error: err.message || 'No se pudo descargar el archivo.' };
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   Adjuntos del chat · bucket `archivos_mmcapital`, carpeta `chat/<uid>/`
   ═══════════════════════════════════════════════════════════════════════════ */

/** Un adjunto de chat puede ser una foto, un PDF o un documento de oficina. */
export const ADJUNTO_CHAT_MAX_MB = 15;

/** Lo que acepta el selector del clip. Mismo criterio que la bóveda. */
export const ACEPTA_ADJUNTO_CHAT =
  'image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv';

/** Valida el adjunto antes de gastar red. Devuelve null si está bien. */
export function validarAdjuntoChat(file) {
  if (!file) return 'No se seleccionó ningún archivo.';
  if (file.size > ADJUNTO_CHAT_MAX_MB * 1024 * 1024) {
    return `El archivo pesa ${(file.size / 1024 / 1024).toFixed(1)} MB y el máximo es ${ADJUNTO_CHAT_MAX_MB} MB.`;
  }
  return null;
}

/**
 * Sube un adjunto del chat y devuelve lo que se guarda en el mensaje.
 *
 * La ruta DEBE ser `chat/<uid>/...`: así la reconocen las políticas de la
 * migración 012 y cada quien solo puede subir bajo su propia carpeta. Con
 * cualquier otra ruta, un socio que no sea administrador recibiría
 * «new row violates row-level security policy».
 *
 * Las fotos se comprimen a 1600 px antes de viajar — una foto de móvil pesa
 * 12 MB y el bucket la rechazaría con 413. Los PDF y los documentos viajan
 * intactos: comprimir un PDF rasterizaría su texto.
 *
 * @returns {Promise<{success: boolean, adjunto?: object, error?: string}>}
 */
export async function subirAdjuntoChat(file, usuarioId) {
  const invalido = validarAdjuntoChat(file);
  if (invalido) return { success: false, error: invalido };
  if (!esIdValidoDeSupabase(usuarioId)) {
    return { success: false, error: 'No se pudo identificar tu usuario para subir el archivo.' };
  }

  const esImagenComprimible = TIPOS_COMPRIMIBLES.includes(file.type);
  const archivo = esImagenComprimible
    ? await comprimirImagen(file, {
        ladoMax: 1600,
        pesoObjetivoKB: 700,
        nombre: file.name || 'adjunto.jpg'
      })
    : file;

  const filePath = `chat/${usuarioId}/${Date.now()}_${rutaSegura(file.name || 'adjunto')}`;

  try {
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(filePath, archivo, {
        cacheControl: '3600',
        upsert: true,
        contentType: archivo.type || file.type || 'application/octet-stream'
      });

    if (upErr) {
      if (esErrorDeTamano(upErr)) {
        return { success: false, error: 'El archivo es demasiado grande para el servidor.' };
      }
      return { success: false, error: `No se pudo subir el archivo: ${upErr.message}` };
    }

    const url = supabase.storage.from(BUCKET).getPublicUrl(filePath).data?.publicUrl || null;
    if (!url) {
      await supabase.storage.from(BUCKET).remove([filePath]);
      return { success: false, error: 'El archivo subió pero no se pudo obtener su enlace.' };
    }

    return {
      success: true,
      adjunto: {
        // El nombre que se guarda es el ORIGINAL, no el saneado de la ruta:
        // es el que va a leer la persona en la burbuja.
        url,
        nombre: file.name || 'adjunto',
        tipo: archivo.type || file.type || 'application/octet-stream',
        tamano: archivo.size ?? file.size ?? null,
        path: filePath
      }
    };
  } catch (err) {
    return { success: false, error: err.message || 'Error inesperado subiendo el archivo.' };
  }
}

/** Borra un adjunto ya subido (se usa al descartar antes de enviar). */
export async function eliminarAdjuntoChat(path) {
  if (!path) return { success: true };
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) return { success: false, error: error.message };
  return { success: true };
}

/**
 * Sube la imagen de portada de un proyecto y actualiza `proyectos.imagen_url`.
 * @returns {Promise<{success: boolean, url?: string, error?: string}>}
 */
export async function subirPortadaProyecto(file, proyectoId) {
  const invalido = validarImagen(file);
  if (invalido) return { success: false, error: invalido };
  if (!esIdValidoDeSupabase(proyectoId)) {
    return { success: false, error: 'Este proyecto no existe en Supabase todavía, no se puede cambiar su portada.' };
  }

  // Las portadas se ven a 800 px como mucho: se comprimen antes de viajar.
  const imagen = await comprimirImagen(file, {
    ladoMax: 1600,
    pesoObjetivoKB: 400,
    nombre: file.name || 'portada.jpg'
  });

  const filePath = `proyecto_${proyectoId}/portada/${Date.now()}_${rutaSegura(imagen.name || 'portada.jpg')}`;

  try {
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(filePath, imagen, {
        cacheControl: '3600',
        upsert: true,
        contentType: imagen.type || 'image/jpeg'
      });

    if (upErr) return { success: false, error: `No se pudo subir la portada: ${upErr.message}` };

    const url = supabase.storage.from(BUCKET).getPublicUrl(filePath).data?.publicUrl || null;

    const { error: dbErr } = await supabase
      .from('proyectos')
      .update({ imagen_url: url })
      .eq('id', proyectoId);

    if (dbErr) {
      await supabase.storage.from(BUCKET).remove([filePath]);
      return { success: false, error: `La imagen subió pero no se guardó en el proyecto: ${dbErr.message}` };
    }

    return { success: true, url };
  } catch (err) {
    return { success: false, error: err.message || 'Error inesperado subiendo la portada.' };
  }
}
