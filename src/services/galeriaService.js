import { supabase } from '../supabaseClient';
import {
  BUCKET, esIdValidoDeSupabase, validarImagen, rutaDesdeUrl
} from './storageService';
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

    const listaFotos = Array.isArray(fotos) ? fotos : [];

    const conFotos = (albumes || []).map((a) => {
      const propias = listaFotos.filter(f => f && String(f.album_id || '') === String(a.id));
      return {
        id: a.id,
        title: a.titulo || 'Álbum sin título',
        date: a.fecha_texto || '',
        cover: a.portada_url || propias[0]?.url_archivo || null,
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
    portadaUrl = supabase.storage.from(BUCKET).getPublicUrl(portadaPath).data?.publicUrl || null;
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

    cambios.portada_url = supabase.storage.from(BUCKET).getPublicUrl(ruta).data?.publicUrl || null;
  }

  const { error } = await supabase
    .from(TABLA_ALBUMES)
    .update(cambios)
    .eq('id', albumId);

  if (error) {
    if (faltaEsquema(error)) return { success: false, error: AVISO_MIGRACION, requiereMigracion: true };
    return { success: false, error: error.message };
  }
  return { success: true };
}

/** Elimina el álbum, sus fotos del bucket y sus registros. */
export async function eliminarAlbum(album) {
  if (!album?.id) return { success: false, error: 'El álbum no tiene identificador.' };

  const rutas = (album.photos || [])
    .map(f => f.storage_path || rutaDesdeUrl(f.url_archivo))
    .filter(Boolean);

  const rutaPortada = rutaDesdeUrl(album.cover);
  if (rutaPortada && !rutas.includes(rutaPortada)) rutas.push(rutaPortada);

  if (rutas.length > 0) {
    const { error } = await supabase.storage.from(BUCKET).remove(rutas);
    if (error) return { success: false, error: `No se pudieron borrar las fotos del bucket: ${error.message}` };
  }

  // Las fotos de `archivos` se borran explícitamente: album_id usa ON DELETE SET NULL,
  // así que sin esto quedarían huérfanas en la tabla.
  const ids = (album.photos || []).map(f => f.id).filter(Boolean);
  if (ids.length > 0) await supabase.from('archivos').delete().in('id', ids);

  const { error } = await supabase.from(TABLA_ALBUMES).delete().eq('id', album.id);
  if (error) return { success: false, error: error.message };

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

  const url = supabase.storage.from(BUCKET).getPublicUrl(filePath).data?.publicUrl || null;

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

  const { error } = await supabase.from('archivos').delete().eq('id', foto.id);
  if (error) return { success: false, error: `Se borró del bucket pero no de la tabla: ${error.message}` };

  return { success: true };
}
