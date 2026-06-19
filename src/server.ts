/**
 * Phase 4 — minimal web server + WebSocket event stream.
 *
 * Wraps the Phase 3 engine. Proves transport, not design (the pretty UI is
 * Phase 5). Endpoints:
 *   POST /command          { command, floorId? } -> kicks off plan+supervise
 *   GET  /state            current snapshot (floors, workers, tasks)
 *   GET  /settings         { apiKeySet: boolean }   (never the value)
 *   POST /settings/api-key { apiKey }  write-only; stores in SQLite settings
 *   WS   /events           snapshot first, then live EngineEvent deltas
 *
 * Secrets (ANTHROPIC_API_KEY) are NEVER returned by /state or /settings and
 * NEVER sent over the WebSocket.
 */
import { createServer } from "node:http";
import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import { openDb } from "./db/schema.js";
import { Dao } from "./db/dao.js";
import type { EngineEvent } from "./engine/events.js";
import { makeEmitter } from "./engine/events.js";
import { runCommand } from "./engine/run.js";

const PORT = Number(process.env.PORT ?? 4000);
const SECRET_KEYS = new Set(["ANTHROPIC_API_KEY"]);

const db = openDb("orchestrator.sqlite");
const dao = new Dao(db);

// Ensure a default floor exists.
const defaultFloor =
  dao.getFloor("floor_main") ??
  dao.createFloor({ id: "floor_main", name: "Main Floor", team: "default" });

// ---------------------------------------------------------------------------
// Live broadcast plumbing
// ---------------------------------------------------------------------------

const clients = new Set<WebSocket>();

function broadcast(ev: EngineEvent) {
  const line = JSON.stringify({ kind: "event", data: ev });
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(line);
  }
}

/** Engine emit sink: persistence already happens in the engine; we just fan out. */
const emit = makeEmitter(broadcast);

/** Full snapshot a fresh client renders before live deltas arrive. */
function snapshot() {
  return {
    floors: dao.listFloors(),
    workers: dao.listWorkers(), // contains no secrets
    tasks: dao.listTasks().map((t) => ({
      ...t,
      // keep payloads light; full event log is fetchable per-task if needed
    })),
  };
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static("public"));

// Defense in depth: scrub any secret keys from outgoing JSON bodies. Registered
// BEFORE the routes so it wraps res.json for every handler below.
app.use((_req, res, next) => {
  const orig = res.json.bind(res);
  res.json = (body: unknown) => orig(scrubSecrets(body));
  next();
});

app.get("/state", (_req, res) => {
  res.json(snapshot());
});

// Replay history: the recorded task_events for a floor, in chronological order,
// plus the (final) tasks/workers so a client can reconstruct the scene at any
// point in time. Powers the Phase 8 replay scrubber.
app.get("/history", (req, res) => {
  const floorId = (req.query.floorId ?? defaultFloor.id).toString();
  const floor = dao.getFloor(floorId);
  if (!floor) {
    res.status(404).json({ error: `no such floor: ${floorId}` });
    return;
  }
  const tasks = dao.listTasks(floorId);
  const workers = dao.listWorkers(floorId);
  const events = tasks
    .flatMap((t) =>
      dao.listEvents(t.id).map((e) => {
        const p = e.payload as { to?: string } | null;
        const status =
          e.type === "status-change" ? (p?.to ?? null) : e.type === "finish" ? "done" : null;
        return { id: e.id, taskId: t.id, type: e.type, status, ts: e.ts };
      }),
    )
    .sort((a, b) => a.id - b.id); // global autoincrement id == chronological
  res.json({ floor, floors: [floor], workers, tasks, events });
});

app.get("/settings", (_req, res) => {
  res.json({ apiKeySet: dao.hasSetting("ANTHROPIC_API_KEY") });
});

// Write-only: accepts the key, never returns it.
app.post("/settings/api-key", (req, res) => {
  const apiKey = (req.body?.apiKey ?? "").toString().trim();
  if (!apiKey) {
    res.status(400).json({ error: "apiKey required" });
    return;
  }
  dao.setSetting("ANTHROPIC_API_KEY", apiKey);
  res.json({ apiKeySet: true }); // never echo the value
});

// Human-in-the-loop: approve or reject a task waiting in 'waiting-human'.
app.post("/approve", (req, res) => {
  const taskId = (req.body?.taskId ?? "").toString();
  const approved = Boolean(req.body?.approved);
  const task = dao.getTask(taskId);
  if (!task) {
    res.status(404).json({ error: `no such task: ${taskId}` });
    return;
  }
  if (task.status !== "waiting-human") {
    res.status(409).json({ error: `task ${taskId} is not waiting for approval (status: ${task.status})` });
    return;
  }
  dao.setApproval(taskId, approved ? "approved" : "rejected");
  res.json({ taskId, decision: approved ? "approved" : "rejected" });
});

