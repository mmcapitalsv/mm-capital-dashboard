import React, { useState, useEffect, Suspense, lazy } from 'react';
import Login from './components/Login';
/* El panel entra por carga diferida: arrastra `recharts`, `framer-motion` y las
   nueve vistas del producto, y nada de eso hace falta para pintar el formulario
   de acceso —que es lo primero (y a veces lo único) que ve alguien sin sesión. */
const Dashboard = lazy(() => import('./components/Dashboard'));
import { GlassFilterDefs } from './components/ui/liquid-glass-button';
import ErrorBoundary from './components/ErrorBoundary';
import CargandoVista from './components/ui/CargandoVista';
import AvisoActualizacion from './components/ui/AvisoActualizacion';
import { supabase } from './supabaseClient';
import { PreferenciasProvider } from './context/PreferenciasContext';
import { ChatProvider } from './context/ChatContext';
import { crearTraductor } from './i18n/diccionario';
import { olvidarFirmas } from './lib/urlFirmada';

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
    } = supabase.auth.onAuthStateChange((evento, session) => {
      /* Las firmas de Storage se emiten para la sesión que las pidió: al
         cerrar o cambiar de cuenta se tiran, así la cuenta siguiente no
         reutiliza enlaces de la anterior. */
      if (evento === 'SIGNED_OUT' || evento === 'SIGNED_IN') olvidarFirmas();
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
      <div className="min-h-full flex items-center justify-center bg-white dark:bg-zinc-900 text-slate-700 dark:text-zinc-200">
        {t('comun.cargando')}
      </div>
    );
  }

  return (
    /* Sin sesión iniciada se fuerza el tema claro: la pantalla de acceso
       siempre se ve en versión de día, sin importar la preferencia guardada. */
    <PreferenciasProvider forzarClaro={!currentUser}>
      {/* El chat "Socios" resuelve por sí mismo el nombre y el rol reales
          desde la ficha de `usuarios`: aquí solo necesita la sesión. */}
      <ChatProvider user={currentUser}>
        <GlassFilterDefs />
        {/* Límite exterior: un fallo aquí abajo dejaba la página EN BLANCO,
            sin siquiera un botón para recargar. Ahora se ve el aviso. */}
        <ErrorBoundary claveReinicio={currentUser?.id || 'anonimo'}>
          <Suspense fallback={<CargandoVista />}>
            {currentUser ? (
              <Dashboard user={currentUser} onLogout={handleLogout} />
            ) : (
              <Login />
            )}
          </Suspense>
        </ErrorBoundary>
        {/* Vive fuera del límite de error a propósito: si la vista falla, el
            aviso de "hay una versión nueva" es justo lo que puede arreglarlo. */}
        <AvisoActualizacion />
      </ChatProvider>
    </PreferenciasProvider>
  );
}

export default App;
