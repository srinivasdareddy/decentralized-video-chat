import type { ReactNode } from "react";

/** A centred card with a title, explanation, and actions, for errors and notices. */
export function MessagePanel({
  icon,
  title,
  description,
  actions,
}: {
  icon?: ReactNode;
  title: string;
  description: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="message-panel">
      {icon && <div className="message-panel-icon">{icon}</div>}
      <h1 className="message-panel-title">{title}</h1>
      <p className="message-panel-description">{description}</p>
      {actions && <div className="message-panel-actions">{actions}</div>}
    </div>
  );
}
