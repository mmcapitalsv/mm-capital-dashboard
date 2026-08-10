import { useState } from 'react';
import { User } from 'lucide-react';

/**
 * Avatar circular con respaldo. Nunca deja el icono de "imagen rota".
 *
 * Había SEIS copias del mismo patrón repartidas por el panel:
 *
 *     {avatarUrl ? <img src={avatarUrl} … /> : <span>{iniciales}</span>}
 *
 * Ese ternario solo cubre el caso de que la URL falte. No cubre el que de
 * verdad se ve feo: que la URL EXISTA y no cargue —la foto se borró del
 * bucket, la firma del enlace caducó, no hay red—. Ahí React pinta el `<img>`
 * tal cual y el navegador dibuja su icono de imagen partida dentro del
 * círculo dorado.
 *
 * `onError` cierra ese hueco: al primer fallo de carga se marca la URL como
 * mala y se pasa al respaldo. El estado se reinicia con la propia `key` del
 * `<img>` (la URL), así que cambiar de foto vuelve a intentarlo — sin esto, un
 * fallo dejaría el avatar en respaldo para siempre, incluso tras subir una
 * imagen nueva.
 *
 * El respaldo prefiere las INICIALES cuando se conocen: identifican a la
 * persona, cosa que un icono genérico no hace. El icono de `lucide-react`
 * queda para cuando no hay ni nombre.
 */
export default function AvatarUsuario({
  url,
  iniciales,
  nombre,
  alt = '',
  className = 'w-8 h-8',
  claseTexto = 'text-[11px]',
  claseContenedor = 'bg-slate-800 border border-mm-oro',
  claseIniciales = 'text-white',
  // La lista de inversionistas colorea cada círculo con su color de paleta
  style
}) {
  const [falloUrl, setFalloUrl] = useState(null);

  const limpia = typeof url === 'string' ? url.trim() : '';
  const usable = limpia !== '' && limpia !== falloUrl;

  /* Las iniciales pueden llegar ya calculadas o deducirse del nombre. Si no
     hay ninguna de las dos, manda el icono. */
  const texto = String(
    iniciales || String(nombre || '').trim().charAt(0) || ''
  ).trim().toUpperCase();

  return (
    <span
      style={style}
      className={`${className} ${claseContenedor} rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden`}
    >
      {usable ? (
        <img
          key={limpia}
          src={limpia}
          alt={alt}
          loading="lazy"
          onError={() => setFalloUrl(limpia)}
          className="w-full h-full object-cover rounded-full"
        />
      ) : texto ? (
        <span className={`${claseTexto} ${claseIniciales} font-bold tracking-wider`}>
          {texto}
        </span>
      ) : (
        <User className="w-full h-full p-1 text-slate-400" strokeWidth={1.75} />
      )}
    </span>
  );
}
