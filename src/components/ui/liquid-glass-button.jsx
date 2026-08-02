import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import { cn } from "../../lib/utils";

// ─── SVG Glass Filter — rendered ONCE at body level via portal-like trick ──
// We place it at module level so it only exists once in the DOM.
function GlassFilterDefs() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="0"
      height="0"
      style={{ position: "absolute", overflow: "hidden" }}
      aria-hidden="true"
    >
      <defs>
        <filter
          id="mm-glass-filter"
          x="-20%"
          y="-20%"
          width="140%"
          height="140%"
          colorInterpolationFilters="sRGB"
        >
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.65 0.65"
            numOctaves="3"
            seed="2"
            result="noise"
          />
          <feColorMatrix type="saturate" values="0" in="noise" result="grayNoise" />
          <feBlend in="SourceGraphic" in2="grayNoise" mode="soft-light" result="blend" />
          <feComposite in="blend" in2="SourceGraphic" operator="in" />
        </filter>
      </defs>
    </svg>
  );
}

// ─── Liquid Glass Button ───────────────────────────────────────────────────

const liquidbuttonVariants = cva(
  [
    "inline-flex items-center justify-center cursor-pointer gap-2 whitespace-nowrap",
    "rounded-full text-sm font-semibold tracking-wide",
    "disabled:pointer-events-none disabled:opacity-50",
    "outline-none focus-visible:ring-2 focus-visible:ring-mm-gold/60",
    "transition-transform duration-200",
  ].join(" "),
  {
    variants: {
      variant: {
        default: "text-mm-navy hover:scale-[1.03] active:scale-[0.97]",
        light: "text-white hover:scale-[1.03] active:scale-[0.97]",
      },
      size: {
        sm: "h-9 px-5 py-2 text-xs",
        default: "h-11 px-6 py-2.5",
        lg: "h-12 px-8",
        xl: "h-14 px-10 text-base",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export function LiquidButton({
  className,
  variant,
  size,
  asChild = false,
  children,
  ...props
}) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      data-slot="button"
      className={cn(
        "relative overflow-hidden",
        liquidbuttonVariants({ variant, size, className })
      )}
      {...props}
    >
      {/* Frosted glass background layer */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-full backdrop-blur-md"
        style={{
          background:
            "linear-gradient(135deg, rgba(255,255,255,0.35) 0%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.22) 100%)",
          boxShadow: [
            "inset 0 1px 0 rgba(255,255,255,0.6)",
            "inset 0 -1px 0 rgba(0,0,0,0.08)",
            "0 4px 20px rgba(0,0,0,0.12)",
            "0 1px 4px rgba(0,0,0,0.08)",
          ].join(", "),
          border: "1px solid rgba(255,255,255,0.5)",
        }}
      />

      {/* Gold shimmer highlight on top edge */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px rounded-full"
        style={{
          background:
            "linear-gradient(90deg, transparent, rgba(212,175,55,0.6), transparent)",
        }}
      />

      {/* Text content above all layers */}
      <span className="relative z-10">{children}</span>
    </Comp>
  );
}

// ─── Metal Button ──────────────────────────────────────────────────────────

const colorVariants = {
  default: {
    outer: "bg-gradient-to-b from-[#000] to-[#A0A0A0]",
    inner: "bg-gradient-to-b from-[#FAFAFA] via-[#3E3E3E] to-[#E5E5E5]",
    button: "bg-gradient-to-b from-[#C8C8C8] to-[#969696]",
    textColor: "text-white",
    textShadow: "[text-shadow:_0_-1px_0_rgba(80,80,80,0.8)]",
  },
  gold: {
    outer: "bg-gradient-to-b from-[#7a5e00] to-[#EAD98F]",
    inner: "bg-gradient-to-b from-[#FFFACC] via-[#8a6a08] to-[#FFF1B3]",
    button: "bg-gradient-to-b from-[#F5D96B] to-[#A8893A]",
    textColor: "text-[#2a1f00]",
    textShadow: "[text-shadow:_0_1px_0_rgba(255,240,140,0.7)]",
  },
  navy: {
    outer: "bg-gradient-to-b from-[#000814] to-[#1e3a5f]",
    inner: "bg-gradient-to-b from-[#c8d8ee] via-[#0B1B2C] to-[#d4e3f5]",
    button: "bg-gradient-to-b from-[#1a3255] to-[#0B1B2C]",
    textColor: "text-[#D4AF37]",
    textShadow: "[text-shadow:_0_-1px_0_rgba(212,175,55,0.4)]",
  },
  bronze: {
    outer: "bg-gradient-to-b from-[#864813] to-[#E9B486]",
    inner: "bg-gradient-to-b from-[#EDC5A1] via-[#5F2D01] to-[#FFDEC1]",
    button: "bg-gradient-to-b from-[#FFE3C9] to-[#A36F3D]",
    textColor: "text-[#FFF7F0]",
    textShadow: "[text-shadow:_0_-1px_0_rgba(124,45,18,0.8)]",
  },
};

function getMetalVariants(variant = "gold", isPressed, isHovered, isTouchDevice) {
  const c = colorVariants[variant] || colorVariants.gold;
  const ease = "all 200ms cubic-bezier(0.1, 0.4, 0.2, 1)";

  return {
    wrapperCls: cn("relative inline-flex transform-gpu rounded-lg p-[1.5px] will-change-transform", c.outer),
    wrapperStyle: {
      transform: isPressed ? "translateY(2px) scale(0.985)" : "translateY(0) scale(1)",
      boxShadow: isPressed
        ? "0 1px 3px rgba(0,0,0,0.2)"
        : isHovered && !isTouchDevice
        ? "0 6px 20px rgba(0,0,0,0.22), 0 2px 6px rgba(0,0,0,0.12)"
        : "0 3px 10px rgba(0,0,0,0.15), 0 1px 3px rgba(0,0,0,0.1)",
      transition: ease,
    },
    innerCls: cn("absolute inset-[1.5px] rounded-md will-change-transform", c.inner),
    innerStyle: {
      transition: ease,
      filter: isHovered && !isPressed && !isTouchDevice ? "brightness(1.06)" : "none",
    },
    buttonCls: cn(
      "relative z-10 m-[1.5px] rounded-md inline-flex cursor-pointer items-center justify-center",
      "gap-2 overflow-hidden px-6 py-2.5 text-sm font-bold leading-none tracking-wide",
      "will-change-transform outline-none",
      c.button,
      c.textColor,
      c.textShadow
    ),
    buttonStyle: {
      transform: isPressed ? "scale(0.96)" : "scale(1)",
      transition: ease,
      filter: isHovered && !isPressed && !isTouchDevice ? "brightness(1.03)" : "none",
    },
  };
}

function ShineEffect({ isPressed }) {
  return (
    <span
      className={cn(
        "pointer-events-none absolute inset-0 z-20 overflow-hidden transition-opacity duration-250 rounded-md",
        isPressed ? "opacity-30" : "opacity-0"
      )}
    >
      <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/50 to-transparent -translate-x-full animate-none" />
    </span>
  );
}

export const MetalButton = React.forwardRef(function MetalButton(
  { children, className, variant = "gold", type = "button", onClick, ...props },
  ref
) {
  const [isPressed, setIsPressed] = React.useState(false);
  const [isHovered, setIsHovered] = React.useState(false);
  const [isTouchDevice, setIsTouchDevice] = React.useState(false);

  React.useEffect(() => {
    setIsTouchDevice("ontouchstart" in window || navigator.maxTouchPoints > 0);
  }, []);

  const v = getMetalVariants(variant, isPressed, isHovered, isTouchDevice);

  return (
    <div className={cn(v.wrapperCls, className)} style={v.wrapperStyle}>
      <div className={v.innerCls} style={v.innerStyle} />
      <button
        ref={ref}
        type={type}
        className={v.buttonCls}
        style={v.buttonStyle}
        onClick={onClick}
        {...props}
        onMouseDown={() => setIsPressed(true)}
        onMouseUp={() => setIsPressed(false)}
        onMouseLeave={() => { setIsPressed(false); setIsHovered(false); }}
        onMouseEnter={() => { if (!isTouchDevice) setIsHovered(true); }}
        onTouchStart={() => setIsPressed(true)}
        onTouchEnd={() => setIsPressed(false)}
        onTouchCancel={() => setIsPressed(false)}
      >
        <ShineEffect isPressed={isPressed} />
        <span className="relative z-10 flex items-center gap-2">{children}</span>
        {isHovered && !isPressed && !isTouchDevice && (
          <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-transparent to-white/8 rounded-md" />
        )}
      </button>
    </div>
  );
});

// Export GlassFilterDefs so App.jsx can mount it once at root
export { GlassFilterDefs };
