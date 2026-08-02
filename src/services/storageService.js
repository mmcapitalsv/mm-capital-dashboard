import { supabase } from '../supabaseClient';

/** Único bucket de Storage usado por la aplicación. */
export const BUCKET = 'archivos_mmcapital';

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** La columna `archivos.proyecto_id` es uuid: los IDs demo '1','2','3' no sirven. */
export function esIdValidoDeSupabase(id) {
  return typeof id === 'string' && RE_UUID.test(id.trim());
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
 * @returns {Promise<{success: boolean, data?: object, publicUrl?: string, url?: string, error?: string}>}
 */
export async function uploadArchivoProyecto(file, proyectoId, tipo = 'documento_pdf') {
  try {
    if (!file) throw new Error('No se seleccionó ningún archivo.');

    // 1. Clean file path and unique timestamp name
    const timestamp = Date.now();
    const cleanFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const folder = (proyectoId === 'global_vault' || !proyectoId) ? 'corporate_vault' : `proyecto_${proyectoId}`;
    const filePath = `${folder}/${timestamp}_${cleanFileName}`;

    // 2. Subida al bucket `archivos_mmcapital` — un fallo aquí SÍ es fatal
    const { error: uploadError } = await supabase
      .storage
      .from(BUCKET)
      .upload(filePath, file, { cacheControl: '3600', upsert: true });

    if (uploadError) {
      return {
        success: false,
        error: `No se pudo subir al bucket ${BUCKET}: ${uploadError.message}`
      };
    }

    // 3. URL pública
    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(filePath);
    const publicUrl = urlData?.publicUrl || null;

    // 4. Registro en la tabla `archivos`
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

    return { success: true, data: dbData, publicUrl, url: publicUrl, path: filePath };
  } catch (err) {
    console.error('Upload Error:', err);
    return { success: false, error: err.message || 'Error al subir archivo a Supabase' };
  }
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

    if (error) return { success: false, error: error.message };
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
        return { success: false, error: `No se pudo borrar del bucket ${BUCKET}: ${storageError.message}` };
      }
    }

    // 2. Fila en la base de datos
    const { error: dbError } = await supabase.from('archivos').delete().eq('id', archivo.id);
    if (dbError) return { success: false, error: `Se borró del bucket pero no de la tabla: ${dbError.message}` };

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

  const nombre = file.name || nombreSugerido;
  const filePath = `avatares/${usuarioId}/${Date.now()}_${rutaSegura(nombre)}`;

  try {
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(filePath, file, { cacheControl: '3600', upsert: true });

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

  const filePath = `proyecto_${proyectoId}/portada/${Date.now()}_${rutaSegura(file.name || 'portada.jpg')}`;

  try {
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(filePath, file, { cacheControl: '3600', upsert: true });

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
