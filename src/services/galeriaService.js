import { supabase } from '../supabaseClient';
import {
  BUCKET, esIdValidoDeSupabase, validarImagen, rutaDesdeUrl, AVISO_SIN_PERMISO,
  firmarArchivos
} from './storageService';
import { firmarRuta, firmarUrls } from '../lib/urlFirmada';
import { comprimirImagen } from '../lib/comprimirImagen';

/**
 * Álbumes de galería y sus fotos.
 *
 *   galeria_albumes  -> metadatos del álbum (título, fecha, portada)
 *   archivos         -> cada foto, con tipo='foto_galeria' y album_id
 *
 * Ambas cosas las crea la migración 002. Si todavía no se ejecutó, las
 * funciones devuelven un error legible en lugar de romper la interfaz.
 */

const TABLA_ALBUMES = 'galeria_albumes';

const AVISO_MIGRACION =
  'La galería necesita la migración 002 (tabla galeria_albumes y columna archivos.album_id). ' +
  'Ejecuta supabase/migrations/002_fase2_finanzas_galeria.sql en el SQL Editor de Supabase.';

function faltaEsquema(error) {
  if (!error) return false;
  const code = String(error.code || '');
  const msg = `${error.message || ''} ${error.details || ''}`;
  return code === '42P01' || code === 'PGRST205' || code === '42703' || code === 'PGRST204' ||
         /could not find the (table|'album_id')/i.test(msg);
}

function rutaSegura(nombre) {
  return String(nombre || 'foto').replace(/[^a-zA-Z0-9.-]/g, '_');
}

/* ─────────────────────────────── Lectura ─────────────────────────────────── */

/**
 * Devuelve los álbumes del proyecto con sus fotos ya anidadas.
 * @returns {Promise<{albumes: Array, error: string|null, requiereMigracion: boolean}>}
 */
export async function getAlbumes(proyectoId) {
  if (!esIdValidoDeSupabase(proyectoId)) {
    return { albumes: [], error: null, requiereMigracion: false };
  }

  try {
    const { data: albumes, error } = await supabase
      .from(TABLA_ALBUMES)
      .select('*')
      .eq('proyecto_id', proyectoId)
      .order('created_at', { ascending: false });

    if (error) {
      if (faltaEsquema(error)) return { albumes: [], error: AVISO_MIGRACION, requiereMigracion: true };
      return { albumes: [], error: error.message, requiereMigracion: false };
    }

    const { data: fotos, error: errFotos } = await supabase
      .from('archivos')
      .select('*')
      .eq('proyecto_id', proyectoId)
      .eq('tipo', 'foto_galeria')
      .order('created_at', { ascending: false });

    if (errFotos && faltaEsquema(errFotos)) {
      return { albumes: [], error: AVISO_MIGRACION, requiereMigracion: true };
    }

    /* Bucket privado: ni las fotos ni las portadas abren con la URL guardada
       (pública antigua o firma caducada). Se re-firma todo en dos peticiones
       —una para las fotos, otra para las portadas— antes de entregarlo. */
    const listaFotos = await firmarArchivos(Array.isArray(fotos) ? fotos : []);
    const portadas = await firmarUrls(
      (albumes || []).map(a => a?.portada_url), { bucket: BUCKET }
    );

    const conFotos = (albumes || []).map((a) => {
      const propias = listaFotos.filter(f => f && String(f.album_id || '') === String(a.id));
      const portada = a.portada_url ? portadas.get(a.portada_url) : null;
      return {
        id: a.id,
        title: a.titulo || 'Álbum sin título',
        date: a.fecha_texto || '',
        cover: portada || propias[0]?.url_archivo || null,
        /* La URL guardada tal cual: `eliminarAlbum` necesita la ruta original
           del bucket, y la firmada de `cover` también sirve, pero esta no
           depende de que la firma se haya podido emitir. */
        portadaGuardada: a.portada_url || null,
        // Autoría (migración 014): decide quién puede editarlo o borrarlo, y
        // alimenta la firma "Subido por" de la tarjeta.
        subido_por: a.subido_por || null,
        photos: propias,
        photoCount: propias.length
      };
    });

    return { albumes: conFotos, error: null, requiereMigracion: false };
  } catch (err) {
    return { albumes: [], error: err.message || 'Error leyendo la galería.', requiereMigracion: false };
  }
}

