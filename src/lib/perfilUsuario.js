/**
 * Identidad del usuario en pantalla: saludo por hora, nombre y cargo.
 *
 * Nada de datos fijos: el nombre sale de la ficha de `usuarios` (o, en su
 * defecto, de los metadatos de Auth y del correo) y el cargo del rol real.
 */

import { tituloCase } from './formato';

/** Tratamientos que ya vienen escritos en el nombre y no se duplican. */
const TRATAMIENTOS = /^(ing|inga|arq|lic|licda|dr|dra|sr|sra)\.?\s+/i;

/**
 * Clave del saludo según la hora local.
 * 06:00–11:59 días · 12:00–17:59 tardes · 18:00–05:59 noches.
 */
export function claveSaludo(fecha = new Date()) {
  const h = fecha.getHours();
  if (h >= 6 && h < 12) return 'dash.saludoDia';
  if (h >= 12 && h < 18) return 'dash.saludoTarde';
  return 'dash.saludoNoche';
}

/** "juan.carlos@dominio.com" -> "Juan Carlos" (último recurso). */
function nombreDesdeCorreo(email) {
  const local = String(email || '').split('@')[0];
  if (!local) return '';
  return tituloCase(
    local.replace(/[._-]+/g, ' ').replace(/\d+/g, ' ')
  );
}

/** Nombre tal como está guardado, sin formatear. */
function nombreBruto(user, perfil) {
  return String(
    perfil?.nombre_completo ||
    user?.user_metadata?.nombre_completo ||
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    ''
  ).trim();
}

/**
 * Nombre limpio, sin tratamiento (para el chat y las iniciales).
 * Siempre en Title Case: la base guarda cosas como "GIOVANNI MORALES".
 */
export function nombreSimple(user, perfil) {
  const bruto = nombreBruto(user, perfil);
  const base = bruto || nombreDesdeCorreo(perfil?.email || user?.email);
  return tituloCase(base.replace(TRATAMIENTOS, '').trim());
}

/** Nombre para mostrar, con tratamiento profesional ("Ing. Giovanni Morales"). */
export function nombreMostrado(user, perfil) {
  const bruto = nombreBruto(user, perfil);

  // Ya trae tratamiento ("ING. GIOVANNI MORALES"): solo se normaliza la caja.
  if (TRATAMIENTOS.test(bruto)) return tituloCase(bruto);

  const base = bruto || nombreDesdeCorreo(perfil?.email || user?.email);
  if (!base) return 'Usuario MM Capital';
  return `Ing. ${tituloCase(base)}`;
}

/** Iniciales del nombre real (dos letras) para el avatar sin foto. */
export function inicialesUsuario(user, perfil) {
  const partes = nombreSimple(user, perfil).split(/\s+/).filter(Boolean);
  if (partes.length === 0) {
    const email = String(perfil?.email || user?.email || '');
    return email ? email.substring(0, 2).toUpperCase() : 'MM';
  }
  const primera = partes[0][0] || '';
  const segunda = partes.length > 1 ? partes[partes.length - 1][0] || '' : partes[0][1] || '';
  return `${primera}${segunda}`.toUpperCase();
}

/** Cargo por rol; si la ficha trae `cargo` escrito a mano, ese manda. */
const CARGO_POR_ROL = {
  admin: 'cargo.admin',
  socio_administrador: 'cargo.socioAdministrativo',
  socio_director: 'cargo.socioInversionista',
  inversionista: 'cargo.socioInversionista'
};

/**
 * Cargos nominativos: personas cuya posición societaria es específica y no se
 * deduce del rol técnico de la aplicación.
 */
const CARGOS_NOMINATIVOS = [
  {
    // Juan Carlos Meléndez — con o sin tratamiento y sin depender de acentos
    coincide: /juan\s*carlos.*mel[eé]ndez/i,
    // Clave, no texto: el cargo se traduce como cualquier otro rótulo
    clave: 'cargo.propietarioRepresentante'
  }
];

/**
 * Devuelve `{ texto }` si el cargo viene literal (de la base o del catálogo
 * nominativo), o `{ clave }` para traducir. La UI resuelve: `texto || t(clave)`.
 */
export function cargoUsuario(rol, perfil, user) {
  const nombre = nombreSimple(user, perfil);
  const nominativo = CARGOS_NOMINATIVOS.find(c => c.coincide.test(nombre));
  if (nominativo) return { texto: null, clave: nominativo.clave };

  const literal = String(perfil?.cargo || '').trim();
  if (literal) return { texto: literal, clave: null };
  return { texto: null, clave: CARGO_POR_ROL[rol] || 'cargo.socioInversionista' };
}

/** Solo el Administrador puede tocar los checks de avance de los proyectos. */
export function puedeEditarHitos(rol) {
  return rol === 'admin';
}
