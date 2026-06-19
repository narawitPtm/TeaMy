import { useMemo } from "react";
import type { Viewport } from "./useViewport";

/**
 * Layered parallax starfield + nebula. Three star layers drift at different
 * fractions of the pan (depth illusion). Deterministic positions so stars don't
 * jump between renders. Pure decoration — no interactivity.
 */

interface Star {
  x: number;
  y: number;
  r: number;
  o: number;
  tw: number; // twinkle duration
}

function makeStars(seed: number, count: number, spread: number): Star[] {
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0xffffffff);
  return Array.from({ length: count }, () => ({
    x: (rnd() - 0.5) * spread,
    y: (rnd() - 0.5) * spread,
    r: 0.4 + rnd() * 1.5,
    o: 0.25 + rnd() * 0.75,
    tw: 2.5 + rnd() * 5,
  }));
}

function Layer({ stars, factor, vp }: { stars: Star[]; factor: number; vp: Viewport }) {
  // Parallax: nearer layers (higher factor) track the pan more closely.
  const tx = vp.x * factor;
  const ty = vp.y * factor;
  const sc = 1 + (vp.scale - 1) * factor * 0.6;
  return (
    <g transform={`translate(${tx} ${ty}) scale(${sc})`}>
      {stars.map((st, i) => (
        <circle
          key={i}
          cx={st.x}
          cy={st.y}
          r={st.r}
          fill="#dfe9ff"
          opacity={st.o}
          style={{ animation: `twinkle ${st.tw}s ease-in-out ${(i % 7) * 0.4}s infinite` }}
        />
      ))}
    </g>
  );
}

export function Starfield({ vp, width, height }: { vp: Viewport; width: number; height: number }) {
  const far = useMemo(() => makeStars(11, 220, 4200), []);
  const mid = useMemo(() => makeStars(73, 140, 3400), []);
  const near = useMemo(() => makeStars(157, 70, 2800), []);

  return (
    <svg className="starfield" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <defs>
        <radialGradient id="neb1" cx="30%" cy="28%" r="60%">
          <stop offset="0%" stopColor="#1b2b66" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#1b2b66" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="neb2" cx="78%" cy="72%" r="55%">
          <stop offset="0%" stopColor="#0f4a52" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#0f4a52" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="neb3" cx="62%" cy="18%" r="40%">
          <stop offset="0%" stopColor="#4a1f57" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#4a1f57" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* nebula clouds (fixed to screen, drift very slightly with pan) */}
      <g transform={`translate(${vp.x * 0.04} ${vp.y * 0.04})`}>
        <rect x={-200} y={-200} width={width + 400} height={height + 400} fill="url(#neb1)" />
        <rect x={-200} y={-200} width={width + 400} height={height + 400} fill="url(#neb2)" />
        <rect x={-200} y={-200} width={width + 400} height={height + 400} fill="url(#neb3)" />
      </g>

      {/* star layers anchored at screen-center so parallax feels centered */}
      <g transform={`translate(${width / 2} ${height / 2})`}>
        <Layer stars={far} factor={0.12} vp={vp} />
        <Layer stars={mid} factor={0.28} vp={vp} />
        <Layer stars={near} factor={0.5} vp={vp} />
      </g>
    </svg>
  );
}
