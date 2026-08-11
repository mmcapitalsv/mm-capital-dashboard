import React, { useMemo } from 'react';
import { usePreferencias } from '../hooks/usePreferencias';
import { crearTraductor, localeDeIdioma } from '../i18n/diccionario';
import { PreferenciasContext } from './usePrefs';

/**
 * Contexto de preferencias de interfaz (tema + idioma).
 *
 * Se monta una sola vez en App para que Sidebar, ProfileView, ProjectDetails
 * y cualquier otro componente lean el MISMO estado. Sin esto, cada componente
 * tendría su propia copia del idioma y el toggle solo afectaría al Header.
 */

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

/* `usePrefs` vive en `./usePrefs`: este archivo solo exporta el provider. */
