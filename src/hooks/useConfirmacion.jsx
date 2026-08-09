import React, { useState, useCallback, useRef } from 'react';
import { ConfirmacionModal } from '../components/ui/Modal';

/**
 * Sustituto de `confirm()` con la estética de la aplicación.
 *
 * Se comporta igual que el nativo —espera y devuelve `true` o `false`— así que
 * cada sitio de llamada cambia en una sola línea:
 *
 *     if (!confirm(t('vault.confirmEliminar'))) return;      // antes
 *     if (!await confirmar({ mensaje: t('vault.confirmEliminar') })) return;
 *
 * Se hace así, y no reescribiendo los once manejadores en dos pasos, porque el
 * cambio de menor superficie es el que menos riesgo tiene de romper flujos que
 * ya funcionan.
 *
 * Uso:
 *     const { confirmar, dialogoConfirmacion } = useConfirmacion();
 *     ...
 *     return (<>...{dialogoConfirmacion}</>);
 */
export function useConfirmacion() {
  const [estado, setEstado] = useState(null);
  const resolverRef = useRef(null);

  const confirmar = useCallback((opciones = {}) => {
    const texto = typeof opciones === 'string' ? { mensaje: opciones } : opciones;
    setEstado({ ...texto, ocupado: false });
    return new Promise((resolver) => { resolverRef.current = resolver; });
  }, []);

  const responder = useCallback((valor) => {
    setEstado(null);
    resolverRef.current?.(valor);
    resolverRef.current = null;
  }, []);

  const dialogoConfirmacion = (
    <ConfirmacionModal
      abierto={!!estado}
      titulo={estado?.titulo}
      mensaje={estado?.mensaje}
      detalle={estado?.detalle}
      textoConfirmar={estado?.textoConfirmar}
      destructivo={estado?.destructivo !== false}
      onCerrar={() => responder(false)}
      onConfirmar={() => responder(true)}
    />
  );

  return { confirmar, dialogoConfirmacion };
}

/**
 * Aviso simple, en sustitución de `alert()`.
 * Mismo motivo: el diálogo nativo rompe la estética y en iOS muestra la URL.
 */
export function useAviso() {
  const [mensaje, setMensaje] = useState(null);

  const avisar = useCallback((texto, opciones = {}) => {
    setMensaje({ texto, ...opciones });
  }, []);

  const dialogoAviso = (
    <ConfirmacionModal
      abierto={!!mensaje}
      titulo={mensaje?.titulo}
      mensaje={mensaje?.texto}
      destructivo={false}
      textoConfirmar="OK"
      onCerrar={() => setMensaje(null)}
      onConfirmar={() => setMensaje(null)}
    />
  );

  return { avisar, dialogoAviso };
}
