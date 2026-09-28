/** Copies text to the clipboard, returning whether it worked. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // The async clipboard API needs a secure context and permission; fall
    // back to the legacy approach for older or restricted browsers.
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.setAttribute("readonly", "");
    textArea.style.position = "fixed";
    textArea.style.opacity = "0";
    document.body.append(textArea);
    textArea.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      textArea.remove();
    }
  }
}
