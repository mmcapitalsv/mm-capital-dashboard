import React, { useEffect, useRef } from 'react';

/**
 * TubesCursor — animación WebGL de tubos que siguen el cursor.
 * Fuente: https://21st.dev/@jod49034/components/tubes-curor
 *
 * Se conserva la lógica original (misma librería, mismas opciones de init,
 * mismo click-para-recolorear y mismo cleanup). Dos ajustes para usarlo como
 * fondo en lugar de como demo a pantalla completa:
 *   · Se quitó el texto "Tubes / Cursor / Click to change colors" del demo.
 *   · El contenedor llena a su padre (absolute inset-0) en vez de fijar
 *     h-screen w-screen, y el canvas es `absolute` en vez de `fixed`.
 *   · El módulo se carga desde node_modules y no desde la CDN de jsDelivr,
 *     para que la pantalla de acceso no dependa de una red externa.
 */
export default function TubesCursor() {
  // useRef to get a persistent reference to the canvas element
  const canvasRef = useRef(null);
  // useRef to hold the animation instance so we can call its methods
  const appRef = useRef(null);

  /**
   * Generates an array of random hex color strings.
   * @param {number} count - The number of random colors to generate.
   * @returns {string[]} An array of color strings.
   */
  const randomColors = (count) => {
    return new Array(count)
      .fill(0)
      .map(() => '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0'));
  };

  // This effect runs once when the component mounts
  useEffect(() => {
    /* El fondo animado cuesta 761 KB de three.js (210 KB comprimidos) y se
       descarga antes de que nadie haya entrado. El coste se asume: las luces
       son la primera impresión de la marca y sin ellas la pantalla de acceso
       queda plana.

       Aquí había dos guardas —`prefers-reduced-motion` y `saveData`— que
       apagaban el efecto ENTERO y en silencio. El problema práctico es que
       ninguna de las dos avisa: en el equipo donde no salía el láser todo
       parecía correcto (WebGL disponible, el módulo cargando, cero errores en
       consola) y la pantalla se quedaba negra sin explicación. Basta con que
       el equipo tenga desactivados los efectos de animación de Windows, o con
       que una extensión encienda el ahorro de datos, para perder la portada.

       Decisión del dueño del producto: la portada se ve siempre. Lo que sí se
       respeta es la señal del sistema DENTRO del panel, que es donde el
       movimiento acompaña en vez de presentar — ahí `VideoBackground` sigue
       honrando ambas preferencias. */

    // The error "Computed radius is NaN" suggests a race condition where the animation
    // library initializes before the canvas element has its final dimensions, leading
    // to invalid geometry calculations. Delaying the initialization with setTimeout
    // ensures the DOM is fully painted and ready.
    const initTimer = setTimeout(() => {
      import('threejs-components/build/cursors/tubes1.min.js')
        .then(module => {
          const TubesCursor = module.default;

          // Ensure the canvas element is still available before initializing
          if (canvasRef.current) {
            // Initialize the TubesCursor animation
            /* Intensidad 500, no 200. El valor del demo se eligió sobre un
               lienzo pequeño; en un monitor de escritorio el halo alcanzaba
               apenas unos centenares de píxeles alrededor del puntero y el
               resto de la pantalla quedaba negra — el efecto existía pero no
               se veía. Con 500 la luz llega al borde del lienzo y la pantalla
               de acceso vuelve a leerse como una sola pieza iluminada. */
            const app = TubesCursor(canvasRef.current, {
              tubes: {
                colors: ['#5e72e4', '#8965e0', '#f5365c'],
                lights: {
                  intensity: 500,
                  colors: ['#21d4fd', '#b721ff', '#f4d03f', '#11cdef']
                }
              }
            });
            // Store the instance in our ref for later use
            appRef.current = app;
          }
        })
        .catch(err => console.error('Failed to load TubesCursor module:', err));
    }, 100); // 100ms delay to allow for DOM rendering

    // Cleanup function to dispose of the animation and clear the timeout
    return () => {
      clearTimeout(initTimer);
      // Check if app was initialized and has a dispose method before calling
      if (appRef.current && typeof appRef.current.dispose === 'function') {
        appRef.current.dispose();
      }
    };
  }, []); // The empty dependency array ensures this effect runs only once

  // Handles click events on the main container
  const handleClick = () => {
    if (appRef.current) {
      const newTubeColors = randomColors(3);
      const newLightColors = randomColors(4);

      // Update the colors in the running animation
      appRef.current.tubes.setColors(newTubeColors);
      appRef.current.tubes.setLightsColors(newLightColors);
    }
  };

  return (
    <div
      onClick={handleClick}
      className="absolute inset-0 bg-black overflow-hidden cursor-pointer"
    >
      <canvas ref={canvasRef} className="absolute inset-0 z-0 w-full h-full" />
    </div>
  );
}
