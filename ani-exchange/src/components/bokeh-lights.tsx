import type { CSSProperties } from "react";

/**
 * Luces navideñas desenfocadas (bokeh) detrás de todo el sitio. Puro CSS:
 * cada disco pulsa a su ritmo; algunos van estirados como vistos con
 * astigmatismo. Posiciones fijas (sin aleatoriedad) para evitar desajustes de
 * hidratación.
 */

const COLORS = {
  red: "oklch(0.66 0.21 25)",
  green: "oklch(0.72 0.17 150)",
  gold: "oklch(0.86 0.14 85)",
  ice: "oklch(0.86 0.09 215)",
  warm: "oklch(0.93 0.05 80)",
} as const;

type Light = {
  x: number; // % horizontal
  y: number; // % vertical
  size: number; // px
  color: keyof typeof COLORS;
  blur: number; // px: más = más lejos
  min: number; // opacidad mínima
  max: number; // opacidad máxima
  duration: number; // s
  delay: number; // s
  stretch?: number; // >1 = astigmatismo
  rotate?: number; // deg
};

const LIGHTS: Light[] = [
  // Lejanas y grandes (muy desenfocadas)
  { x: 6, y: 12, size: 260, color: "ice", blur: 28, min: 0.1, max: 0.22, duration: 9, delay: 0 },
  { x: 92, y: 8, size: 240, color: "red", blur: 26, min: 0.1, max: 0.22, duration: 11, delay: -3 },
  { x: 50, y: 104, size: 320, color: "green", blur: 34, min: 0.06, max: 0.14, duration: 13, delay: -6 },
  { x: 100, y: 62, size: 220, color: "gold", blur: 26, min: 0.06, max: 0.15, duration: 10, delay: -2 },
  { x: -2, y: 70, size: 230, color: "red", blur: 28, min: 0.07, max: 0.16, duration: 12, delay: -8 },
  // Medianas
  { x: 15, y: 30, size: 110, color: "gold", blur: 6, min: 0.12, max: 0.32, duration: 5.5, delay: -1, stretch: 1.35, rotate: 25 },
  { x: 84, y: 26, size: 120, color: "green", blur: 6, min: 0.12, max: 0.3, duration: 6.5, delay: -4 },
  { x: 8, y: 48, size: 90, color: "red", blur: 5, min: 0.14, max: 0.36, duration: 4.8, delay: -2.5, stretch: 1.4, rotate: -30 },
  { x: 93, y: 44, size: 100, color: "ice", blur: 5, min: 0.12, max: 0.3, duration: 7, delay: -5 },
  { x: 20, y: 84, size: 130, color: "green", blur: 7, min: 0.1, max: 0.26, duration: 6, delay: -3.5 },
  { x: 78, y: 82, size: 115, color: "red", blur: 6, min: 0.12, max: 0.3, duration: 5.2, delay: -1.5, stretch: 1.3, rotate: 40 },
  // Cercanas y chicas (borde más definido)
  { x: 17, y: 19, size: 46, color: "red", blur: 1.5, min: 0.18, max: 0.55, duration: 3.2, delay: -0.8 },
  { x: 72, y: 16, size: 40, color: "gold", blur: 1.5, min: 0.2, max: 0.6, duration: 2.8, delay: -2.2, stretch: 1.5, rotate: 15 },
  { x: 4, y: 90, size: 52, color: "gold", blur: 2, min: 0.16, max: 0.5, duration: 3.6, delay: -1.2 },
  { x: 96, y: 92, size: 44, color: "green", blur: 1.5, min: 0.18, max: 0.55, duration: 3, delay: -0.4 },
  { x: 88, y: 58, size: 36, color: "warm", blur: 1.5, min: 0.2, max: 0.6, duration: 2.6, delay: -1.8, stretch: 1.45, rotate: -20 },
  { x: 12, y: 62, size: 38, color: "ice", blur: 1.5, min: 0.18, max: 0.5, duration: 3.4, delay: -2.9 },
  { x: 60, y: 96, size: 42, color: "red", blur: 2, min: 0.14, max: 0.45, duration: 3.8, delay: -0.2 },
];

export function BokehLights() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {LIGHTS.map((l, i) => (
        <span
          key={i}
          className="bokeh"
          style={
            {
              left: `${l.x}%`,
              top: `${l.y}%`,
              width: l.size,
              height: l.size,
              "--bokeh-color": COLORS[l.color],
              "--bokeh-blur": `${l.blur}px`,
              "--bokeh-min": l.min,
              "--bokeh-max": l.max,
              "--bokeh-duration": `${l.duration}s`,
              "--bokeh-delay": `${l.delay}s`,
              "--bokeh-stretch": l.stretch ?? 1,
              "--bokeh-rotate": `${l.rotate ?? 0}deg`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
