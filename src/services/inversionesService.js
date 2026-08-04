import { supabase } from '../supabaseClient';
import { esIdValidoDeSupabase } from './storageService';
import { tituloCase } from '../lib/formato';

/**
 * Aportaciones de capital: relación usuario_id ↔ proyecto_id ↔ monto.
 * La tabla la crea la migración 003.
 *
 * Regla del módulo: para aparecer en Inversionistas hay que existir en
 * `usuarios`. No hay inversionistas "sueltos".
 */

const TABLA = 'aportaciones';

export const AVISO_MIGRACION_003 =
  'Falta la tabla `aportaciones`. Ejecuta supabase/migrations/003_inversiones.sql ' +
  'en el SQL Editor de Supabase.';

function faltaTabla(error) {
  if (!error) return false;
  const code = String(error.code || '');
  const msg = `${error.message || ''} ${error.details || ''}`;
  return code === '42P01' || code === 'PGRST205' || /could not find the table/i.test(msg);
}

/* ─────────────────────────────── Lectura ─────────────────────────────────── */

/**
 * Devuelve los inversionistas con su capital total y el desglose por proyecto.
 * Solo incluye usuarios que existen en `usuarios` (la FK lo garantiza).
 *
 * @returns {Promise<{inversionistas: Array, error: string|null, requiereMigracion: boolean}>}
 */
export async function getInversionistas() {
  try {
    const { data, error } = await supabase
      .from(TABLA)
      .select(`
        id, monto, fecha, nota, usuario_id, proyecto_id,
        usuarios ( id, nombre_completo, email, rol, avatar_url ),
        proyectos ( id, nombre )
      `)
      .order('monto', { ascending: false });

    if (error) {
      if (faltaTabla(error)) {
        return { inversionistas: [], error: AVISO_MIGRACION_003, requiereMigracion: true };
      }
      return { inversionistas: [], error: error.message, requiereMigracion: false };
    }

    // Agrupar por usuario
    const porUsuario = new Map();

    for (const fila of (data || [])) {
      if (!fila?.usuarios) continue;          // aportación sin usuario válido
      const u = fila.usuarios;

      if (!porUsuario.has(u.id)) {
        porUsuario.set(u.id, {
          id: u.id,
          // Title Case: la base guarda nombres en mayúscula sostenida
          nombre: tituloCase(u.nombre_completo || (u.email || '').split('@')[0]) || 'Usuario',
          email: u.email || '',
          rol: u.rol || '',
          avatarUrl: u.avatar_url || null,
          aportaciones: [],
          total: 0
        });
      }

      const inv = porUsuario.get(u.id);
      const monto = Number(fila.monto) || 0;

      inv.aportaciones.push({
        id: fila.id,
        proyectoId: fila.proyecto_id,
        proyecto: fila.proyectos?.nombre || '',
        monto,
        fecha: fila.fecha || null,
        nota: fila.nota || ''
      });
      inv.total += monto;
    }

    const inversionistas = [...porUsuario.values()].sort((a, b) => b.total - a.total);
    return { inversionistas, error: null, requiereMigracion: false };
  } catch (err) {
    return {
      inversionistas: [],
      error: err.message || 'Error leyendo las aportaciones.',
      requiereMigracion: false
    };
  }
}

/* ─────────────────────────────── Escritura ───────────────────────────────── */

/** Registra una aportación de un usuario a un proyecto. */
export async function registrarInversion({ usuarioId, proyectoId, monto, fecha, nota }) {
  if (!esIdValidoDeSupabase(usuarioId)) {
    return { success: false, error: 'Selecciona un usuario registrado.' };
  }
  if (!esIdValidoDeSupabase(proyectoId)) {
    return { success: false, error: 'Selecciona un proyecto válido.' };
  }

  const importe = Number(String(monto).replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(importe) || importe <= 0) {
    return { success: false, error: 'El monto debe ser un número mayor que cero.' };
  }

  const { data, error } = await supabase
    .from(TABLA)
    .insert([{
      usuario_id: usuarioId,
      proyecto_id: proyectoId,
      monto: importe,
      fecha: fecha || new Date().toISOString().slice(0, 10),
      nota: String(nota || '').trim()
    }])
    .select()
    .single();

  if (error) {
    if (faltaTabla(error)) return { success: false, error: AVISO_MIGRACION_003, requiereMigracion: true };
    // 23505 = ya existe una aportación idéntica (mismo usuario, proyecto, monto y fecha)
    if (String(error.code) === '23505') {
      return { success: false, error: 'Ya existe una aportación idéntica registrada hoy para ese proyecto.' };
    }
    return { success: false, error: error.message };
  }

  return { success: true, aportacion: data };
}

