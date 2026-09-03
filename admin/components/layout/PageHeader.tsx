import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="gg-pagehead">
      <div className="gg-pagehead__text">
        <h1 className="gg-pagehead__title">{title}</h1>
        {description && <p className="gg-pagehead__desc">{description}</p>}
      </div>
      {actions && <div className="gg-pagehead__actions">{actions}</div>}
    </div>
  );
}
