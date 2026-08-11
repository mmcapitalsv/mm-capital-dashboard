import { useCallback, useEffect, useRef } from 'react';

/**
 * Temporizadores que se cancelan solos al desmontar el componente.
 *
 * Casi todos los `setTimeout` de la aplicación son avisos que se borran a los
 * 5 segundos (`setTimeout(() => setMensaje(null), 5000)`). Si el usuario cambia
 * de vista antes de que venza, el temporizador sigue vivo y llama a un `setX`
 * de un componente ya desmontado: en React 19 no revienta, pero es trabajo
 * pendiente que retiene el estado —y con él la vista entera— hasta que corre.
 * Sumados los de la bóveda, el detalle de proyecto y la administración de
 * usuarios, son más de veinte fugas potenciales.
 *
 * `programar` registra el id y el efecto de limpieza los cancela todos de una
 * vez. La firma es la misma de `setTimeout`, así que sustituirlo es cambiar el
 * nombre de la llamada.
 */
export function useTemporizadores() {
  const pendientes = useRef(new Set());

  useEffect(() => {
    const registro = pendientes.current;
    return () => {
      registro.forEach((id) => clearTimeout(id));
      registro.clear();
    };
  }, []);

  /** Igual que `setTimeout`, pero cancelado al desmontar. Devuelve el id. */
  const programar = useCallback((accion, ms) => {
    const id = setTimeout(() => {
      pendientes.current.delete(id);
      accion();
    }, ms);
    pendientes.current.add(id);
    return id;
  }, []);

  /** Cancela un temporizador concreto antes de que venza. */
  const cancelar = useCallback((id) => {
    clearTimeout(id);
    pendientes.current.delete(id);
  }, []);

  return { programar, cancelar };
}
