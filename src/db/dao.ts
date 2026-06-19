/**
 * Phase 2 — typed data-access layer.
 *
 * The ONLY sanctioned way to touch the DB. Crucially, `setTaskStatus` routes
 * every status change through the validated state machine (assertTransition),
 * so an illegal transition can never be persisted.
 */
import { randomUUID } from "node:crypto";
import type { DB } from "./schema.js";
import { assertTransition, type TaskStatus } from "./states.js";

// ---------------------------------------------------------------------------
// Row types (as stored / as returned)
// ---------------------------------------------------------------------------

export type PermissionMode = "default" | "acceptEdits" | "bypassPermissions";

export interface Floor {
  id: string;
  name: string;
  team: string | null;
  instruction: string | null;
  model: string | null; // null/'' = auto
  cwd: string | null;
  permission_mode: PermissionMode | null;
  mode: "auto" | "manual" | null; // null = auto
}

export interface Worker {
  id: string;
  floor_id: string;
  name: string;
  role: string | null;
  model: string;
  auth_mode: "max" | "apiKey";
  system_prompt: string | null;
}

export interface TaskRow {
  id: string;
  floor_id: string;
  parent_id: string | null;
  specialize: string | null;
  system_prompt: string | null;
  model: string;
  status: TaskStatus;
  input: string | null;
  output: string | null;
  depends_on: string; // JSON array in the DB
  session_id: string | null;
  retries: number;
  requires_approval: number; // 0 | 1
  approval: "approved" | "rejected" | null;
  worker_id: string | null;
  created_at: string;
  updated_at: string;
}

/** A task with depends_on parsed into a real array. */
export interface Task extends Omit<TaskRow, "depends_on"> {
  depends_on: string[];
}

export interface TaskEvent {
  id: number;
  task_id: string;
  type: string;
  payload: unknown;
  ts: string;
}

function hydrateTask(row: TaskRow): Task {
  return { ...row, depends_on: JSON.parse(row.depends_on) as string[] };
}

// ---------------------------------------------------------------------------
// DAO
// ---------------------------------------------------------------------------

export class Dao {
  constructor(private readonly db: DB) {}

  // --- floors --------------------------------------------------------------
  createFloor(input: {
    id?: string;
    name: string;
    team?: string;
    instruction?: string;
    model?: string;
    cwd?: string;
    permissionMode?: PermissionMode;
    mode?: "auto" | "manual";
  }): Floor {
    const id = input.id ?? `floor_${randomUUID().slice(0, 8)}`;
    this.db
      .prepare(
        `INSERT INTO floors (id, name, team, instruction, model, cwd, permission_mode, mode)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.team ?? null,
        input.instruction?.trim() || null,
        input.model?.trim() || null,
        input.cwd?.trim() || null,
        input.permissionMode ?? null,
        input.mode ?? "auto",
      );
    return this.getFloor(id)!;
  }

  getFloor(id: string): Floor | undefined {
    return this.db.prepare(`SELECT * FROM floors WHERE id = ?`).get(id) as
      | Floor
      | undefined;
  }

  listFloors(): Floor[] {
    return this.db.prepare(`SELECT * FROM floors ORDER BY id`).all() as Floor[];
  }

  /** Delete a floor; ON DELETE CASCADE removes its workers/tasks/events too. */
  deleteFloor(id: string): void {
    this.db.prepare(`DELETE FROM floors WHERE id = ?`).run(id);
  }

  // --- workers -------------------------------------------------------------
  createWorker(input: {
    id?: string;
    floorId: string;
    name: string;
    role?: string;
    model: string;
    authMode?: "max" | "apiKey";
    systemPrompt?: string;
  }): Worker {
    const id = input.id ?? `worker_${randomUUID().slice(0, 8)}`;
    this.db
      .prepare(
        `INSERT INTO workers (id, floor_id, name, role, model, auth_mode, system_prompt)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.floorId,
        input.name,
        input.role ?? null,
        input.model,
        input.authMode ?? "max",
        input.systemPrompt?.trim() || null,
      );
    return this.getWorker(id)!;
  }

  getWorker(id: string): Worker | undefined {
    return this.db.prepare(`SELECT * FROM workers WHERE id = ?`).get(id) as
      | Worker
      | undefined;
  }

  listWorkers(floorId?: string): Worker[] {
    return floorId
      ? (this.db
          .prepare(`SELECT * FROM workers WHERE floor_id = ? ORDER BY id`)
          .all(floorId) as Worker[])
      : (this.db.prepare(`SELECT * FROM workers ORDER BY id`).all() as Worker[]);
  }

