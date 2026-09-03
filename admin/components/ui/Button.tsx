import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "gold";
type Size = "sm" | "md";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: IconName;
  iconRight?: IconName;
  loading?: boolean;
  children?: ReactNode;
}

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  iconRight,
  loading = false,
  children,
  className = "",
  disabled,
  ...rest
}: ButtonProps) {
  const iconOnly = !children;
  return (
    <button
      className={[
        "gg-btn",
        `gg-btn--${variant}`,
        `gg-btn--${size}`,
        iconOnly ? "gg-btn--icon" : "",
        loading ? "gg-btn--loading" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <span className="gg-spinner" aria-hidden="true" />}
      {!loading && icon && <Icon name={icon} size={size === "sm" ? 15 : 17} />}
      {children && <span>{children}</span>}
      {!loading && iconRight && (
        <Icon name={iconRight} size={size === "sm" ? 15 : 17} />
      )}
    </button>
  );
}
