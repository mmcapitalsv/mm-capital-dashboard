import React from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Download, WifiOff, X } from 'lucide-react';
import { usePrefs } from '../../context/PreferenciasContext';

/** Cada hora: una versión nueva no debería tardar un día en anunciarse. */
const INTERVALO_REVISION = 60 * 60 * 1000;

/**
 * Aviso de versión nueva del Service Worker.
 *
 * Antes la actualización era silenciosa (`skipWaiting`): el paquete nuevo tomaba
 * el control sin decir nada, y la pestaña abierta se quedaba con la mitad de la
 * aplicación vieja en memoria y la mitad nueva en el disco. El síntoma es
 * conocido —la función nueva "no aparece" en el celular, o aparece a medias— y
 * no había forma de que el usuario supiera que solo le faltaba recargar.
 *
 * Ahora el trabajador nuevo espera y se anuncia: una barra pide permiso y el
 * botón aplica el cambio recargando la aplicación completa. Es la única manera
 * de garantizar que el código y los datos en pantalla pertenecen a la misma
 * versión.
 *
 * De paso se avisa —una sola vez— cuando la aplicación queda lista para
 * trabajar sin conexión, que es lo que un panel de obra necesita saber.
 */
export default function AvisoActualizacion() {
  const { t } = usePrefs();
  const {
    offlineReady: [listaSinConexion, setListaSinConexion],
    needRefresh: [hayVersionNueva, setHayVersionNueva],
    updateServiceWorker
  } = useRegisterSW({
    onRegisteredSW(url, registro) {
      if (!registro) return;
      /* Una PWA instalada puede pasar días sin recargarse: sin esta revisión
         periódica el navegador solo busca versiones nuevas al navegar. */
      setInterval(() => { registro.update().catch(() => {}); }, INTERVALO_REVISION);
    },
    onRegisterError(error) {
      console.warn('No se pudo registrar el Service Worker:', error);
    }
  });

  if (!hayVersionNueva && !listaSinConexion) return null;

  const cerrar = () => {
    setListaSinConexion(false);
    setHayVersionNueva(false);
  };

  return (
    /* Sobre la barra inferior del móvil (68 px) para no taparla, y por encima
       de los modales de vista pero por debajo del visor a pantalla completa. */
    <div className="fixed left-1/2 -translate-x-1/2 bottom-[84px] md:bottom-6 z-[70] w-[calc(100vw-2rem)] max-w-md px-1">
      <div className="flex items-center gap-3 rounded-2xl border border-mm-oro-borde dark:border-amber-500/30 bg-white dark:bg-zinc-800 shadow-2xl px-4 py-3">
        {hayVersionNueva
          ? <Download size={18} className="text-mm-oro flex-shrink-0" />
          : <WifiOff size={18} className="text-emerald-600 flex-shrink-0" />}

        <p className="flex-1 min-w-0 text-xs font-bold text-slate-700 dark:text-zinc-100 leading-snug">
          {hayVersionNueva ? t('sw.versionNueva') : t('sw.sinConexionLista')}
        </p>

        {hayVersionNueva && (
          <button
            onClick={() => updateServiceWorker(true)}
            className="flex-shrink-0 px-3.5 py-1.5 rounded-xl bg-mm-navy text-white text-xs font-bold hover:bg-slate-800 transition-colors active:scale-95"
          >
            {t('sw.actualizar')}
          </button>
        )}

        <button
          onClick={cerrar}
          aria-label={t('comun.cerrar')}
          className="flex-shrink-0 p-1.5 rounded-lg text-slate-400 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-700 transition-colors"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