  // --- tasks ---------------------------------------------------------------
  createTask(input: {
    id?: string;
    floorId: string;
    parentId?: string | null;
    specialize?: string;
    systemPrompt?: string;
    model: string;
    status?: TaskStatus;
    input?: string;
    dependsOn?: string[];
    requiresApproval?: boolean;
  }): Task {
    const id = input.id ?? `task_${randomUUID().slice(0, 8)}`;
    this.db
      .prepare(
        `INSERT INTO tasks
           (id, floor_id, parent_id, specialize, system_prompt, model,
            status, input, depends_on, requires_approval)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.floorId,
        input.parentId ?? null,
        input.specialize ?? null,
        input.systemPrompt ?? null,
        input.model,
        input.status ?? "idle",
        input.input ?? null,
        JSON.stringify(input.dependsOn ?? []),
        input.requiresApproval ? 1 : 0,
      );
    return this.getTask(id)!;
  }

  getTask(id: string): Task | undefined {
    const row = this.db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as
      | TaskRow
      | undefined;
    return row ? hydrateTask(row) : undefined;
  }

  listTasks(floorId?: string): Task[] {
    const rows = (
      floorId
        ? this.db
            .prepare(`SELECT * FROM tasks WHERE floor_id = ? ORDER BY created_at`)
            .all(floorId)
        : this.db.prepare(`SELECT * FROM tasks ORDER BY created_at`).all()
    ) as TaskRow[];
    return rows.map(hydrateTask);
  }

  getTasksByStatus(status: TaskStatus, floorId?: string): Task[] {
    const rows = (
      floorId
        ? this.db
            .prepare(
              `SELECT * FROM tasks WHERE status = ? AND floor_id = ? ORDER BY created_at`,
            )
            .all(status, floorId)
        : this.db
            .prepare(`SELECT * FROM tasks WHERE status = ? ORDER BY created_at`)
            .all(status)
    ) as TaskRow[];
    return rows.map(hydrateTask);
  }

  /**
   * The ONLY way to change a task's status. Validates the transition against
   * the state machine first; throws IllegalTransitionError if not allowed.
   */
  setTaskStatus(id: string, to: TaskStatus): Task {
    const task = this.getTask(id);
    if (!task) throw new Error(`No such task: ${id}`);
    assertTransition(task.status, to);
    this.db
      .prepare(
        `UPDATE tasks SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id = ?`,
      )
      .run(to, id);
    return this.getTask(id)!;
  }

  setTaskOutput(id: string, output: string): void {
    this.db
      .prepare(
        `UPDATE tasks SET output = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id = ?`,
      )
      .run(output, id);
  }

  setTaskInput(id: string, input: string): void {
    this.db
      .prepare(
        `UPDATE tasks SET input = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id = ?`,
      )
      .run(input, id);
  }

  setDependsOn(id: string, dependsOn: string[]): void {
    this.db
      .prepare(
        `UPDATE tasks SET depends_on = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id = ?`,
      )
      .run(JSON.stringify(dependsOn), id);
  }

  /** Record a human approval decision for a gated task. */
  setApproval(id: string, decision: "approved" | "rejected"): void {
    this.db
      .prepare(
        `UPDATE tasks SET approval = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id = ?`,
      )
      .run(decision, id);
  }

  /** Record which worker is assigned to run a task (set at dispatch). */
  setTaskWorker(id: string, workerId: string): void {
    this.db
      .prepare(
        `UPDATE tasks SET worker_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id = ?`,
      )
      .run(workerId, id);
  }

  setTaskSession(id: string, sessionId: string): void {
    this.db
      .prepare(
        `UPDATE tasks SET session_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id = ?`,
      )
      .run(sessionId, id);
  }

  incrementRetries(id: string): number {
    this.db.prepare(`UPDATE tasks SET retries = retries + 1 WHERE id = ?`).run(id);
    return this.getTask(id)!.retries;
  }

  // --- task_events (append-only) ------------------------------------------
  appendEvent(taskId: string, type: string, payload: unknown): TaskEvent {
    const info = this.db
      .prepare(`INSERT INTO task_events (task_id, type, payload) VALUES (?, ?, ?)`)
      .run(taskId, type, JSON.stringify(payload));
    return this.getEvent(Number(info.lastInsertRowid))!;
  }

  getEvent(id: number): TaskEvent | undefined {
    const row = this.db
      .prepare(`SELECT * FROM task_events WHERE id = ?`)
      .get(id) as
      | { id: number; task_id: string; type: string; payload: string; ts: string }
      | undefined;
    return row ? { ...row, payload: JSON.parse(row.payload) } : undefined;
  }

  listEvents(taskId: string): TaskEvent[] {
    const rows = this.db
      .prepare(`SELECT * FROM task_events WHERE task_id = ? ORDER BY id`)
      .all(taskId) as Array<{
      id: number;
      task_id: string;
      type: string;
      payload: string;
      ts: string;
    }>;
    return rows.map((r) => ({ ...r, payload: JSON.parse(r.payload) }));
  }

  // --- settings ------------------------------------------------------------
  setSetting(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, value);
  }

  getSetting(key: string): string | undefined {
    const row = this.db
      .prepare(`SELECT value FROM settings WHERE key = ?`)
      .get(key) as { value: string } | undefined;
    return row?.value;
  }

  hasSetting(key: string): boolean {
    return this.getSetting(key) !== undefined;
  }
}
