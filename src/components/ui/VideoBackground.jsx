import { useEffect, useRef, useState } from 'react';

/**
 * VideoBackground — fondo de video en bucle continuo, muy tenue.
 *
 * Portado del sitio público de MM Capital (mmcapital2.pages.dev). Son dos
 * capas: el video a `object-fit: cover` con opacidad muy baja, y encima un
 * degradado del color del lienzo que lo funde con la página. La opacidad baja
 * es lo que hace que se lea como TEXTURA y no como una plantilla con video: a
 * 0,15 acompaña, a 0,5 compite con el texto.
 *
 * El MP4 vive en `public/`, no en la nube de nadie: si el sitio de origen
 * desaparece, esto sigue funcionando.
 *
 * Tres cosas de las que depende que esto funcione, y que no se pueden quitar:
 *   · `muted` — sin esto ningún navegador autoreproduce.
 *   · `playsInline` — sin esto Safari de iPhone abre el video a pantalla
 *     completa en lugar de dejarlo de fondo.
 *   · El padre necesita `position: relative` y `overflow: hidden`, y el
 *     contenido por encima necesita `position` propio. En el panel eso ya lo
 *     resuelve el `relative isolate` del contenedor principal.
 *
 * ── EL BUCLE SIN CORTE ──────────────────────────────────────────────────────
 * Un `<video loop>` a secas da un salto al reiniciar: el último fotograma no
 * se parece al primero, así que el humo aparece de golpe en otra posición.
 *
 * Aquí hay DOS copias del mismo video reproduciéndose a la vez, desfasadas
 * media vuelta (6,58 s). La que se ve es siempre la que está lejos de su
 * reinicio; cuando una se acerca al final, se funde con la otra —que en ese
 * momento va por la mitad de su clip, en pleno movimiento— y el reinicio
 * ocurre mientras esa copia está invisible. Nunca hay un corte, solo un
 * fundido de 1,2 s entre dos momentos del mismo humo.
 *
 * El archivo se descarga UNA sola vez: dos <video> con la misma `src` piden
 * el MP4 por separado (medido: 2,56 MB en vez de 1,28 MB), así que se baja a
 * mano con `fetch`, se guarda como Blob y las dos copias apuntan al mismo
 * objeto en memoria. El precio es que el fondo tarda un poco más en aparecer,
 * porque no arranca hasta tener el archivo entero; mientras tanto se ve el
 * lienzo, que es justo el color con el que el video se funde.
 */

/* Duración del fundido entre las dos copias, en segundos DEL CLIP (no de
   reloj): se mide sobre `currentTime`, así que si el tema frena el video a la
   mitad, el fundido también dura el doble en pantalla. Es lo que se quiere —
   un fondo más lento pide una transición más lenta. */
const FUNDIDO = 1.2;

/* Cada tema con su color de fusión, su opacidad y su velocidad.
     opacidad — en noche sube a 0,20: sobre el navy oscuro los destellos del
       video tienen que trabajar más para verse, mientras que sobre el lienzo
       claro 0,15 ya es suficiente.
     velocidad — y precisamente por eso hay que frenarlo de noche. El mismo
       movimiento que sobre el lienzo claro apenas se insinúa, sobre el navy se
       ve entero, y a velocidad normal resulta inquieto. A la mitad el clip
       pasa de 13,2 s a 26,3 s y el humo se lee como algo que respira.
       De día se queda a 1: ahí el movimiento gusta como está. */
const TEMAS = {
  dia: { fade: '#F4F4F2', opacidad: 0.15, velocidad: 1 },
  noche: { fade: '#0A1017', opacidad: 0.2, velocidad: 0.5 }
};

/* Descargas en curso, compartidas por todo el módulo. Sin esto el MP4 se pide
   DOS veces en desarrollo: `StrictMode` monta cada efecto por duplicado a
   propósito, y son dos `fetch` de 1,2 MB con 44 ms de diferencia (medido). En
   producción StrictMode no duplica, pero la caché no estorba y además cubre el
   caso de que el fondo llegue a montarse dos veces por cualquier motivo. */
const descargas = new Map();

