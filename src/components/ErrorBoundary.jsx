import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { usePrefs } from '../context/usePrefs';

/**
 * Red de seguridad contra la pantalla en blanco.
 *
 * Un error al renderizar —o el `import()` de una vista diferida que no llega
 * porque se cayó la red a mitad de la descarga— desmonta TODO el árbol de
 * React y deja la página literalmente vacía: sin menú, sin botón de volver y
 * sin ninguna pista de qué pasó. En una PWA instalada eso parece la aplicación
 * rota, no una conexión mala.
 *
 * Con el límite puesto, el fallo se queda contenido en la vista que lo produjo:
 * el resto del panel sigue en pie y el usuario tiene dos salidas —reintentar
 * (que vuelve a montar la vista, y con ella a reintentar la descarga) o
 * recargar la aplicación entera.
 *
 * Tiene que ser una clase: `componentDidCatch` no existe como hook.
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, clave: props.claveReinicio };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  /* Cambiar de vista limpia el error: si no, una vista rota dejaría el aviso
     pegado para siempre aunque el usuario ya se haya ido a otra pantalla. Se
     resuelve DURANTE el render (y no en `componentDidUpdate`) para no encadenar
     un segundo render con el aviso todavía en pantalla. */
  static getDerivedStateFromProps(props, estado) {
    if (props.claveReinicio === estado.clave) return null;
    return { error: null, clave: props.claveReinicio };
  }

  componentDidCatch(error, info) {
    // El detalle técnico va a la consola: la pantalla enseña el mensaje humano.
    console.error('Error no controlado en la interfaz:', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <AvisoDeFallo onReintentar={() => this.setState({ error: null })} />;
  }
}

/**
 * Cara visible del fallo. Va en su propio componente de función para poder
 * traducirse con `usePrefs()`, que una clase no puede consumir.
 */
function AvisoDeFallo({ onReintentar }) {
  const { t } = usePrefs();
  return (
    <div className="flex-1 flex items-center justify-center p-6 bg-white dark:bg-zinc-900">
      <div className="max-w-sm text-center">
        <AlertTriangle size={38} className="text-red-500 mx-auto mb-3" />
        <p className="text-sm font-bold text-slate-900 dark:text-white">{t('err.vistaTitulo')}</p>
        <p className="text-xs text-slate-500 dark:text-zinc-300 mt-1.5 leading-relaxed">
          {t('err.vistaDetalle')}
        </p>
        <div className="mt-4 flex items-center justify-center gap-2">
          <button
            onClick={onReintentar}
            className="px-4 py-2 rounded-xl bg-mm-navy text-white text-xs font-bold hover:bg-slate-800 transition-colors active:scale-95"
          >
            {t('err.reintentar')}
          </button>
          <button
            onClick={() => window.location.reload()}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-gray-200 dark:border-zinc-700 text-slate-600 dark:text-zinc-200 text-xs font-bold hover:bg-slate-50 dark:hover:bg-zinc-800 transition-colors active:scale-95"
          >
            <RefreshCw size={13} /> {t('err.recargar')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ErrorBoundary;
