/** Keyboard shortcuts on the call page, used with Ctrl (⌘ on Apple devices). */
export const SHORTCUT_KEYS = { microphone: "d", camera: "e" } as const;

const isApple = () => /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);

/** How to show a shortcut in a tooltip: "⌘D" or "Ctrl+D". */
export function shortcutLabel(key: string): string {
  return isApple() ? `⌘${key.toUpperCase()}` : `Ctrl+${key.toUpperCase()}`;
}

/** The shortcut in aria-keyshortcuts syntax, e.g. "Control+D". */
export function shortcutAria(key: string): string {
  return `${isApple() ? "Meta" : "Control"}+${key.toUpperCase()}`;
}

/** The shortcut key pressed with Ctrl or ⌘ and nothing else, if any. */
export function shortcutKey(event: KeyboardEvent): string | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return null;
  return event.key.toLowerCase();
}
