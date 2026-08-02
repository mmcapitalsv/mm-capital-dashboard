import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "../../lib/utils";

// ── Geometry ──────────────────────────────────────────────────────────────
const VISIBLE_COUNT = 5;
const RADIUS_X = 300;   // wider spread to accommodate bigger cards
const RADIUS_Y = 60;    // vertical depth (perspective effect)

// Card dimensions — w-80 h-56 = 320×224px
const CARD_W = 320;
const CARD_H = 224;

function getItemPosition(index, activeIndex, total) {
  const offset = index - activeIndex;
  const half = Math.floor(VISIBLE_COUNT / 2);

  let adj = offset;
  if (offset > half)  adj = offset - total;
  if (offset < -half) adj = offset + total;
  if (Math.abs(adj) > half * 2) return null;

  // Elliptical arc: sin → x spread, (1 - cos) → y depth
  const angle = (adj / VISIBLE_COUNT) * Math.PI;
  const x = Math.sin(angle) * RADIUS_X;
  const y = (1 - Math.cos(angle)) * RADIUS_Y - RADIUS_Y * 0.1;

  const dist = Math.abs(adj);
  const maxDist = half + 1;
  const scale   = adj === 0 ? 1.15 : Math.max(0.70, 1 - (dist / maxDist) * 0.30);
  const opacity = Math.max(0.25, 1 - (dist / maxDist) * 0.70);
  const zIndex  = VISIBLE_COUNT - dist;

  return { x, y, scale, opacity, zIndex };
}

