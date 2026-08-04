import React from 'react';
import { usePrefs } from '../context/PreferenciasContext';
import { Bell, ChevronDown } from 'lucide-react';

export default function Header({ user }) {
  const { t } = usePrefs();
  return (
    <header className="h-20 bg-white dark:bg-zinc-800 border-b border-gray-200 dark:border-zinc-700 px-8 flex items-center justify-between sticky top-0 z-10">
      <div className="flex flex-col">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white leading-none">{t('dash.panelSociosMin')}</h1>
        <p className="text-[11px] text-slate-500 dark:text-zinc-200 font-medium uppercase tracking-wider mt-1">
          {t('dash.gestionInmob')}
        </p>
      </div>

      <div className="flex items-center gap-4">
        <button className="text-slate-500 dark:text-zinc-200 hover:text-slate-800 dark:hover:text-white transition-colors relative">
          <Bell size={20} />
          <span className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full border-2 border-white"></span>
        </button>
        {/* Las preferencias viven solo en el menú del avatar: aquí no va engranaje. */}
        <div className="flex items-center gap-3 ml-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-zinc-700/50 px-2 py-1 rounded-lg transition-colors">
          <div className="w-10 h-10 rounded-full border border-[#C5A059] bg-[#050D15] flex items-center justify-center">
            <span className="text-[#C5A059] font-bold text-sm tracking-wider">
              {user?.email ? user.email.substring(0, 2).toUpperCase() : 'LP'}
            </span>
          </div>
          <ChevronDown size={14} className="text-slate-400 dark:text-zinc-300" />
        </div>
      </div>
    </header>
  );
}
