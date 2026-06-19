import type { Floor, Task, Worker } from "./types";
import { Planet } from "./Planet";

/**
 * One team rendered as a star system: an orchestrator "sun" at the cluster
 * center, worker "planets" placed at deterministic angles around it, and dashed
 * beams from the sun to any running planet. Drawn in WORLD coordinates — the
 * Universe applies pan/zoom around it.
 */

const RADIUS = 168;

export interface ClusterProps {
  floor: Floor;
  cx: number;
  cy: number;
  workers: Worker[];
  tasks: Record<string, Task>;
  workerTask: Record<string, string>;
  selectedWorker: string | null;
  onSelectWorker: (id: string) => void;
  onFocusFloor?: () => void;
  running: boolean;
}

export function Cluster({
  floor,
  cx,
  cy,
  workers,
  tasks,
  workerTask,
  selectedWorker,
  onSelectWorker,
  onFocusFloor,
  running,
}: ClusterProps) {
  const n = workers.length;
  const angleFor = (i: number) => (2 * Math.PI * i) / Math.max(1, n) - Math.PI / 2;
  const statusOf = (workerId: string): Task["status"] => {
    const id = workerTask[workerId];
    return (id ? tasks[id]?.status : undefined) ?? "idle";
  };

  return (
    <g className="cluster">
      {/* faint system ring + clickable name plate (click to focus this team) */}
      <circle cx={cx} cy={cy} r={RADIUS + 46} className="system-ring" />
      <g
        className="nameplate-hit"
        transform={`translate(${cx}, ${cy - RADIUS - 70})`}
        onClick={onFocusFloor}
        style={{ cursor: onFocusFloor ? "pointer" : "default" }}
      >
        <rect x={-92} y={-17} width={184} height={30} rx={15} className="nameplate" />
        <text className="floor-name" textAnchor="middle" y={3}>
          {floor.name.toUpperCase()}
        </text>
        {running && <circle cx={84} cy={-2} r={3.5} className="run-dot" />}
      </g>

      {/* beams: sun -> running planets only */}
      {workers.map((w, wi) => {
        if (statusOf(w.id) !== "running") return null;
        const a = angleFor(wi);
        const sx = cx + 50 * Math.cos(a);
        const sy = cy + 50 * Math.sin(a);
        const ex = cx + (RADIUS - 32) * Math.cos(a);
        const ey = cy + (RADIUS - 32) * Math.sin(a);
        return (
          <line
            key={`beam-${w.id}`}
            className="beam"
            x1={sx}
            y1={sy}
            x2={ex}
            y2={ey}
            markerEnd="url(#beamArrow)"
          />
        );
      })}

      {/* orchestrator sun */}
      <g transform={`translate(${cx}, ${cy})`} className="sun">
        <circle r={64} className="sun-corona" />
        <circle r={46} className="sun-core" />
        <circle r={46} className="sun-shade" />
        <text className="sun-label" textAnchor="middle" y={70}>
          orchestrator
        </text>
      </g>

      {/* worker planets */}
      {workers.map((w, wi) => {
        const a = angleFor(wi);
        return (
          <Planet
            key={w.id}
            x={cx + RADIUS * Math.cos(a)}
            y={cy + RADIUS * Math.sin(a)}
            status={statusOf(w.id)}
            name={w.name}
            model={w.model}
            spriteSeed={w.id}
            selected={selectedWorker === w.id}
            onClick={() => onSelectWorker(w.id)}
          />
        );
      })}

      {n === 0 && (
        <text x={cx} y={cy + RADIUS} textAnchor="middle" className="empty-hint">
          no workers yet — dispatch a command
        </text>
      )}
    </g>
  );
}
