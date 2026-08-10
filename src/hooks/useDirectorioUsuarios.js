import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { tituloCase } from '../lib/formato';

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
    cachePromesa = supabase
      .from('usuarios')
      .select('id, nombre_completo, email')
      .then(({ data, error }) => {
        if (error) {
          // Un fallo no se cachea: la siguiente vista vuelve a intentarlo.
          cachePromesa = null;
          console.warn('No se pudo leer el directorio de usuarios:', error.message);
          return {};
        }
        const mapa = {};
        for (const u of (data || [])) {
          if (!u?.id) continue;
          mapa[String(u.id)] = tituloCase(u.nombre_completo) || (u.email || '').split('@')[0] || '';
        }
        cacheDirectorio = mapa;
        return mapa;
      });
  }
  return cachePromesa;
}

/**
 * @returns {{ nombreDe: (id: string|null) => string|null, directorio: object }}
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

  const nombreDe = (id) => (id ? directorio[String(id)] || null : null);

  return { nombreDe, directorio };
}
