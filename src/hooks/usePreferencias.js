import { useState, useEffect, useCallback } from 'react';

/**
 * Preferencias de interfaz del usuario (tema e idioma), persistidas en
 * localStorage. Se leen de forma síncrona en el primer render para que la
 * aplicación no parpadee del tema claro al oscuro al recargar.
 */

const CLAVE_TEMA = 'mmcapital:tema';
const CLAVE_IDIOMA = 'mmcapital:idioma';

const IDIOMAS_VALIDOS = ['es', 'en'];

/** localStorage puede fallar (modo privado de Safari, cookies bloqueadas). */
function leerAlmacenamiento(clave) {
  try {
    return window.localStorage.getItem(clave);
  } catch {
    return null;
  }
}

function escribirAlmacenamiento(clave, valor) {
  try {
    window.localStorage.setItem(clave, valor);
  } catch {
    // Sin persistencia disponible: la preferencia solo dura la sesión actual.
  }
}

/** Aplica o quita la clase `dark` en <html>, que es lo que lee Tailwind. */
function aplicarTema(esOscuro) {
  const raiz = document.documentElement;
  raiz.classList.toggle('dark', esOscuro);
  raiz.style.colorScheme = esOscuro ? 'dark' : 'light';
}

function temaInicial() {
  const guardado = leerAlmacenamiento(CLAVE_TEMA);
  if (guardado === 'dark') return true;
  if (guardado === 'light') return false;
  // Sin preferencia guardada: se respeta la del sistema operativo.
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

function idiomaInicial() {
  const guardado = leerAlmacenamiento(CLAVE_IDIOMA);
  return IDIOMAS_VALIDOS.includes(guardado) ? guardado : 'es';
}

/**
 * @param {object}  opciones
 * @param {boolean} opciones.forzarClaro  Ignora la preferencia y muestra el
 *   tema claro (se usa en la pantalla de inicio de sesión). La preferencia
 *   guardada NO se pierde: al entrar, el modo oscuro vuelve solo.
 */
export function usePreferencias({ forzarClaro = false } = {}) {
  const [modoOscuro, setModoOscuro] = useState(temaInicial);
  const [language, setLanguage] = useState(idiomaInicial);

  // Lo que realmente se pinta en pantalla
  const oscuroEfectivo = modoOscuro && !forzarClaro;

  // Tema -> clase en <html> + localStorage
  useEffect(() => {
    aplicarTema(oscuroEfectivo);
    // Se persiste la PREFERENCIA, no el tema forzado de la pantalla de login
    escribirAlmacenamiento(CLAVE_TEMA, modoOscuro ? 'dark' : 'light');
  }, [oscuroEfectivo, modoOscuro]);

  // Idioma -> atributo lang de <html> + localStorage
  useEffect(() => {
    document.documentElement.setAttribute('lang', language);
    escribirAlmacenamiento(CLAVE_IDIOMA, language);
  }, [language]);

  const alternarTema = useCallback(() => setModoOscuro(previo => !previo), []);

  const alternarIdioma = useCallback(
    () => setLanguage(previo => (previo === 'es' ? 'en' : 'es')),
    []
  );

  return { modoOscuro, alternarTema, language, setLanguage, alternarIdioma };
}
