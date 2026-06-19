/**
 * Phase 2 — seed script. Inserts one floor, two workers, and two dependent
 * tasks (the haiku example), then prints the resulting table contents so the
 * tables can be eyeballed.
 *
 * Run:  npx tsx src/seed.ts
 */
import { openDb } from "./db/schema.js";
import { Dao } from "./db/dao.js";

function main() {
  // Fresh DB each run so the seed is reproducible.
  const db = openDb("orchestrator.sqlite");
  db.exec(
    `DELETE FROM task_events; DELETE FROM tasks; DELETE FROM workers;
     DELETE FROM floors; DELETE FROM settings;`,
  );
  const dao = new Dao(db);

  // One floor (== one team).
  const floor = dao.createFloor({
    id: "floor_poetry",
    name: "Poetry Floor",
    team: "creative",
  });

  // Two workers on different models.
  const poet = dao.createWorker({
    id: "worker_poet",
    floorId: floor.id,
    name: "Poet",
    role: "writer",
    model: "claude-sonnet-4-6",
    authMode: "max",
  });
  const counter = dao.createWorker({
    id: "worker_counter",
    floorId: floor.id,
    name: "Counter",
    role: "analyzer",
    model: "claude-haiku-4-5",
    authMode: "max",
  });

  // Two dependent tasks: B depends on A (the haiku example).
  const taskA = dao.createTask({
    id: "task_haiku",
    floorId: floor.id,
    specialize: "writer",
    systemPrompt: poet.role ?? "write a haiku",
    model: poet.model,
    input: "Write a haiku about the ocean.",
    dependsOn: [],
  });
  const taskB = dao.createTask({
    id: "task_count",
    floorId: floor.id,
    parentId: taskA.id,
    specialize: "analyzer",
    systemPrompt: counter.role ?? "count syllables",
    model: counter.model,
    dependsOn: [taskA.id],
  });

  // Drive the validated state machine + the append-only event log a little,
  // so the seed shows non-trivial rows. idle -> queued -> running -> done.
  dao.setTaskStatus(taskA.id, "queued");
  dao.appendEvent(taskA.id, "status-change", { from: "idle", to: "queued" });
  dao.setTaskStatus(taskA.id, "running");
  dao.appendEvent(taskA.id, "start", {
    type: "system",
    subtype: "init",
    model: poet.model,
    apiKeySource: "none",
  });
  dao.setTaskOutput(
    taskA.id,
    "Waves crash on the shore\nSalt and mist embrace the deep\nTides breathe in and out",
  );
  dao.setTaskStatus(taskA.id, "done");
  dao.appendEvent(taskA.id, "finish", {
    type: "result",
    subtype: "success",
    total_cost_usd: 0.1363,
  });

  // B was waiting on A; now A is done, so B can be queued.
  dao.setTaskStatus(taskB.id, "queued");

  // ----- Print the tables --------------------------------------------------
  const show = (label: string, rows: unknown[]) => {
    console.log(`\n=== ${label} (${rows.length}) ===`);
    console.table(rows);
  };

  show("floors", dao.listFloors());
  show("workers", dao.listWorkers());
  show(
    "tasks",
    dao.listTasks().map((t) => ({
      id: t.id,
      status: t.status,
      model: t.model,
      depends_on: JSON.stringify(t.depends_on),
      input: t.input?.slice(0, 30) ?? null,
      output: t.output?.slice(0, 30) ?? null,
    })),
  );
  show(
    "task_events",
    dao
      .listEvents(taskA.id)
      .map((e) => ({ id: e.id, task_id: e.task_id, type: e.type })),
  );

  // Demonstrate the state machine rejects illegal transitions.
  console.log("\n=== state-machine guard ===");
  try {
    dao.setTaskStatus(taskA.id, "running"); // done -> running is illegal
  } catch (err) {
    console.log("Rejected as expected:", (err as Error).message);
  }

  db.close();
}

main();
