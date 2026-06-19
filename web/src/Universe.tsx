import { useEffect, useRef, useState } from "react";
import type { Floor, Task, Worker } from "./types";
import { useViewport } from "./useViewport";
import { Starfield } from "./Starfield";
import { Cluster } from "./Cluster";

/**
 * The full-screen, pannable/zoomable star map. Holds every team (floor) as a
 * star-system cluster scattered across world space (golden-angle spiral so they
 * never overlap). Drag to pan, wheel/buttons to zoom — like a sky atlas.
 */

// Deterministic world position per floor index (phyllotaxis spiral).
export function clusterPos(i: number): { x: number; y: number } {
  if (i === 0) return { x: 0, y: 0 };
  const a = i * 2.39996; // golden angle
  const r = 620 * Math.sqrt(i);
  return { x: Math.cos(a) * r, y: Math.sin(a) * r };
}

export interface UniverseProps {
  floors: Floor[];
  workers: Worker[];
  tasks: Record<string, Task>;
  workerTask: Record<string, string>;
  runningFloors: Set<string>;
  selectedWorker: string | null;
  onSelectWorker: (id: string | null) => void;
  onFocusFloor?: (id: string) => void;
  focusFloorId?: string | null;
}

export function Universe(props: UniverseProps) {
  const { vp, ref, panning, handlers, didPan, zoomBy, focusOn } = useViewport();
  const [size, setSize] = useState({ w: 1200, h: 800 });

  useEffect(() => {
    const update = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // Fly to a floor when asked (e.g. a brand-new team).
  const lastFocus = useRef<string | null>(null);
  useEffect(() => {
    if (!props.focusFloorId || props.focusFloorId === lastFocus.current) return;
    const i = props.floors.findIndex((f) => f.id === props.focusFloorId);
    if (i >= 0) {
      const p = clusterPos(i);
      focusOn(p.x, p.y, 0.85);
      lastFocus.current = props.focusFloorId;
    }
  }, [props.focusFloorId, props.floors, focusOn]);

  return (
    <div
      className={`universe ${panning ? "panning" : ""}`}
      ref={ref}
      onPointerDown={handlers.onPointerDown}
      onPointerMove={handlers.onPointerMove}
      onPointerUp={handlers.onPointerUp}
      onPointerLeave={handlers.onPointerLeave}
    >
      <Starfield vp={vp} width={size.w} height={size.h} />

      <svg className="world" width={size.w} height={size.h}>
        <defs>
          <radialGradient id="planetShade" cx="0.5" cy="0.5" r="0.5">
            <stop offset="60%" stopColor="rgba(0,0,0,0)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0.45)" />
          </radialGradient>
          <marker id="beamArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="#56e6ff" />
          </marker>
          <radialGradient id="sunGlow" cx="40%" cy="35%" r="68%">
            <stop offset="0%" stopColor="#ffe6a6" />
            <stop offset="55%" stopColor="#ffb23e" />
            <stop offset="100%" stopColor="#bf5a16" />
          </radialGradient>
        </defs>
        <g transform={`translate(${vp.x} ${vp.y}) scale(${vp.scale})`}>
          {props.floors.map((floor, i) => {
            const p = clusterPos(i);
            const fw = props.workers.filter((w) => w.floor_id === floor.id);
            return (
              <Cluster
                key={floor.id}
                floor={floor}
                cx={p.x}
                cy={p.y}
                workers={fw}
                tasks={props.tasks}
                workerTask={props.workerTask}
                selectedWorker={props.selectedWorker}
                running={props.runningFloors.has(floor.id)}
                onFocusFloor={() => {
                  if (didPan()) return;
                  const p = clusterPos(i);
                  focusOn(p.x, p.y, Math.max(vp.scale, 0.85));
                  props.onFocusFloor?.(floor.id);
                }}
                onSelectWorker={(id) => {
                  if (didPan()) return; // it was a pan, not a click
                  props.onSelectWorker(props.selectedWorker === id ? null : id);
                }}
              />
            );
          })}
        </g>
      </svg>

      {/* zoom controls */}
      <div className="zoom-ctl">
        <button onClick={() => zoomBy(1.25)} aria-label="zoom in">＋</button>
        <button onClick={() => zoomBy(0.8)} aria-label="zoom out">－</button>
        <button onClick={() => focusOn(0, 0, 0.75)} aria-label="reset view">⊙</button>
      </div>
    </div>
  );
}
