import { useEffect, useMemo, useState } from "react";
import type { History, Task } from "./types";
import { Scene } from "./Scene";

/**
 * Phase 8 — replay scrubber.
 *
 * Pure view: fetches the recorded task_events for the floor (GET /history) and
 * reconstructs the scene at any point on the timeline. Dragging the slider (or
 * pressing play) sets a "playhead"; each task's status is the latest
 * status-change at or before the playhead. Worker↔planet binding comes from the
 * persisted task.worker_id, so planets light up exactly as they did live.
 *
 * It contains NO engine logic — it just re-derives past state from the log.
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
        setIdx(h.events.length); // start fully resolved
      });
  }, [floorId]);

  // Auto-advance while playing.
  useEffect(() => {
    if (!playing || !hist) return;
    if (idx >= hist.events.length) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setIdx((i) => i + 1), 320);
    return () => clearTimeout(t);
  }, [playing, idx, hist]);

  // Derive each task's status by replaying status-changes up to the playhead.
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

  return (
    <div className="replay">
      <div className="replay-bar">
        <strong>Replay</strong>
        <button onClick={() => setPlaying((p) => !p)} disabled={idx >= total && !playing}>
          {playing ? "⏸ Pause" : "▶ Play"}
        </button>
        <button onClick={() => { setIdx(0); setPlaying(false); }}>⏮ Restart</button>
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
        <button className="replay-close" onClick={onClose}>← Live</button>
      </div>

      <div className="stage">
        <Scene
          floors={hist.floors}
          workers={hist.workers}
          tasks={tasks}
          workerTask={workerTask}
          selectedWorker={null}
          onSelectWorker={() => {}}
        />
      </div>
    </div>
  );
}
