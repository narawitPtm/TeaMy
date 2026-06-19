/**
 * Phase 3 — scheduler (the orchestrator's SUPERVISE phase).
 *
 * Watches the board (SQLite) and drives tasks through the state machine:
 *   - a task is runnable when all its depends_on tasks are 'done'
 *   - runnable tasks go queued -> running as worker slots free up (concurrency)
 *   - on finish: write output, mark done, inject output into dependents' input
 *   - deps not yet met: the task sits in 'blocked'
 *   - on error/timeout: failed -> retrying -> queued, up to MAX_RETRIES
 *
 * Workers never talk to each other; the scheduler routes every output through
 * the board. 1 task = 1 worker = its own output.
 */
import type { Dao, Task, Worker } from "../db/dao.js";
import type { TaskStatus } from "../db/states.js";
import type { EngineEvent } from "./events.js";
import { runTask } from "./worker-runner.js";

const MAX_RETRIES = 2;

export interface SchedulerOptions {
  floorId: string;
  concurrency?: number;
  emit: (e: Omit<EngineEvent, "ts">) => EngineEvent;
}

export class Scheduler {
  private readonly concurrency: number;
  private running = new Set<string>();

  constructor(
    private readonly dao: Dao,
    private readonly opts: SchedulerOptions,
  ) {
    this.concurrency = opts.concurrency ?? 2;
  }

  private emitStatus(task: Task, status: TaskStatus, extra: unknown = {}) {
    this.opts.emit({
      taskId: task.id,
      floorId: task.floor_id,
      workerId: null,
      type: "status-change",
      status,
      payload: { from: task.status, to: status, ...(extra as object) },
    });
  }

  /** Move a task through the validated state machine and log the change. */
  private transition(task: Task, to: TaskStatus, extra?: unknown): Task {
    const updated = this.dao.setTaskStatus(task.id, to);
    this.dao.appendEvent(task.id, "status-change", {
      from: task.status,
      to,
      ...(extra as object),
    });
    this.emitStatus(task, to, extra);
    return updated;
  }

  private depsState(task: Task): "ready" | "pending" | "failed" {
    if (task.depends_on.length === 0) return "ready";
    let allDone = true;
    for (const depId of task.depends_on) {
      const dep = this.dao.getTask(depId);
      if (!dep) continue;
      if (dep.status === "failed") return "failed";
      if (dep.status !== "done") allDone = false;
    }
    return allDone ? "ready" : "pending";
  }

  /** Inject upstream outputs into a task's input before it runs. */
  private buildInput(task: Task): string {
    if (task.depends_on.length === 0) return task.input ?? "";
    const upstream = task.depends_on
      .map((depId) => {
        const dep = this.dao.getTask(depId);
        return dep?.output
          ? `--- upstream result from ${dep.id} (${dep.specialize ?? "task"}) ---\n${dep.output}`
          : "";
      })
      .filter(Boolean)
      .join("\n\n");
    const base = task.input ?? "";
    return upstream ? `${base}\n\n${upstream}`.trim() : base;
  }

  /** Pick a worker on this floor matching the task's specialty (else any). */
  private pickWorker(task: Task): Worker | undefined {
    const workers = this.dao.listWorkers(this.opts.floorId);
    return (
      workers.find((w) => w.role && w.role === task.specialize) ??
      workers.find((w) => w.model === task.model) ??
      workers[0]
    );
  }

  /** One scheduling pass: advance idle/blocked tasks, dispatch runnable ones. */
  private async tick(): Promise<void> {
    // 1. Classify idle/blocked tasks by dependency readiness.
    const pending = [
      ...this.dao.getTasksByStatus("idle", this.opts.floorId),
      ...this.dao.getTasksByStatus("blocked", this.opts.floorId),
    ];
    for (const task of pending) {
      const state = this.depsState(task);
      if (task.status === "idle") {
        // idle -> queued (deps ready) or idle -> queued -> blocked (deps pending)
        const queued = this.transition(task, "queued");
        if (state === "pending") this.transition(queued, "blocked");
      } else if (task.status === "blocked" && state === "ready") {
        this.transition(task, "queued"); // blocked -> queued
      }
    }

    // 2. Dispatch queued+ready tasks up to the concurrency limit.
    const queued = this.dao
      .getTasksByStatus("queued", this.opts.floorId)
      .filter((t) => this.depsState(t) === "ready");

    for (const task of queued) {
      if (this.running.size >= this.concurrency) break;
      void this.dispatch(task);
    }
  }

