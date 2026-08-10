import React, { useLayoutEffect, useRef, useState } from 'react';
import { HyperText } from './hyper-text';

/**
 * Nombre que SIEMPRE cabe en UNA sola línea.
 *
 * Arranca en `max` px y va bajando de medio punto hasta que el texto entra en
 * el ancho disponible (sin pasar de `min`). Se recalcula cuando cambia el
 * texto o cuando el contenedor cambia de ancho, así se ve igual de bien con
 * "Ing. Luis Panameño" que con un nombre largo tipo "Ing. Juan Carlos Meléndez".
 *
 * ── `descifrar` ─────────────────────────────────────────────────────────────
 * Con `descifrar`, el nombre entra con el efecto de HyperText en vez de
 * aparecer de golpe. Las dos piezas conviven porque miden cosas distintas:
 * HyperText deja EN EL FLUJO un molde invisible con el texto final y pinta las
 * letras que bailan encima, en absoluto. Lo que esta medición ve es siempre el
 * molde —el nombre ya resuelto—, así que el tamaño de letra se calcula una vez
 * y no se mueve mientras dura la animación. Al revés no funcionaría: midiendo
 * el revoltijo, cada fotograma daría un ancho distinto y la letra temblaría.
 */
export default function NombreAjustado({
  texto,
  max = 21,
  min = 11,
  className = '',
  style,
  descifrar = false,
  esperando = false,
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
      {descifrar ? <HyperText text={texto} esperando={esperando} /> : texto}
    </span>
  );
}
