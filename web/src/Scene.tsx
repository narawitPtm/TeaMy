import type { Floor, Task, Worker } from "./types";
import { Planet } from "./Planet";

/**
 * The side-view space scene (radial layout — matches the reference sketch):
 *  - each FLOOR (team) is one cluster
 *  - an orchestrator "sun" in the CENTER, worker "planets" arranged AROUND it
 *  - multiple floors stack vertically in one view (no camera chasing)
 *  - planets DO NOT orbit; positions are deterministic (fixed angle per worker)
 *  - dashed beams run from the SUN outward to a planet ONLY while that worker's
 *    task is active (running). NEVER planet-to-planet. NO ships/satellites —
 *    workers are planets only.
 */

const RADIUS = 175; // distance from sun to each planet
const FLOOR_H = 470;
const FLOOR_Y0 = 250;
const CX = 430; // cluster center x (orchestrator sun)

export interface SceneProps {
  floors: Floor[];
  workers: Worker[];
  tasks: Record<string, Task>;
  workerTask: Record<string, string>;
  selectedWorker: string | null;
  onSelectWorker: (id: string | null) => void;
}

export function Scene({
  floors,
  workers,
  tasks,
  workerTask,
  selectedWorker,
  onSelectWorker,
}: SceneProps) {
  const width = CX * 2;
  const height = Math.max(FLOOR_H, FLOOR_Y0 + (floors.length - 1) * FLOOR_H + 200);

  const statusOf = (workerId: string): Task["status"] => {
    const taskId = workerTask[workerId];
    const t = taskId ? tasks[taskId] : undefined;
    return t?.status ?? "idle";
  };

  // Deterministic angle for worker i of n, starting at the top, going clockwise.
  const angleFor = (i: number, n: number) =>
    (2 * Math.PI * i) / Math.max(1, n) - Math.PI / 2;

  return (
    <svg className="scene" viewBox={`0 0 ${width} ${height}`} width="100%" height={height}>
      <defs>
        <radialGradient id="planetShade" cx="0.5" cy="0.5" r="0.5">
          <stop offset="60%" stopColor="rgba(0,0,0,0)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0.45)" />
        </radialGradient>
        <radialGradient id="sunGlow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#ffd66b" />
          <stop offset="55%" stopColor="#f5a623" />
          <stop offset="100%" stopColor="#b25b00" />
        </radialGradient>
        {/* arrowhead at the planet end of an active beam (no ship sprite) */}
        <marker
          id="beamArrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L10,5 L0,10 z" fill="#39c0ff" />
        </marker>
      </defs>

      {floors.map((floor, fi) => {
        const cy = FLOOR_Y0 + fi * FLOOR_H;
        const fWorkers = workers.filter((w) => w.floor_id === floor.id);
        const n = fWorkers.length;

        return (
          <g key={floor.id}>
            {/* floor label + faint divider between clusters */}
            <text x={20} y={cy - RADIUS - 40} fontSize={13} fill="#8b96ab" fontWeight="bold">
              {floor.name}
            </text>
            {fi > 0 && (
              <line
                x1={20}
                x2={width - 20}
                y1={cy - FLOOR_H / 2}
                y2={cy - FLOOR_H / 2}
                stroke="#1a2230"
                strokeWidth={1}
              />
            )}

            {/* beams: sun -> active (running) planets only */}
            {fWorkers.map((w, wi) => {
              if (statusOf(w.id) !== "running") return null;
              const a = angleFor(wi, n);
              // start just outside the sun, end just before the planet
              const sx = CX + 46 * Math.cos(a);
              const sy = cy + 46 * Math.sin(a);
              const ex = CX + (RADIUS - 34) * Math.cos(a);
              const ey = cy + (RADIUS - 34) * Math.sin(a);
              return (
                <line
                  key={`beam-${w.id}`}
                  className="beam"
                  x1={sx}
                  y1={sy}
                  x2={ex}
                  y2={ey}
                  stroke="#39c0ff"
                  strokeWidth={2}
                  strokeDasharray="6 7"
                  markerEnd="url(#beamArrow)"
                />
              );
            })}

            {/* orchestrator sun (center) */}
            <g transform={`translate(${CX},${cy})`}>
              <circle r={52} fill="url(#sunGlow)" opacity={0.25} />
              <circle r={40} fill="url(#sunGlow)" />
              <text textAnchor="middle" y={64} fontSize={12} fill="#f5c873">
                orchestrator
              </text>
            </g>

            {/* worker planets, arranged radially (deterministic, no orbit) */}
            {fWorkers.map((w, wi) => {
              const a = angleFor(wi, n);
              return (
                <Planet
                  key={w.id}
                  x={CX + RADIUS * Math.cos(a)}
                  y={cy + RADIUS * Math.sin(a)}
                  status={statusOf(w.id)}
                  name={w.name}
                  model={w.model}
                  selected={selectedWorker === w.id}
                  onClick={() => onSelectWorker(selectedWorker === w.id ? null : w.id)}
                />
              );
            })}

            {n === 0 && (
              <text x={CX} y={cy - RADIUS} textAnchor="middle" fontSize={12} fill="#566">
                (no workers yet — send a command)
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
