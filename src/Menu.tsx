import { useEffect, useRef, useState } from "react";

// An accessible dropdown menu:
//  - toggles on click, exposes aria-expanded
//  - closes on Escape, on outside click, and when focus leaves the menu
//  - items are real links reachable by keyboard
export default function Menu() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        btnRef.current?.focus();
      }
    }
    function onPointer(e: PointerEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  function onBlur(e: React.FocusEvent<HTMLDivElement>) {
    // Close when focus moves outside the menu entirely.
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setOpen(false);
    }
  }

  return (
    <div className="menu" ref={wrapRef} onBlur={onBlur}>
      <button
        ref={btnRef}
        className="menu-btn"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Menu"
      >
        &#9776;
      </button>
      {open && (
        <div className="menu-drop" role="menu">
          <a
            href="#catalog"
            role="menuitem"
            onClick={() => setOpen(false)}
          >
            Browse catalog
          </a>
          <a
            href="#launch"
            role="menuitem"
            onClick={() => setOpen(false)}
          >
            Get the launch notice
          </a>
        </div>
      )}
    </div>
  );
}
