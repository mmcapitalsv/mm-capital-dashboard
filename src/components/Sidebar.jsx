import React from 'react';
import { Home, FolderOpen, Shield, MessageSquare, User, LogOut } from 'lucide-react';
import { usePrefs } from '../context/PreferenciasContext';

export default function Sidebar({ currentView, setCurrentView, onLogout }) {
  const { t } = usePrefs();

  const menuItems = [
    { id: 'portfolio', icon: Home, label: t('nav.dashboard') },
    { id: 'all-projects', icon: FolderOpen, label: t('nav.proyectos') },
    { id: 'vault', icon: Shield, label: t('nav.boveda') },
    { id: 'chat', icon: MessageSquare, label: t('nav.chat') },
    { id: 'profile', icon: User, label: t('nav.perfil') },
  ];

  return (
    <aside className="w-64 bg-[#0B1B2C] dark:bg-zinc-900 border-r border-white/5 dark:border-zinc-800 h-screen hidden md:flex flex-col sticky top-0 shadow-xl">
      <div className="p-6 h-20 flex items-center border-b border-white/5 dark:border-zinc-800">
        <img src="/logo1.png" alt="MM Capital" className="h-10 w-auto" style={{ filter: 'brightness(0) invert(1)' }} />
      </div>
      <nav className="flex-1 px-4 py-6 overflow-y-auto">
        <ul className="space-y-2">
          {menuItems.map(item => (
            <li key={item.id}>
              <button
                onClick={() => setCurrentView(item.id)}
                className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-xl transition-all duration-200 ${
                  currentView === item.id 
                    ? 'bg-[#C5A059]/20 text-[#C5A059] border border-[#C5A059]/30 shadow-sm' 
                    : 'text-white/50 hover:bg-white/5 hover:text-white'
                }`}
              >
                <item.icon size={20} className={currentView === item.id ? 'text-[#C5A059]' : 'text-white/40'} />
                <span className="font-semibold text-[13px] tracking-wide">{item.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <div className="p-4 border-t border-white/5 dark:border-zinc-800">
        <button
          onClick={onLogout}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-white/40 hover:text-white hover:bg-white/5 transition-colors text-xs font-semibold"
        >
          <LogOut size={16} />
          <span>{t('perfil.cerrarSesion')}</span>
        </button>
      </div>
    </aside>
  );
}
