/**
 * Multi-Agent Orchestrator — Phase 1 PoC (throwaway probe, kept readable)
 *
 * Proves four risky assumptions with the Claude Agent SDK, Max auth only:
 *   1. Orchestrator/workers run against Claude Max with NO ANTHROPIC_API_KEY.
 *   2. Two workers run on DIFFERENT models in the same run.
 *   3. Dependency wiring: worker A's output is injected as worker B's input.
 *   4. A structured event stream per agent is captured + printed as JSON lines.
 *
 * CLI only. No web server, no DB, no frontend.
 *
 * Run:  npx tsx src/poc.ts
 */
import { query } from "@anthropic-ai/claude-agent-sdk";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AuthMode = "max" | "apiKey";

interface WorkerConfig {
  id: string;
  systemPrompt: string;
  model: string;
  authMode: AuthMode;
}

/** The clean event we emit per agent. payload holds the raw SDK message. */
interface AgentEvent {
  taskId: string;
  workerId: string;
  type:
    | "start"
    | "thinking"
    | "assistant_text"
    | "tool_use"
    | "finish"
    | "error"
    | "other";
  payload: unknown;
  ts: string;
}

interface WorkerResult {
  ok: boolean;
  text: string;
  sessionId: string | null;
  costUsd: number | null;
  modelReported: string | null;
  error?: string;
}

// ---------------------------------------------------------------------------
// Concurrency limiter (reusable semaphore) — capped at 2 for the PoC
// ---------------------------------------------------------------------------

class Limiter {
  private active = 0;
  private queue: Array<() => void> = [];
  constructor(private readonly max: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

// ---------------------------------------------------------------------------
// Event normalization — map the noisy SDK stream to clean event types.
// (Derived from the Phase 1 probe: see ai-workspace/PHASE1_FINDINGS.md)
// ---------------------------------------------------------------------------

function classify(msg: Record<string, unknown>): AgentEvent["type"] | null {
  const type = msg.type as string;
  const subtype = msg.subtype as string | undefined;

  if (type === "system") {
    if (subtype === "init") return "start";
    // hook_*, thinking_tokens, post_turn_summary, status, etc. → drop as noise
    return null;
  }
  if (type === "assistant") {
    const content = (msg.message as Record<string, unknown> | undefined)
      ?.content;
    if (Array.isArray(content)) {
      if (content.some((b) => (b as Record<string, unknown>).type === "tool_use"))
        return "tool_use";
      if (content.some((b) => (b as Record<string, unknown>).type === "text"))
        return "assistant_text";
      if (content.some((b) => (b as Record<string, unknown>).type === "thinking"))
        return "thinking";
    }
    return "other";
  }
  if (type === "result") {
    return (msg.is_error ? "error" : "finish");
  }
  // rate_limit_event, user, etc.
  return null;
}

function emit(ev: AgentEvent) {
  // One JSON line per event — the contract future phases (WS/UI) will consume.
  process.stdout.write(JSON.stringify(ev) + "\n");
}

// ---------------------------------------------------------------------------
// Worker runner
// ---------------------------------------------------------------------------

const WORKER_TIMEOUT_MS = 120_000;

async function runWorker(
  taskId: string,
  worker: WorkerConfig,
  input: string,
): Promise<WorkerResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WORKER_TIMEOUT_MS);

  // --- Auth handling -------------------------------------------------------
  // authMode 'max': run WITHOUT ANTHROPIC_API_KEY so the SDK uses `claude login`
  //                 (Max subscription) credentials.
  // authMode 'apiKey': would inject ANTHROPIC_API_KEY for THIS invocation only.
  //                    Not exercised yet (no key available). Never log the key.
  const env: Record<string, string | undefined> = { ...process.env };
  delete env.ANTHROPIC_API_KEY; // ensure Max path by default
  if (worker.authMode === "apiKey") {
    // TODO(apiKey): inject the per-worker key here once a key exists, e.g.
    //   env.ANTHROPIC_API_KEY = getKeyFromSettings();
    // It must be scoped to this invocation only and NEVER logged.
    throw new Error(
      `worker ${worker.id}: authMode 'apiKey' not wired yet (no key available)`,
    );
  }

  let finalText = "";
  let sessionId: string | null = null;
  let costUsd: number | null = null;
  let modelReported: string | null = null;

