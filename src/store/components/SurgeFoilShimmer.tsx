import { useEffect, useRef, useState } from "react";
import {
  isSurgeFoilSupported,
  registerSurgeFoil,
  renderSurgeFoilOnce,
  surgeFoilMotionReduced,
  wakeSurgeFoil,
  type SurgeFoilInstance,
} from "../lib/surgeFoilRenderer";

/** Largest 3D tilt, in degrees, when the pointer is at a card's edge. */
const MAX_TILT_DEG = 4;

/**
 * The foil layer over a card picture. Put it inside the picture's positioned,
 * clipping box (.gg-card-imgwrap--foil), after the <img>.
 *
 * Every finish gets the shared CSS shimmer (src/foilShimmer.css). A surge
 * foil, where the browser has WebGL, gets the realistic one instead
 * (../lib/surgeFoilRenderer): irregular diagonal metallic bands that follow
 * the pointer, with a slight 3D tilt of the picture. The CSS layer is what
 * renders on the server and stays as the fallback, so the card is never
 * without its shimmer.
 */
export function FoilShimmer({ finish, seedKey }: { finish: string; seedKey?: string | null }) {
  if (finish !== "surge") {
    return <span className="gg-card-foil-shimmer" data-finish={finish} aria-hidden="true" />;
  }
  return <SurgeFoilShimmer seedKey={seedKey ?? null} />;
}

function seedFrom(key: string | null): number {
  if (!key) return Math.random();
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

function SurgeFoilShimmer({ seedKey }: { seedKey: string | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !isSurgeFoilSupported()) return;
    canvas.width = 200;
    canvas.height = 279;

    const wrap = canvas.parentElement; // the picture box
    const host = (canvas.closest(".gg-card") as HTMLElement | null) ?? wrap;
    const reduced = surgeFoilMotionReduced();
    const fine = window.matchMedia?.("(hover: hover) and (pointer: fine)").matches ?? false;

    const inst: SurgeFoilInstance = {
      canvas,
      seed: seedFrom(seedKey),
      targetTilt: { x: 0, y: 0 },
      tilt: { x: 0, y: 0 },
      visible: true,
      onFrame:
        wrap && fine && !reduced
          ? (tilt) => {
              const settled = Math.abs(tilt.x) < 0.002 && Math.abs(tilt.y) < 0.002;
              wrap.style.transform = settled
                ? ""
                : `perspective(800px) rotateX(${(-tilt.y * MAX_TILT_DEG).toFixed(2)}deg) rotateY(${(tilt.x * MAX_TILT_DEG).toFixed(2)}deg)`;
            }
          : undefined,
    };
    const unregister = registerSurgeFoil(inst);
    setActive(true);

    // Only animate cards that are on screen.
    let observer: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver((entries) => {
        for (const entry of entries) inst.visible = entry.isIntersecting;
        if (inst.visible) wakeSurgeFoil();
      });
      observer.observe(canvas);
    }

    // Pointer: the reflection angle follows the pointer over the card.
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch" || !wrap) return;
      const rect = wrap.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = ((e.clientY - rect.top) / rect.height) * 2 - 1;
      inst.targetTilt.x = Math.max(-1, Math.min(1, x));
      inst.targetTilt.y = Math.max(-1, Math.min(1, y));
      if (reduced) {
        inst.tilt.x = inst.targetTilt.x;
        inst.tilt.y = inst.targetTilt.y;
        renderSurgeFoilOnce(inst);
      } else {
        wakeSurgeFoil();
      }
    };
    const onLeave = () => {
      inst.targetTilt.x = 0;
      inst.targetTilt.y = 0;
      if (reduced) {
        inst.tilt.x = 0;
        inst.tilt.y = 0;
        renderSurgeFoilOnce(inst);
      }
    };
    host?.addEventListener("pointermove", onMove);
    host?.addEventListener("pointerleave", onLeave);

    return () => {
      unregister();
      observer?.disconnect();
      host?.removeEventListener("pointermove", onMove);
      host?.removeEventListener("pointerleave", onLeave);
      if (wrap) wrap.style.transform = "";
    };
  }, [seedKey]);

  return (
    <>
      {/* CSS fallback until (and unless) the shader is running. */}
      {!active && <span className="gg-card-foil-shimmer" data-finish="surge" aria-hidden="true" />}
      <canvas
        ref={canvasRef}
        className={`gg-surge-foil${active ? " gg-surge-foil--on" : ""}`}
        aria-hidden="true"
      />
    </>
  );
}
