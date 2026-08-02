import React, { createContext, useContext, useState, useMemo, useCallback } from 'react';

/**
 * Estado compartido del chat corporativo.
 *
 * El recuadro del Sidebar y el canal "general" del módulo de Chat leen y
 * escriben el MISMO arreglo, así que lo que se escribe en uno aparece
 * inmediatamente en el otro.
 *
 * Los mensajes iniciales son claves de traducción; los que escribe el usuario
 * llevan texto literal (no se traducen). Cuando exista la tabla `mensajes` en
 * Supabase, `enviarMensaje` hará el insert y Realtime empujará al mismo estado.
 */

const CANAL_POR_DEFECTO = 'general';

const MENSAJES_INICIALES = {
  general: [
    { id: 'g1', autor: 'Giovanni Morales', propio: false, claveTexto: 'chatMsg.g1', hora: '09:12' },
    { id: 'g2', autor: 'Luis Panameño',    propio: true,  claveTexto: 'chatMsg.g2', hora: '09:15' },
    { id: 'g3', autor: 'Marcela Rivas',    propio: false, claveTexto: 'chatMsg.g3', hora: '09:31' }
  ],
  obra: [
    { id: 'o1', autor: 'Ing. Residente', propio: false, claveTexto: 'chatMsg.o1', hora: '08:40' },
    { id: 'o2', autor: 'Luis Panameño',  propio: true,  claveTexto: 'chatMsg.o2', hora: '08:52' }
  ],
  finanzas: [
    { id: 'f1', autor: 'Contabilidad', propio: false, claveTexto: 'chatMsg.f1', hora: '11:05' }
  ],
  socios: [
    { id: 's1', autor: 'Giovanni Morales', propio: false, claveTexto: 'chatMsg.s1', hora: '16:20' }
  ]
};

const ChatContext = createContext(null);

export function ChatProvider({ children, usuarioNombre = 'Luis Panameño' }) {
  const [mensajes, setMensajes] = useState(MENSAJES_INICIALES);

  /**
   * Añade un mensaje al canal indicado.
   * @returns {boolean} false si el texto estaba vacío
   */
  const enviarMensaje = useCallback((texto, canal = CANAL_POR_DEFECTO) => {
    const limpio = String(texto || '').trim();
    if (!limpio) return false;

    const ahora = new Date();
    const nuevo = {
      id: `${canal}-${ahora.getTime()}-${Math.random().toString(36).slice(2, 7)}`,
      autor: usuarioNombre,
      propio: true,
      texto: limpio,                 // texto del usuario: se muestra tal cual
      hora: ahora.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMensajes(prev => ({ ...prev, [canal]: [...(prev[canal] || []), nuevo] }));
    return true;
  }, [usuarioNombre]);

  const valor = useMemo(() => ({
    mensajes,
    mensajesGeneral: mensajes[CANAL_POR_DEFECTO] || [],
    enviarMensaje,
    CANAL_POR_DEFECTO
  }), [mensajes, enviarMensaje]);

  return <ChatContext.Provider value={valor}>{children}</ChatContext.Provider>;
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat debe usarse dentro de <ChatProvider>');
  return ctx;
}