/** Actualiza el monto o la nota de una aportación existente. */
export async function actualizarInversion(id, { monto, nota }) {
  if (!id) return { success: false, error: 'La aportación no tiene identificador.' };

  const importe = Number(String(monto).replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(importe) || importe <= 0) {
    return { success: false, error: 'El monto debe ser un número mayor que cero.' };
  }

  const { error } = await supabase
    .from(TABLA)
    .update({ monto: importe, nota: String(nota || '').trim() })
    .eq('id', id);

  if (error) return { success: false, error: error.message };
  return { success: true };
}

/** Elimina una aportación. */
export async function eliminarInversion(id) {
  if (!id) return { success: false, error: 'La aportación no tiene identificador.' };
  const { error } = await supabase.from(TABLA).delete().eq('id', id);
  if (error) return { success: false, error: error.message };
  return { success: true };
}

/* ───────────────────────── Usuarios (CRUD de admin) ──────────────────────── */

/** Lista los usuarios reales de la tabla `usuarios`. */
export async function getUsuarios() {
  const { data, error } = await supabase
    .from('usuarios')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) return { usuarios: [], error: error.message };

  const usuarios = (Array.isArray(data) ? data : [])
    .filter(Boolean)
    .map(u => ({ ...u, nombre_completo: tituloCase(u.nombre_completo) || u.nombre_completo }));

  return { usuarios, error: null };
}

/**
 * Crea la ficha de un usuario.
 *
 * Nota importante: esto NO crea una cuenta de acceso (auth.users) — el alta en
 * Auth requiere la service_role key y no puede hacerse desde el navegador.
 * Crea la ficha para poder asignarle rol e inversiones; cuando la persona se
 * registre con ese mismo correo, el trigger de la migración 001 respeta la
 * fila existente.
 */
export async function crearUsuario({ nombre, email, rol }) {
  const correo = String(email || '').trim().toLowerCase();
  const nombreLimpio = String(nombre || '').trim();

  if (!correo || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) {
    return { success: false, error: 'Escribe un correo electrónico válido.' };
  }
  if (!nombreLimpio) return { success: false, error: 'El nombre no puede quedar vacío.' };

  const { data, error } = await supabase
    .from('usuarios')
    .insert([{ nombre_completo: nombreLimpio, email: correo, rol: rol || 'inversionista' }])
    .select()
    .single();

  if (error) {
    if (String(error.code) === '23505') {
      return { success: false, error: 'Ya existe un usuario con ese correo.' };
    }
    return { success: false, error: error.message };
  }
  return { success: true, usuario: data };
}

/** Actualiza nombre, correo y rol de un usuario. */
export async function actualizarUsuario(id, { nombre, email, rol }) {
  if (!id) return { success: false, error: 'El usuario no tiene identificador.' };

  const cambios = {};
  if (nombre !== undefined) {
    const n = String(nombre).trim();
    if (!n) return { success: false, error: 'El nombre no puede quedar vacío.' };
    cambios.nombre_completo = n;
  }
  if (email !== undefined) {
    const c = String(email).trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c)) {
      return { success: false, error: 'Escribe un correo electrónico válido.' };
    }
    cambios.email = c;
  }
  if (rol !== undefined) cambios.rol = rol;

  const { error } = await supabase.from('usuarios').update(cambios).eq('id', id);

  if (error) {
    if (String(error.code) === '23505') {
      return { success: false, error: 'Ya existe otro usuario con ese correo.' };
    }
    return { success: false, error: error.message };
  }
  return { success: true };
}

/** Elimina la ficha de un usuario (sus aportaciones caen por ON DELETE CASCADE). */
export async function eliminarUsuario(id, propioId) {
  if (!id) return { success: false, error: 'El usuario no tiene identificador.' };
  if (id === propioId) {
    return { success: false, error: 'No puedes eliminar tu propia cuenta de administrador.' };
  }
  const { error } = await supabase.from('usuarios').delete().eq('id', id);
  if (error) return { success: false, error: error.message };
  return { success: true };
}