// Create a new team (floor). Each floor runs its own engine concurrently.
const PERMISSION_MODES = new Set(["default", "acceptEdits", "bypassPermissions"]);
app.post("/floors", (req, res) => {
  const b = req.body ?? {};
  const name = (b.name ?? "").toString().trim() || "New Team";
  const team = (b.team ?? "").toString().trim() || undefined;
  const instruction = (b.instruction ?? "").toString();
  const model = (b.model ?? "").toString().trim();
  const cwd = (b.cwd ?? "").toString().trim();
  const pm = (b.permissionMode ?? "").toString();
  const roster = Array.isArray(b.workers) ? b.workers : [];
  const floor = dao.createFloor({
    name,
    team,
    instruction,
    model,
    cwd,
    permissionMode: PERMISSION_MODES.has(pm) ? (pm as "default" | "acceptEdits" | "bypassPermissions") : undefined,
    mode: roster.length ? "manual" : "auto",
  });
  // Manual roster: create the user-defined workers up front.
  for (const w of roster) {
    const role = (w?.role ?? "").toString().trim();
    const name2 = (w?.name ?? role ?? "Worker").toString().trim() || "Worker";
    const wmodel = (w?.model ?? model ?? "claude-sonnet-4-6").toString().trim() || "claude-sonnet-4-6";
    if (!role) continue;
    dao.createWorker({
      floorId: floor.id,
      name: name2,
      role,
      model: wmodel,
      systemPrompt: (w?.systemPrompt ?? "").toString(),
    });
  }
  emit({
    taskId: "-",
    floorId: floor.id,
    workerId: null,
    type: "floor-created",
    status: null,
    payload: { floor },
  });
  res.json({ floor });
});

// Per-floor busy guard — different floors run concurrently, same floor serializes.
const busyFloors = new Set<string>();

// Remove a team (floor) and everything under it.
app.delete("/floors/:id", (req, res) => {
  const id = req.params.id;
  const floor = dao.getFloor(id);
  if (!floor) {
    res.status(404).json({ error: `no such floor: ${id}` });
    return;
  }
  if (busyFloors.has(id)) {
    res.status(409).json({ error: `team ${id} is running; stop it before removing` });
    return;
  }
  dao.deleteFloor(id);
  emit({ taskId: "-", floorId: id, workerId: null, type: "floor-deleted", status: null, payload: { id } });
  res.json({ removed: id });
});
app.post("/command", (req, res) => {
  const command = (req.body?.command ?? "").toString().trim();
  const floorId = (req.body?.floorId ?? defaultFloor.id).toString();
  if (!command) {
    res.status(400).json({ error: "command required" });
    return;
  }
  const floor = dao.getFloor(floorId);
  if (!floor) {
    res.status(404).json({ error: `no such floor: ${floorId}` });
    return;
  }
  if (busyFloors.has(floorId)) {
    res.status(409).json({ error: `team ${floorId} is already running a command` });
    return;
  }
  busyFloors.add(floorId);

  // Fire-and-forget; progress is observed via the WebSocket stream.
  runCommand({ dao, floor, command, emit, concurrency: 2, log: (m) => console.error(m) })
    .then((r) => {
      emit({
        taskId: "-",
        floorId: floor.id,
        workerId: null,
        type: "run-complete",
        status: null,
        payload: { tasks: r.tasks.length, failed: r.failed.length },
      });
    })
    .catch((err) => {
      emit({
        taskId: "-",
        floorId: floor.id,
        workerId: null,
        type: "run-error",
        status: null,
        payload: { error: err instanceof Error ? err.message : String(err) },
      });
    })
    .finally(() => {
      busyFloors.delete(floorId);
    });

  res.json({ accepted: true, floorId: floor.id });
});

function scrubSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubSecrets);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEYS.has(k) ? "***" : scrubSecrets(v);
    }
    return out;
  }
  return value;
}

// ---------------------------------------------------------------------------
// WebSocket /events — snapshot first, then live deltas.
// ---------------------------------------------------------------------------

const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/events" });

wss.on("connection", (ws) => {
  clients.add(ws);
  ws.send(JSON.stringify({ kind: "snapshot", data: snapshot() }));
  ws.on("close", () => clients.delete(ws));
  ws.on("error", () => clients.delete(ws));
});

server.listen(PORT, () => {
  console.error(`[server] http + ws on http://localhost:${PORT}`);
  console.error(`[server] test client: http://localhost:${PORT}/`);
});
