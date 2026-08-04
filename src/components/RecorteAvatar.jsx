import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Loader2, Upload, X, ZoomIn } from 'lucide-react';
import { usePrefs } from '../context/PreferenciasContext';

/**
 * Recorte de avatar con canvas nativo (sin dependencias externas).
 *
 * El usuario arrastra para encuadrar y usa el deslizador para acercar.
 * La imagen resultante siempre sale cuadrada y de tamaño fijo, así el avatar
 * pesa poco aunque suban una foto de 12 MP.
 *
 * No sube nada por su cuenta: devuelve el Blob por `onConfirmar` y quien lo
 * usa decide qué hacer. La subida solo ocurre al pulsar "Guardar y Subir".
 */

const LIENZO = 320;          // lado del área visible de encuadre, en px
const SALIDA = 512;          // lado de la imagen final, en px
const ZOOM_MIN = 1;
const ZOOM_MAX = 4;

export default function RecorteAvatar({ file, onCancel, onConfirmar, subiendo = false }) {
  const { t } = usePrefs();

  const [imagen, setImagen] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [arrastrando, setArrastrando] = useState(false);
  const [error, setError] = useState(null);

  const inicioRef = useRef({ x: 0, y: 0 });
  const objectUrlRef = useRef(null);

  // Carga la imagen elegida y libera la URL temporal al desmontar
  useEffect(() => {
    if (!file) return;

    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;

    const img = new Image();
    img.onload = () => {
      setImagen(img);
      setZoom(1);
      setOffset({ x: 0, y: 0 });
    };
    img.onerror = () => setError(t('perfil.errorLeerImagen'));
    img.src = url;

    return () => {
      URL.revokeObjectURL(url);
      objectUrlRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  /**
   * Escala mínima para que la imagen siempre cubra el lienzo.
   * Sin esto se verían franjas vacías al encuadrar una foto muy apaisada.
   */
  const escalaBase = imagen
    ? Math.max(LIENZO / imagen.width, LIENZO / imagen.height)
    : 1;

  const escala = escalaBase * zoom;
  const anchoEscalado = imagen ? imagen.width * escala : 0;
  const altoEscalado = imagen ? imagen.height * escala : 0;

  /** Impide arrastrar la imagen más allá de sus bordes. */
  const limitar = useCallback((valor, extension) => {
    const margen = Math.max(0, (extension - LIENZO) / 2);
    return Math.min(margen, Math.max(-margen, valor));
  }, []);

  // Al cambiar el zoom, reencuadra para que no queden huecos
  useEffect(() => {
    setOffset(prev => ({
      x: limitar(prev.x, anchoEscalado),
      y: limitar(prev.y, altoEscalado)
    }));
  }, [zoom, anchoEscalado, altoEscalado, limitar]);

  const alBajarPuntero = (e) => {
    setArrastrando(true);
    inicioRef.current = {
      x: e.clientX - offset.x,
      y: e.clientY - offset.y
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const alMoverPuntero = (e) => {
    if (!arrastrando) return;
    setOffset({
      x: limitar(e.clientX - inicioRef.current.x, anchoEscalado),
      y: limitar(e.clientY - inicioRef.current.y, altoEscalado)
    });
  };

  const alSoltarPuntero = (e) => {
    setArrastrando(false);
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  /** Dibuja el recorte en un canvas y lo entrega como Blob. */
  const handleGuardar = () => {
    if (!imagen) return;
    setError(null);

    try {
      const canvas = document.createElement('canvas');
      canvas.width = SALIDA;
      canvas.height = SALIDA;
      const ctx = canvas.getContext('2d');

      // Fondo por si la imagen tuviera transparencia
      ctx.fillStyle = '#0B1B2C';
      ctx.fillRect(0, 0, SALIDA, SALIDA);

      const factor = SALIDA / LIENZO;

      // Esquina superior izquierda de la imagen dentro del lienzo visible
      const izquierda = (LIENZO - anchoEscalado) / 2 + offset.x;
      const arriba = (LIENZO - altoEscalado) / 2 + offset.y;

      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(
        imagen,
        izquierda * factor,
        arriba * factor,
        anchoEscalado * factor,
        altoEscalado * factor
      );

      canvas.toBlob(
        (blob) => {
          if (!blob) { setError(t('perfil.errorRecorte')); return; }
          onConfirmar(blob);
        },
        'image/jpeg',
        0.9
      );
    } catch {
      setError(t('perfil.errorRecorte'));
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white dark:bg-zinc-800 rounded-3xl max-w-md w-full p-6 shadow-2xl border border-gray-100 dark:border-zinc-700">

        <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100 dark:border-zinc-700">
          <h3 className="text-base font-bold text-slate-900 dark:text-white">{t('perfil.encuadrarFoto')}</h3>
          <button
            onClick={onCancel}
            disabled={subiendo}
            className="text-slate-400 dark:text-zinc-200 hover:text-slate-700 dark:hover:text-white disabled:opacity-40"
          >
            <X size={18} />
          </button>
        </div>

        {/* Área de encuadre */}
        <div
          className="relative mx-auto rounded-2xl overflow-hidden bg-slate-100 dark:bg-zinc-900 touch-none select-none"
          style={{ width: LIENZO, height: LIENZO, cursor: arrastrando ? 'grabbing' : 'grab' }}
          onPointerDown={alBajarPuntero}
          onPointerMove={alMoverPuntero}
          onPointerUp={alSoltarPuntero}
          onPointerCancel={alSoltarPuntero}
        >
          {imagen ? (
            <img
              src={objectUrlRef.current}
              alt=""
              draggable={false}
              className="absolute left-1/2 top-1/2 max-w-none pointer-events-none"
              style={{
                width: anchoEscalado,
                height: altoEscalado,
                transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`
              }}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Loader2 size={24} className="animate-spin text-[#C5A059]" />
            </div>
          )}

          {/* Guía circular: muestra cómo se verá el avatar recortado */}
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute inset-0 bg-black/45" style={{ clipPath: 'polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, 50% 0, 50% 100%, 50% 100%, 50% 0, 0 0)' }} />
            <div className="absolute inset-2 rounded-full border-2 border-[#C5A059] shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
          </div>
        </div>

        {/* Zoom */}
        <div className="flex items-center gap-3 mt-4">
          <ZoomIn size={16} className="text-slate-400 dark:text-zinc-200 flex-shrink-0" />
          <input
            type="range"
            min={ZOOM_MIN}
            max={ZOOM_MAX}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            disabled={!imagen || subiendo}
            className="flex-1 accent-[#C5A059] cursor-pointer"
          />
          <span className="text-xs font-bold text-slate-500 dark:text-zinc-200 w-10 text-right tabular-nums">
            {zoom.toFixed(1)}x
          </span>
        </div>

        <p className="text-[11px] text-slate-400 dark:text-zinc-300 mt-2 text-center">
          {t('perfil.ayudaRecorte')}
        </p>

        {error && (
          <div className="mt-3 p-3 rounded-xl border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 text-xs font-semibold text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        <div className="pt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={subiendo}
            className="px-4 py-2.5 text-xs font-bold text-slate-500 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-700 rounded-xl disabled:opacity-50"
          >
            {t('comun.cancelar')}
          </button>
          <button
            onClick={handleGuardar}
            disabled={!imagen || subiendo}
            className="flex items-center gap-2 px-5 py-2.5 text-xs font-bold text-white bg-[#0B1B2C] hover:bg-slate-800 rounded-xl shadow-sm disabled:opacity-50"
          >
            {subiendo
              ? <><Loader2 size={14} className="animate-spin text-[#C5A059]" /> {t('comun.subiendo')}</>
              : <><Upload size={14} className="text-[#C5A059]" /> {t('perfil.guardarYSubir')}</>}
          </button>
        </div>
      </div>
    </div>
  );
}
