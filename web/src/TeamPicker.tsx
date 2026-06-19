import { useEffect, useRef, useState } from "react";
import type { Floor } from "./types";

/**
 * Themed team picker (replaces the unreadable native <select> on dark bg).
 * Selecting a team calls onSelect — App uses that to fly the view to it.
 */
export function TeamPicker({
  floors,
  value,
  runningFloors,
  onSelect,
}: {
  floors: Floor[];
  value: string;
  runningFloors: Set<string>;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const current = floors.find((f) => f.id === value) ?? floors[0];

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div className="team-picker" ref={ref}>
      <button className="tp-btn" onClick={() => setOpen((o) => !o)}>
        <span className="tp-cur">{current?.name ?? "—"}</span>
        {current && runningFloors.has(current.id) && <span className="tp-run" />}
        <span className="tp-caret">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="tp-menu panel">
          {floors.map((f) => (
            <button
              key={f.id}
              className={`tp-item ${f.id === value ? "active" : ""}`}
              onClick={() => {
                onSelect(f.id);
                setOpen(false);
              }}
            >
              <span className="tp-name">{f.name}</span>
              <span className="tp-tags">
                {f.mode === "manual" && <span className="tp-tag">roster</span>}
                {runningFloors.has(f.id) && <span className="tp-run" />}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