/* ─────────────────────────────── Álbumes ─────────────────────────────────── */

/** Crea un álbum. La portada es opcional y se sube desde el dispositivo. */
export async function crearAlbum(proyectoId, { titulo, fecha, portadaFile }) {
  if (!esIdValidoDeSupabase(proyectoId)) {
    return { success: false, error: 'El proyecto no existe en Supabase todavía.' };
  }
  const tituloLimpio = String(titulo || '').trim();
  if (!tituloLimpio) return { success: false, error: 'El álbum necesita un título.' };

  let portadaUrl = null;
  let portadaPath = null;

  if (portadaFile) {
    const invalida = validarImagen(portadaFile);
    if (invalida) return { success: false, error: invalida };

    const portada = await comprimirImagen(portadaFile, { ladoMax: 1600, pesoObjetivoKB: 400 });
    portadaPath = `proyecto_${proyectoId}/portadas/${Date.now()}_${rutaSegura(portada.name || portadaFile.name)}`;
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(portadaPath, portada, {
        cacheControl: '3600', upsert: true, contentType: portada.type || 'image/jpeg'
      });

    if (upErr) return { success: false, error: `No se pudo subir la portada: ${upErr.message}` };
    // Bucket privado (migración 018): enlace firmado, no público.
    portadaUrl = await firmarRuta(portadaPath, { bucket: BUCKET });
  }

  const { data, error } = await supabase
    .from(TABLA_ALBUMES)
    .insert([{
      proyecto_id: proyectoId,
      titulo: tituloLimpio,
      fecha_texto: String(fecha || '').trim(),
      portada_url: portadaUrl
    }])
    .select()
    .single();

  if (error) {
    if (portadaPath) await supabase.storage.from(BUCKET).remove([portadaPath]);
    if (faltaEsquema(error)) return { success: false, error: AVISO_MIGRACION, requiereMigracion: true };
    return { success: false, error: error.message };
  }

  return { success: true, album: data };
}

/** Actualiza título, fecha y opcionalmente la portada de un álbum existente. */
export async function actualizarAlbum(albumId, { titulo, fecha, portadaFile, proyectoId }) {
  if (!albumId) return { success: false, error: 'El álbum no tiene identificador.' };
  const tituloLimpio = String(titulo || '').trim();
  if (!tituloLimpio) return { success: false, error: 'El título no puede quedar vacío.' };

  const cambios = { titulo: tituloLimpio, fecha_texto: String(fecha || '').trim() };

  // Portada nueva: se sube antes de tocar la fila
  if (portadaFile) {
    const invalida = validarImagen(portadaFile);
    if (invalida) return { success: false, error: invalida };

    const carpeta = esIdValidoDeSupabase(proyectoId) ? `proyecto_${proyectoId}` : 'portadas';
    const portada = await comprimirImagen(portadaFile, { ladoMax: 1600, pesoObjetivoKB: 400 });
    const ruta = `${carpeta}/portadas/${Date.now()}_${rutaSegura(portada.name || portadaFile.name)}`;

    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(ruta, portada, {
        cacheControl: '3600', upsert: true, contentType: portada.type || 'image/jpeg'
      });

    if (upErr) return { success: false, error: `No se pudo subir la portada: ${upErr.message}` };

    cambios.portada_url = await firmarRuta(ruta, { bucket: BUCKET });
  }

  const { data, error } = await supabase
    .from(TABLA_ALBUMES)
    .update(cambios)
    .eq('id', albumId)
    .select();

  if (error) {
    if (faltaEsquema(error)) return { success: false, error: AVISO_MIGRACION, requiereMigracion: true };
    return { success: false, error: error.message };
  }
  // Cero filas actualizadas = la política de autoría lo dejó fuera, no un fallo.
  if (!data || data.length === 0) return { success: false, error: AVISO_SIN_PERMISO };

  return { success: true };
}

/**
 * Elimina el álbum, sus fotos del bucket y sus registros.
 *
 * Quien creó el álbum puede borrarlo, pero no arrastrarse por delante las
 * fotos que subieron otros: si hay alguna ajena, se para aquí y se dice. El
 * Administrador sí puede con todo. Sin esta comprobación el borrado avanzaba
 * a medias —Storage rechazaba las fotos ajenas, RLS descartaba sus filas— y
 * dejaba el álbum vacío por fuera y a medio existir por dentro.
 *
 * @param {object} album  álbum tal como lo devuelve `getAlbumes`
 * @param {{userId?: string, esAdmin?: boolean}} [quien]
 */