  private async dispatch(task: Task): Promise<void> {
    this.running.add(task.id);
    const worker = this.pickWorker(task);
    if (!worker) {
      this.transition(task, "running");
      this.transition(this.dao.getTask(task.id)!, "failed", {
        error: "no worker available",
      });
      this.running.delete(task.id);
      return;
    }

    // Persist the assignment so the snapshot conveys worker<->task binding even
    // to clients that connect mid-run (and so resume/inspection know who ran it).
    this.dao.setTaskWorker(task.id, worker.id);

    // Bind this worker to its planet up front (carries workerId) so the UI can
    // reflect state on the planet — including 'waiting-human' before the SDK
    // ever starts (the gate happens before any agent event is emitted).
    this.opts.emit({
      taskId: task.id,
      floorId: task.floor_id,
      workerId: worker.id,
      type: "assign",
      status: "running",
      payload: { worker: worker.id, model: task.model },
    });

    const injected = this.buildInput(task);
    this.dao.setTaskInput(task.id, injected);
    let runningTask = this.transition(task, "running"); // queued -> running

    // Human-in-the-loop gate: if this task needs approval and none is recorded
    // yet, pause in 'waiting-human' until a human decides (POST /approve).
    if (runningTask.requires_approval && !runningTask.approval) {
      this.transition(runningTask, "waiting-human"); // running -> waiting-human
      const decision = await this.awaitApproval(task.id);
      if (decision !== "approved") {
        // rejected (or timed out): waiting-human -> failed, no retry.
        this.dao.setTaskOutput(task.id, `(blocked by human: ${decision})`);
        this.transition(this.dao.getTask(task.id)!, "failed", { rejected: true, decision });
        this.running.delete(task.id);
        return;
      }
      runningTask = this.transition(this.dao.getTask(task.id)!, "running"); // approved
    }

    const outcome = await runTask(
      this.dao,
      { ...runningTask, input: injected },
      worker,
      this.opts.emit,
    );

    if (outcome.ok) {
      this.dao.setTaskOutput(task.id, outcome.output);
      this.transition(this.dao.getTask(task.id)!, "done", {
        model: outcome.modelReported,
        costUsd: outcome.costUsd,
      });
    } else {
      // running -> failed, then maybe failed -> retrying -> queued.
      const failed = this.transition(this.dao.getTask(task.id)!, "failed", {
        error: outcome.error,
      });
      const retries = this.dao.getTask(task.id)!.retries;
      if (retries < MAX_RETRIES) {
        this.dao.incrementRetries(task.id);
        const retrying = this.transition(failed, "retrying");
        this.transition(retrying, "queued"); // back into the pool
      }
      // else: stays 'failed' and is surfaced.
    }

    this.running.delete(task.id);
  }

  /** Poll the board for a human approval decision (set via the server). */
  private async awaitApproval(
    taskId: string,
    timeoutMs = 600_000,
  ): Promise<"approved" | "rejected" | "timeout"> {
    const start = Date.now();
    for (;;) {
      const t = this.dao.getTask(taskId);
      if (t?.approval) return t.approval;
      if (Date.now() - start > timeoutMs) return "timeout";
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  private isDone(): boolean {
    const tasks = this.dao.listTasks(this.opts.floorId);
    if (tasks.length === 0) return true;
    // Done when nothing can still make progress: no idle/queued/running/blocked/
    // waiting-human/retrying left. (failed with deps stuck also terminates.)
    const active = tasks.filter((t) =>
      ["idle", "queued", "running", "retrying", "waiting-human"].includes(t.status),
    );
    if (active.length > 0) return false;
    // Blocked tasks whose deps failed will never run — treat as terminal.
    const blocked = tasks.filter((t) => t.status === "blocked");
    for (const b of blocked) {
      if (this.depsState(b) === "ready") return false; // still schedulable
    }
    return true;
  }

  /** Run the supervise loop until the floor reaches a terminal state. */
  async supervise(): Promise<void> {
    // Guard against a runaway loop.
    for (let i = 0; i < 10_000; i++) {
      await this.tick();
      if (this.running.size === 0 && this.isDone()) return;
      await new Promise((r) => setTimeout(r, this.running.size > 0 ? 200 : 50));
    }
  }
}
