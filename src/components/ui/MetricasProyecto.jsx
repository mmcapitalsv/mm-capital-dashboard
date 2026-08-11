import React from 'react';
import { usePrefs } from '../../context/usePrefs';
import { montoCorto, montoExacto } from '../../lib/formato';
import { aNumeroSeguro } from '../../lib/numeros';

/**
 * Las DOS métricas de un proyecto, presentadas por separado.
 *
 * Por qué existe este archivo: antes la tarjeta mostraba
 *
 *     Ejecutado   $32,000 (15%)
 *
 * donde el 15% era el avance FÍSICO del checklist. Un socio lo leía como
 * «$32,000 son el 15% del presupuesto», cuando en realidad eran el 40%. No es
 * que el 15% estuviera mal calculado —es un dato correcto y útil— sino que
 * estaba puesto junto a una cifra de dinero, y la vecindad lo convertía en otra
 * cosa. Las dos métricas miden cosas distintas y aquí no vuelven a mezclarse:
 *
 *   · Avance de obra        = hitos del checklist completados
 *   · Ejecución financiera  = presupuesto consumido
 *
 * Además llevan colores distintos a propósito. El avance de obra usa el dorado
 * de marca; la ejecución financiera usa color semántico (verde / ámbar / rojo)
 * porque ahí sí importa si la cifra es sana o preocupante.
 */

/** Grado de salud del gasto: por debajo del 75% va holgado; el 100% es sobregiro. */
/* Sin `export`: nadie más la usa y exportarla desde un archivo de componentes
   deja el módulo entero fuera del Fast Refresh. */
function gradoFinanciero(porcentaje) {
  const p = aNumeroSeguro(porcentaje);
  if (p > 100) return 'sobregiro';
  if (p >= 75) return 'ajustado';
  return 'holgado';
}

const TONO_FINANCIERO = {
  holgado:   { barra: 'bg-emerald-500', texto: 'text-emerald-700 dark:text-emerald-300' },
  ajustado:  { barra: 'bg-amber-500',   texto: 'text-amber-700 dark:text-amber-300' },
  sobregiro: { barra: 'bg-red-500',     texto: 'text-red-700 dark:text-red-300' }
};

/**
 * Barra de progreso con su etiqueta y su porcentaje.
 *
 * `compacta` la usa el carrusel móvil, donde hay menos alto disponible.
 */
export function BarraMetrica({
  etiqueta, porcentaje, colorBarra, colorTexto, detalle, tituloDetalle, compacta = false
}) {
  const pct = Math.max(0, Math.min(100, Math.round(aNumeroSeguro(porcentaje))));
  // El valor real puede pasar de 100 (sobregiro); la barra se llena, el número no miente
  const real = Math.round(aNumeroSeguro(porcentaje));

  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className={`font-bold uppercase tracking-wider text-mm-2 dark:text-zinc-400 ${compacta ? 'text-[11px]' : 'text-[11px]'} leading-tight`}>
          {etiqueta}
        </span>
        <span className={`font-black tabular-nums flex-shrink-0 ${compacta ? 'text-sm' : 'text-base'} ${colorTexto}`}>
          {real}%
        </span>
      </div>
      <div className={`w-full rounded-full overflow-hidden bg-slate-100 dark:bg-zinc-700 mt-1.5 ${compacta ? 'h-1.5' : 'h-2'}`}>
        <div
          className={`h-full rounded-full transition-all duration-700 ease-out ${colorBarra}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {detalle && (
        <p
          title={tituloDetalle}
          className={`text-mm-3 dark:text-zinc-400 mt-1.5 tabular-nums ${compacta ? 'text-[11px]' : 'text-xs'} leading-tight`}
        >
          {detalle}
        </p>
      )}
    </div>
  );
}

/** Avance de obra: hitos completados del checklist. Siempre en dorado de marca. */
export function AvanceObra({ proyecto, compacta = false }) {
  const { t } = usePrefs();
  const hechos = aNumeroSeguro(proyecto?.hitosCompletados);
  const total = aNumeroSeguro(proyecto?.hitosTotales);

  return (
    <BarraMetrica
      compacta={compacta}
      etiqueta={t('metrica.avanceObra')}
      porcentaje={proyecto?.avanceFisico}
      colorBarra="bg-mm-oro"
      colorTexto="text-mm-oro-tinta dark:text-mm-oro-claro"
      detalle={total > 0 ? t('metrica.hitosDe', { hechos, total }) : t('dash.sinHitos')}
    />
  );
}

/**
 * Ejecución financiera: presupuesto consumido, con los montos que lo sustentan.
 * Es la métrica que antes se confundía con la de arriba.
 */
export function EjecucionFinanciera({ proyecto, compacta = false }) {
  const { t, locale } = usePrefs();
  const gastado = aNumeroSeguro(proyecto?.totalGastado);
  const presupuesto = aNumeroSeguro(proyecto?.presupuesto_total);
  const pct = aNumeroSeguro(proyecto?.porcentajeGastado);
  const tono = TONO_FINANCIERO[gradoFinanciero(pct)];

  return (
    <BarraMetrica
      compacta={compacta}
      etiqueta={t('metrica.ejecucionFinanciera')}
      porcentaje={pct}
      colorBarra={tono.barra}
      colorTexto={tono.texto}
      /* En la tarjeta móvil la frase completa no cabe y se recortaba con
         puntos suspensivos justo sobre la cifra del presupuesto, que es
         precisamente el dato. La versión corta dice lo mismo con los dos
         importes intactos, y el `title` sigue dando las cifras exactas. */
      detalle={t(compacta ? 'metrica.dePresupuestoCorto' : 'metrica.dePresupuesto', {
        gastado: montoCorto(gastado, locale),
        presupuesto: montoCorto(presupuesto, locale)
      })}
      tituloDetalle={`${montoExacto(gastado, locale)} / ${montoExacto(presupuesto, locale)}`}
    />
  );
}

/**
 * Las dos juntas, apiladas. Es la forma en que deben aparecer siempre que haya
 * sitio: separadas, etiquetadas y con la de obra primero.
 */
export default function MetricasProyecto({ proyecto, compacta = false, className = '' }) {
  if (!proyecto) return null;
  return (
    <div className={`space-y-3 min-w-0 ${className}`}>
      <AvanceObra proyecto={proyecto} compacta={compacta} />
      <EjecucionFinanciera proyecto={proyecto} compacta={compacta} />
    </div>
  );
}
