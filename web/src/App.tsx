import { useMemo, useState } from "react";
import { useOrchestrator } from "./useOrchestrator";
import { Universe } from "./Universe";
import { Replay } from "./Replay";
import { NewTeam } from "./NewTeam";
import { TeamPicker } from "./TeamPicker";
import { ALL_STATES, STATE_VISUALS } from "./state-visuals";
import type { NewTeamConfig, Task } from "./types";

const ACTIVE: Task["status"][] = ["queued", "running", "blocked", "waiting-human", "retrying"];

export default function App() {
  const { state, sendCommand, saveApiKey, approve, createFloor, updateFloor, removeFloor, retryTask } = useOrchestrator();
  const [command, setCommand] = useState(
    "Research three deep-sea creatures, write a fun fact about each, then combine them into one blurb and give it a catchy title.",
  );
  const [targetFloor, setTargetFloor] = useState<string>("");
  const [apiKey, setApiKey] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [selectedWorker, setSelectedWorker] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [replay, setReplay] = useState(false);
  const [focusFloorId, setFocusFloorId] = useState<string | null>(null);
  const [showNewTeam, setShowNewTeam] = useState(false);
  const [editing, setEditing] = useState(false);

  const floorId = targetFloor || state.floors[0]?.id || "floor_main";

  const runningFloors = useMemo(() => {
    const s = new Set<string>();
    for (const t of Object.values(state.tasks)) if (ACTIVE.includes(t.status)) s.add(t.floor_id);
    return s;
  }, [state.tasks]);

  const pendingApprovals = useMemo(
    () => Object.values(state.tasks).filter((t) => t.status === "waiting-human"),
    [state.tasks],
  );

  const selFloor = state.floors.find((f) => f.id === floorId) ?? null;
  const selWorker = state.workers.find((w) => w.id === selectedWorker) ?? null;
  const selTask = selWorker ? state.tasks[state.workerTask[selWorker.id]] : undefined;
  const selEvents = selTask ? state.events.filter((e) => e.taskId === selTask.id) : [];
  // Surface the failure reason from the latest error / failed event payload.
  const selError =
    selTask?.status === "failed"
      ? (() => {
          const ev = [...selEvents].reverse().find(
            (e) => e.type === "error" || (e.type === "status-change" && e.status === "failed"),
          );
          const p = ev?.payload as { error?: string; decision?: string } | undefined;
          const fromEvent = p?.error ?? (p?.decision ? `rejected by human (${p.decision})` : null);
          // Fall back to the persisted error stored on the task (survives reload).
          const fromTask = selTask.output?.startsWith("⚠ error:") ? selTask.output.replace("⚠ error: ", "") : null;
          return fromEvent ?? fromTask;
        })()
      : null;

  const dispatch = async () => {
    if (!command.trim()) return;
    setSending(true);
    await sendCommand(command, floorId);
    setSending(false);
  };

  const addTeam = async (cfg: NewTeamConfig) => {
    const f = await createFloor(cfg);
    setShowNewTeam(false);
    if (f?.id) {
      setTargetFloor(f.id);
      setFocusFloorId(f.id);
    }
  };

  const focusTeam = (id: string) => {
    setTargetFloor(id);
    setFocusFloorId(id);
  };

  const saveTeam = async (cfg: NewTeamConfig) => {
    if (selFloor) await updateFloor(selFloor.id, cfg);
    setEditing(false);
  };

  const removeTeam = async () => {
    const f = state.floors.find((x) => x.id === floorId);
    if (!f) return;
    if (runningFloors.has(floorId)) {
      alert(`"${f.name}" is running — wait for it to finish before removing.`);
      return;
    }
    if (!confirm(`Remove team "${f.name}" and all its tasks? This cannot be undone.`)) return;
    if (selWorker?.floor_id === floorId) setSelectedWorker(null);
    await removeFloor(floorId);
    setTargetFloor("");
  };

  return (
    <div className="app">
      {replay ? (
        <Replay floorId={floorId} onClose={() => setReplay(false)} />
      ) : (
        <Universe
          floors={state.floors}
          workers={state.workers}
          tasks={state.tasks}
          workerTask={state.workerTask}
          runningFloors={runningFloors}
          selectedWorker={selectedWorker}
          onSelectWorker={setSelectedWorker}
          onFocusFloor={focusTeam}
          focusFloorId={focusFloorId}
        />
      )}

      {/* top-left brand */}
      <header className="hud brand">
        <div className="mark" />
        <div>
          <h1>OBSERVATORY</h1>
          <p>
            multi-agent orchestrator ·{" "}
            <span className={state.connected ? "on" : "off"}>
              {state.connected ? "live signal" : "no signal"}
            </span>
          </p>
        </div>
      </header>

      {/* top-right settings */}
      <div className="hud topright">
        <button className="ghost" onClick={() => setShowSettings((s) => !s)}>
          ⚙ {state.apiKeySet ? "key set" : "no key"}
        </button>
        {showSettings && (
          <div className="panel settings-panel">
            <label>Anthropic API key (write-only)</label>
            <div className="row">
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-ant-…"
              />
              <button
                disabled={!apiKey.trim()}
                onClick={async () => {
                  await saveApiKey(apiKey);
                  setApiKey("");
                }}
              >
                Save
              </button>
            </div>
            <small>{state.apiKeySet ? "A key is stored (never shown)." : "Running on Max — no key needed."}</small>
          </div>
        )}
      </div>

      {/* approvals toast stack (top-center) */}
      {pendingApprovals.length > 0 && !replay && (
        <div className="hud approvals">
          {pendingApprovals.map((t) => (
            <div key={t.id} className="panel approval">
              <span className="needs">◉ needs you</span>
              <span className="atask">{t.specialize ?? "task"}</span>
              <button className="ok" onClick={() => approve(t.id, true)}>Approve</button>
              <button className="no" onClick={() => approve(t.id, false)}>Reject</button>
            </div>
          ))}
        </div>
      )}

      {/* legend (bottom-left) */}
      {!replay && (
        <div className="hud legend panel">
          {ALL_STATES.map((s) => (
            <span key={s} className="li">
              <span className="dot" style={{ background: STATE_VISUALS[s].color }} />
              {STATE_VISUALS[s].label}
            </span>
          ))}
        </div>
      )}

      {/* active team config readout */}
      {!replay && selFloor && (
        <div className="hud teaminfo panel">
          <span className="team-meta">
            <b>mode</b> {selFloor.mode === "manual" ? "manual roster" : "auto"} ·{" "}
            <b>model</b> {selFloor.model ? selFloor.model.replace("claude-", "") : "auto"} ·{" "}
            <b>perm</b> {selFloor.permission_mode ?? "default"} ·{" "}
            <b>dir</b> {selFloor.cwd ? selFloor.cwd : "sandbox"}
            {selFloor.instruction ? " · ✎ instruction" : ""}
          </span>
        </div>
      )}

      {/* command console (bottom-center) */}
      {!replay && (
        <div className="hud console panel">
          <TeamPicker
            floors={state.floors}
            value={floorId}
            runningFloors={runningFloors}
            onSelect={focusTeam}
          />
          <button className="ghost icon" title="edit this team" onClick={() => setEditing(true)}>✎</button>
          <input
            className="cmd"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && dispatch()}
            placeholder="command for the orchestrator…"
          />
          <button className="primary" disabled={sending || runningFloors.has(floorId)} onClick={dispatch}>
            {sending ? "…" : runningFloors.has(floorId) ? "running" : "Dispatch"}
          </button>
          <button className="ghost" onClick={() => setShowNewTeam(true)}>＋ Team</button>
          <button
            className="ghost danger"
            onClick={removeTeam}
            disabled={state.floors.length <= 1 || runningFloors.has(floorId)}
            title={runningFloors.has(floorId) ? "team is running" : "remove this team"}
          >
            🗑 Team
          </button>
          <button className="ghost" onClick={() => setReplay(true)}>⏪ Replay</button>
        </div>
      )}

      {/* inspector (right) */}
      {selWorker && !replay && (
        <aside className="hud inspector panel">
          <div className="ins-head">
            <strong>{selWorker.name}</strong>
            <button className="x" onClick={() => setSelectedWorker(null)}>×</button>
          </div>
          <div className="meta">{selWorker.model} · {selWorker.auth_mode}</div>
          {selTask ? (
            <>
              <div className="meta">
                <span className="chip" data-s={selTask.status}>{selTask.status}</span>
                <span>{selTask.id}</span>
              </div>
              {selTask.status === "waiting-human" && (
                <div className="ins-approve">
                  <button className="ok" onClick={() => approve(selTask.id, true)}>Approve</button>
                  <button className="no" onClick={() => approve(selTask.id, false)}>Reject</button>
                </div>
              )}
              {selTask.status === "failed" && (
                <div className="ins-error">
                  <div className="ins-label" style={{ marginTop: 10 }}>error</div>
                  <pre className="errbox">{selError ?? "failed (no detail captured)"}</pre>
                  <button className="primary retry" onClick={() => retryTask(selTask.id)}>↻ Retry task</button>
                </div>
              )}
              <div className="ins-label">latest output</div>
              <pre className="out">{selTask.output ?? "—"}</pre>
              <div className="ins-label">events ({selEvents.length})</div>
              <div className="evlog">
                {selEvents.slice(-30).map((e, i) => (
                  <div key={i} className="ev">
                    <span className="t">{e.type}</span>
                    <span className="s">{e.status ?? ""}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="meta">no task bound yet</div>
          )}
        </aside>
      )}

      {showNewTeam && (
        <NewTeam
          defaultName={`Team ${state.floors.length + 1}`}
          onCreate={addTeam}
          onClose={() => setShowNewTeam(false)}
        />
      )}

      {editing && selFloor && (
        <NewTeam
          defaultName={selFloor.name}
          edit={selFloor}
          onCreate={saveTeam}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}
