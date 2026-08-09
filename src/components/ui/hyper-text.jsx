import { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/utils';

/**
 * HyperText — el texto se revela descifrándose, letra a letra.
 * Fuente: componente `hyper-text` de Magic UI, portado a JSX.
 *
 * Cuatro cambios respecto al original, todos para que sirva aquí:
 *
 *  1. NO pone el texto en mayúsculas. El original hace `letter.toUpperCase()`
 *     y eso convertiría "Ing. Giovanni Morales" en "ING. GIOVANNI MORALES".
 *     Aquí el ruido respeta la caja de cada letra: mayúscula por mayúscula,
 *     minúscula por minúscula, y los puntos y espacios ni se tocan.
 *
 *  2. NO fuerza `font-mono`. El original lo usa para que las letras no bailen
 *     de ancho mientras se descifran; el precio es cambiar la tipografía, y
 *     este texto tiene que verse exactamente igual que antes. En su lugar hay
 *     un molde invisible con el texto final que reserva el ancho, y el texto
 *     animado se pinta encima. La caja no se mueve y la letra es la de marca.
 *
 *  3. Reinicia la animación cuando CAMBIA el texto. En el original el contador
 *     de iteraciones no se reponía, así que un cambio de texto posterior se
 *     limitaba a aparecer de golpe — justo el salto que se quería evitar.
 *
 *  4. Modo `esperando`: mientras el dato real no ha llegado, las letras giran
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

const menosMovimiento = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/**
 * @param {object}  props
 * @param {string}  props.text          Texto final.
 * @param {number}  props.duration      Duración del descifrado, en ms.
 * @param {boolean} props.esperando     El dato real aún no llegó: gira sin resolver.
 * @param {boolean} props.animateOnLoad Animar en el primer render.
 * @param {string}  props.className     Clases del texto (tamaño y color se heredan).
 */
export function HyperText({
  text,
  duration = 800,
  className,
  animateOnLoad = true,
  esperando = false
}) {
  const textoSeguro = String(text ?? '');

  const [visible, setVisible] = useState(() =>
    animateOnLoad ? textoSeguro.split('').map(ruido) : textoSeguro.split('')
  );
  const [pulso, setPulso] = useState(0);
  const avance = useRef(0);

  /* Quien pidió menos movimiento en su sistema recibe el texto quieto. No se
     guarda en estado: si cambia la preferencia, el siguiente render la lee. */
  const quieto = menosMovimiento();

  useEffect(() => {
    if (quieto) {
      setVisible(textoSeguro.split(''));
      return;
    }

    // Cada texto nuevo se descifra desde el principio (punto 3 de la cabecera)
    avance.current = 0;

    if (textoSeguro.length === 0) {
      setVisible([]);
      return;
    }

    const paso = Math.max(16, duration / (textoSeguro.length * 10));

    const intervalo = setInterval(() => {
      /* Sin dato definitivo no se resuelve nada: todas las letras siguen
         girando hasta que `esperando` se apague. */
      if (esperando) {
        setVisible(textoSeguro.split('').map(ruido));
        return;
      }

      if (avance.current < textoSeguro.length) {
        setVisible(
          textoSeguro
            .split('')
            .map((letra, i) => (i <= avance.current ? letra : ruido(letra)))
        );
        avance.current += 0.1;
      } else {
        setVisible(textoSeguro.split(''));
        clearInterval(intervalo);
      }
    }, paso);

    return () => clearInterval(intervalo);
  }, [textoSeguro, duration, esperando, pulso, quieto]);

  const reanimar = () => {
    if (quieto || esperando) return;
    avance.current = 0;
    setPulso(p => p + 1);
  };

  /* Molde invisible + capa animada encima, las dos en la misma celda de un
     `inline-grid`: el ancho lo manda SIEMPRE el texto final, así que las
     letras que bailan no empujan lo que tienen al lado (punto 2). */
  return (
    /* `role="img"` + `aria-label`: el lector de pantalla anuncia el nombre
       entero de una vez y nunca las letras revueltas. Se probó antes con un
       `sr-only` al lado del texto visible y el nombre acababa DOS veces en el
       `innerText` del encabezado (y en lo que se copia al portapapeles). */
    <span
      role="img"
      aria-label={esperando ? '' : textoSeguro}
      className={cn('inline-grid align-bottom overflow-hidden', className)}
      onMouseEnter={reanimar}
    >
      <span className="col-start-1 row-start-1 invisible whitespace-pre" aria-hidden="true">
        {textoSeguro}
      </span>
      <span className="col-start-1 row-start-1 whitespace-pre" aria-hidden="true">
        {visible.join('')}
      </span>
    </span>
  );
}

export default HyperText;
