import { useEffect, useState } from 'react';

/** Marca de tiempo del inicio del día (00:00:00.000) de una fecha dada. */
export function inicioDelDia(fecha = new Date()) {
  const d = new Date(fecha);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * "Hoy", anclado al inicio del día y RECALCULADO al cruzar la medianoche.
 *
 * Los plazos de obra se miden en días: "faltan 3 días" tiene que significar lo
 * mismo a las 9:00 y a las 17:00, así que el valor se fija al arranque del día
 * y no en cada render (si no, ningún `useMemo` que dependa de él se sostiene).
 *
 * Pero fijarlo UNA sola vez tiene su propio problema, y en una PWA instalada es
 * el caso normal: la aplicación se queda abierta en el teléfono días enteros
 * sin recargarse nunca. Con el valor congelado, un hito que vence hoy seguía
 * anunciándose como "en 1 día" a la mañana siguiente, y uno ya vencido no
 * pasaba a rojo hasta que alguien refrescaba a mano.
 *
 * Aquí se programa un único temporizador que despierta justo después de las
 * 00:00 y vuelve a fijar el día. Nada de sondear cada minuto: un `setTimeout`
 * por día, y se cancela al desmontar.
 */
export function useDiaActual() {
  const [hoy, setHoy] = useState(() => inicioDelDia());

  useEffect(() => {
    let temporizador = null;

    const programarMedianoche = () => {
      const ahora = new Date();
      const manana = new Date(ahora);
      manana.setHours(24, 0, 0, 0);
      /* Un segundo de margen: los relojes de los navegadores redondean y un
         despertar exacto a las 00:00:00.000 puede caer todavía en el día
         anterior, dejando la fecha sin cambiar hasta el siguiente ciclo. */
      const espera = Math.max(1000, manana.getTime() - ahora.getTime() + 1000);
      temporizador = setTimeout(() => {
        setHoy(inicioDelDia());
        programarMedianoche();
      }, espera);
    };

    /* El teléfono suspende los temporizadores mientras la app está en segundo
       plano: al volver, la fecha puede llevar horas obsoleta y el `setTimeout`
       pendiente ya no sirve. Se recalcula al recuperar el foco. */
    const alVolver = () => {
      if (document.visibilityState !== 'visible') return;
      setHoy((previo) => {
        const actual = inicioDelDia();
        return actual === previo ? previo : actual;
      });
      clearTimeout(temporizador);
      programarMedianoche();
    };

    programarMedianoche();
    document.addEventListener('visibilitychange', alVolver);

    return () => {
      clearTimeout(temporizador);
      document.removeEventListener('visibilitychange', alVolver);
    };
  }, []);

  return hoy;
}
