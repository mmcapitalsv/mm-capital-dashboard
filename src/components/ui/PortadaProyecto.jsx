import { useState } from 'react';
import { Building2 } from 'lucide-react';
import { useUrlFirmada } from '../../hooks/useUrlFirmada';

/**
 * Portada de un proyecto, con respaldo cuando la foto no carga.
 *
 * Los tres sitios donde se pinta una portada ya cubrían el caso "no hay
 * `imagen_url`" con un icono de edificio. Lo que ninguno cubría es que la URL
 * EXISTA y falle: portada borrada del bucket, enlace caducado, sin conexión.
 * Ahí React montaba el `<img>` y el navegador dibujaba su icono de imagen
 * partida a todo lo ancho de la tarjeta — bastante más visible que en un
 * avatar de 32 px. Medido con las portadas apuntando a un 404: tres tarjetas
 * del carrusel con el icono roto.
 *
 * `onError` recuerda QUÉ url falló, no un booleano: si el administrador sube
 * una portada nueva, la nueva se intenta. Con un booleano, un 404 dejaría la
 * tarjeta con el icono de respaldo hasta recargar la página.
 *
 * El contenedor (bordes, medidas, controles de "cambiar portada" superpuestos)
 * se queda en quien llama: aquí solo vive la imagen y su respaldo.
 */
export default function PortadaProyecto({
  url,
  alt = '',
  claseImg = 'w-full h-full object-cover',
  claseRespaldo = 'w-full h-full',
  tamanoIcono = 36,
  claseIcono = 'text-slate-300 dark:text-zinc-500'
}) {
  const [falloUrl, setFalloUrl] = useState(null);

  /* `proyectos.imagen_url` apunta a un bucket privado (migración 018) y las
     tarjetas la pasan cruda: se firma aquí. Las portadas de demo, que son
     rutas de `/public`, salen intactas y sin tocar la red. */
  const limpia = useUrlFirmada(url) || '';
  const usable = limpia !== '' && limpia !== falloUrl;

  if (!usable) {
    return (
      <div className={`${claseRespaldo} flex items-center justify-center`}>
        <Building2 size={tamanoIcono} className={claseIcono} />
      </div>
    );
  }

  return (
    <img
      key={limpia}
      src={limpia}
      alt={alt}
      loading="lazy"
      onError={() => setFalloUrl(limpia)}
      className={claseImg}
    />
  );
}
