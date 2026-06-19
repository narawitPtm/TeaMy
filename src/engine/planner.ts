/**
 * Phase 3 — planner (the orchestrator's PLAN phase).
 *
 * An orchestrator agent decomposes a command into a task graph (DAG) and writes
 * the tasks into SQLite as 'idle'. It ONLY plans here — it runs no workers.
 *
 * Architecture rule enforced at plan time: 1 task = 1 worker = its own output.
 * Two tasks must never target the same output; if order matters the planner
 * MUST express it as a dependency (serialized), never as parallel tasks.
 */
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Dao, Floor, Task } from "../db/dao.js";

const ORCHESTRATOR_MODEL = "claude-sonnet-4-6";

interface PlannedTask {
  key: string; // planner-local id, used to express deps
  specialize: string; // role/specialty (matched to a worker)
  system_prompt: string;
  model: string;
  input: string; // the static part of the instruction (deps get injected later)
  depends_on: string[]; // keys of other planned tasks
}

const PLAN_SYSTEM_PROMPT = `You are an orchestrator that decomposes a command into a task graph (a DAG).

Rules (HARD constraints):
- Each task is run by exactly ONE worker and produces ONE output. Never have two
  tasks produce the same artifact.
- If task B needs task A's result, express it via depends_on. B's input should
  describe what to do with "the provided input from upstream" — the engine will
  inject A's actual output at run time. Do NOT try to do A's work inside B.
- Prefer the minimum number of tasks that still respects real dependencies.
- Choose a model per task: "claude-sonnet-4-6" for generative/complex work,
  "claude-haiku-4-5" for short/mechanical/checking work.
- "specialize" is a short role label (e.g. "writer", "analyzer", "researcher",
  "summarizer", "coder").

Output ONLY a JSON object, no prose, of this exact shape:
{
  "tasks": [
    {
      "key": "t1",
      "specialize": "writer",
      "system_prompt": "...the worker's role/system prompt...",
      "model": "claude-sonnet-4-6",
      "input": "...what this task should do...",
      "depends_on": []
    }
  ]
}`;

function extractJson(text: string): unknown {
  // Tolerate code fences or stray prose around the JSON object.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("planner returned no JSON object");
  return JSON.parse(candidate.slice(start, end + 1));
}

export interface PlanResult {
  tasks: Task[];
  sessionId: string | null;
  raw: PlannedTask[];
}

/** Run the orchestrator to plan, then persist the DAG as 'idle' tasks. */
export async function plan(
  dao: Dao,
  floor: Floor,
  command: string,
  log: (msg: string) => void = () => {},
): Promise<PlanResult> {
  log(`[planner] decomposing command on floor ${floor.id}…`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);

  let planText = "";
  let sessionId: string | null = null;
  try {
    const env: Record<string, string | undefined> = { ...process.env };
    delete env.ANTHROPIC_API_KEY; // orchestrator runs on Max
    for await (const message of query({
      prompt: `Command to decompose:\n\n${command}`,
      options: {
        model: ORCHESTRATOR_MODEL,
        systemPrompt: PLAN_SYSTEM_PROMPT,
        abortController: controller,
        maxTurns: 2,
        settingSources: [],
        env: env as Record<string, string>,
      },
    })) {
      const msg = message as Record<string, unknown>;
      if (!sessionId && typeof msg.session_id === "string") sessionId = msg.session_id;
      if (msg.type === "result" && typeof msg.result === "string") planText = msg.result;
    }
  } finally {
    clearTimeout(timer);
  }

  const parsed = extractJson(planText) as { tasks: PlannedTask[] };
  if (!parsed?.tasks?.length) throw new Error("planner produced an empty plan");

  // Validate the DAG: every dep must reference a known key (no dangling/self).
  const keys = new Set(parsed.tasks.map((t) => t.key));
  for (const t of parsed.tasks) {
    for (const d of t.depends_on ?? []) {
      if (d === t.key) throw new Error(`task ${t.key} depends on itself`);
      if (!keys.has(d)) throw new Error(`task ${t.key} depends on unknown key ${d}`);
    }
  }

  // Persist. First pass creates rows (planner key -> db id), second wires deps.
  const keyToId = new Map<string, string>();
  for (const t of parsed.tasks) {
    const row = dao.createTask({
      floorId: floor.id,
      specialize: t.specialize,
      systemPrompt: t.system_prompt,
      model: t.model,
      input: t.input,
      status: "idle",
      dependsOn: [], // wired in the next pass once ids exist
    });
    keyToId.set(t.key, row.id);
    log(`[planner] created ${row.id} (${t.specialize}, ${t.model})`);
  }

  const tasks: Task[] = [];
  for (const t of parsed.tasks) {
    const id = keyToId.get(t.key)!;
    const depIds = (t.depends_on ?? []).map((k) => keyToId.get(k)!);
    if (depIds.length) dao.setDependsOn(id, depIds);
    tasks.push(dao.getTask(id)!);
  }

  log(`[planner] plan persisted: ${tasks.length} tasks`);
  return { tasks, sessionId, raw: parsed.tasks };
}
