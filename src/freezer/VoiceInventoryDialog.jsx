import { useEffect, useMemo, useState } from "react";
import { db } from "../firebase";
import { newId } from "./freezerModel";
import { applyInventoryOperations } from "./inventoryChanges";
import { interpretInventoryText, prepareInventoryOperations } from "./inventoryInterpretation";

const actionLabels = { add: "Add", remove: "Use / remove", move: "Move", set_quantity: "Set remaining" };

export default function VoiceInventoryDialog({
  householdId, stockItems, entries, locations, defaultLocationKey,
  capturedText, captureError, listening, onStop, onRetry, onCancel, onSaved,
}) {
  const [transcript, setTranscript] = useState("");
  const [spokenLocation, setSpokenLocation] = useState("");
  const [sourceLocationKey, setSourceLocationKey] = useState(defaultLocationKey);
  const [proposals, setProposals] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!capturedText) return;
    const result = interpretInventoryText(capturedText);
    setTranscript(capturedText);
    setSpokenLocation(result.spokenLocation);
    setProposals(result.proposals);
    setDirty(false);
    setError("");
  }, [capturedText]);

  const prepared = useMemo(() => prepareInventoryOperations(proposals, {
    entries, stockItems, locations, sourceLocationKey,
  }), [proposals, entries, stockItems, locations, sourceLocationKey]);
  const hasIssues = prepared.some((operation) => operation.issues.length > 0);
  const sourceLocation = locations.find((location) => location.key === sourceLocationKey);
  const sourceEntries = entries.filter((entry) => `${entry.freezerId}/${entry.compartmentId}` === sourceLocationKey);
  const sourceProducts = [...new Map(sourceEntries.map((entry) => [entry.stockItem.id, entry.stockItem])).values()];
  const existingProducts = [...new Map(stockItems.filter((item) => item.freezer).map((item) => [item.id, item])).values()];

  const interpret = () => {
    const result = interpretInventoryText(transcript);
    setSpokenLocation(result.spokenLocation);
    setProposals(result.proposals);
    setDirty(false);
    setError("");
  };

  const update = (id, patch) => {
    setProposals((current) => current.map((operation) => operation.id === id ? { ...operation, ...patch } : operation));
    setError("");
  };

  const addCorrectionRow = () => setProposals((current) => [...current, {
    id: newId(), kind: "add", name: "", quantity: null, unitLabel: "item", opened: false,
    stockItemId: "", targetLocationKey: "", targetText: "", sourcePhrase: "Manual correction",
  }]);

  const retry = () => {
    setTranscript("");
    setProposals([]);
    setDirty(false);
    setError("");
    onRetry();
  };

  const save = async () => {
    if (dirty || listening || hasIssues || prepared.length === 0 || prepared.length > 20 || saving) return;
    setSaving(true);
    setError("");
    try {
      await applyInventoryOperations(db, householdId, prepared, locations);
      onSaved(`${prepared.length} inventory change${prepared.length === 1 ? "" : "s"} saved.`);
    } catch (saveError) {
      setError(saveError.message || "Could not save changes. Review and try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/60 p-2 sm:items-center" role="presentation">
      <div role="dialog" aria-modal="true" aria-labelledby="voice-title" className="max-h-[96vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-4 shadow-xl sm:p-6">
        <div className="flex items-center justify-between gap-2">
          <div><p className="text-xs font-semibold uppercase tracking-widest text-sky-700">Norwegian inventory update</p><h2 id="voice-title" className="mt-1 text-xl font-bold text-slate-950">Tell us what changed</h2></div>
          <button type="button" onClick={onCancel} disabled={saving} className="min-h-11 rounded-xl border border-slate-200 px-3 text-sm font-medium disabled:opacity-40">Cancel</button>
        </div>
        <p className="mt-3 text-sm text-slate-600">For example: “To pakker bacon, en åpnet pakke tacolefser og en halv baguette.” You review every change before it is saved.</p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="min-w-0 flex-1 text-sm font-medium text-slate-700">Selected compartment
            <select value={sourceLocationKey} onChange={(event) => setSourceLocationKey(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm">
              {locations.map((location) => <option key={location.key} value={location.key}>{location.label}</option>)}
            </select>
          </label>
          <div className="flex gap-2 sm:self-end">
            {listening && <button type="button" onClick={onStop} className="min-h-11 rounded-xl border border-rose-200 bg-rose-50 px-3 text-sm font-semibold text-rose-800">Stop listening</button>}
            <button type="button" onClick={retry} disabled={listening} className="min-h-11 rounded-xl border border-sky-200 bg-sky-50 px-3 text-sm font-semibold text-sky-800 disabled:opacity-40">🎙 Try again</button>
          </div>
        </div>
        {listening && <p role="status" className="mt-2 text-sm font-medium text-sky-800">Listening in Norwegian (nb-NO)…</p>}
        {captureError && <p role="status" className="mt-2 text-sm text-amber-800">{captureError}</p>}
        {spokenLocation && <p className="mt-2 text-xs text-slate-600">Spoken location: “{spokenLocation}”. Changes use the selected compartment: {sourceLocation?.label || "none"}.</p>}

        <label className="mt-4 block text-sm font-medium text-slate-700">Transcript or typed update
          <textarea value={transcript} onChange={(event) => { setTranscript(event.target.value); setDirty(true); }} placeholder="Skriv eller si: Legg til to pakker bacon" className="mt-1 min-h-24 w-full rounded-xl border border-slate-200 p-3 text-sm" />
        </label>
        {dirty && <button type="button" onClick={interpret} disabled={!transcript.trim()} className="mt-2 min-h-11 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white disabled:opacity-40">Interpret text</button>}
        {dirty && <p className="mt-2 text-sm text-amber-800">Transcript changed. Interpret it again before saving.</p>}

        {prepared.length > 0 && !dirty && <section className="mt-5 space-y-3" aria-label="Proposed changes">
          <div className="flex items-center justify-between gap-2"><h3 className="font-bold text-slate-950">Review changes</h3><span className="text-xs text-slate-500">{prepared.length} proposed</span></div>
          {prepared.map((operation) => {
            const original = proposals.find((item) => item.id === operation.id);
            const products = operation.kind === "add" ? existingProducts : sourceProducts;
            return <article key={operation.id} className={`rounded-xl border p-3 ${operation.issues.length ? "border-amber-200 bg-amber-50/50" : "border-emerald-100 bg-white"}`}>
              <div className="flex items-center justify-between gap-2"><p className="min-w-0 truncate text-xs text-slate-500">Heard: {operation.sourcePhrase}</p><button type="button" onClick={() => setProposals((current) => current.filter((item) => item.id !== operation.id))} className="min-h-8 px-2 text-xs text-rose-700">Discard</button></div>
              {original.kind === "unknown" && <p className="mt-2 text-xs text-amber-900">We could not identify an inventory change. Check the food name, then choose an action and quantity.</p>}
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[145px_1fr_90px]">
                <label className="text-xs font-medium text-slate-600">Action<select value={original.kind} onChange={(event) => update(operation.id, { kind: event.target.value, stockItemId: "" })} className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm">{original.kind === "unknown" && <option value="unknown">Choose action</option>}{Object.entries(actionLabels).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select></label>
                <label className="text-xs font-medium text-slate-600">Food<input value={original.name} onChange={(event) => update(operation.id, { name: event.target.value, stockItemId: "" })} placeholder="Choose or correct name" className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm" /></label>
                <label className="text-xs font-medium text-slate-600">Quantity<input type="number" min={operation.kind === "set_quantity" ? "0" : "0.01"} max="99" step="0.01" value={original.quantity ?? ""} onChange={(event) => update(operation.id, { quantity: event.target.value })} placeholder="?" className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm" /></label>
              </div>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
                <label className="min-w-0 flex-1 text-xs font-medium text-slate-600">Existing item <span className="font-normal">(choose if ambiguous)</span>
                  <select value={original.stockItemId || (operation.stockItemId && products.some((item) => item.id === operation.stockItemId) ? operation.stockItemId : "")}
                    onChange={(event) => { const item = products.find((product) => product.id === event.target.value); update(operation.id, { stockItemId: event.target.value, ...(item ? { name: item.name } : {}) }); }}
                    className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm">
                    <option value="">{operation.kind === "add" ? "New item or auto-match" : "Choose an item"}</option>
                    {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
                  </select>
                </label>
                <label className="text-xs font-medium text-slate-600">Unit<select value={original.unitLabel} onChange={(event) => update(operation.id, { unitLabel: event.target.value })} className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm"><option value="item">Item / portion</option><option value="package">Package</option></select></label>
                {operation.kind === "add" && <label className="flex min-h-11 items-center gap-2 text-xs font-medium text-slate-600"><input type="checkbox" checked={original.opened} onChange={(event) => update(operation.id, { opened: event.target.checked })} />Opened</label>}
              </div>
              {operation.kind === "move" && <label className="mt-2 block text-xs font-medium text-slate-600">Destination<select value={original.targetLocationKey || operation.targetLocationKey || ""} onChange={(event) => update(operation.id, { targetLocationKey: event.target.value })} className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm"><option value="">Choose compartment</option>{locations.map((location) => <option key={location.key} value={location.key}>{location.label}</option>)}</select></label>}
              {operation.kind === "add" && operation.stockItemId && !operation.issues.length && <p className="mt-2 text-xs text-emerald-800">Adds to an existing stock item, avoiding a duplicate.</p>}
              {operation.issues.length > 0 && <ul className="mt-2 list-inside list-disc text-xs text-amber-900">{operation.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul>}
            </article>;
          })}
        </section>}
        <button type="button" onClick={addCorrectionRow} disabled={dirty} className="mt-4 min-h-10 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-700 disabled:opacity-40">+ Add correction</button>
        {error && <p role="alert" className="mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
        <button type="button" onClick={save} disabled={saving || listening || dirty || hasIssues || prepared.length === 0 || prepared.length > 20}
          className="mt-4 min-h-12 w-full rounded-xl bg-emerald-700 px-4 text-sm font-bold text-white disabled:opacity-40">
          {saving ? "Saving…" : `Confirm ${prepared.length} change${prepared.length === 1 ? "" : "s"}`}
        </button>
        <p className="mt-2 text-center text-xs text-slate-500">No changes are saved until you confirm.</p>
      </div>
    </div>
  );
}
