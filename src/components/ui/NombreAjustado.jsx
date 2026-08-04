import React, { useLayoutEffect, useRef, useState } from 'react';

/**
 * Nombre que SIEMPRE cabe en UNA sola línea.
 *
 * Arranca en `max` px y va bajando de medio punto hasta que el texto entra en
 * el ancho disponible (sin pasar de `min`). Se recalcula cuando cambia el
 * texto o cuando el contenedor cambia de ancho, así se ve igual de bien con
 * "Ing. Luis Panameño" que con un nombre largo tipo "Ing. Juan Carlos Meléndez".
 */
export default function NombreAjustado({
  texto,
  max = 21,
  min = 11,
  className = '',
  style,
  ...rest
}) {
  const ref = useRef(null);
  const anchoPrevio = useRef(0);
  const [tam, setTam] = useState(max);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const ajustar = () => {
      let s = max;
      el.style.fontSize = `${s}px`;
      // scrollWidth > clientWidth ⇒ el texto se sale: se encoge hasta que quepa
      while (s > min && el.scrollWidth > el.clientWidth) {
        s -= 0.5;
        el.style.fontSize = `${s}px`;
      }
      setTam(s);
    };

    ajustar();
    anchoPrevio.current = el.clientWidth;

    // Solo reacciona a cambios de ANCHO: al encoger la letra cambia el alto y
    // volver a medir por eso dispararía un bucle de ResizeObserver.
    const ro = new ResizeObserver(() => {
      const ancho = el.clientWidth;
      if (ancho === anchoPrevio.current) return;
      anchoPrevio.current = ancho;
      ajustar();
    });
    ro.observe(el.parentElement || el);
    return () => ro.disconnect();
  }, [texto, max, min]);

  return (
    <span
      ref={ref}
      title={texto}
      style={{ fontSize: `${tam}px`, ...style }}
      className={`block w-full whitespace-nowrap overflow-hidden text-ellipsis ${className}`}
      {...rest}
    >
      {texto}
    </span>
  );
}