// ── Component ─────────────────────────────────────────────────────────────
export function CircularCarousel({
  items,
  activeIndex: controlledIndex,
  onActiveChange,
  onCardClick,
  autoPlay = true,
  autoPlayInterval = 5000,
  className,
}) {
  const [internalIndex, setInternalIndex] = useState(0);
  const [isHovered, setIsHovered]         = useState(false);
  const [isFocused, setIsFocused]         = useState(false);
  const [isTouched, setIsTouched]         = useState(false);
  const intervalRef  = useRef(null);
  const containerRef = useRef(null);
  const mobileScrollRef = useRef(null);

  const activeIndex = controlledIndex ?? internalIndex;
  const total = items.length;

  const goTo = useCallback(
    (index) => {
      const newIndex = ((index % total) + total) % total;
      if (controlledIndex === undefined) setInternalIndex(newIndex);
      onActiveChange?.(newIndex);
    },
    [total, controlledIndex, onActiveChange]
  );

  const next = useCallback(() => goTo(activeIndex + 1), [activeIndex, goTo]);
  const prev = useCallback(() => goTo(activeIndex - 1), [activeIndex, goTo]);

  useEffect(() => {
    if (!autoPlay || isHovered || isFocused || isTouched) return;
    intervalRef.current = setInterval(next, autoPlayInterval);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [autoPlay, autoPlayInterval, isHovered, isFocused, isTouched, next]);

  // Sync mobile scroll with activeIndex
  useEffect(() => {
    const el = mobileScrollRef.current;
    if (el) {
      const cardWidth = el.scrollWidth / items.length;
      el.scrollTo({ left: activeIndex * cardWidth, behavior: "smooth" });
    }
  }, [activeIndex, items.length]);

  useEffect(() => {
    const handler = (e) => {
      if (e.key === "ArrowLeft")  prev();
      if (e.key === "ArrowRight") next();
    };
    const el = containerRef.current;
    el?.addEventListener("keydown", handler);
    return () => el?.removeEventListener("keydown", handler);
  }, [next, prev]);

  const activeItem = items[activeIndex];

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      role="region"
      aria-label="Carrusel de Proyectos"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      className={cn(
        "relative flex flex-col items-center gap-10 outline-none select-none",
        className
      )}
    >

      {/* ── Carousel track ─────────────────────────────────────────── */}
      {/*
        Cards are positioned with CSS absolute + negative margins equal to
        half the card dimensions. Framer then animates x/y as offsets from
        that CSS-established center. No translate classes involved, avoiding
        transform conflicts.
      */}
      {/* ── Desktop 3D Track ── */}
      <div className="relative h-[320px] w-full hidden md:block">

        <AnimatePresence initial={false}>
          {items.map((item, i) => {
            const pos = getItemPosition(i, activeIndex, total);
            if (!pos) return null;
            const isActive = i === activeIndex;

            return (
              <motion.button
                key={item.id}
                role="option"
                aria-label={item.title}
                aria-selected={isActive}
                onClick={() => {
                  if (isActive) {
                    // Already active → navigate to detail
                    onCardClick?.(item);
                  } else {
                    goTo(i);
                  }
                }}
                onHoverStart={() => goTo(i)}

                // ── CSS origin: card center aligned to track center ──
                style={{
                  position: "absolute",
                  left: "50%",
                  top:  "50%",
                  marginLeft: -(CARD_W / 2),
                  marginTop:  -(CARD_H / 2),
                  width: CARD_W,
                  height: CARD_H,
                  transformOrigin: "center center",
                  zIndex: pos.zIndex,
                }}

                // ── Framer animates offset + scale + opacity ──
                initial={false}
                animate={{
                  x:       pos.x,
                  y:       pos.y,
                  scale:   pos.scale,
                  opacity: pos.opacity,
                }}
                transition={{ duration: 0.5, ease: [0.32, 0.72, 0, 1] }}

                className={cn(
                  "flex flex-col items-center justify-center",
                  "rounded-2xl cursor-pointer border",
                  "transition-all duration-300",
                  isActive
                    ? "bg-white border-gray-100 shadow-[0_20px_40px_-15px_rgba(0,0,0,0.1)]"
                    : "bg-white border-gray-200 shadow-[0_2px_12px_rgba(0,0,0,0.05)] hover:shadow-[0_8px_28px_rgba(0,0,0,0.09)]"
                )}
              >
                {/* Active gold accent line at top */}
                {isActive && (
                  <motion.div
                    layoutId="card-accent"
                    className="absolute top-0 left-8 right-8 h-0.5 rounded-full bg-slate-900"
                    transition={{ duration: 0.4, ease: "easeOut" }}
                  />
                )}

                {/* Title only — centered, minimal */}
                <div className="px-6 text-center">
                  <h3 className={cn(
                    "font-semibold tracking-tight transition-all duration-300",
                    isActive
                      ? "text-slate-900 text-xl"
                      : "text-slate-400 text-base"
                  )}>
                    {item.title}
                  </h3>

                  {/* Subtle status dot for active card only */}
                  {isActive && (
                    <motion.div
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="mt-3 flex items-center justify-center gap-1.5"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-900 animate-pulse" />
                      <span className="text-xs text-slate-400 uppercase tracking-widest font-medium">
                        {item.tag}
                      </span>
                    </motion.div>
                  )}
                </div>
              </motion.button>
            );
          })}
        </AnimatePresence>
      </div>

      {/* ── Mobile Horizontal Scroll ── */}
      <div 
        ref={mobileScrollRef}
        onTouchStart={() => setIsTouched(true)}
        onTouchEnd={() => setTimeout(() => setIsTouched(false), 3000)}
        className="flex md:hidden overflow-x-auto snap-x snap-mandatory gap-4 pb-4 px-8 w-[100vw] -mx-8 no-scrollbar pt-4"
      >
        {items.map((item, i) => (
          <div
            key={item.id}
            onClick={() => onCardClick?.(item)}
            className="flex-shrink-0 w-80 h-60 bg-white border border-gray-100 rounded-[2rem] p-6 shadow-[0_25px_50px_-12px_rgba(0,0,0,0.12)] flex flex-col justify-center items-center text-center cursor-pointer snap-center"
          >
            <h3 className="text-xl font-bold text-slate-900 leading-tight mb-3">
              {item.title}
            </h3>
            <div className="flex items-center justify-center gap-2 mt-3">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-900" />
              <span className="text-xs text-slate-400 uppercase tracking-widest font-medium">
                {item.tag}
              </span>
            </div>
            <div className="mt-6 text-[10px] text-slate-900 font-bold tracking-widest flex items-center gap-1">
              VER PROYECTO <ChevronRight size={14} />
            </div>
          </div>
        ))}
      </div>

      {/* ── Navigation controls ── */}
      <div className="hidden md:flex items-center gap-5 -mt-2">
        <motion.button
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.92 }}
          onClick={prev}
          aria-label="Proyecto anterior"
          className="flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-white text-slate-500 shadow-sm transition-colors hover:bg-slate-50 hover:text-slate-900"
        >
          <ChevronLeft size={20} />
        </motion.button>

        {/* Dot indicators */}
        <div className="flex items-center gap-2" role="tablist">
          {items.map((_, i) => (
            <button
              key={i}
              role="tab"
              aria-selected={i === activeIndex}
              onClick={() => goTo(i)}
              className={cn(
                "h-1.5 rounded-full transition-all duration-300 focus:outline-none",
                i === activeIndex
                  ? "w-7 bg-slate-800"
                  : "w-1.5 bg-slate-300 hover:bg-slate-500"
              )}
              aria-label={`Ir al proyecto ${i + 1}`}
            />
          ))}
        </div>

        <motion.button
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.92 }}
          onClick={next}
          aria-label="Siguiente proyecto"
          className="flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-white text-slate-500 shadow-sm transition-colors hover:bg-slate-50 hover:text-slate-900"
        >
          <ChevronRight size={20} />
        </motion.button>
      </div>
    </div>
  );
}

export default CircularCarousel;
