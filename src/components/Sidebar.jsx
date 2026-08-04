import React, { useState } from 'react';
import { Home, FolderOpen, Shield, MessageSquare, User, LogOut } from 'lucide-react';
import { motion } from 'framer-motion';
import { usePrefs } from '../context/PreferenciasContext';

/** Dorado de marca para el resaltado del menú. */
const NAV_DORADO = '#C5A059';

export default function Sidebar({ currentView, setCurrentView, onLogout }) {
  const { t } = usePrefs();
  const [hover, setHover] = useState(null);

  const menuItems = [
    { id: 'portfolio', icon: Home, label: t('nav.dashboard') },
    { id: 'all-projects', icon: FolderOpen, label: t('nav.proyectos') },
    { id: 'vault', icon: Shield, label: t('nav.boveda') },
    { id: 'chat', icon: MessageSquare, label: t('nav.chat') },
    { id: 'profile', icon: User, label: t('nav.perfil') },
  ];

  return (
    // Columna estricta: el nav absorbe el sobrante con su propio scroll y el
    // logout queda anclado abajo sin desbordar en pantallas bajas.
    <aside className="w-64 bg-[#0B1B2C] dark:bg-zinc-900 border-r border-white/5 dark:border-zinc-800 h-full hidden md:flex flex-col sticky top-0 shadow-xl overflow-hidden">
      <div className="p-6 h-20 flex items-center border-b border-white/5 dark:border-zinc-800 flex-shrink-0">
        <img src="/logo1.png" alt="MM Capital" className="h-10 w-auto" style={{ filter: 'brightness(0) invert(1)' }} />
      </div>

      {/* Efecto Berlix "Menu Vertical": el ícono entra deslizándose desde la
          izquierda y el texto se corre a su sitio, ambos tomando el dorado.
          Se conservan los íconos de lucide; por defecto todo va en blanco. */}
      <nav
        className="flex-1 min-h-0 px-4 py-6 overflow-y-auto"
        onMouseLeave={() => setHover(null)}
      >
        <ul className="space-y-2">
          {menuItems.map(item => {
            const Icon = item.icon;
            const activo = currentView === item.id;
            // Al pasar el cursor manda el hover; si no hay, manda el ítem activo
            const resaltado = hover ? hover === item.id : activo;

            return (
              <li key={item.id}>
                <button
                  onClick={() => setCurrentView(item.id)}
                  onMouseEnter={() => setHover(item.id)}
                  onFocus={() => setHover(item.id)}
                  className="w-full flex items-center gap-2 px-4 py-3.5 rounded-xl text-left focus:outline-none cursor-pointer"
                >
                  {/* El ícono se mantiene SIEMPRE visible: blanco por defecto y
                      dorado al activarse. Solo acompaña con un leve desplazamiento. */}
                  <motion.span
                    animate={{
                      x: resaltado ? 10 : 0,
                      color: resaltado ? NAV_DORADO : '#ffffff'
                    }}
                    transition={{ duration: 0.3, ease: 'easeOut' }}
                    className="flex items-center flex-shrink-0"
                  >
                    <Icon size={20} strokeWidth={2.4} />
                  </motion.span>

                  <motion.span
                    animate={{
                      x: resaltado ? 14 : 0,
                      color: resaltado ? NAV_DORADO : '#ffffff'
                    }}
                    transition={{ duration: 0.3, ease: 'easeOut' }}
                    className="text-[13px] font-semibold tracking-wider uppercase truncate"
                  >
                    {item.label}
                  </motion.span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="p-4 border-t border-white/5 dark:border-zinc-800 flex-shrink-0">
        <button
          onClick={onLogout}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-white/60 hover:text-white hover:bg-white/5 transition-colors text-xs font-semibold"
        >
          <LogOut size={16} />
          <span>{t('perfil.cerrarSesion')}</span>
        </button>
      </div>
    </aside>
  );
}
