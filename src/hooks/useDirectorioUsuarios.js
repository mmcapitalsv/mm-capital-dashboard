import { useEffect, useState } from 'react';
import { tituloCase } from '../lib/formato';
import { leerTablaCompleta } from '../lib/supabasePaginado';

/**
 * Directorio { id -> nombre } de las personas registradas.
 *
 * Lo usan la Bóveda, los Documentos del proyecto y la Galería para poner el
 * "Subido por: Ing. Giovanni Morales" debajo de cada archivo. Desde que
 * cualquier usuario puede subir (migración 014), la autoría dejó de ser un
 * detalle: es lo que explica por qué unos archivos se pueden borrar y otros no.
 *
 * La lista se pide UNA vez por sesión y se comparte entre todas las vistas: son
 * cuatro o cinco filas que cambian con muy poca frecuencia, y pedirlas en cada
 * montaje multiplicaba la misma consulta por cada pantalla abierta.
 */

let cachePromesa = null;
let cacheDirectorio = null;

/** Fuerza que la próxima lectura vuelva a la base (alta o cambio de nombre). */
export function olvidarDirectorio() {
  cachePromesa = null;
  cacheDirectorio = null;
}

function pedirDirectorio() {
  if (!cachePromesa) {
    // Paginado con conteo exacto: pasadas las 1,000 fichas, PostgREST recorta
    // sin avisar y los archivos de quien quedara fuera saldrían sin firma.
    // `rol` viaja con el nombre: la Galería firma «Admin» al administrador
    // principal en lugar de su nombre propio.
    cachePromesa = leerTablaCompleta('usuarios', 'id, nombre_completo, email, rol')
      .then(({ filas }) => {
        const mapa = {};
        for (const u of filas) {
          if (!u?.id) continue;
          mapa[String(u.id)] = {
            nombre: tituloCase(u.nombre_completo) || (u.email || '').split('@')[0] || '',
            rol: String(u.rol || '')
          };
        }
        cacheDirectorio = mapa;
        return mapa;
      })
      .catch((err) => {
        // Un fallo no se cachea: la siguiente vista vuelve a intentarlo.
        cachePromesa = null;
        console.warn('No se pudo leer el directorio de usuarios:', err?.message || err);
        return {};
      });
  }
  return cachePromesa;
}

/**
 * @returns {{
 *   nombreDe: (id: string|null) => string|null,
 *   esAdminPrincipal: (id: string|null) => boolean,
 *   directorio: object
 * }}
 *   `nombreDe` devuelve null cuando no hay autor conocido: la vista decide qué
 *   poner en su lugar (los archivos anteriores a la 014 no tienen firma).
 */
export function useDirectorioUsuarios() {
  const [directorio, setDirectorio] = useState(cacheDirectorio || {});

  useEffect(() => {
    let vivo = true;
    pedirDirectorio().then(mapa => { if (vivo) setDirectorio(mapa); });
    return () => { vivo = false; };
  }, []);

  const nombreDe = (id) => (id ? directorio[String(id)]?.nombre || null : null);

  /* El administrador principal es el único con `rol = 'admin'` (los demás son
     socios). Es la misma comprobación que hace `public.es_admin()` en la base. */
  const esAdminPrincipal = (id) => (id ? directorio[String(id)]?.rol === 'admin' : false);

  return { nombreDe, esAdminPrincipal, directorio };
}