function pedirVideo(src) {
  let promesa = descargas.get(src);
  if (!promesa) {
    promesa = fetch(src)
      .then(res => (res.ok ? res.blob() : Promise.reject(new Error(res.status))))
      .catch(error => {
        // Un fallo no se cachea: el siguiente montaje puede reintentarlo.
        descargas.delete(src);
        throw error;
      });
    descargas.set(src, promesa);
  }
  return promesa;
}

/** '#RRGGBB' + alfa → 'rgba(r, g, b, a)'. */
function conAlfa(hex, alfa) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alfa})`;
}

const estiloVideo = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  display: 'block',
  opacity: 0
};

/**
 * @param {object}  props
 * @param {string}  props.src        Ruta del MP4.
 * @param {boolean} props.oscuro     Receta de color: día (false) o noche (true).
 * @param {string}  props.fadeColor  Fuerza el color de fusión (opcional).
 * @param {number}  props.opacity    Fuerza la opacidad del video (opcional).
 */
export function VideoBackground({
  src = '/fondo-panel.mp4',
  oscuro = false,
  fadeColor,
  opacity
}) {
  const videoA = useRef(null);
  const videoB = useRef(null);

  const tema = oscuro ? TEMAS.noche : TEMAS.dia;
  const fusion = fadeColor ?? tema.fade;
  const opacidad = opacity ?? tema.opacidad;
  const velocidad = tema.velocidad;

  /* Las dos señales que el usuario pide de forma explícita en su sistema.
     Con ahorro de datos activo el MP4 ni se pide: son 1,2 MB por un adorno,
     y quien enciende esa opción está diciendo justamente que no los quiere.
     Con "menos movimiento" se descarga una sola copia y se queda quieta en su
     primer fotograma: la textura se conserva, el movimiento no. */
  const [ahorroDatos] = useState(() => navigator.connection?.saveData === true);
  const [menosMovimiento] = useState(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  );

  /* Sin movimiento basta una copia y se puede cargar de forma progresiva, así
     que ahí se usa la ruta tal cual. Con las dos copias hace falta el Blob. */
  const [fuente, setFuente] = useState(() => (menosMovimiento ? src : null));

  // ── Descarga única, compartida por las dos copias ──
  useEffect(() => {
    if (ahorroDatos || menosMovimiento) return;
    let vigente = true;
    let url = null;
    pedirVideo(src)
      .then(blob => {
        if (!vigente) return;
        url = URL.createObjectURL(blob);
        setFuente(url);
      })
      /* Plan B: si el fetch falla (sin conexión, el service worker de la PWA
         no lo tiene cacheado…), cada copia se lo pide por su cuenta. Se paga
         la descarga doble, pero el fondo se ve. */
      .catch(() => { if (vigente) setFuente(src); });
    return () => {
      vigente = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [src, ahorroDatos, menosMovimiento]);

  // ── Reproducción y costura del bucle ──
  useEffect(() => {
    const a = videoA.current;
    if (!a || !fuente || ahorroDatos) return;

    const arrancar = (v) => {
      /* `autoPlay` falla en silencio en varios casos reales (ahorro de batería
         de iOS, pestaña en segundo plano). Se reintenta a mano y, si el
         navegador se niega, el video se queda en su primer fotograma: el fondo
         sigue viéndose bien, solo que quieto. */
      const promesa = v.play();
      if (promesa?.catch) promesa.catch(() => {});
    };

    // Sin movimiento no hay bucle que coser: una sola copia, quieta y visible.
    if (menosMovimiento) {
      a.style.opacity = '1';
      return;
    }

    const b = videoB.current;
    if (!b) return;

    let raf = 0;
    let emparejados = false;

    /** Reparto entre las dos copias: 0 cuando A está pegada a su reinicio, 1 lejos. */
    const alfaDe = (t, d) => {
      const restante = d - t;
      if (restante < FUNDIDO) return Math.max(0, restante / FUNDIDO);
      if (t < FUNDIDO) return Math.min(1, t / FUNDIDO);
      return 1;
    };

    /* Solo se escribe el REPARTO (0..1), nunca la opacidad del tema: esa vive
       en el contenedor y la aplica React. Así cambiar de día a noche no obliga
       a reiniciar nada de esto. */
    const pintar = (alfa) => {
      a.style.opacity = String(alfa);
      b.style.opacity = String(1 - alfa);
    };

    const paso = () => {
      raf = 0;
      const d = a.duration;
      if (!Number.isFinite(d) || d === 0) return;
      const t = a.currentTime;
      const alfa = alfaDe(t, d);
      pintar(alfa);

      if (alfa === 1) {
        /* Fuera de la ventana de fundido. Aquí B está invisible, que es el
           único momento seguro para recolocarla: las dos copias corren por su
           cuenta y el desfase de media vuelta se desajusta con las horas.
           Corregirlo mientras se ve daría un salto — justo lo que se evita. */
        const desfase = (b.currentTime - t + d) % d;
        if (Math.abs(desfase - d / 2) > 0.4) b.currentTime = (t + d / 2) % d;
        return; // y se corta el rAF hasta que vuelva a hacer falta
      }
      raf = requestAnimationFrame(paso);
    };

    /* El rAF solo corre durante el fundido (2,4 s de cada 13,2). El resto del
       tiempo basta con `timeupdate`, que el navegador dispara ~4 veces por
       segundo, para vigilar cuándo se acerca la ventana. */
    const vigilar = () => {
      if (raf !== 0) return;
      const d = a.duration;
      if (!Number.isFinite(d)) return;
      const t = a.currentTime;
      if (d - t < FUNDIDO + 0.5 || t < FUNDIDO) raf = requestAnimationFrame(paso);
    };

    const emparejar = () => {
      const d = a.duration;
      if (emparejados || !Number.isFinite(d) || d === 0) return;
      emparejados = true;
      b.currentTime = (a.currentTime + d / 2) % d;
      arrancar(b);
      pintar(alfaDe(a.currentTime, d));
    };

    arrancar(a);
    if (a.readyState >= 1) emparejar();
    else a.addEventListener('loadedmetadata', emparejar);
    a.addEventListener('timeupdate', vigilar);

    return () => {
      if (raf !== 0) cancelAnimationFrame(raf);
      a.removeEventListener('loadedmetadata', emparejar);
      a.removeEventListener('timeupdate', vigilar);
    };
  }, [fuente, ahorroDatos, menosMovimiento]);

  /* ── Velocidad del tema ──
     Las DOS copias tienen que ir al mismo ritmo: el bucle se sostiene sobre un
     desfase fijo de media vuelta, y con velocidades distintas ese desfase se
     desharía en segundos y el fundido dejaría de tapar el reinicio.
     Se aplica en su propio efecto, no en el del bucle, para que cambiar de
     tema solo mueva este número y no reinicie la reproducción. */
  useEffect(() => {
    for (const v of [videoA.current, videoB.current]) {
      if (v) v.playbackRate = velocidad;
    }
  }, [velocidad, fuente]);

  if (ahorroDatos) return null;

  const propsVideo = {
    src: fuente ?? undefined,
    loop: true,
    muted: true,
    playsInline: true,
    preload: 'auto',
    tabIndex: -1,
    disablePictureInPicture: true,
    style: estiloVideo
  };

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      {/* La opacidad del tema vive AQUÍ, en el contenedor de las dos copias.
          Dentro, cada copia solo lleva su reparto del fundido. Separarlo es lo
          que permite cambiar de día a noche sin tocar el bucle. */}
      <div style={{ position: 'absolute', inset: 0, opacity: opacidad }}>
        <video ref={videoA} {...propsVideo} />
        {/* La segunda copia solo existe para coser el bucle: sin movimiento no
            hace falta y no se monta, así el navegador no abre un decodificador
            de más. */}
        {!menosMovimiento && <video ref={videoB} {...propsVideo} />}
      </div>

      {/* Degradado que funde el video con el lienzo. Pesa más abajo (0,9) que
          arriba (0,4) para que el contenido que se lee al hacer scroll quede
          sobre un fondo casi liso. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `linear-gradient(to bottom, ${conAlfa(fusion, 0.4)}, ${conAlfa(
            fusion,
            0.1
          )}, ${conAlfa(fusion, 0.9)})`
        }}
      />
    </div>
  );
}

export default VideoBackground;
