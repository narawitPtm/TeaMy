/**
 * Phase 3/4 — reusable engine driver.
 *
 * Extracted so both the CLI (src/engine/index.ts) and the web server
 * (src/server.ts) drive the same plan -> supervise -> assemble loop with an
 * injectable event sink.
 */
import { Dao, type Floor, type Task } from "../db/dao.js";
import type { EngineEvent } from "./events.js";
import { plan } from "./planner.js";
import { Scheduler } from "./scheduler.js";

export interface RunResult {
  tasks: Task[];
  leaves: Task[];
  failed: Task[];
}

/** Crash safety: re-queue tasks stuck in 'running' (running->failed->retrying->queued). */
export function recoverStuck(
  dao: Dao,
  floorId: string,
  emit: (e: Omit<EngineEvent, "ts">) => EngineEvent,
  log: (m: string) => void = () => {},
) {
  for (const t of dao.getTasksByStatus("running", floorId)) {
    log(`[recover] task ${t.id} was stuck in 'running'; re-queueing`);
    const failed = dao.setTaskStatus(t.id, "failed");
    const retrying = dao.setTaskStatus(failed.id, "retrying");
    dao.setTaskStatus(retrying.id, "queued");
    emit({
      taskId: t.id,
      floorId,
      workerId: null,
      type: "status-change",
      status: "queued",
      payload: { recovered: true, sessionId: t.session_id },
    });
  }
}

/** Ensure a worker exists for every (specialize, model) the plan needs. */
export function provisionWorkers(
  dao: Dao,
  floor: Floor,
  tasks: Task[],
  log: (m: string) => void = () => {},
) {
  // Manual roster: workers are user-defined; never auto-create new ones.
  if (floor.mode === "manual") return;
  const seen = new Set(dao.listWorkers(floor.id).map((w) => `${w.role}|${w.model}`));
  for (const t of tasks) {
    const role = t.specialize ?? "worker";
    const k = `${role}|${t.model}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const w = dao.createWorker({
      floorId: floor.id,
      name: role.charAt(0).toUpperCase() + role.slice(1),
      role,
      model: t.model,
      authMode: "max",
    });
    log(`[provision] worker ${w.id} (${role}, ${t.model})`);
  }
}

export async function runCommand(args: {
  dao: Dao;
  floor: Floor;
  command: string;
  emit: (e: Omit<EngineEvent, "ts">) => EngineEvent;
  concurrency?: number;
  log?: (m: string) => void;
}): Promise<RunResult> {
  const { dao, floor, command, emit, concurrency = 2 } = args;
  const log = args.log ?? (() => {});

  recoverStuck(dao, floor.id, emit, log);

  const { tasks } = await plan(dao, floor, command, log);
  provisionWorkers(dao, floor, tasks, log);

  const scheduler = new Scheduler(dao, { floorId: floor.id, concurrency, emit });
  await scheduler.supervise();

  const all = dao.listTasks(floor.id);
  const hasDependent = new Set<string>();
  for (const t of all) for (const d of t.depends_on) hasDependent.add(d);
  const leaves = all.filter((t) => !hasDependent.has(t.id));
  const failed = all.filter((t) => t.status === "failed");
  return { tasks: all, leaves, failed };
}
