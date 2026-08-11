import React, { createContext, useContext, useMemo } from 'react';
import { usePreferencias } from '../hooks/usePreferencias';
import { crearTraductor, localeDeIdioma } from '../i18n/diccionario';

/**
 * Contexto de preferencias de interfaz (tema + idioma).
 *
 * Se monta una sola vez en App para que Sidebar, ProfileView, ProjectDetails
 * y cualquier otro componente lean el MISMO estado. Sin esto, cada componente
 * tendría su propia copia del idioma y el toggle solo afectaría al Header.
 */

const PreferenciasContext = createContext(null);

export function PreferenciasProvider({ children, forzarClaro = false }) {
  /* Se desestructura en vez de esparcir el objeto entero: `usePreferencias`
     devuelve uno nuevo en cada render, así que `{...prefs}` obligaba a listar
     sus campos a mano en las dependencias —lo que el linter marca como lista
     incompleta— y bastaba olvidar uno para servir un valor rancio. */
  const {
    modoOscuro, alternarTema, language, setLanguage, alternarIdioma
  } = usePreferencias({ forzarClaro });

  // El traductor solo se recrea cuando cambia el idioma
  const t = useMemo(() => crearTraductor(language), [language]);

  // Locale de fechas/números acorde al idioma activo
  const locale = localeDeIdioma(language);

  const valor = useMemo(
    () => ({ modoOscuro, alternarTema, language, setLanguage, alternarIdioma, t, locale }),
    [modoOscuro, alternarTema, language, setLanguage, alternarIdioma, t, locale]
  );

  return (
    <PreferenciasContext.Provider value={valor}>
      {children}
    </PreferenciasContext.Provider>
  );
}

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
