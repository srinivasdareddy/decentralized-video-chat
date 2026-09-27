import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";

/**
 * A modal dialog. The native <dialog> keeps focus inside it and closes on
 * Escape; clicking outside the panel closes it too. Focus starts on the
 * element marked `data-autofocus`, if any.
 */
export function Dialog({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (open && !dialog.open) {
      dialog.showModal();
      dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="dialog"
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(event) => {
        // The panel fills the dialog, so a click on the dialog itself is on the backdrop.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="dialog-panel">
        <header className="dialog-header">
          <h2 id={titleId} className="dialog-title">
            {title}
          </h2>
          <button type="button" className="dialog-close" onClick={onClose} aria-label="Close">
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
