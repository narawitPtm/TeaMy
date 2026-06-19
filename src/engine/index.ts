/**
 * Phase 3 — orchestration engine CLI entry point (headless).
 *
 * command -> PLAN (DAG) -> SUPERVISE -> assembled result. Shares the driver
 * with the Phase 4 server (src/engine/run.ts).
 *
 * Run:  npx tsx src/engine/index.ts "your command here"
 *   or: echo "your command" | npx tsx src/engine/index.ts
 */
import { openDb } from "../db/schema.js";
import { Dao } from "../db/dao.js";
import { makeEmitter, stdoutSink } from "./events.js";
import { runCommand } from "./run.js";

const log = (msg: string) => process.stderr.write(msg + "\n");

async function readCommand(): Promise<string> {
  const arg = process.argv.slice(2).join(" ").trim();
  if (arg) return arg;
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const piped = Buffer.concat(chunks).toString("utf8").trim();
  if (piped) return piped;
  return (
    "Research three notable deep-sea creatures, write a short fun fact about " +
    "each, then combine them into a single 'Ocean Trivia' blurb and finally " +
    "give it a catchy title."
  );
}

async function main() {
  const command = await readCommand();
  const db = openDb("orchestrator.sqlite");
  const dao = new Dao(db);
  const emit = makeEmitter(stdoutSink);

  const floor =
    dao.getFloor("floor_main") ??
    dao.createFloor({ id: "floor_main", name: "Main Floor", team: "default" });

  log(`\n[engine] command: ${command}`);
  log(`[engine] ANTHROPIC_API_KEY present: ${Boolean(process.env.ANTHROPIC_API_KEY)} (Max path expects false)\n`);

  const { tasks, leaves, failed } = await runCommand({
    dao,
    floor,
    command,
    emit,
    concurrency: 2,
    log,
  });

  log("\n========== FINAL ASSEMBLED RESULT ==========");
  for (const t of leaves) {
    log(`\n--- ${t.id} (${t.specialize ?? "task"}) [${t.status}] ---`);
    log(t.output ?? "(no output)");
  }

  log("\n========== TASK SUMMARY ==========");
  log(
    "\n" +
      tasks
        .map(
          (t) =>
            `${t.id.padEnd(16)} ${t.status.padEnd(14)} ${(t.specialize ?? "").padEnd(12)} ` +
            `deps=[${t.depends_on.join(",")}]`,
        )
        .join("\n"),
  );
  log(`\n[engine] done. ${tasks.length} tasks, ${failed.length} failed.`);
  db.close();
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
