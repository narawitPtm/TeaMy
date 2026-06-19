import type { TaskStatus } from "./types";
import { STATE_VISUALS } from "./state-visuals";

// Number of planet sprite assets in public/assets/planets/ (planet-0..N-1.svg).
const SPRITE_COUNT = 8;

/** Stable hash so a given worker always gets the same planet design. */
function spriteIndex(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % SPRITE_COUNT;
}

/**
 * SPRITE SEAM — the ONLY place the planet's appearance is sourced.
 *
 * It draws the planet body ONLY; all state animation (signal rings, shake,
 * blink, glow) is applied by <Planet> around it, so swapping the sprite source
 * never touches state logic. Currently loads generated SVG sprites from
 * public/assets/planets/. To use Deep-Fold PNGs instead, just point `href` at
 * the PNGs (same centered placement, same call site) — nothing else changes.
 *
 * The sprite art has the disc at radius 48 within a 120-unit viewBox, so an
 * image of width 2.5r renders the disc at ~r (matching the glow/rings).
 */
function PlanetSprite({ r, seed, fallbackColor }: { r: number; seed: string; fallbackColor: string }) {
  const idx = spriteIndex(seed);
  return (
    <>
      {/* fallback disc shows if the asset fails to load (keeps state readable) */}
      <circle r={r} fill={fallbackColor} opacity={0.25} />
      <image
        href={`/assets/planets/planet-${idx}.svg`}
        x={-r * 1.25}
        y={-r * 1.25}
        width={r * 2.5}
        height={r * 2.5}
      />
    </>
  );
}

export interface PlanetProps {
  x: number;
  y: number;
  r?: number;
  status: TaskStatus;
  name: string;
  model?: string;
  /** stable seed (e.g. worker id) picking which planet sprite to show */
  spriteSeed?: string;
  selected?: boolean;
  onClick?: () => void;
}

export function Planet({ x, y, r = 26, status, name, model, spriteSeed, selected, onClick }: PlanetProps) {
  const v = STATE_VISUALS[status];
  // Positioning lives on the OUTER group (SVG transform attr). Animations live
  // on the INNER group so a CSS `transform` (shake) never clobbers the planet's
  // translate(x,y). Opacity-based anims would be fine either way; shake is not.
  return (
    <g
      transform={`translate(${x},${y})`}
      onClick={onClick}
      style={{ cursor: onClick ? "pointer" : "default" }}
    >
      <g className={`planet anim-${v.anim}`}>
      {/* glow halo (breathes gently while running) */}
      <circle
        className={status === "running" ? "halo halo-breathe" : "halo"}
        r={r + 8}
        fill={v.glow}
        opacity={status === "idle" ? 0 : 0.16}
      />

      {/* running: a thin arc that slowly tracks around the planet (telescope-like) */}
      {status === "running" && (
        <g className="track">
          <circle r={r + 9} fill="none" stroke={v.glow} strokeWidth={1} opacity={0.18} />
          <circle
            className="track-arc"
            r={r + 9}
            fill="none"
            stroke={v.glow}
            strokeWidth={2}
            strokeLinecap="round"
            strokeDasharray={`${(r + 9) * 0.9} ${(r + 9) * 6}`}
          />
        </g>
      )}

      {/* retrying spinner arc (distinct: warmer, faster) */}
      {status === "retrying" && (
        <circle
          className="spinner"
          r={r + 6}
          fill="none"
          stroke={v.glow}
          strokeWidth={3}
          strokeDasharray={`${(r + 6) * 1.2} ${(r + 6) * 6}`}
        />
      )}

      {selected && <circle r={r + 13} fill="none" stroke="#ffffff" strokeWidth={1} opacity={0.5} />}

      <PlanetSprite r={r} seed={spriteSeed ?? name} fallbackColor={v.color} />

      {/* waiting-human: clear blinking "needs you" marker, distinct from blocked */}
      {v.needsYou && (
        <g className="needs-you" transform={`translate(${r - 2},${-r + 2})`}>
          <circle r={9} fill="#1b1130" stroke="#d8b3ff" strokeWidth={1.5} />
          <text textAnchor="middle" y={4} fontSize={12} fill="#d8b3ff" fontWeight="bold">
            !
          </text>
        </g>
      )}

      <text textAnchor="middle" y={r + 18} fontSize={11} fill="#c7d0e0">
        {name}
      </text>
      {model && (
        <text textAnchor="middle" y={r + 31} fontSize={9} fill="#6b7689">
          {model.replace("claude-", "")}
        </text>
      )}
      <text textAnchor="middle" y={r + 44} fontSize={9} fill={v.glow === "transparent" ? "#6b7689" : v.glow}>
        {v.label}
      </text>
      </g>
    </g>
  );
}
