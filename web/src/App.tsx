import { useState } from "react";
import { useOrchestrator } from "./useOrchestrator";
import { Scene } from "./Scene";
import { ALL_STATES, STATE_VISUALS } from "./state-visuals";

export default function App() {
  const { state, sendCommand, saveApiKey } = useOrchestrator();
  const [command, setCommand] = useState(
    "Research three notable deep-sea creatures, write a fun fact about each, then combine them into one Ocean Trivia blurb and give it a catchy title.",
  );
  const [apiKey, setApiKey] = useState("");
  const [selectedWorker, setSelectedWorker] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const selWorker = state.workers.find((w) => w.id === selectedWorker) ?? null;
  const selTask = selWorker ? state.tasks[state.workerTask[selWorker.id]] : undefined;
  const selEvents = selTask
    ? state.events.filter((e) => e.taskId === selTask.id)
    : [];

  return (
    <div className="app">
      <header>
        <h1>Multi-Agent Orchestrator</h1>
        <span className={`conn ${state.connected ? "on" : "off"}`}>
          {state.connected ? "● live" : "○ offline"}
        </span>
      </header>

      <div className="controls">
        <input
          className="cmd"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="Enter a command for the orchestrator…"
        />
        <button
          disabled={sending || !command.trim()}
          onClick={async () => {
            setSending(true);
            await sendCommand(command);
            setSending(false);
          }}
        >
          {sending ? "…" : "Dispatch"}
        </button>

        <div className="settings">
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="ANTHROPIC_API_KEY (write-only)"
          />
          <button
            disabled={!apiKey.trim()}
            onClick={async () => {
              await saveApiKey(apiKey);
              setApiKey("");
            }}
          >
            Save key
          </button>
          <span className="keystate">
            {state.apiKeySet ? "key is set" : "key not set"}
          </span>
        </div>
      </div>

      <div className="legend">
        {ALL_STATES.map((s) => (
          <span key={s} className="legend-item">
            <span className="dot" style={{ background: STATE_VISUALS[s].color }} />
            {STATE_VISUALS[s].label}
          </span>
        ))}
      </div>

      <div className="stage">
        <Scene
          floors={state.floors}
          workers={state.workers}
          tasks={state.tasks}
          workerTask={state.workerTask}
          selectedWorker={selectedWorker}
          onSelectWorker={setSelectedWorker}
        />
      </div>

      {selWorker && (
        <div className="inspector">
          <div className="inspector-head">
            <strong>{selWorker.name}</strong> · {selWorker.model} · {selWorker.auth_mode}
            <button className="close" onClick={() => setSelectedWorker(null)}>
              ×
            </button>
          </div>
          {selTask ? (
            <>
              <div className="kv">task: {selTask.id} · <em>{selTask.status}</em></div>
              <div className="kv">specialize: {selTask.specialize ?? "—"}</div>
              <div className="output">
                <div className="muted">latest output</div>
                <pre>{selTask.output ?? "(none yet)"}</pre>
              </div>
              <div className="muted">event log ({selEvents.length})</div>
              <div className="eventlog">
                {selEvents.slice(-40).map((e, i) => (
                  <div key={i} className="evrow">
                    <span className="evt">{e.type}</span>
                    <span className="evs">{e.status ?? ""}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="muted">no task bound to this worker yet</div>
          )}
        </div>
      )}
    </div>
  );
}
