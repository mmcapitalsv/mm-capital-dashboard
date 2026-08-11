import { createContext, useContext } from 'react';

/**
 * Contexto del chat corporativo "Socios" y su hook de lectura.
 *
 * Separado de `ChatContext.jsx` por la misma razón que [usePrefs]: mezclar el
 * provider (un componente) con el hook en el mismo archivo deja el módulo
 * entero fuera del Fast Refresh.
 */
export const ChatContext = createContext(null);

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat debe usarse dentro de <ChatProvider>');
  return ctx;
}
