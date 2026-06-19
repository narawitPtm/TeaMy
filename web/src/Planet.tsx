import type { TaskStatus } from "./types";
import { STATE_VISUALS } from "./state-visuals";

/**
 * SPRITE SEAM — swap this one function to use Deep-Fold planet PNGs later.
 * It draws the planet body ONLY; all state animation (rings, shake, blink) is
 * applied by <Planet> around it, so swapping the sprite never touches state
 * logic. To use an image:  return <image href={...} x={-r} y={-r} ... />
 */
function PlanetSprite({ r, color }: { r: number; color: string }) {
  return (
    <>
      <circle r={r} fill={color} />
      {/* simple stylized surface so different planets read as distinct */}
      <circle r={r} fill="url(#planetShade)" />
      <circle r={r * 0.55} cx={-r * 0.25} cy={-r * 0.3} fill="rgba(255,255,255,0.08)" />
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
  selected?: boolean;
  onClick?: () => void;
}

export function Planet({ x, y, r = 26, status, name, model, selected, onClick }: PlanetProps) {
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
      {/* glow halo */}
      <circle r={r + 8} fill={v.glow} opacity={status === "idle" ? 0 : 0.18} />

      {/* signal-wave rings for running (expanding + fading) */}
      {v.rings && (
        <g className="rings" stroke={v.glow} fill="none" strokeWidth={2}>
          <circle r={r} className="ring ring1" />
          <circle r={r} className="ring ring2" />
          <circle r={r} className="ring ring3" />
        </g>
      )}

      {/* retrying spinner arc */}
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

      <PlanetSprite r={r} color={v.color} />

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
