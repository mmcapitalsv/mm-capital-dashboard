import React, { useState, useEffect, useRef } from 'react';
import { formatearMontoEntrada } from '../../lib/formato';

/**
 * Casilla de dinero con separador de miles mientras se escribe.
 *
 * Un `<input type="number">` NO puede mostrar comas (el navegador solo acepta
 * dígitos y punto), así que se usa un input de texto con `inputMode="decimal"`
 * —el teclado numérico del teléfono sale igual— y el formato se aplica en cada
 * tecla: al escribir 5000 se ve "5,000".
 *
 * Hacia afuera entrega el TEXTO ya formateado; quien lo recibe lo pasa por
 * `aNumero` / `aMonto` / `aAjuste`, que quitan las comas. A la base de datos
 * nunca viaja el formato, solo el número.
 *
 * Mientras la casilla tiene el foco manda lo que el usuario teclea (si no, un
 * "5000." se convertiría en "5,000" al instante y sería imposible escribir los
 * centavos); al salir, vuelve a mandar el valor real que llegó por props.
 */
export default function InputMonto({ value, onChange, className, placeholder = '0.00', ...rest }) {
  const [texto, setTexto] = useState(() => formatearMontoEntrada(value));
  const enfocado = useRef(false);

  useEffect(() => {
    if (!enfocado.current) setTexto(formatearMontoEntrada(value));
  }, [value]);

  const handleChange = (e) => {
    const formateado = formatearMontoEntrada(e.target.value);
    setTexto(formateado);
    if (typeof onChange === 'function') onChange(formateado);
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={texto}
      placeholder={placeholder}
      onChange={handleChange}
      onFocus={(e) => { enfocado.current = true; e.target.select(); }}
      onBlur={() => { enfocado.current = false; setTexto(formatearMontoEntrada(value)); }}
      className={className}
      {...rest}
    />
  );
}
