import React, { useEffect, useRef, useCallback } from 'react';
import { X, AlertTriangle, Loader2 } from 'lucide-react';
import { usePrefs } from '../../context/usePrefs';

/**
 * Modal accesible, único para toda la aplicación.
 *
 * Antes había una docena de modales escritos a mano y ninguno declaraba
 * `role="dialog"`, ninguno atrapaba el foco, ninguno cerraba con Escape y el
 * fondo seguía haciendo scroll por detrás. Tabulando dentro de un modal el foco
 * se escapaba a los botones de la pantalla de abajo.
 *
 * Aquí se resuelve una vez:
 *   · `role="dialog"` + `aria-modal` + título asociado por `aria-labelledby`
 *   · Escape cierra
 *   · el foco queda atrapado dentro y vuelve a su origen al cerrar
 *   · el fondo no hace scroll mientras el modal está abierto
 */

let contadorId = 0;

export default function Modal({
  abierto,
  onCerrar,
  titulo,
  icono: Icono,
  children,
  pie,
  ancho = 'max-w-md',
  cerrableAlFondo = true
}) {
  const { t } = usePrefs();
  const cajaRef = useRef(null);
  const focoPrevio = useRef(null);
  const idTitulo = useRef(`modal-titulo-${++contadorId}`);

  /** Elementos que pueden recibir foco dentro del modal, en orden. */
  const enfocables = useCallback(() => {
    if (!cajaRef.current) return [];
    return [...cajaRef.current.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )].filter(el => el.offsetParent !== null);
  }, []);

  useEffect(() => {
    if (!abierto) return;

    // Se recuerda quién tenía el foco para devolvérselo al cerrar
    focoPrevio.current = document.activeElement;

    // El fondo no se mueve mientras el modal está abierto
    const overflowPrevio = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Primer elemento enfocable, o la propia caja
    const inicial = enfocables()[0] || cajaRef.current;
    inicial?.focus?.();

    const alPulsar = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onCerrar?.(); return; }
      if (e.key !== 'Tab') return;

      // Foco atrapado: al salir por un extremo se vuelve por el otro
      const lista = enfocables();
      if (lista.length === 0) { e.preventDefault(); return; }
      const primero = lista[0];
      const ultimo = lista[lista.length - 1];

      if (e.shiftKey && document.activeElement === primero) {
        e.preventDefault(); ultimo.focus();
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault(); primero.focus();
      }
    };

    document.addEventListener('keydown', alPulsar, true);
    return () => {
      document.removeEventListener('keydown', alPulsar, true);
      document.body.style.overflow = overflowPrevio;
      focoPrevio.current?.focus?.();
    };
  }, [abierto, onCerrar, enfocables]);

  if (!abierto) return null;

  return (
    <div
      className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onMouseDown={(e) => {
        if (cerrableAlFondo && e.target === e.currentTarget) onCerrar?.();
      }}
    >
      <div
        ref={cajaRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo.current}
        tabIndex={-1}
        className={`bg-white dark:bg-zinc-800 rounded-3xl w-full ${ancho} shadow-2xl border border-gray-100 dark:border-zinc-700 flex flex-col max-h-[88vh] focus:outline-none`}
      >
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-gray-100 dark:border-zinc-700 flex-shrink-0">
          <h3 id={idTitulo.current} className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2 min-w-0">
            {Icono && <Icono size={18} className="text-mm-oro flex-shrink-0" />}
            <span className="truncate">{titulo}</span>
          </h3>
          <button
            type="button"
            onClick={onCerrar}
            aria-label={t('comun.cerrar')}
            className="text-mm-3 hover:text-slate-700 dark:hover:text-white transition-colors flex-shrink-0"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 min-h-0">{children}</div>

        {pie && (
          <div className="px-6 py-4 border-t border-gray-100 dark:border-zinc-700 flex justify-end gap-2 flex-shrink-0">
            {pie}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Confirmación destructiva, en sustitución de `confirm()` del navegador.
 *
 * Los diálogos nativos son grises, del sistema, no admiten estilo y en iOS
 * aparecen encabezados con la URL del sitio. Se usaban justo en los momentos
 * más delicados —borrar un documento, un usuario o un reporte—, que es donde
 * peor sienta que se rompa la estética del producto.
 */
export function ConfirmacionModal({
  abierto, onCerrar, onConfirmar, titulo, mensaje, detalle,
  textoConfirmar, destructivo = true, ocupado = false
}) {
  const { t } = usePrefs();

  return (
    <Modal
      abierto={abierto}
      onCerrar={ocupado ? undefined : onCerrar}
      titulo={titulo || t('comun.confirmar')}
      ancho="max-w-sm"
      cerrableAlFondo={!ocupado}
      pie={
        <>
          <button
            type="button"
            onClick={onCerrar}
            disabled={ocupado}
            className="px-4 py-2.5 text-xs font-bold text-mm-2 bg-slate-100 dark:bg-zinc-700 hover:bg-slate-200 dark:hover:bg-zinc-600 rounded-xl disabled:opacity-50 transition-colors"
          >
            {t('comun.cancelar')}
          </button>
          <button
            type="button"
            onClick={onConfirmar}
            disabled={ocupado}
            className={`flex items-center gap-2 px-5 py-2.5 text-xs font-bold text-white rounded-xl shadow-sm disabled:opacity-50 transition-colors ${
              destructivo ? 'bg-red-600 hover:bg-red-700' : 'bg-mm-navy hover:bg-slate-800'
            }`}
          >
            {ocupado && <Loader2 size={14} className="animate-spin" />}
            {textoConfirmar || t('comun.eliminar')}
          </button>
        </>
      }
    >
      <div className="flex flex-col items-center text-center">
        <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-4 ${
          destructivo
            ? 'bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30'
            : 'bg-mm-oro-lavado dark:bg-amber-500/10 border border-mm-oro-borde dark:border-amber-500/30'
        }`}>
          <AlertTriangle size={22} className={destructivo ? 'text-red-600 dark:text-red-400' : 'text-mm-oro'} />
        </div>
        <p className="text-sm font-semibold text-slate-800 dark:text-zinc-100 leading-relaxed">{mensaje}</p>
        {detalle && (
          <p className="text-[11px] text-mm-2 leading-relaxed mt-2 break-words">{detalle}</p>
        )}
      </div>
    </Modal>
  );
}
