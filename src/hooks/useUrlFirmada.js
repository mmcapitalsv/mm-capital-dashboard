import { useEffect, useState } from 'react';
import { firmarUrl, rutaDeUrl } from '../lib/urlFirmada';

/**
 * Convierte lo que hay guardado en la base (una URL pública antigua, una firma
 * caducada o una ruta del bucket) en una URL firmada válida ahora mismo.
 *
 * Existe porque los buckets pasaron a privados (migración 018) y hay decenas de
 * sitios que pintan una imagen directamente desde una fila de Supabase
 * —`usuarios.avatar_url`, `proyectos.imagen_url`— sin pasar por un servicio.
 * Colgando el hook de los dos componentes que dibujan esas imágenes
 * (`AvatarUsuario` y `PortadaProyecto`) queda cubierta toda la app.
 *
 * Mientras la firma viaja devuelve null, y el componente pinta su respaldo: es
 * medio segundo con las iniciales en vez de medio segundo con un hueco.
 * Lo que no pertenece a nuestros buckets (un `data:` de previsualización, una
 * imagen externa) sale intacto y sin pedir nada a la red.
 *
 * @param {string|null|undefined} valor
 * @param {{bucket?: string}} [opciones]
 * @returns {string|null} URL lista para `src`/`href`, o null si aún no hay
 */
export function useUrlFirmada(valor, { bucket } = {}) {
  const bruto = typeof valor === 'string' ? valor.trim() : '';

  // Lo que no hay que firmar se devuelve ya resuelto en el primer render, sin
  // parpadeo: un `data:` de recorte o una URL ajena al bucket.
  const inmediato = bruto && !rutaDeUrl(bruto, bucket) ? bruto : null;

  const [firmada, setFirmada] = useState(inmediato);

  useEffect(() => {
    if (!bruto) { setFirmada(null); return; }

    const directa = !rutaDeUrl(bruto, bucket) ? bruto : null;
    if (directa) { setFirmada(directa); return; }

    let vigente = true;
    setFirmada(null);
    firmarUrl(bruto, { bucket }).then(url => { if (vigente) setFirmada(url); });
    return () => { vigente = false; };
  }, [bruto, bucket]);

  return firmada;
}

export default useUrlFirmada;
