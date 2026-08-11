import { createContext, useContext } from 'react';
import { crearTraductor, localeDeIdioma } from '../i18n/diccionario';

/**
 * Contexto de preferencias de interfaz (tema + idioma) y su hook de lectura.
 *
 * Vive APARTE del archivo del provider a propósito: un módulo que exporta
 * componentes y además funciones sueltas queda fuera del Fast Refresh de Vite,
 * y `PreferenciasContext.jsx` lo consume media aplicación. Aquí solo hay
 * contexto y hook, así que el provider vuelve a recargarse en caliente.
 */
export const PreferenciasContext = createContext(null);

/**
 * Devuelve { modoOscuro, alternarTema, language, alternarIdioma, t }.
 * Fuera del provider entrega valores neutros en español para que un
 * componente aislado (o un test) no reviente.
 */
export function usePrefs() {
  const ctx = useContext(PreferenciasContext);
  if (ctx) return ctx;

  return {
    modoOscuro: false,
    alternarTema: () => {},
    language: 'es',
    setLanguage: () => {},
    alternarIdioma: () => {},
    t: crearTraductor('es'),
    locale: localeDeIdioma('es')
  };
}
