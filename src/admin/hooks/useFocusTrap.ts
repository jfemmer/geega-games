import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Open traps, innermost last. When a dialog opens on top of another (a
// confirmation over a drawer), only the top one handles Escape and Tab, so
// Escape closes just the confirmation instead of both.
const openTraps: symbol[] = [];

/**
 * Traps Tab focus inside `ref` while `active`, restores focus to the previously
 * focused element on close, and invokes `onEscape` when Escape is pressed.
 *
 * `onEscape` is read when Escape is pressed rather than being a dependency,
 * so a parent re-rendering with a new inline close handler doesn't re-run the
 * trap (which would pull focus back to the first field mid-typing).
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  onEscape: () => void,
) {
  const onEscapeRef = useRef(onEscape);
  useEffect(() => {
    onEscapeRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    if (!active) return;
    const node = ref.current;
    if (!node) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const trap = Symbol("focus-trap");
    openTraps.push(trap);

    // Move focus into the dialog.
    const focusables = node.querySelectorAll<HTMLElement>(FOCUSABLE);
    (focusables[0] ?? node).focus();

    function onKeyDown(e: KeyboardEvent) {
      if (openTraps[openTraps.length - 1] !== trap) return;
      if (e.key === "Escape") {
        e.stopPropagation();
        onEscapeRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const els = Array.from(
        node!.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (els.length === 0) {
        e.preventDefault();
        return;
      }
      const first = els[0];
      const last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      const index = openTraps.lastIndexOf(trap);
      if (index >= 0) openTraps.splice(index, 1);
      previouslyFocused?.focus?.();
    };
  }, [ref, active]);
}
