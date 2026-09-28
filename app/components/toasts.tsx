import { useCallback, useEffect, useRef, useState } from "react";

interface Toast {
  id: number;
  text: string;
}

const DURATION_MS = 4000;

/** Brief status messages. A new message replaces the current one. */
export function useToast() {
  const [toast, setToast] = useState<Toast | null>(null);
  const nextId = useRef(1);

  useEffect(() => {
    if (toast === null) return;
    const timer = setTimeout(() => setToast(null), DURATION_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  const show = useCallback((text: string) => setToast({ id: nextId.current++, text }), []);
  return { toast, show };
}

export function ToastViewport({ toast }: { toast: Toast | null }) {
  return (
    <div className="toast-viewport" role="status" aria-live="polite">
      {toast && (
        <div key={toast.id} className="toast">
          {toast.text}
        </div>
      )}
    </div>
  );
}