export async function eliminarAlbum(album, { userId, esAdmin } = {}) {
  if (!album?.id) return { success: false, error: 'El álbum no tiene identificador.' };

  if (!esAdmin) {
    const ajenas = (album.photos || []).filter(
      f => f && String(f.subido_por || '') !== String(userId || '')
    );
    if (ajenas.length > 0) {
      return {
        success: false,
        error: `Este álbum tiene ${ajenas.length} foto(s) subidas por otras personas. ` +
               'Solo el Administrador puede eliminarlo completo.'
      };
    }
  }

  const rutas = (album.photos || [])
    .map(f => f.storage_path || rutaDesdeUrl(f.url_archivo))
    .filter(Boolean);

  const rutaPortada = rutaDesdeUrl(album.portadaGuardada || album.cover);
  if (rutaPortada && !rutas.includes(rutaPortada)) rutas.push(rutaPortada);

  if (rutas.length > 0) {
    const { error } = await supabase.storage.from(BUCKET).remove(rutas);
    if (error) return { success: false, error: `No se pudieron borrar las fotos del bucket: ${error.message}` };
  }

  // Las fotos de `archivos` se borran explícitamente: album_id usa ON DELETE SET NULL,
  // así que sin esto quedarían huérfanas en la tabla.
  const ids = (album.photos || []).map(f => f.id).filter(Boolean);
  if (ids.length > 0) await supabase.from('archivos').delete().in('id', ids);

  /* `.select()` devuelve lo borrado: cuando RLS filtra la fila no hay error,
     solo cero filas, y sin esto el borrado parecería haber funcionado. */
  const { data, error } = await supabase
    .from(TABLA_ALBUMES).delete().eq('id', album.id).select();
  if (error) return { success: false, error: error.message };
  if (!data || data.length === 0) return { success: false, error: AVISO_SIN_PERMISO };

  return { success: true };
}

/* ──────────────────────────────── Fotos ──────────────────────────────────── */

/** Sube una foto al bucket y la registra dentro del álbum indicado. */
export async function subirFotoAlbum(file, proyectoId, albumId) {
  const invalida = validarImagen(file);
  if (invalida) return { success: false, error: invalida };
  if (!esIdValidoDeSupabase(proyectoId)) {
    return { success: false, error: 'El proyecto no existe en Supabase todavía.' };
  }

  const foto = await comprimirImagen(file, { ladoMax: 1920, pesoObjetivoKB: 600 });
  const filePath = `proyecto_${proyectoId}/galeria/${Date.now()}_${rutaSegura(foto.name || file.name)}`;

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(filePath, foto, {
      cacheControl: '3600', upsert: true, contentType: foto.type || 'image/jpeg'
    });

  if (upErr) return { success: false, error: `No se pudo subir la foto: ${upErr.message}` };

  const url = await firmarRuta(filePath, { bucket: BUCKET });

  const { data, error } = await supabase
    .from('archivos')
    .insert([{
      proyecto_id: proyectoId,
      album_id: albumId || null,
      nombre_archivo: file.name,
      tipo: 'foto_galeria',
      url_archivo: url,
      storage_path: filePath
    }])
    .select()
    .single();

  if (error) {
    await supabase.storage.from(BUCKET).remove([filePath]);
    if (faltaEsquema(error)) return { success: false, error: AVISO_MIGRACION, requiereMigracion: true };
    return { success: false, error: error.message };
  }

  return { success: true, foto: data, url };
}

/** Elimina una foto concreta del bucket y de la tabla. */
export async function eliminarFoto(foto) {
  if (!foto?.id) return { success: false, error: 'La foto no tiene identificador.' };

  const path = foto.storage_path || rutaDesdeUrl(foto.url_archivo);
  if (path) {
    const { error } = await supabase.storage.from(BUCKET).remove([path]);
    if (error) return { success: false, error: `No se pudo borrar del bucket: ${error.message}` };
  }

  const { data, error } = await supabase.from('archivos').delete().eq('id', foto.id).select();
  if (error) return { success: false, error: `Se borró del bucket pero no de la tabla: ${error.message}` };
  if (!data || data.length === 0) return { success: false, error: AVISO_SIN_PERMISO };

  return { success: true };
}
