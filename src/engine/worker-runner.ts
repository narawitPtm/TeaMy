/**
 * Phase 3 — worker runner.
 *
 * Runs ONE task with the Claude Agent SDK. A worker only reads its injected
 * input (task.input) and writes its own output (task.output) — both via the
 * board (DAO). It never talks to another worker. Every SDK message is appended
 * to task_events and re-emitted on the consolidated engine stream.
 */
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Dao, Task, Worker } from "../db/dao.js";
import type { EngineEvent } from "./events.js";

const WORKER_TIMEOUT_MS = 120_000;

export interface RunOutcome {
  ok: boolean;
  output: string;
  sessionId: string | null;
  modelReported: string | null;
  costUsd: number | null;
  error?: string;
}

/** Normalize the noisy SDK stream to a clean event type (see PHASE1_FINDINGS). */
function classify(msg: Record<string, unknown>): string | null {
  const type = msg.type as string;
  const subtype = msg.subtype as string | undefined;
  if (type === "system") return subtype === "init" ? "start" : null;
  if (type === "assistant") {
    const content = (msg.message as Record<string, unknown> | undefined)?.content;
    if (Array.isArray(content)) {
      if (content.some((b) => (b as Record<string, unknown>).type === "tool_use"))
        return "tool_use";
      if (content.some((b) => (b as Record<string, unknown>).type === "text"))
        return "assistant_text";
      if (content.some((b) => (b as Record<string, unknown>).type === "thinking"))
        return "thinking";
    }
    return null;
  }
  if (type === "result") return msg.is_error ? "error" : "finish";
  return null;
}

/**
 * Build the env for this invocation, honoring the worker's auth_mode.
 *  - 'max':    no ANTHROPIC_API_KEY -> uses `claude login` (Max) credentials.
 *  - 'apiKey': inject the key from settings for THIS invocation only. Never log.
 */
function buildEnv(
  worker: Worker,
  dao: Dao,
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  delete env.ANTHROPIC_API_KEY; // default to the Max path
  if (worker.auth_mode === "apiKey") {
    const key = dao.getSetting("ANTHROPIC_API_KEY");
    if (!key) {
      throw new Error(
        `worker ${worker.id}: auth_mode 'apiKey' but no ANTHROPIC_API_KEY in settings`,
      );
    }
    // Scoped to this invocation only. NEVER logged or emitted.
    env.ANTHROPIC_API_KEY = key;
  }
  return env;
}

export interface RunTaskOptions {
  cwd?: string | null;
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | null;
}

export async function runTask(
  dao: Dao,
  task: Task,
  worker: Worker,
  emit: (e: Omit<EngineEvent, "ts">) => EngineEvent,
  opts: RunTaskOptions = {},
): Promise<RunOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WORKER_TIMEOUT_MS);

  const tag = (type: string, payload: unknown, status: string | null = "running") =>
    emit({ taskId: task.id, floorId: task.floor_id, workerId: worker.id, type, status, payload });

  let output = "";
  let sessionId: string | null = null;
  let modelReported: string | null = null;
  let costUsd: number | null = null;

  try {
    const env = buildEnv(worker, dao);
    for await (const message of query({
      prompt: task.input ?? "",
      options: {
        model: task.model,
        systemPrompt: task.system_prompt ?? undefined,
        abortController: controller,
        maxTurns: 6,
        settingSources: [], // clean room — don't load project CLAUDE.md/hooks
        ...(opts.cwd ? { cwd: opts.cwd } : {}),
        ...(opts.permissionMode ? { permissionMode: opts.permissionMode } : {}),
        env: env as Record<string, string>,
      },
    })) {
      const msg = message as Record<string, unknown>;

      if (!sessionId && typeof msg.session_id === "string") {
        sessionId = msg.session_id;
        dao.setTaskSession(task.id, sessionId);
      }
      if (msg.type === "assistant") {
        const m = msg.message as Record<string, unknown> | undefined;
        if (m && typeof m.model === "string") modelReported = m.model;
      }

      const kind = classify(msg);
      if (kind) {
        dao.appendEvent(task.id, kind, msg); // persist raw SDK message
        tag(kind, msg);
      }

      if (msg.type === "result") {
        if (typeof msg.result === "string") output = msg.result;
        if (typeof msg.total_cost_usd === "number") costUsd = msg.total_cost_usd;
        if (msg.is_error) {
          return {
            ok: false,
            output,
            sessionId,
            modelReported,
            costUsd,
            error: String(msg.subtype ?? "result error"),
          };
        }
      }
    }
    return { ok: true, output, sessionId, modelReported, costUsd };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    dao.appendEvent(task.id, "error", { error });
    tag("error", { error }, "running");
    return { ok: false, output, sessionId, modelReported, costUsd, error };
  } finally {
    clearTimeout(timer);
  }
}
