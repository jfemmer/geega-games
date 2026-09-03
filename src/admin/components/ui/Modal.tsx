import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { Icon } from "./Icon";

interface OverlayProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  /** "modal" centers a dialog; "drawer" slides from the right. */
  variant?: "modal" | "drawer";
  size?: "sm" | "md" | "lg";
  /** Optional element rendered in the header, right of the title. */
  headerExtra?: ReactNode;
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  variant = "modal",
  size = "md",
  headerExtra,
}: OverlayProps) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, open, onClose);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  const titleId = "gg-overlay-title";

  return createPortal(
    <div
      className={`gg-overlay gg-overlay--${variant}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={`gg-dialog gg-dialog--${variant} gg-dialog--${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="gg-dialog__head">
          <h2 id={titleId} className="gg-dialog__title">
            {title}
          </h2>
          <div className="gg-dialog__head-right">
            {headerExtra}
            <button
              className="gg-icon-btn"
              onClick={onClose}
              aria-label="Close"
            >
              <Icon name="close" size={18} />
            </button>
          </div>
        </header>
        <div className="gg-dialog__body">{children}</div>
        {footer && <footer className="gg-dialog__foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