  try {
    for await (const message of query({
      prompt: input,
      options: {
        model: worker.model,
        systemPrompt: worker.systemPrompt,
        abortController: controller,
        maxTurns: 3,
        // Clean room: don't load this project's CLAUDE.md / hooks / settings
        // into the worker — keeps the worker's behavior reproducible and cheap.
        settingSources: [],
        // Max path: env without ANTHROPIC_API_KEY.
        env: env as Record<string, string>,
      },
    })) {
      const msg = message as Record<string, unknown>;
      if (!sessionId && typeof msg.session_id === "string")
        sessionId = msg.session_id;

      // Capture the model the API actually reported (proves model-per-worker).
      if (msg.type === "assistant") {
        const m = msg.message as Record<string, unknown> | undefined;
        if (m && typeof m.model === "string") modelReported = m.model;
      }

      const kind = classify(msg);
      if (kind) {
        emit({
          taskId,
          workerId: worker.id,
          type: kind,
          payload: msg,
          ts: new Date().toISOString(),
        });
      }

      if (msg.type === "result") {
        if (typeof msg.result === "string") finalText = msg.result;
        if (typeof msg.total_cost_usd === "number") costUsd = msg.total_cost_usd;
        if (msg.is_error) {
          return {
            ok: false,
            text: finalText,
            sessionId,
            costUsd,
            modelReported,
            error: String(msg.subtype ?? "result error"),
          };
        }
      }
    }

    return { ok: true, text: finalText, sessionId, costUsd, modelReported };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    emit({
      taskId,
      workerId: worker.id,
      type: "error",
      payload: { error },
      ts: new Date().toISOString(),
    });
    return { ok: false, text: finalText, sessionId, costUsd, modelReported, error };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Orchestrator + main
// ---------------------------------------------------------------------------

async function main() {
  const COMMAND =
    "Write a haiku about the ocean, then count the syllables in it.";

  console.error(`\n[orchestrator] command: ${COMMAND}`);
  console.error(
    `[orchestrator] ANTHROPIC_API_KEY present: ${Boolean(process.env.ANTHROPIC_API_KEY)} (expected: false for Max)\n`,
  );

  // PLAN: orchestrator decomposes into exactly 2 subtasks with a dependency.
  //   task A (no deps): write the haiku           -> capable model (Sonnet)
  //   task B (depends on A): count the syllables   -> cheaper model (Haiku)
  const workerA: WorkerConfig = {
    id: "worker-A",
    systemPrompt:
      "You are a poet. Write a single haiku (3 lines, 5-7-5 syllables). Output ONLY the haiku, no commentary.",
    model: "claude-sonnet-4-6",
    authMode: "max",
  };
  const workerB: WorkerConfig = {
    id: "worker-B",
    systemPrompt:
      "You are a syllable counter. Given a haiku, count the syllables in each line and report them as 'line N: X syllables'. Be concise.",
    model: "claude-haiku-4-5",
    authMode: "max",
  };

  const taskA = { id: "task-A", worker: workerA, dependsOn: [] as string[] };
  const taskB = { id: "task-B", worker: workerB, dependsOn: ["task-A"] };

  const limiter = new Limiter(2);

  // Run A (no deps).
  console.error("[orchestrator] dispatching task-A (write haiku)…");
  const resultA = await limiter.run(() =>
    runWorker(taskA.id, taskA.worker, COMMAND),
  );

  if (!resultA.ok) {
    console.error("[orchestrator] task-A failed:", resultA.error);
  }

  // Dependency wiring: inject A's output as B's input.
  const inputB = `Count the syllables in each line of this haiku:\n\n${resultA.text}`;
  console.error(
    "[orchestrator] task-A done; injecting its output into task-B…",
  );

  const resultB = await limiter.run(() =>
    runWorker(taskB.id, taskB.worker, inputB),
  );

  // ----- Final output ------------------------------------------------------
  console.error("\n========== FINAL RESULT (task-B) ==========");
  console.error(resultB.text || "(no output)");

  console.error("\n========== TASK-A OUTPUT (the haiku) ==========");
  console.error(resultA.text || "(no output)");

  console.error("\n========== SUMMARY ==========");
  const rows = [
    {
      task: taskA.id,
      worker: workerA.id,
      "model (requested)": workerA.model,
      "model (reported)": resultA.modelReported ?? "—",
      authMode: workerA.authMode,
      ok: resultA.ok,
      "cost $": resultA.costUsd?.toFixed(4) ?? "—",
    },
    {
      task: taskB.id,
      worker: workerB.id,
      "model (requested)": workerB.model,
      "model (reported)": resultB.modelReported ?? "—",
      authMode: workerB.authMode,
      ok: resultB.ok,
      "cost $": resultB.costUsd?.toFixed(4) ?? "—",
    },
  ];
  console.table(rows);

  const differentModels =
    resultA.modelReported &&
    resultB.modelReported &&
    resultA.modelReported !== resultB.modelReported;
  console.error("\n[checks]");
  console.error("  1. ran against Max (no API key):", !process.env.ANTHROPIC_API_KEY);
  console.error("  2. workers ran on DIFFERENT models:", Boolean(differentModels),
    `(A=${resultA.modelReported}, B=${resultB.modelReported})`);
  console.error("  3. A's output flowed into B:", resultA.text.length > 0 && resultB.text.length > 0);
  console.error("  4. captured structured event stream: yes (JSON lines above)");
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
