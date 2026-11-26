import type { CSSProperties } from "react";

/**
 * Nieve sutil detrás de todo el sitio. Puro CSS: cada copo cae (elemento
 * exterior) y se mece (elemento interior). Valores deterministas para que el
 * HTML del servidor y del navegador coincidan.
 */

const FLAKE_COUNT = 40;

/** Pseudoaleatorio estable en [0, 1) a partir del índice. */
function rand(i: number, salt: number): number {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

const r2 = (n: number) => Math.round(n * 100) / 100;

const FLAKES = Array.from({ length: FLAKE_COUNT }, (_, i) => {
  const depth = rand(i, 1); // 0 = lejos, 1 = cerca
  return {
    left: r2(rand(i, 2) * 100), // %
    size: r2(2 + depth * 4), // 2–6 px
    blur: r2((1 - depth) * 1.5), // lejos = más borroso
    opacity: r2(0.3 + depth * 0.3), // 0.3–0.6
    fall: r2(30 - depth * 15), // 15–30 s (cerca cae más rápido)
    delay: r2(-rand(i, 3) * 30), // ya repartidos al cargar
    sway: r2(10 + rand(i, 4) * 20), // 10–30 px de vaivén
    swayDuration: r2(4 + rand(i, 5) * 4), // 4–8 s
  };
});

export function Snowfall() {
  return (
    <div aria-hidden className="snowfall pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {FLAKES.map((f, i) => (
        <span
          key={i}
          className="snowflake"
          style={
            {
              left: `${f.left}%`,
              "--flake-fall": `${f.fall}s`,
              "--flake-delay": `${f.delay}s`,
            } as CSSProperties
          }
        >
          <span
            className="snowflake-body"
            style={
              {
                width: f.size,
                height: f.size,
                opacity: f.opacity,
                filter: f.blur > 0.2 ? `blur(${f.blur}px)` : undefined,
                "--flake-sway": `${f.sway}px`,
                "--flake-sway-duration": `${f.swayDuration}s`,
              } as CSSProperties
            }
          />
        </span>
      ))}
    </div>
  );
}
