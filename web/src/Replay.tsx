import { useEffect, useMemo, useState } from "react";
import type { History, Task } from "./types";
import { Cluster } from "./Cluster";

/**
 * Replay scrubber — pure view over recorded task_events. Reconstructs the team's
 * star system at any point on the timeline (slider / play / restart). No engine
 * logic: status is the latest status-change at-or-before the playhead, planet
 * binding from the persisted worker_id, so beams/states replay exactly.
 */
export function Replay({ floorId, onClose }: { floorId: string; onClose: () => void }) {
  const [hist, setHist] = useState<History | null>(null);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    fetch(`/history?floorId=${encodeURIComponent(floorId)}`)
      .then((r) => r.json())
      .then((h: History) => {
        setHist(h);
        setIdx(h.events.length);
      });
  }, [floorId]);

  useEffect(() => {
    if (!playing || !hist) return;
    if (idx >= hist.events.length) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setIdx((i) => i + 1), 300);
    return () => clearTimeout(t);
  }, [playing, idx, hist]);

  const tasks: Record<string, Task> = useMemo(() => {
    if (!hist) return {};
    const m: Record<string, Task> = Object.fromEntries(
      hist.tasks.map((t) => [t.id, { ...t, status: "idle" as const }]),
    );
    for (let i = 0; i < idx; i++) {
      const e = hist.events[i];
      if (e.status && m[e.taskId]) m[e.taskId] = { ...m[e.taskId], status: e.status };
    }
    return m;
  }, [hist, idx]);

  const workerTask: Record<string, string> = useMemo(() => {
    const w: Record<string, string> = {};
    hist?.tasks.forEach((t) => {
      if (t.worker_id) w[t.worker_id] = t.id;
    });
    return w;
  }, [hist]);

  if (!hist) return <div className="replay-loading">loading history…</div>;

  const total = hist.events.length;
  const cur = idx > 0 ? hist.events[idx - 1] : null;
  const stamp = cur ? new Date(cur.ts).toLocaleTimeString() : "start";
  const anyRunning = Object.values(tasks).some((t) => t.status === "running");

  return (
    <div className="replay-view">
      <svg className="replay-svg" viewBox="-460 -360 920 720" preserveAspectRatio="xMidYMid meet">
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
        <Cluster
          floor={hist.floor}
          cx={0}
          cy={0}
          workers={hist.workers}
          tasks={tasks}
          workerTask={workerTask}
          selectedWorker={null}
          onSelectWorker={() => {}}
          running={anyRunning}
        />
      </svg>

      <div className="hud replay-bar panel">
        <strong>REPLAY</strong>
        <button onClick={() => setPlaying((p) => !p)} disabled={idx >= total && !playing}>
          {playing ? "⏸" : "▶"}
        </button>
        <button onClick={() => { setIdx(0); setPlaying(false); }}>⏮</button>
        <input
          type="range"
          min={0}
          max={total}
          value={idx}
          onChange={(e) => { setPlaying(false); setIdx(Number(e.target.value)); }}
          className="scrub"
        />
        <span className="counter">
          {idx}/{total} · {stamp}
          {cur ? ` · ${cur.type}${cur.status ? " → " + cur.status : ""}` : ""}
        </span>
        <button className="ok" onClick={onClose}>● Live</button>
      </div>
    </div>
  );
}
