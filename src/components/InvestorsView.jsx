import React, { useState, useEffect, useCallback } from 'react';
import {
  Briefcase, ChevronLeft, ChevronDown, Building2, TrendingUp, ArrowUpRight,
  Wallet, Users, Plus, Trash2, Edit2, Loader2, AlertTriangle, CheckCircle2, X, Check
} from 'lucide-react';
import { usePrefs } from '../context/PreferenciasContext';
import { formatearMoneda } from '../services/finanzasService';
import {
  getInversionistas, registrarInversion, actualizarInversion, eliminarInversion, getUsuarios
} from '../services/inversionesService';
import { supabase } from '../supabaseClient';

const PALETA = ['#C5A059', '#0B1B2C', '#7C8DA6', '#8B6914'];

/** Traduce el valor de rol de la BD a la clave del diccionario. */
function claveRol(rol) {
  const mapa = {
    admin: 'admin',
    socio_administrador: 'socioAdmin',
    socio_director: 'socioDirector',
    inversionista: 'inversionista'
  };
  return mapa[rol] || 'inversionista';
}

/** Agrupa las aportaciones de un inversionista por proyecto. */
function agruparPorProyecto(aportaciones) {
  const mapa = new Map();
  for (const ap of aportaciones || []) {
    const clave = String(ap.proyectoId || 'sin-proyecto');
    if (!mapa.has(clave)) {
      mapa.set(clave, { proyectoId: ap.proyectoId, proyecto: ap.proyecto, total: 0, registros: [] });
    }
    const g = mapa.get(clave);
    g.total += Number(ap.monto) || 0;
    g.registros.push(ap);
  }
  // Registros más recientes primero dentro de cada proyecto
  for (const g of mapa.values()) {
    g.registros.sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));
  }
  return [...mapa.values()].sort((a, b) => b.total - a.total);
}

