import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Pan + zoom of an infinite world, like a star map.
 *   screen = world * scale + (x, y)
 * Drag to pan, wheel to zoom toward the cursor. A small drag threshold lets
 * clicks (planet selection) still pass through.
 */
export interface Viewport {
  x: number;
  y: number;
  scale: number;
}

const MIN_SCALE = 0.18;
const MAX_SCALE = 3.2;
const DRAG_THRESHOLD = 5; // px before a press becomes a pan (vs a click)

export function useViewport(initial?: Partial<Viewport>) {
  const [vp, setVp] = useState<Viewport>({
    x: initial?.x ?? (typeof window !== "undefined" ? window.innerWidth / 2 : 600),
    y: initial?.y ?? (typeof window !== "undefined" ? window.innerHeight / 2 : 400),
    scale: initial?.scale ?? 0.75,
  });
  const ref = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const [panning, setPanning] = useState(false);
  const vpRef = useRef(vp);
  vpRef.current = vp;
  const rafRef = useRef<number | null>(null);

  const cancelAnim = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  /** Smoothly ease the viewport to a target (easeOutCubic). */
  const animateTo = useCallback(
    (target: Viewport, dur = 700) => {
      cancelAnim();
      const start = { ...vpRef.current };
      const t0 = performance.now();
      const ease = (t: number) => 1 - Math.pow(1 - t, 3);
      const step = (now: number) => {
        const k = Math.min(1, (now - t0) / dur);
        const e = ease(k);
        setVp({
          x: start.x + (target.x - start.x) * e,
          y: start.y + (target.y - start.y) * e,
          scale: start.scale + (target.scale - start.scale) * e,
        });
        rafRef.current = k < 1 ? requestAnimationFrame(step) : null;
      };
      rafRef.current = requestAnimationFrame(step);
    },
    [cancelAnim],
  );

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    cancelAnim(); // interrupt any fly-to when the user grabs
    drag.current = { sx: e.clientX, sy: e.clientY, ox: 0, oy: 0, moved: false };
    setVp((v) => {
      drag.current!.ox = v.x;
      drag.current!.oy = v.y;
      return v;
    });
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!d.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
      d.moved = true;
      setPanning(true);
      try {
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      } catch {
        /* synthetic/expired pointer — panning still works without capture */
      }
    }
    if (d.moved) setVp((v) => ({ ...v, x: d.ox + dx, y: d.oy + dy }));
  }, []);

  const endDrag = useCallback(() => {
    drag.current = null;
    setPanning(false);
  }, []);

  /** Did the last pointer interaction actually pan? (suppress click if so) */
  const didPan = useCallback(() => Boolean(drag.current?.moved), []);

  // Non-passive wheel listener so we can preventDefault and zoom to cursor.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      cancelAnim();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      setVp((v) => {
        const factor = Math.exp(-e.deltaY * 0.0016);
        const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
        // keep the world point under the cursor fixed
        const wx = (cx - v.x) / v.scale;
        const wy = (cy - v.y) / v.scale;
        return { scale, x: cx - wx * scale, y: cy - wy * scale };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const zoomBy = useCallback(
    (mult: number) => {
      const el = ref.current;
      const cx = el ? el.clientWidth / 2 : window.innerWidth / 2;
      const cy = el ? el.clientHeight / 2 : window.innerHeight / 2;
      const v = vpRef.current;
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * mult));
      const wx = (cx - v.x) / v.scale;
      const wy = (cy - v.y) / v.scale;
      animateTo({ scale, x: cx - wx * scale, y: cy - wy * scale }, 360);
    },
    [animateTo],
  );

  /** Smoothly fly the view to center a world point at a given scale. */
  const focusOn = useCallback(
    (wx: number, wy: number, scale = 0.85) => {
      const el = ref.current;
      const cx = el ? el.clientWidth / 2 : window.innerWidth / 2;
      const cy = el ? el.clientHeight / 2 : window.innerHeight / 2;
      animateTo({ scale, x: cx - wx * scale, y: cy - wy * scale }, 720);
    },
    [animateTo],
  );

  return {
    vp,
    ref,
    panning,
    handlers: { onPointerDown, onPointerMove, onPointerUp: endDrag, onPointerLeave: endDrag },
    didPan,
    zoomBy,
    focusOn,
  };
}
