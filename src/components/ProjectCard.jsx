import React, { useRef, useState } from 'react';
import { usePrefs } from '../context/PreferenciasContext';
import { etiquetaEstado } from '../i18n/diccionario';

export default function ProjectCard({ title, status, user }) {
  const { t } = usePrefs();
  const cardRef = useRef(null);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [isHovering, setIsHovering] = useState(false);

  const handleMouseMove = (e) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    setMousePosition({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  return (
    <div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      className="relative overflow-hidden bg-mm-navy rounded-2xl md:rounded-xl p-6 shadow-lg transition-transform md:hover:scale-[1.02] cursor-pointer"
      style={{ minHeight: '140px' }}
    >
      {/* Glow Effect (Desktop Only) */}
      <div
        className="pointer-events-none absolute inset-0 hidden md:block transition-opacity duration-300"
        style={{
          opacity: isHovering ? 1 : 0,
          background: `radial-gradient(400px circle at ${mousePosition.x}px ${mousePosition.y}px, rgba(212, 175, 55, 0.15), transparent 40%)`,
        }}
      />
      
      {/* Glassmorphism subtle overlay */}
      <div className="absolute inset-0 bg-white/5 backdrop-blur-sm pointer-events-none"></div>

      <div className="relative z-10 flex flex-col justify-between h-full">
        <div>
          <h3 className="text-xl font-semibold text-white tracking-wide">{title}</h3>
          
          <div className="mt-2 flex items-center space-x-2">
            <span className="w-2 h-2 rounded-full bg-mm-gold animate-pulse"></span>
            <span className="text-sm text-mm-cream/80">{etiquetaEstado(status, t)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
