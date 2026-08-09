import React, { useState } from 'react';
import { usePrefs } from '../context/PreferenciasContext';
import { supabase } from '../supabaseClient';
import { AlertCircle, Eye, EyeOff, Loader2 } from 'lucide-react';
import TubesCursor from './ui/tubes-curor';

export default function Login() {
  const { t } = usePrefs();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password) return;

    setLoading(true);
    setErrorMsg(null);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        // Se distingue el correo sin confirmar de unas credenciales erróneas:
        // con el mensaje genérico el usuario no sabría que solo le falta
        // validar su correo.
        const esSinConfirmar = /email not confirmed|not confirmed/i.test(error.message || '');
        setErrorMsg(esSinConfirmar ? t('login.correoSinConfirmar') : t('login.credencialesInvalidas'));
        setLoading(false);
      }
      // Si es exitoso, App.jsx detectará el cambio de sesión y mostrará el Dashboard
    } catch (err) {
      setErrorMsg(t('login.errorConexion'));
      setLoading(false);
      console.error('Error de inicio de sesión:', err);
    }
  };

  return (
    <div className="relative min-h-full flex items-center justify-center bg-zinc-950 px-6 overflow-hidden">

      {/* Fondo WebGL: detrás de todo y sin capturar clics del formulario */}
      <div className="absolute inset-0 z-0 overflow-hidden">
        <TubesCursor />
      </div>

      {/* Velo suave para que el láser no compita con el texto.
          Se aligeró (40/60 → 20/40): sumado a la luz corta de los tubos, el
          velo anterior dejaba el escritorio prácticamente negro. Sigue
          bastando para que el texto de la tarjeta no pelee con el láser,
          porque la tarjeta ya aporta su propio `bg-black/40`. */}
      <div className="absolute inset-0 z-0 bg-gradient-to-b from-black/20 via-transparent to-black/40 pointer-events-none" />

      {/* Tarjeta glassmorphism.
          Medidas propias para el teléfono: esta pantalla se veía más contenida
          cuando la base tipográfica del móvil estaba al 80% (`12.8px`). Al
          subirla a 16px por legibilidad, todo lo medido en `rem` —ancho,
          padding, logo, márgenes— creció un 25% de golpe y la tarjeta pasó a
          comerse la pantalla. El código de aquí no había cambiado; cambió su
          base. Se recupera la proporción con valores explícitos en móvil, sin
          tocar el escritorio ni volver a encoger la letra. */}
      {/* `bg-black/50`, antes `/40`. Con los tubos a intensidad 500 el láser
          cruza POR DETRÁS de la tarjeta, y a `/40` los marcadores de posición
          caían sobre una banda verde brillante. A `/60` el formulario ganaba
          contraste pero la tarjeta se tragaba la luz justo donde vive el
          puntero mientras se escribe, que es la mitad del efecto. `/50` es el
          punto en que se leen las dos cosas. */}
      <div className="relative z-10 w-full max-w-[19rem] sm:max-w-sm bg-black/50 backdrop-blur-md border border-white/10 shadow-2xl rounded-3xl px-6 py-8 sm:px-8 sm:py-10">

        {/* Logo */}
        <div className="flex flex-col items-center mb-8 sm:mb-10">
          <img
            src="/logo1.png"
            alt="MM Capital Logo"
            className="w-40 sm:w-52 h-auto object-contain mb-4 sm:mb-5"
            style={{ filter: 'brightness(0) invert(1)' }}
          />
          <p className="text-[11px] text-white/50 uppercase tracking-[0.2em] font-medium">
            {t('login.portal')}
          </p>
        </div>

        {/* Error Message */}
        {errorMsg && (
          <div className="mb-4 p-3 bg-red-500/15 border border-red-400/30 rounded-xl flex items-center gap-2 text-red-200 text-sm">
            <AlertCircle size={16} />
            <p>{errorMsg}</p>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            id="email"
            type="email"
            placeholder={t('login.correo')}
            className="w-full px-4 py-3.5 rounded-xl border border-white/15 bg-white/5 text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-mm-oro/50 focus:border-mm-oro/60 transition text-sm min-h-[44px]"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={loading}
          />
          {/* pr-12 reserva el espacio del ojo para que el texto no lo pise */}
          <div className="relative">
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              placeholder={t('login.password')}
              className="w-full pl-4 pr-12 py-3.5 rounded-xl border border-white/15 bg-white/5 text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-mm-oro/50 focus:border-mm-oro/60 transition text-sm min-h-[44px]"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={loading}
            />
            <button
              type="button"
              onClick={() => setShowPassword(v => !v)}
              disabled={loading}
              aria-label={showPassword ? t('login.ocultarPass') : t('login.verPass')}
              title={showPassword ? t('login.ocultarPass') : t('login.verPass')}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-white/40 hover:text-mm-oro transition-colors focus:outline-none disabled:opacity-40"
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-white text-zinc-950 flex items-center justify-center gap-2 font-semibold py-3.5 rounded-xl hover:bg-white/90 active:scale-[0.98] transition-all text-sm tracking-wide shadow-lg min-h-[44px] disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  {t('login.verificando')}
                </>
              ) : (
                t('login.acceder')
              )}
            </button>
          </div>
        </form>

        {/* Footer */}
        <p className="text-center text-xs text-white/30 mt-10 tracking-wide">
          MM Capital &copy; {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
