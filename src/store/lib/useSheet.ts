import { useEffect, useRef, type RefObject } from "react";

/**
 * For a modal sheet (the yard sale page's list and "Shop your deck"): once,
 * when it opens, focus its title, stop the page scrolling behind it, and
 * close on Escape. Only once — not on every render — or typing in the sheet
 * would keep losing focus. Returns the ref for the title.
 */
export function useSheet(onClose: () => void): RefObject<HTMLHeadingElement | null> {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    headingRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return headingRef;
}
