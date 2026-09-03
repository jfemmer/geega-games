import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import {
  ToastContext,
  type ToastApi,
  type ToastOptions,
  type ToastTone,
} from "./toast-context";

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

const TONE_ICON: Record<ToastTone, IconName> = {
  success: "checkCircle",
  error: "alert",
  info: "info",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (message: string, options?: ToastOptions) => {
      const id = nextId.current++;
      const tone = options?.tone ?? "info";
      const duration = options?.duration ?? 4000;
      setItems((prev) => [...prev, { id, message, tone }]);
      if (duration > 0) {
        window.setTimeout(() => dismiss(id), duration);
      }
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      toast: (m, o) => push(m, o),
      success: (m, o) => push(m, { ...o, tone: "success" }),
      error: (m, o) => push(m, { ...o, tone: "error" }),
      info: (m, o) => push(m, { ...o, tone: "info" }),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="gg-toasts" role="region" aria-label="Notifications">
        {items.map((t) => (
          <div
            key={t.id}
            className={`gg-toast gg-toast--${t.tone}`}
            role="status"
            aria-live="polite"
          >
            <Icon name={TONE_ICON[t.tone]} size={18} />
            <span className="gg-toast__msg">{t.message}</span>
            <button
              className="gg-toast__close"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss notification"
            >
              <Icon name="close" size={15} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
