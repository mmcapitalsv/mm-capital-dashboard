import React, { useState, useEffect, useCallback } from 'react';
import { usePrefs } from '../context/usePrefs';
import { useConfirmacion } from '../hooks/useConfirmacion';
import { useTemporizadores } from '../hooks/useTemporizadores';
import { supabase } from '../supabaseClient';
import { crearUsuario, actualizarUsuario } from '../services/inversionesService';
import AvatarUsuario from './ui/AvatarUsuario';
import {
  Activity, AlertTriangle, CheckCircle2, ChevronLeft, Edit2, Loader2,
  Plus, Trash2, UserCheck, Users, X
} from 'lucide-react';

// El `valor` es lo que se guarda en Supabase y NUNCA se traduce.
// La etiqueta visible sí se traduce con la clave correspondiente.
const ROLES = [
  { valor: 'admin',               clave: 'rol.admin' },
  { valor: 'socio_administrador', clave: 'rol.socioAdmin' },
  { valor: 'socio_director',      clave: 'rol.socioDirector' },
  { valor: 'inversionista',       clave: 'rol.inversionista' }
];

function etiquetaRol(rol, t) {
  const encontrado = ROLES.find(r => r.valor === rol);
  if (encontrado) return t(encontrado.clave);
  return rol || t('admin.sinRol');
}

