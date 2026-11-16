import { useEffect, useRef, useState } from "react";
import { copyText } from "./clipboard";
import { formatInventoryExport } from "./inventoryExport";

const UI_LABELS = {
  en: { scope: { freezer: "Freezer", fridge: "Fridge", both: "Fridge + freezer" }, copy: "Copy inventory", share: "Share", copied: "inventory copied.", shared: "Inventory shared.", manual: "Automatic copying is unavailable. Select and copy the text below.", shareFailed: "Sharing is unavailable. Use Copy inventory instead.", text: "Inventory text" },
  nb: { scope: { freezer: "Fryser", fridge: "Kjøleskap", both: "Kjøleskap + fryser" }, copy: "Kopier lagerliste", share: "Del", copied: "lagerliste kopiert.", shared: "Lagerlisten er delt.", manual: "Automatisk kopiering er ikke tilgjengelig. Marker og kopier teksten nedenfor.", shareFailed: "Deling er ikke tilgjengelig. Bruk Kopier lagerliste i stedet.", text: "Lagerliste" },
};

export default function InventoryExportControls({ stockItems, freezers, defaultScope, disabled = false }) {
  const [scope, setScope] = useState(defaultScope);
  const [status, setStatus] = useState("");
  const [manualText, setManualText] = useState("");
  const [busy, setBusy] = useState(false);
  const manualRef = useRef(null);
  const language = typeof document !== "undefined" ? document.documentElement.lang || "en" : "en";
  const labels = UI_LABELS[/^(nb|nn|no)(-|$)/i.test(language) ? "nb" : "en"];
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  useEffect(() => {
    if (manualText) manualRef.current?.select();
  }, [manualText]);

  const getText = () => formatInventoryExport(stockItems, freezers, scope, language);
  const copy = async () => {
    setBusy(true);
    setStatus("");
    setManualText("");
    const text = getText();
    const copied = await copyText(text);
    setStatus(copied ? `${labels.scope[scope]} ${labels.copied}` : labels.manual);
    if (!copied) setManualText(text);
    setBusy(false);
  };
  const share = async () => {
    const text = getText();
    setStatus("");
    try {
      await navigator.share({ title: "QuickStock inventory", text });
      setStatus(labels.shared);
    } catch (error) {
      if (error?.name !== "AbortError") setStatus(labels.shareFailed);
    }
  };

  return <section aria-label="Export inventory" className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label="Inventory to copy" value={scope} onChange={(event) => { setScope(event.target.value); setStatus(""); setManualText(""); }}
        className="min-h-11 min-w-36 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-sm sm:flex-none">
        <option value={defaultScope}>{labels.scope[defaultScope]}</option>
        <option value={defaultScope === "fridge" ? "freezer" : "fridge"}>{labels.scope[defaultScope === "fridge" ? "freezer" : "fridge"]}</option>
        <option value="both">{labels.scope.both}</option>
      </select>
      <button type="button" onClick={copy} disabled={disabled || busy} className="min-h-11 rounded-xl border border-emerald-200 bg-emerald-50 px-4 text-sm font-semibold text-emerald-800 disabled:opacity-40">{labels.copy}</button>
      {canShare && <button type="button" onClick={share} disabled={disabled || busy} className="min-h-11 rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-700 disabled:opacity-40">{labels.share}</button>}
    </div>
    {status && <p role="status" className="mt-2 text-sm text-emerald-800">{status}</p>}
    {manualText && <label className="mt-2 block text-xs text-slate-600">{labels.text}<textarea ref={manualRef} readOnly value={manualText} className="mt-1 h-32 w-full rounded-xl border border-slate-200 p-2 text-sm" /></label>}
  </section>;
}
