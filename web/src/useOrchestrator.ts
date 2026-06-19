import { useCallback, useEffect, useRef, useState } from "react";
import type {
  EngineEvent,
  Floor,
  Snapshot,
  Task,
  Worker,
  WsMessage,
} from "./types";

export interface OrchestratorState {
  floors: Floor[];
  workers: Worker[];
  tasks: Record<string, Task>;
  /** workerId -> the task it is currently bound to (learned from agent events) */
  workerTask: Record<string, string>;
  events: EngineEvent[];
  connected: boolean;
  apiKeySet: boolean;
}

const MAX_EVENTS = 500;

/**
 * Pure view-layer data source. On load: GET /state for the snapshot, then keep
 * a live WebSocket open and fold deltas in. The engine is authoritative — if
 * the engine and UI ever disagree, the engine wins (we only ever apply what it
 * sends).
 */
export function useOrchestrator() {
  const [state, setState] = useState<OrchestratorState>({
    floors: [],
    workers: [],
    tasks: {},
    workerTask: {},
    events: [],
    connected: false,
    apiKeySet: false,
  });
  const wsRef = useRef<WebSocket | null>(null);
  const seenWorkers = useRef<Set<string>>(new Set());
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applySnapshot = useCallback((snap: Snapshot) => {
    setState((s) => {
      // Derive worker<->task bindings from the snapshot (tasks persist their
      // assigned worker_id) so a client connecting mid-run still maps planets to
      // their current task — not only from live events it may have missed.
      const workerTask = { ...s.workerTask };
      for (const t of snap.tasks) if (t.worker_id) workerTask[t.worker_id] = t.id;
      return {
        ...s,
        floors: snap.floors,
        workers: snap.workers,
        tasks: Object.fromEntries(snap.tasks.map((t) => [t.id, t])),
        workerTask,
      };
    });
  }, []);

  const applyEvent = useCallback((ev: EngineEvent) => {
    setState((s) => {
      const tasks = { ...s.tasks };
      const workerTask = { ...s.workerTask };
      let workers = s.workers;

      // A fresh run creates tasks the initial snapshot never had. Stub any
      // unknown task on first sighting so its live status updates apply (else
      // running/beam states would be dropped until the run finishes).
      if (ev.taskId && ev.taskId !== "-" && !tasks[ev.taskId]) {
        tasks[ev.taskId] = {
          id: ev.taskId,
          floor_id: ev.floorId,
          parent_id: null,
          specialize: null,
          model: "",
          status: ev.status ?? "idle",
          input: null,
          output: null,
          depends_on: [],
          session_id: null,
          retries: 0,
          requires_approval: 0,
          approval: null,
          worker_id: ev.workerId ?? null,
        };
      }

      // status-change carries the authoritative task status.
      if (ev.type === "status-change" && ev.status && tasks[ev.taskId]) {
        tasks[ev.taskId] = { ...tasks[ev.taskId], status: ev.status };
      }
      // The finish/result event means the task reached 'done' (or error).
      if (ev.type === "finish" && tasks[ev.taskId]) {
        tasks[ev.taskId] = { ...tasks[ev.taskId], status: "done" };
      }
      // Agent events carry the worker<->task binding (status-change does not).
      if (ev.workerId) {
        workerTask[ev.workerId] = ev.taskId;
        // A worker provisioned mid-run may not be in the snapshot; add a stub.
        if (!workers.some((w) => w.id === ev.workerId)) {
          workers = [
            ...workers,
            {
              id: ev.workerId,
              floor_id: ev.floorId,
              name: ev.workerId,
              role: tasks[ev.taskId]?.specialize ?? null,
              model: tasks[ev.taskId]?.model ?? "",
              auth_mode: "max",
            },
          ];
        }
      }

      const events = [...s.events, ev];
      if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
      return { ...s, tasks, workerTask, workers, events };
    });
  }, []);

  // Reconcile against the server snapshot (e.g. after a run provisions workers
  // or creates tasks the UI hasn't learned about yet).
  const refresh = useCallback(async () => {
    const snap = (await fetch("/state").then((r) => r.json())) as Snapshot;
    applySnapshot(snap);
    const settings = await fetch("/settings").then((r) => r.json());
    setState((s) => ({ ...s, apiKeySet: Boolean(settings.apiKeySet) }));
  }, [applySnapshot]);

  useEffect(() => {
    refresh();
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/events`);
    wsRef.current = ws;
    ws.onopen = () => setState((s) => ({ ...s, connected: true }));
    ws.onclose = () => setState((s) => ({ ...s, connected: false }));
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data) as WsMessage & { data: { type?: string } };
      if (msg.kind === "snapshot") applySnapshot(msg.data as Snapshot);
      else if (msg.kind === "event") {
        const ev = msg.data as EngineEvent;
        applyEvent(ev);
        // First time we see a worker, pull the snapshot (debounced) to get its
        // real name/model instead of the stub. Reconcile fully on run end too.
        if (ev.workerId && !seenWorkers.current.has(ev.workerId)) {
          seenWorkers.current.add(ev.workerId);
          if (refreshTimer.current) clearTimeout(refreshTimer.current);
          refreshTimer.current = setTimeout(() => void refresh(), 400);
        }
        if (ev.type === "run-complete" || ev.type === "run-error" || ev.type === "floor-created")
          void refresh();
      }
    };
    return () => ws.close();
  }, [applySnapshot, applyEvent, refresh]);

  const sendCommand = useCallback(async (command: string, floorId?: string) => {
    return fetch("/command", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command, floorId }),
    }).then((r) => r.json());
  }, []);

  const saveApiKey = useCallback(
    async (apiKey: string) => {
      await fetch("/settings/api-key", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });
      await refresh();
    },
    [refresh],
  );

  const createFloor = useCallback(async (name: string) => {
    const r = await fetch("/floors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    }).then((x) => x.json());
    await refresh();
    return r.floor;
  }, [refresh]);

  const approve = useCallback(async (taskId: string, approved: boolean) => {
    return fetch("/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskId, approved }),
    }).then((r) => r.json());
  }, []);

  return { state, sendCommand, saveApiKey, approve, createFloor };
}