function AdminUsersView({ onBack, currentUserId, isEditMode, isAdmin }) {
  const { t } = usePrefs();
  // Los avisos se borran solos; el temporizador se cancela al desmontar la vista
  const { programar } = useTemporizadores();
  const { confirmar, dialogoConfirmacion } = useConfirmacion();
  // El Modo Edición es la llave maestra: sin él la vista es solo lectura
  const puedeEditar = isAdmin && isEditMode;
  const [showCrear, setShowCrear] = useState(false);
  const [editando, setEditando] = useState(null);
  const [form, setForm] = useState({ nombre: '', email: '', rol: 'inversionista' });
  const [usuarios, setUsuarios] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [mensaje, setMensaje] = useState(null);
  const [guardandoId, setGuardandoId] = useState(null);

  /* `useCallback` para que el efecto de abajo pueda declararlo como
     dependencia real en vez de esconderlo con una lista vacía. */
  const cargarUsuarios = useCallback(async () => {
    setCargando(true);
    try {
      const { data, error } = await supabase
        .from('usuarios')
        .select('*')
        .order('created_at', { ascending: true });

      if (error) {
        setMensaje({ tipo: 'error', texto: t('msg.leerUsuarios', { error: error.message }) });
        setUsuarios([]);
      } else {
        setUsuarios(Array.isArray(data) ? data.filter(Boolean) : []);
      }
    } catch (err) {
      setMensaje({ tipo: 'error', texto: t('msg.errorInesperado', { error: err?.message || err }) });
      setUsuarios([]);
    } finally {
      setCargando(false);
    }
  }, [t]);

  useEffect(() => {
    cargarUsuarios();
    // Reactividad: si alguien cambia la tabla, la lista se actualiza sola
    const canal = supabase
      .channel('admin-usuarios')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'usuarios' }, cargarUsuarios)
      .subscribe();
    return () => { supabase.removeChannel(canal); };
  }, [cargarUsuarios]);

  const handleCrear = async (e) => {
    e.preventDefault();
    setGuardandoId('nuevo');
    setMensaje(null);

    const { success, error } = await crearUsuario(form);
    setGuardandoId(null);

    if (success) {
      setShowCrear(false);
      setForm({ nombre: '', email: '', rol: 'inversionista' });
      setMensaje({ tipo: 'exito', texto: t('admin.usuarioCreado') });
      await cargarUsuarios();
      programar(() => setMensaje(null), 5000);
    } else {
      setMensaje({ tipo: 'error', texto: error });
    }
  };

  const handleGuardarEdicion = async (e) => {
    e.preventDefault();
    if (!editando?.id) return;

    setGuardandoId(editando.id);
    setMensaje(null);

    const { success, error } = await actualizarUsuario(editando.id, {
      nombre: editando.nombre_completo,
      email: editando.email,
      rol: editando.rol
    });
    setGuardandoId(null);

    if (success) {
      setEditando(null);
      setMensaje({ tipo: 'exito', texto: t('admin.usuarioActualizado') });
      await cargarUsuarios();
      programar(() => setMensaje(null), 5000);
    } else {
      setMensaje({ tipo: 'error', texto: error });
    }
  };

  const handleCambiarRol = async (usuario, nuevoRol) => {
    if (!usuario?.id || nuevoRol === usuario.rol) return;

    setGuardandoId(usuario.id);
    setMensaje(null);

    // Actualización optimista: la UI responde de inmediato
    setUsuarios(prev => prev.map(u => u.id === usuario.id ? { ...u, rol: nuevoRol } : u));

    const { error } = await supabase.from('usuarios').update({ rol: nuevoRol }).eq('id', usuario.id);

    if (error) {
      setMensaje({ tipo: 'error', texto: t('msg.cambiarRol', { error: error.message }) });
      await cargarUsuarios();
    } else {
      setMensaje({ tipo: 'exito', texto: t('msg.rolCambiado', { email: usuario.email, rol: etiquetaRol(nuevoRol, t) }) });
      programar(() => setMensaje(null), 5000);
    }
    setGuardandoId(null);
  };

  const handleEliminar = async (usuario) => {
    if (!usuario?.id) return;
    if (usuario.id === currentUserId) {
      setMensaje({ tipo: 'error', texto: t('admin.noEliminarPropia') });
      return;
    }
    if (!await confirmar({
      mensaje: t('dlg.eliminarUsuario', { email: usuario.email }),
      detalle: usuario.nombre_completo || usuario.email,
      textoConfirmar: t('admin.eliminarUsuario')
    })) return;

    setGuardandoId(usuario.id);
    setMensaje(null);

    const { error } = await supabase.from('usuarios').delete().eq('id', usuario.id);

    if (error) {
      setMensaje({ tipo: 'error', texto: t('msg.noEliminar', { error: error.message }) });
    } else {
      setUsuarios(prev => prev.filter(u => u.id !== usuario.id));
      setMensaje({ tipo: 'exito', texto: t('msg.usuarioEliminado', { email: usuario.email }) });
      programar(() => setMensaje(null), 5000);
    }
    setGuardandoId(null);
  };

  return (
    <main className="flex-1 flex flex-col overflow-hidden bg-transparent">
      <div className="flex items-center justify-between px-6 md:px-8 py-5 border-b border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-slate-400 dark:text-zinc-200 hover:text-slate-700 dark:hover:text-zinc-100 transition-colors">
            <ChevronLeft size={20} />
          </button>
          <div className="flex items-center gap-2">
            <UserCheck size={20} className="text-mm-2" />
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">{t('admin.titulo')}</h2>
              <p className="text-xs text-slate-400 dark:text-zinc-200 font-medium">{t('admin.subtitulo')} <span className="font-mono">usuarios</span> {t('admin.subtituloPost')}</p>
            </div>
          </div>
        </div>
        <button
          onClick={cargarUsuarios}
          disabled={cargando}
          className="flex items-center gap-2 text-xs font-bold text-slate-600 dark:text-zinc-300 bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 px-3.5 py-2 rounded-xl hover:bg-slate-50 dark:hover:bg-zinc-700/50 transition-colors disabled:opacity-50"
        >
          {cargando ? <Loader2 size={14} className="animate-spin text-mm-3" /> : <Activity size={14} className="text-mm-oro" />}
          {t('comun.actualizar')}
        </button>
      </div>

      <div className="flex-1 p-6 md:p-8 overflow-y-auto">
        <div className="max-w-4xl space-y-4">

          {mensaje && (
            <div className={`p-4 rounded-2xl border flex items-center gap-3 text-xs font-semibold ${
              mensaje.tipo === 'exito' ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30' : 'bg-red-50 dark:bg-red-500/10 text-red-800 dark:text-red-300 border-red-200 dark:border-red-500/30'
            }`}>
              {mensaje.tipo === 'exito'
                ? <CheckCircle2 size={16} className="text-emerald-600 flex-shrink-0" />
                : <AlertTriangle size={16} className="text-red-600 flex-shrink-0" />}
              <span>{mensaje.texto}</span>
            </div>
          )}

          <div className="bg-white dark:bg-zinc-800 rounded-2xl p-6 border border-gray-100 dark:border-zinc-700 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <h3 className="text-sm font-bold text-slate-800 dark:text-zinc-100 uppercase tracking-wider">
                {t('admin.registrados')} ({usuarios.length})
              </h3>

              {puedeEditar ? (
                <button
                  onClick={() => { setForm({ nombre: '', email: '', rol: 'inversionista' }); setShowCrear(true); }}
                  className="flex items-center gap-2 bg-mm-navy text-white text-xs font-bold px-4 py-2.5 rounded-xl hover:bg-slate-800 transition-colors shadow-sm"
                >
                  <Plus size={15} className="text-mm-3" /> {t('admin.anadirUsuario')}
                </button>
              ) : isAdmin && (
                <span className="text-[11px] font-semibold text-slate-400 dark:text-zinc-300 flex items-center gap-1.5">
                  <AlertTriangle size={12} /> {t('admin.activaEdicion')}
                </span>
              )}
            </div>

            {cargando ? (
              <div className="flex items-center justify-center gap-3 py-12 text-slate-400 dark:text-zinc-200">
                <Loader2 size={20} className="animate-spin text-mm-3" />
                <span className="text-sm font-semibold">{t('admin.cargando')}</span>
              </div>
            ) : usuarios.length === 0 ? (
              <div className="border border-dashed border-gray-300 dark:border-zinc-600 rounded-2xl bg-slate-50/60 dark:bg-zinc-800/60 py-12 px-6 text-center">
                <Users size={28} className="text-slate-300 dark:text-zinc-200 mx-auto mb-3" />
                <p className="text-sm font-bold text-slate-600 dark:text-zinc-300">{t('msg.tablaVacia', { tabla: 'usuarios' })}</p>
                <p className="text-xs text-slate-400 dark:text-zinc-200 mt-1 max-w-md mx-auto">
                  {t('admin.tablaVaciaAyuda2', { archivo: '001_esquema_mmcapital.sql' })}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {usuarios.map((u) => {
                  const esYo = u.id === currentUserId;
                  const ocupado = guardandoId === u.id;
                  return (
                    <div key={u.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-slate-50 dark:bg-zinc-800 rounded-xl border border-gray-100 dark:border-zinc-700">
                      <div className="flex items-center gap-3.5 min-w-0 flex-1">
                        <AvatarUsuario
                          url={u.avatar_url}
                          iniciales={(u.email || '').substring(0, 2)}
                          className="w-10 h-10"
                          claseContenedor="bg-mm-navy border-2 border-mm-oro"
                          claseTexto="text-xs"
                          claseIniciales="text-mm-oro"
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-slate-900 dark:text-white truncate">
                            {u.nombre_completo || (u.email || '').split('@')[0] || 'Usuario'}
                            {esYo && <span className="ml-2 text-[11px] font-bold text-mm-oro-tinta dark:text-mm-oro-claro bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 px-2 py-0.5 rounded-full">{t('admin.tu')}</span>}
                          </p>
                          <p className="text-xs text-slate-400 dark:text-zinc-200 truncate">{u.email || t('fb.sinCorreo')}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 flex-shrink-0">
                        <select
                          value={u.rol || ''}
                          disabled={ocupado || !puedeEditar}
                          onChange={(e) => handleCambiarRol(u, e.target.value)}
                          className="text-xs font-semibold px-3 py-2 rounded-xl bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 text-slate-700 dark:text-zinc-200 focus:outline-none focus:border-mm-oro disabled:opacity-50 cursor-pointer"
                          title={t('admin.cambiarRol')}
                        >
                          {!u.rol && <option value="">{t('admin.sinRol')}</option>}
                          {ROLES.map(r => <option key={r.valor} value={r.valor}>{t(r.clave)}</option>)}
                        </select>

                        {puedeEditar && (
                          <button
                            onClick={() => setEditando({ ...u })}
                            disabled={ocupado}
                            className="p-2 text-slate-400 dark:text-zinc-200 hover:text-mm-oro rounded-xl hover:bg-amber-50 dark:hover:bg-amber-500/10 border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 transition-colors disabled:opacity-40"
                            title={t('admin.editarUsuario')}
                          >
                            <Edit2 size={15} />
                          </button>
                        )}

                        <button
                          onClick={() => handleEliminar(u)}
                          disabled={ocupado || esYo || !puedeEditar}
                          className="p-2 text-slate-300 dark:text-zinc-200 hover:text-red-500 rounded-xl hover:bg-red-50 border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 transition-colors disabled:opacity-30 disabled:hover:text-slate-300 disabled:hover:bg-white"
                          title={esYo ? t('admin.noEliminarTooltip') : t('admin.eliminarUsuario')}
                        >
                          {ocupado ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {dialogoConfirmacion}

      {/* ── Modal: añadir usuario ── */}
      {showCrear && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-800 rounded-3xl max-w-md w-full p-6 shadow-2xl border border-gray-100 dark:border-zinc-700">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100 dark:border-zinc-700">
              <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <UserCheck size={18} className="text-mm-oro" /> {t('admin.anadirUsuario')}
              </h3>
              <button onClick={() => setShowCrear(false)} className="text-slate-400 dark:text-zinc-200 hover:text-slate-700 dark:hover:text-white">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCrear} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-zinc-300 mb-1 uppercase">{t('admin.nombre')}</label>
                <input type="text" required value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} className="w-full bg-slate-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-slate-800 dark:text-zinc-100 focus:outline-none focus:border-mm-oro" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-zinc-300 mb-1 uppercase">{t('admin.correo')}</label>
                <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full bg-slate-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-slate-800 dark:text-zinc-100 focus:outline-none focus:border-mm-oro" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-zinc-300 mb-1 uppercase">{t('admin.rol')}</label>
                <select value={form.rol} onChange={(e) => setForm({ ...form, rol: e.target.value })} className="w-full bg-slate-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-slate-800 dark:text-zinc-100 focus:outline-none focus:border-mm-oro cursor-pointer">
                  {ROLES.map(r => <option key={r.valor} value={r.valor}>{t(r.clave)}</option>)}
                </select>
              </div>

              <p className="text-[11px] text-slate-400 dark:text-zinc-300 leading-relaxed">
                {t('admin.avisoSinAuth')}
              </p>

              <div className="pt-2 flex justify-end gap-2">
                <button type="button" onClick={() => setShowCrear(false)} className="px-4 py-2.5 text-xs font-bold text-slate-500 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-700 rounded-xl">
                  {t('comun.cancelar')}
                </button>
                <button type="submit" disabled={guardandoId === 'nuevo'} className="flex items-center gap-2 px-5 py-2.5 text-xs font-bold text-white bg-mm-navy hover:bg-slate-800 rounded-xl shadow-sm disabled:opacity-50">
                  {guardandoId === 'nuevo' && <Loader2 size={14} className="animate-spin text-mm-3" />}
                  {t('comun.guardar')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal: editar usuario ── */}
      {editando && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-800 rounded-3xl max-w-md w-full p-6 shadow-2xl border border-gray-100 dark:border-zinc-700">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100 dark:border-zinc-700">
              <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Edit2 size={18} className="text-mm-2" /> {t('admin.editarUsuario')}
              </h3>
              <button onClick={() => setEditando(null)} className="text-slate-400 dark:text-zinc-200 hover:text-slate-700 dark:hover:text-white">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleGuardarEdicion} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-zinc-300 mb-1 uppercase">{t('admin.nombre')}</label>
                <input type="text" required value={editando.nombre_completo || ''} onChange={(e) => setEditando({ ...editando, nombre_completo: e.target.value })} className="w-full bg-slate-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-slate-800 dark:text-zinc-100 focus:outline-none focus:border-mm-oro" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-zinc-300 mb-1 uppercase">{t('admin.correo')}</label>
                <input type="email" required value={editando.email || ''} onChange={(e) => setEditando({ ...editando, email: e.target.value })} className="w-full bg-slate-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-slate-800 dark:text-zinc-100 focus:outline-none focus:border-mm-oro" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-zinc-300 mb-1 uppercase">{t('admin.rol')}</label>
                <select value={editando.rol || 'inversionista'} onChange={(e) => setEditando({ ...editando, rol: e.target.value })} className="w-full bg-slate-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-slate-800 dark:text-zinc-100 focus:outline-none focus:border-mm-oro cursor-pointer">
                  {ROLES.map(r => <option key={r.valor} value={r.valor}>{t(r.clave)}</option>)}
                </select>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button type="button" onClick={() => setEditando(null)} className="px-4 py-2.5 text-xs font-bold text-slate-500 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-700 rounded-xl">
                  {t('comun.cancelar')}
                </button>
                <button type="submit" disabled={guardandoId === editando.id} className="flex items-center gap-2 px-5 py-2.5 text-xs font-bold text-white bg-mm-navy hover:bg-slate-800 rounded-xl shadow-sm disabled:opacity-50">
                  {guardandoId === editando.id && <Loader2 size={14} className="animate-spin text-mm-3" />}
                  {t('comun.guardar')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </main>
  );
}

export default AdminUsersView;
