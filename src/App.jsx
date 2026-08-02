import React, { useState, useEffect } from 'react';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import { GlassFilterDefs } from './components/ui/liquid-glass-button';
import { supabase } from './supabaseClient';
import { PreferenciasProvider } from './context/PreferenciasContext';
import { ChatProvider } from './context/ChatContext';
import { crearTraductor } from './i18n/diccionario';

/** Idioma guardado, leído sin el contexto (aún no está montado). */
function idiomaGuardado() {
  try {
    return localStorage.getItem('mmcapital:idioma') === 'en' ? 'en' : 'es';
  } catch {
    return 'es';
  }
}

function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Verificar sesión actual al cargar
    supabase.auth.getSession().then(({ data: { session } }) => {
      setCurrentUser(session?.user ?? null);
      setLoading(false);
    });

    // Escuchar cambios de sesión (login, logout, etc.)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setCurrentUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  if (loading) {
    // Se pinta antes de montar el provider, así que el idioma se lee directo
    // de localStorage en lugar de usar el contexto.
    const t = crearTraductor(idiomaGuardado());
    return (
      <div className="min-h-screen flex items-center justify-center bg-white dark:bg-zinc-900 text-slate-700 dark:text-zinc-200">
        {t('comun.cargando')}
      </div>
    );
  }

  return (
    /* Sin sesión iniciada se fuerza el tema claro: la pantalla de acceso
       siempre se ve en versión de día, sin importar la preferencia guardada. */
    <PreferenciasProvider forzarClaro={!currentUser}>
      <ChatProvider usuarioNombre={currentUser?.email?.split('@')[0] || 'Luis Panameño'}>
        <GlassFilterDefs />
      {currentUser ? (
        <Dashboard user={currentUser} onLogout={handleLogout} />
      ) : (
        <Login />
      )}
      </ChatProvider>
    </PreferenciasProvider>
  );
}

export default App;
