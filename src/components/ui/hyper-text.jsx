import { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/utils';

/**
 * HyperText — el texto se revela descifrándose, letra a letra.
 * Fuente: componente `hyper-text` de Magic UI, portado a JSX.
 *
 * Cinco cambios respecto al original, todos para que sirva aquí:
 *
 *  1. NO pone el texto en mayúsculas. El original hace `letter.toUpperCase()`
 *     y eso convertiría "Ing. Giovanni Morales" en "ING. GIOVANNI MORALES".
 *     Aquí el ruido respeta la caja de cada letra: mayúscula por mayúscula,
 *     minúscula por minúscula, y los puntos y espacios ni se tocan.
 *
 *  2. NO fuerza `font-mono`. El original lo usa para que las letras no bailen
 *     de ancho mientras se descifran; el precio es cambiar la tipografía, y
 *     este texto tiene que verse exactamente igual que antes. En su lugar hay
 *     un molde invisible con el texto final que MANDA el ancho, y el texto
 *     animado va encima en posición absoluta. La caja no se mueve ni aunque
 *     el revoltijo salga más ancho que el nombre final.
 *
 *  3. Reinicia la animación cuando CAMBIA el texto. En el original el contador
 *     de iteraciones no se reponía, así que un cambio de texto posterior se
 *     limitaba a aparecer de golpe — justo el salto que se quería evitar.
 *
 *  4. `duration` se cumple de verdad. El original avanza un contador fijo por
 *     tick (`+0.1` cada `duration/(largo*10)` ms), así que el reloj real sale
 *     de multiplicar ticks por intervalo. Con nombres largos el intervalo caía
 *     por debajo de lo que el navegador puede servir —`setInterval` no baja de
 *     ~4 ms, y menos aún con React repintando— y la cuenta se estiraba sola:
 *     "Ing. Luis Panameño" pedía 900 ms y tardaba casi 3 segundos. Aquí el
 *     avance se calcula con el RELOJ (`performance.now()`) sobre
 *     `requestAnimationFrame`: dure lo que dure cada fotograma, a los
 *     `duration` ms el texto está resuelto. Sin sorpresas con nombres largos.
 *
 *  5. Modo `esperando`: mientras el dato real no ha llegado, las letras giran
 *     sin resolverse nunca. Es lo que quita el parpadeo del nombre provisional
 *     sacado del correo: sus letras nunca se llegan a leer, solo prestan la
 *     longitud del revoltijo, y cuando la ficha de `usuarios` responde el
 *     nombre de verdad se descifra encima.
 */

const MAYUSCULAS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const MINUSCULAS = 'abcdefghijklmnopqrstuvwxyz';

const alAzar = (letras) => letras[Math.floor(Math.random() * letras.length)];

/** Sustituto del mismo tipo: así el revoltijo conserva la forma del nombre. */
function ruido(caracter) {
  if (/\p{Lu}/u.test(caracter)) return alAzar(MAYUSCULAS);
  if (/\p{Ll}/u.test(caracter)) return alAzar(MINUSCULAS);
  return caracter;   // espacios, puntos y guiones se quedan donde están
}

/** El revoltijo se refresca cada 45 ms, no en cada fotograma: a 60 Hz las
    letras cambian tan rápido que se leen como una mancha gris temblando. */
const REFRESCO_RUIDO = 45;

/**
 * @param {object}  props
 * @param {string}  props.text          Texto final.
 * @param {number}  props.duration      Lo que tarda en descifrarse, en ms.
 * @param {boolean} props.esperando     El dato real aún no llegó: gira sin resolver.
 * @param {boolean} props.animateOnLoad Animar en el primer render.
 * @param {string}  props.className     Clases del texto (tamaño y color se heredan).
 */
export function HyperText({
  text,
  duration = 450,
  className,
  animateOnLoad = true,
  esperando = false
}) {
  const textoSeguro = String(text ?? '');

  const [visible, setVisible] = useState(() =>
    animateOnLoad ? textoSeguro.split('').map(ruido) : textoSeguro
  );
  const [pulso, setPulso] = useState(0);
  const animando = useRef(false);

  useEffect(() => {
    const letras = textoSeguro.split('');

    if (letras.length === 0) {
      setVisible('');
      return;
    }

    /* ── Pestaña en segundo plano ──
       `requestAnimationFrame` NO se dispara mientras el documento está oculto
       (no es que se ralentice: no corre). Y el panel se abre en segundo plano
       constantemente — se pulsa el marcador y se sigue en otra pestaña. Sin
       esto, la animación se quedaba congelada a media mezcla y al volver te
       encontrabas el nombre convertido en un revoltijo de letras hasta que
       algo la reiniciara. Si nadie está mirando, no hay nada que animar: se
       pone el texto final y listo. Comprobado: en la pestaña oculta el
       componente resuelve al instante en vez de quedarse a medias. */
    if (document.hidden) {
      setVisible(textoSeguro);
      return;
    }

    let raf = 0;
    const inicio = performance.now();
    let ultimoRuido = 0;

    // Si te vas a otra pestaña a media animación, se cierra sin dejar restos
    const alOcultarse = () => {
      if (!document.hidden) return;
      cancelAnimationFrame(raf);
      animando.current = false;
      setVisible(textoSeguro);
    };
    document.addEventListener('visibilitychange', alOcultarse);

    const paso = (ahora) => {
      /* Sin dato definitivo no se resuelve nada: todas las letras siguen
         girando hasta que `esperando` se apague. */
      const avance = esperando
        ? 0
        : Math.min(1, (ahora - inicio) / Math.max(1, duration));

      if (ahora - ultimoRuido >= REFRESCO_RUIDO || avance === 1) {
        ultimoRuido = ahora;
        const resueltas = Math.floor(avance * letras.length);
        setVisible(
          letras.map((letra, i) => (i < resueltas ? letra : ruido(letra))).join('')
        );
      }

      if (avance < 1) {
        raf = requestAnimationFrame(paso);
      } else {
        setVisible(textoSeguro);
        animando.current = false;
      }
    };

    animando.current = true;
    raf = requestAnimationFrame(paso);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', alOcultarse);
      animando.current = false;
    };
    // Cada texto nuevo se descifra desde el principio (punto 3 de la cabecera)
  }, [textoSeguro, duration, esperando, pulso]);

  const reanimar = () => {
    if (esperando || animando.current) return;
    setPulso(p => p + 1);
  };

  /* Molde invisible en el flujo + capa animada ENCIMA en absoluto: el ancho
     y el alto los fija siempre el texto final, así que las letras que bailan
     no pueden empujar lo que tienen al lado ni aunque salgan más anchas.
     `role="img"` + `aria-label`: el lector de pantalla anuncia el nombre
     entero de una vez y nunca las letras revueltas. Se probó antes con un
     `sr-only` al lado del texto visible y el nombre acababa DOS veces en el
     `innerText` del encabezado (y en lo que se copia al portapapeles). */
  return (
    <span
      role="img"
      aria-label={esperando ? '' : textoSeguro}
      className={cn('relative inline-block align-bottom whitespace-pre', className)}
      onMouseEnter={reanimar}
    >
      <span className="invisible" aria-hidden="true">{textoSeguro}</span>
      <span
        className="absolute inset-0 overflow-hidden"
        aria-hidden="true"
      >
        {visible}
      </span>
    </span>
  );
}

export default HyperText;
