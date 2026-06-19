import { useState } from "react";
import type { NewTeamConfig, PermissionMode, RosterWorker } from "./types";

/**
 * "New Team" configuration dialog. Lets you set everything per team before it's
 * created: name, a custom orchestrator instruction, the model (auto = planner
 * picks per task), the workspace directory workers operate in, and the agent
 * permission mode.
 */
const MODELS = [
  { v: "", label: "Auto (planner picks per task)" },
  { v: "claude-opus-4-8", label: "Opus 4.8 (most capable)" },
  { v: "claude-sonnet-4-6", label: "Sonnet 4.6 (balanced)" },
  { v: "claude-haiku-4-5", label: "Haiku 4.5 (fast/cheap)" },
];

const PERMS: { v: PermissionMode; label: string }[] = [
  { v: "default", label: "default (ask before risky actions)" },
  { v: "acceptEdits", label: "acceptEdits (auto-accept file edits)" },
  { v: "bypassPermissions", label: "bypass (no prompts — careful)" },
];

export function NewTeam({
  defaultName,
  onCreate,
  onClose,
}: {
  defaultName: string;
  onCreate: (cfg: NewTeamConfig) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(defaultName);
  const [instruction, setInstruction] = useState("");
  const [model, setModel] = useState("");
  const [cwd, setCwd] = useState("");
  const [permissionMode, setPermissionMode] = useState<PermissionMode>("default");
  const [workers, setWorkers] = useState<RosterWorker[]>([]);

  const addWorker = () =>
    setWorkers((w) => [...w, { name: "", role: "", model: "claude-sonnet-4-6", systemPrompt: "" }]);
  const setWorker = (i: number, patch: Partial<RosterWorker>) =>
    setWorkers((w) => w.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const delWorker = (i: number) => setWorkers((w) => w.filter((_, j) => j !== i));

  return (
    <div className="modal-scrim" onPointerDown={onClose}>
      <div className="modal panel" onPointerDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>New Team</h2>
          <button className="x" onClick={onClose}>×</button>
        </div>

        <label>Team name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Research Wing" />

        <label>Orchestrator instruction <span className="opt">(optional)</span></label>
        <textarea
          value={instruction}
          rows={3}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder="Extra guidance the planner follows, e.g. 'Always cite sources and keep tasks small.'"
        />

        <div className="grid2">
          <div>
            <label>Model</label>
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              {MODELS.map((m) => (
                <option key={m.v} value={m.v}>{m.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label>Permission</label>
            <select value={permissionMode} onChange={(e) => setPermissionMode(e.target.value as PermissionMode)}>
              {PERMS.map((p) => (
                <option key={p.v} value={p.v}>{p.label}</option>
              ))}
            </select>
          </div>
        </div>

        <label>Workspace directory <span className="opt">(optional — where workers operate)</span></label>
        <input value={cwd} onChange={(e) => setCwd(e.target.value)} placeholder="e.g. C:\\Users\\me\\project (blank = sandbox)" />

        <div className="roster-head">
          <label style={{ margin: 0 }}>
            Workers <span className="opt">{workers.length ? "(manual — planner assigns to these)" : "(empty = auto, planner invents roles)"}</span>
          </label>
          <button className="ghost mini" onClick={addWorker}>＋ worker</button>
        </div>
        {workers.map((w, i) => (
          <div className="roster-row" key={i}>
            <input className="rw-name" value={w.name} onChange={(e) => setWorker(i, { name: e.target.value })} placeholder="name (e.g. Frontend)" />
            <input className="rw-role" value={w.role} onChange={(e) => setWorker(i, { role: e.target.value })} placeholder="role (e.g. frontend)" />
            <select className="rw-model" value={w.model} onChange={(e) => setWorker(i, { model: e.target.value })}>
              {MODELS.filter((m) => m.v).map((m) => (
                <option key={m.v} value={m.v}>{m.v.replace("claude-", "")}</option>
              ))}
            </select>
            <input className="rw-prompt" value={w.systemPrompt} onChange={(e) => setWorker(i, { systemPrompt: e.target.value })} placeholder="persona / system prompt (optional)" />
            <button className="x" onClick={() => delWorker(i)}>×</button>
          </div>
        ))}

        <div className="modal-actions">
          <button className="ghost" onClick={onClose}>Cancel</button>
          <button
            className="primary"
            disabled={!name.trim()}
            onClick={() =>
              onCreate({
                name: name.trim(),
                instruction,
                model,
                cwd,
                permissionMode,
                workers: workers.filter((w) => w.role.trim()),
              })
            }
          >
            Create team
          </button>
        </div>
      </div>
    </div>
  );
}
