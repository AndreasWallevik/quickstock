export async function copyText(text, navigatorObject = globalThis.navigator, documentObject = globalThis.document) {
  if (navigatorObject?.clipboard?.writeText) {
    try {
      await navigatorObject.clipboard.writeText(text);
      return true;
    } catch {
      // Older installed browsers can expose the API but reject a write.
    }
  }
  if (!documentObject?.body || !documentObject.execCommand) return false;
  const field = documentObject.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.top = "0";
  field.style.opacity = "0";
  documentObject.body.appendChild(field);
  try {
    field.focus();
    field.select();
    field.setSelectionRange(0, text.length);
    return Boolean(documentObject.execCommand("copy"));
  } catch {
    return false;
  } finally {
    documentObject.body.removeChild(field);
  }
}
