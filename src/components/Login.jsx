import React, { useState } from 'react';
import { usePrefs } from '../context/PreferenciasContext';
import { supabase } from '../supabaseClient';
import { AlertCircle, Loader2 } from 'lucide-react';

export default function Login() {
  const { t } = usePrefs();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password) return;
    
    setLoading(true);
    setErrorMsg(null);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setErrorMsg(t('login.credencialesInvalidas'));
      setLoading(false);
    }
    // Si es exitoso, App.jsx detectará el cambio de sesión y mostrará el Dashboard
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-white px-6">
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="flex flex-col items-center mb-12">
          <img
            src="/logo1.png"
            alt="MM Capital Logo"
            className="w-52 h-auto object-contain mb-5"
          />
          <p className="text-xs text-slate-400 uppercase tracking-[0.2em] font-medium">
            {t('login.portal')}
          </p>
        </div>

        {/* Error Message */}
        {errorMsg && (
          <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-xl flex items-center gap-2 text-red-600 text-sm">
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
            className="w-full px-4 py-3.5 rounded-xl border border-gray-200 bg-white text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200 focus:border-slate-300 transition text-sm min-h-[44px]"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={loading}
          />
          <input
            id="password"
            type="password"
            placeholder={t('login.password')}
            className="w-full px-4 py-3.5 rounded-xl border border-gray-200 bg-white text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200 focus:border-slate-300 transition text-sm min-h-[44px]"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={loading}
          />

          <div className="pt-2">
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-slate-900 text-white flex items-center justify-center gap-2 font-medium py-3.5 rounded-xl hover:bg-slate-800 active:scale-[0.98] transition-all text-sm tracking-wide shadow-sm min-h-[44px] disabled:opacity-70 disabled:cursor-not-allowed"
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
        <p className="text-center text-xs text-slate-300 mt-10 tracking-wide">
          MM Capital &copy; {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