export default function InvestorsView({ onBack, proyectos = [], onAbrirProyecto, isEditMode, isAdmin }) {
  const { t } = usePrefs();

  const [inversionistas, setInversionistas] = useState([]);
  const [usuarios, setUsuarios] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [mensaje, setMensaje] = useState(null);
  const [expandido, setExpandido] = useState(null);          // tarjeta de inversionista
  const [desglose, setDesglose] = useState(null);            // `${invId}:${proyectoId}`
  const [ocupado, setOcupado] = useState(false);

  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ usuarioId: '', proyectoId: '', monto: '', nota: '' });
  const [editandoAp, setEditandoAp] = useState(null);        // { id, monto, nota }

  const listaProyectos = Array.isArray(proyectos) ? proyectos.filter(Boolean) : [];
  const puedeEditar = isAdmin && isEditMode;

  const cargar = useCallback(async () => {
    setCargando(true);
    const [inv, usr] = await Promise.all([getInversionistas(), getUsuarios()]);
    setInversionistas(inv.inversionistas);
    setUsuarios(usr.usuarios);
    if (inv.error) setMensaje({ tipo: 'error', texto: inv.error });
    setCargando(false);
  }, []);

  useEffect(() => {
    cargar();
    const canal = supabase
      .channel('inversionistas')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'aportaciones' }, cargar)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'usuarios' }, cargar)
      .subscribe();
    return () => { supabase.removeChannel(canal); };
  }, [cargar]);

  const capitalGlobal = inversionistas.reduce((s, i) => s + (Number(i.total) || 0), 0);

  const avisar = (tipo, texto) => {
    setMensaje({ tipo, texto });
    if (tipo === 'exito') setTimeout(() => setMensaje(null), 5000);
  };

  /** Abre el modal ya apuntando al inversionista de la tarjeta. */
  const abrirModal = (usuarioId = '') => {
    setForm({
      usuarioId: usuarioId || usuarios[0]?.id || '',
      proyectoId: listaProyectos[0]?.id || '',
      monto: '',
      nota: ''
    });
    setMensaje(null);
    setShowModal(true);
  };

  const handleRegistrar = async (e) => {
    e.preventDefault();
    setOcupado(true);
    setMensaje(null);

    const { success, error } = await registrarInversion(form);
    setOcupado(false);

    if (success) {
      setShowModal(false);
      avisar('exito', t('inv.registrada'));
      await cargar();
    } else {
      avisar('error', error);
    }
  };

  const handleGuardarEdicion = async (e) => {
    e.preventDefault();
    if (!editandoAp?.id) return;

    setOcupado(true);
    const { success, error } = await actualizarInversion(editandoAp.id, {
      monto: editandoAp.monto,
      nota: editandoAp.nota
    });
    setOcupado(false);

    if (success) {
      setEditandoAp(null);
      avisar('exito', t('inv.actualizada'));
      await cargar();
    } else {
      avisar('error', error);
    }
  };

  const handleEliminar = async (ap, nombre) => {
    if (!confirm(t('dlg.eliminarInversion', { monto: formatearMoneda(ap.monto), nombre }))) return;

    setOcupado(true);
    const { success, error } = await eliminarInversion(ap.id);
    setOcupado(false);

    if (success) { avisar('exito', t('inv.eliminada')); await cargar(); }
    else avisar('error', error);
  };

  return (
    <main className="flex-1 flex flex-col overflow-hidden bg-[#F5F6F8] dark:bg-zinc-900">

      {/* Cabecera */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-6 md:px-8 py-5 border-b border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="w-8 h-8 rounded-full border border-gray-200 dark:border-zinc-700 flex items-center justify-center text-slate-400 dark:text-zinc-200 hover:text-slate-700 dark:hover:text-white transition-all"
          >
            <ChevronLeft size={18} />
          </button>
          <div className="flex items-center gap-2.5 min-w-0">
            {/* Sin cuadro oscuro: fondo dorado tenue, igual que el resto */}
            <div className="w-10 h-10 rounded-2xl bg-amber-100/80 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-500/30 flex items-center justify-center flex-shrink-0">
              <Briefcase size={20} className="text-[#8B6914] dark:text-[#E3C77B]" />
            </div>
            <div className="min-w-0">
              <h2 className="text-[17px] md:text-xl font-bold text-slate-900 dark:text-white leading-tight">{t('inv.titulo')}</h2>
              <p className="text-[11px] md:text-xs text-slate-500 dark:text-zinc-200 font-medium leading-snug">{t('inv.subtitulo')}</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {puedeEditar && (
            <button
              onClick={() => abrirModal()}
              disabled={ocupado}
              className="flex items-center gap-2 bg-[#0B1B2C] text-white text-xs font-bold px-4 py-2.5 rounded-xl hover:bg-slate-800 transition-colors shadow-sm disabled:opacity-50"
            >
              <Plus size={15} className="text-[#C5A059]" /> {t('inv.registrar')}
            </button>
          )}
          <div className="flex flex-col items-end">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-zinc-200">{t('inv.capitalGlobal')}</span>
            <span className="text-lg font-black text-slate-900 dark:text-white">{formatearMoneda(capitalGlobal)}</span>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 md:p-8">
        <div className="max-w-4xl mx-auto space-y-4">

          {mensaje && (
            <div className={`p-4 rounded-2xl border flex items-start gap-3 text-xs font-semibold ${
              mensaje.tipo === 'exito'
                ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30'
                : 'bg-red-50 dark:bg-red-500/10 text-red-800 dark:text-red-300 border-red-200 dark:border-red-500/30'
            }`}>
              {mensaje.tipo === 'exito'
                ? <CheckCircle2 size={16} className="flex-shrink-0 mt-px" />
                : <AlertTriangle size={16} className="flex-shrink-0 mt-px" />}
              <span>{mensaje.texto}</span>
            </div>
          )}

          {cargando ? (
            <div className="flex items-center justify-center gap-3 py-16 text-slate-400 dark:text-zinc-200">
              <Loader2 size={20} className="animate-spin text-[#C5A059]" />
              <span className="text-sm font-semibold">{t('inv.cargando')}</span>
            </div>
          ) : inversionistas.length === 0 ? (
            <div className="border border-dashed border-gray-300 dark:border-zinc-600 rounded-2xl bg-white/50 dark:bg-zinc-800/50 py-14 px-6 text-center">
              <Users size={28} className="text-slate-300 dark:text-zinc-600 mx-auto mb-3" />
              <p className="text-sm font-bold text-slate-600 dark:text-zinc-300">{t('inv.vacio')}</p>
              <p className="text-xs text-slate-400 dark:text-zinc-300 mt-1 max-w-md mx-auto">
                {puedeEditar ? t('inv.vacioAdmin') : t('inv.vacioAyuda')}
              </p>
            </div>
          ) : inversionistas.map((inv, idx) => {
            const abierto = expandido === inv.id;
            const iniciales = (inv.nombre || '??').split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase();
            const pctPortafolio = capitalGlobal > 0 ? (inv.total / capitalGlobal) * 100 : 0;
            const grupos = agruparPorProyecto(inv.aportaciones);

            return (
              <div key={inv.id} className="bg-white dark:bg-zinc-800 rounded-[20px] border border-gray-100 dark:border-zinc-700 shadow-sm overflow-hidden transition-shadow hover:shadow-md">

                <button
                  onClick={() => setExpandido(abierto ? null : inv.id)}
                  aria-expanded={abierto}
                  className="w-full flex flex-col md:flex-row md:items-center gap-3 md:gap-4 p-4 md:p-5 text-left hover:bg-slate-50/70 dark:hover:bg-zinc-700/40 transition-colors"
                >
                  <div className="flex items-center gap-3 md:gap-4 min-w-0 md:flex-1">
                    <div
                      className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 border-2 border-[#C5A059] text-white font-black text-sm overflow-hidden"
                      style={{ backgroundColor: PALETA[idx % PALETA.length] }}
                    >
                      {inv.avatarUrl
                        ? <img src={inv.avatarUrl} alt="" className="w-full h-full object-cover" />
                        : iniciales}
                    </div>

                    {/* Nombre y correo COMPLETOS: parten en varias líneas antes
                        que recortarse con puntos suspensivos. */}
                    <div className="flex-1 min-w-0">
                      <h3 className="text-[15px] md:text-base font-bold text-slate-900 dark:text-white leading-tight">{inv.nombre}</h3>
                      {inv.rol && <p className="text-xs text-[#C5A059] font-bold mt-0.5">{t(`rol.${claveRol(inv.rol)}`)}</p>}
                      <p className="text-[11px] text-slate-400 dark:text-zinc-300 break-all leading-snug mt-0.5">{inv.email}</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3 md:justify-end border-t md:border-t-0 border-gray-100 dark:border-zinc-700 pt-3 md:pt-0">
                    <div className="text-left md:text-right flex-shrink-0">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-zinc-200">{t('inv.capitalTotal')}</p>
                      <p className="text-lg md:text-xl font-black text-slate-900 dark:text-white leading-tight">
                        {formatearMoneda(inv.total)}
                      </p>
                      <p className="text-[11px] text-slate-400 dark:text-zinc-300 font-semibold">
                        {pctPortafolio.toFixed(1)}% {t('inv.delPortafolio')}
                      </p>
                    </div>

                    <ChevronDown
                      size={20}
                      className={`text-slate-300 dark:text-zinc-300 flex-shrink-0 transition-transform duration-300 ${abierto ? 'rotate-180' : ''}`}
                    />
                  </div>
                </button>

                {abierto && (
                  <div className="border-t border-gray-100 dark:border-zinc-700 bg-slate-50/60 dark:bg-zinc-900/40 px-5 py-4">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-zinc-200 flex items-center gap-1.5">
                        <TrendingUp size={12} className="text-[#C5A059]" /> {t('inv.desglose')}
                      </p>

                      {/* Alta de aportación para ESTE inversionista */}
                      {puedeEditar && (
                        <button
                          onClick={() => abrirModal(inv.id)}
                          disabled={ocupado}
                          className="flex items-center gap-1.5 text-[11px] font-bold text-[#8B6914] dark:text-[#E3C77B] bg-[#FAF4EA] dark:bg-amber-500/15 border border-[#F0E2CD] dark:border-amber-500/30 px-3 py-1.5 rounded-xl hover:bg-[#F3E7D3] transition-colors disabled:opacity-50"
                        >
                          <Plus size={13} className="text-[#C5A059]" /> {t('inv.agregarInversion')}
                        </button>
                      )}
                    </div>

                    <div className="space-y-2.5">
                      {grupos.map((g) => {
                        const proyecto = listaProyectos.find(p => String(p.id) === String(g.proyectoId));
                        const pct = inv.total > 0 ? (g.total / inv.total) * 100 : 0;
                        const claveDesglose = `${inv.id}:${g.proyectoId}`;
                        const desplegado = desglose === claveDesglose;

                        return (
                          <div key={claveDesglose} className="bg-white dark:bg-zinc-800 rounded-xl border border-gray-100 dark:border-zinc-700 overflow-hidden">
                            <div className="p-3.5">
                              <div className="flex items-center justify-between gap-3 mb-2">
                                <div className="flex items-center gap-2 min-w-0">
                                  <Building2 size={14} className="text-[#C5A059] flex-shrink-0" />
                                  <span className="text-sm font-bold text-slate-800 dark:text-zinc-100 truncate uppercase">
                                    {g.proyecto || t('inv.proyectoNoDisponible')}
                                  </span>
                                </div>
                                <span className="text-sm font-black text-slate-900 dark:text-white flex-shrink-0">
                                  {formatearMoneda(g.total)}
                                </span>
                              </div>

                              <div className="h-1.5 w-full bg-slate-100 dark:bg-zinc-700 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-[#C5A059] rounded-full transition-all duration-500"
                                  style={{ width: `${Math.min(100, pct)}%` }}
                                />
                              </div>

                              <div className="flex items-center justify-between mt-2.5 gap-2">
                                <span className="text-[11px] text-slate-400 dark:text-zinc-300 font-semibold">
                                  {pct.toFixed(1)}% {t('inv.deSuCapital')}
                                </span>

                                <div className="flex items-center gap-2 flex-shrink-0">
                                  {/* Acordeón con los registros individuales */}
                                  <button
                                    onClick={() => setDesglose(desplegado ? null : claveDesglose)}
                                    aria-expanded={desplegado}
                                    className="flex items-center gap-1 text-[11px] font-bold text-slate-600 dark:text-zinc-300 bg-slate-50 dark:bg-zinc-700/60 border border-gray-200 dark:border-zinc-600 px-2.5 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-zinc-700 transition-colors"
                                  >
                                    {t('inv.desgloseBtn')} ({g.registros.length})
                                    <ChevronDown size={12} className={`transition-transform duration-300 ${desplegado ? 'rotate-180' : ''}`} />
                                  </button>

                                  {proyecto ? (
                                    <button
                                      onClick={() => onAbrirProyecto?.(proyecto)}
                                      className="text-[11px] font-bold text-[#8B6914] dark:text-[#E3C77B] hover:underline flex items-center gap-1"
                                    >
                                      {t('inv.verProyecto')} <ArrowUpRight size={12} />
                                    </button>
                                  ) : (
                                    <span className="text-[11px] text-slate-300 dark:text-zinc-600 font-semibold">
                                      {t('inv.proyectoNoDisponible')}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>

                            {/* ── Desglose: cada registro de `aportaciones` ── */}
                            {desplegado && (
                              <div className="border-t border-gray-100 dark:border-zinc-700 bg-slate-50/70 dark:bg-zinc-900/50 divide-y divide-gray-100 dark:divide-zinc-700">
                                {g.registros.map((ap) => {
                                  const enEdicion = editandoAp?.id === ap.id;

                                  if (enEdicion) {
                                    return (
                                      <form key={ap.id} onSubmit={handleGuardarEdicion} className="p-3 flex flex-col sm:flex-row sm:items-center gap-2">
                                        <div className="flex items-center gap-1 flex-shrink-0">
                                          <span className="text-xs font-black text-slate-500 dark:text-zinc-200">$</span>
                                          <input
                                            type="text"
                                            inputMode="decimal"
                                            value={editandoAp.monto}
                                            onChange={(e) => setEditandoAp({ ...editandoAp, monto: e.target.value })}
                                            className="w-24 bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-600 rounded-lg px-2 py-1.5 text-xs font-bold text-slate-800 dark:text-zinc-100 focus:outline-none focus:border-[#C5A059]"
                                            autoFocus
                                          />
                                        </div>
                                        <input
                                          type="text"
                                          value={editandoAp.nota}
                                          onChange={(e) => setEditandoAp({ ...editandoAp, nota: e.target.value })}
                                          placeholder={t('inv.notaPh')}
                                          className="flex-1 min-w-0 bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-600 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 dark:text-zinc-200 focus:outline-none focus:border-[#C5A059]"
                                        />
                                        <div className="flex items-center gap-1.5 flex-shrink-0">
                                          <button
                                            type="submit"
                                            disabled={ocupado}
                                            className="p-1.5 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 rounded-lg border border-gray-200 dark:border-zinc-600 bg-white dark:bg-zinc-800 disabled:opacity-40"
                                            title={t('comun.guardar')}
                                          >
                                            {ocupado ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => setEditandoAp(null)}
                                            className="p-1.5 text-slate-400 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-700 rounded-lg border border-gray-200 dark:border-zinc-600 bg-white dark:bg-zinc-800"
                                            title={t('comun.cancelar')}
                                          >
                                            <X size={13} />
                                          </button>
                                        </div>
                                      </form>
                                    );
                                  }

                                  return (
                                    <div key={ap.id} className="p-3 flex items-center gap-3">
                                      <span className="text-[11px] font-mono text-slate-400 dark:text-zinc-300 flex-shrink-0 w-20">
                                        {ap.fecha || '—'}
                                      </span>
                                      <span className="text-xs font-black text-slate-900 dark:text-white flex-shrink-0 w-24">
                                        {formatearMoneda(ap.monto)}
                                      </span>
                                      <span className="text-[11px] text-slate-500 dark:text-zinc-200 flex-1 min-w-0 truncate">
                                        {ap.nota || t('inv.sinNota')}
                                      </span>

                                      {puedeEditar && (
                                        <div className="flex items-center gap-1.5 flex-shrink-0">
                                          <button
                                            onClick={() => setEditandoAp({ id: ap.id, monto: String(ap.monto), nota: ap.nota || '' })}
                                            disabled={ocupado}
                                            className="p-1.5 text-slate-400 dark:text-zinc-200 hover:text-[#C5A059] hover:bg-amber-50 dark:hover:bg-amber-500/10 rounded-lg transition-colors disabled:opacity-40"
                                            title={t('comun.editar')}
                                          >
                                            <Edit2 size={13} />
                                          </button>
                                          <button
                                            onClick={() => handleEliminar(ap, inv.nombre)}
                                            disabled={ocupado}
                                            className="p-1.5 text-slate-300 dark:text-zinc-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-40"
                                            title={t('inv.eliminarAportacion')}
                                          >
                                            <Trash2 size={13} />
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    <div className="mt-3.5 pt-3 border-t border-gray-200 dark:border-zinc-700 flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-500 dark:text-zinc-200 flex items-center gap-1.5">
                        <Wallet size={13} className="text-[#C5A059]" />
                        {grupos.length} {t('inv.proyectosActivos')}
                      </span>
                      <span className="text-sm font-black text-slate-900 dark:text-white">
                        {formatearMoneda(inv.total)}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Modal: registrar inversión ── */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-800 rounded-3xl max-w-md w-full p-6 shadow-2xl border border-gray-100 dark:border-zinc-700">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100 dark:border-zinc-700">
              <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Briefcase size={18} className="text-[#C5A059]" /> {t('inv.registrar')}
              </h3>
              <button onClick={() => setShowModal(false)} className="text-slate-400 dark:text-zinc-200 hover:text-slate-700 dark:hover:text-white">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleRegistrar} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-zinc-300 mb-1 uppercase">{t('inv.socio')}</label>
                <select
                  value={form.usuarioId}
                  onChange={(e) => setForm({ ...form, usuarioId: e.target.value })}
                  required
                  className="w-full bg-slate-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-slate-800 dark:text-zinc-100 focus:outline-none focus:border-[#C5A059] cursor-pointer"
                >
                  {usuarios.length === 0 && <option value="">{t('inv.sinUsuarios')}</option>}
                  {usuarios.map(u => (
                    <option key={u.id} value={u.id}>{u.nombre_completo || u.email} — {u.email}</option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-400 dark:text-zinc-300 mt-1">{t('inv.soloRegistrados')}</p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-zinc-300 mb-1 uppercase">{t('inv.proyecto')}</label>
                <select
                  value={form.proyectoId}
                  onChange={(e) => setForm({ ...form, proyectoId: e.target.value })}
                  required
                  className="w-full bg-slate-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-slate-800 dark:text-zinc-100 focus:outline-none focus:border-[#C5A059] cursor-pointer"
                >
                  {listaProyectos.length === 0 && <option value="">{t('dash.sinProyectos')}</option>}
                  {listaProyectos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-zinc-300 mb-1 uppercase">{t('inv.monto')}</label>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-black text-slate-500 dark:text-zinc-200">$</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    placeholder="5000"
                    value={form.monto}
                    onChange={(e) => setForm({ ...form, monto: e.target.value })}
                    className="flex-1 min-w-0 bg-slate-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-slate-800 dark:text-zinc-100 focus:outline-none focus:border-[#C5A059]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-zinc-300 mb-1 uppercase">{t('inv.concepto')}</label>
                <input
                  type="text"
                  placeholder={t('inv.conceptoPh')}
                  value={form.nota}
                  onChange={(e) => setForm({ ...form, nota: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-slate-800 dark:text-zinc-100 focus:outline-none focus:border-[#C5A059]"
                />
              </div>

              {mensaje?.tipo === 'error' && (
                <div className="p-3 rounded-xl border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 text-xs font-semibold text-red-700 dark:text-red-300">
                  {mensaje.texto}
                </div>
              )}

              <div className="pt-2 flex justify-end gap-2">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2.5 text-xs font-bold text-slate-500 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-700 rounded-xl">
                  {t('comun.cancelar')}
                </button>
                <button
                  type="submit"
                  disabled={ocupado || usuarios.length === 0 || listaProyectos.length === 0}
                  className="flex items-center gap-2 px-5 py-2.5 text-xs font-bold text-white bg-[#0B1B2C] hover:bg-slate-800 rounded-xl shadow-sm disabled:opacity-50"
                >
                  {ocupado && <Loader2 size={14} className="animate-spin text-[#C5A059]" />}
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
