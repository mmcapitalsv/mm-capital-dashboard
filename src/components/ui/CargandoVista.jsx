import React from 'react';
import { Loader2 } from 'lucide-react';
import { usePrefs } from '../../context/usePrefs';

/**
 * Reserva visual mientras se descarga el paquete de una vista diferida.
 *
 * Es el mismo bloque que ya usaba el detalle de proyecto al esperar a Supabase:
 * spinner dorado centrado sobre el fondo del panel. Ocupa el alto completo para
 * que la barra inferior y el menú no salten al terminar la descarga.
 */
export default function CargandoVista() {
  const { t } = usePrefs();
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 bg-white dark:bg-zinc-900">
      <Loader2 size={28} className="animate-spin text-mm-oro" />
      <p className="text-xs font-bold text-slate-400 dark:text-zinc-300">{t('comun.cargando')}</p>
    </div>
  );
}
