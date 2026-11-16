import { useMemo, useState } from "react";
import { db } from "../firebase";
import { buildFreezerEntries, locationOptions } from "../freezer/freezerModel";
import useFreezers from "../freezer/useFreezers";
import VoiceInventoryDialog from "../freezer/VoiceInventoryDialog";
import { applyInventoryOperations } from "../freezer/inventoryChanges";
import { prepareInventoryOperations } from "../freezer/inventoryInterpretation";
import { buildFridgeEntries, newId } from "./stockModel";
import QuickAddDialog from "./QuickAddDialog";
import UnitDetailsRow from "./UnitDetailsRow";
import InventoryExportControls from "./InventoryExportControls";
import { assignLegacyToFridge } from "./inventoryStore";
import useVoiceCapture from "./useVoiceCapture";

const FRIDGE_LOCATION = { key: "fridge", kind: "fridge", label: "Fridge" };
const shortDate = (timestamp) => timestamp ? new Date(timestamp).toLocaleDateString("nb-NO") : "";
export default function FridgeHome({ householdId, stockItems, stockLoading, stockError = "" }) {
  const { freezers, error: freezerError } = useFreezers(householdId);
  const freezerLocations = useMemo(() => locationOptions(freezers), [freezers]);
  const locations = useMemo(() => [FRIDGE_LOCATION, ...freezerLocations], [freezerLocations]);
  const fridgeEntries = useMemo(() => buildFridgeEntries(stockItems), [stockItems]);
  const allEntries = useMemo(() => [...fridgeEntries, ...buildFreezerEntries(stockItems, freezers)], [fridgeEntries, stockItems, freezers]);
  const voice = useVoiceCapture();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [showAdd, setShowAdd] = useState(false);
  const [detailsId, setDetailsId] = useState("");
  const [moveId, setMoveId] = useState("");
  const [moveAmount, setMoveAmount] = useState("1");
  const [targetKey, setTargetKey] = useState("");
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState("");

  const visible = fridgeEntries.filter((entry) => {
    if (search && !entry.stockItem.name.toLocaleLowerCase("nb").includes(search.toLocaleLowerCase("nb"))) return false;
    if (filter === "expiring" && entry.soonCount === 0 && entry.expiredCount === 0) return false;
    if (filter === "opened" && entry.openedCount === 0) return false;
    if (filter === "leftovers" && !(entry.stockItem.labels || []).some((label) => ["Leftover", "Prepared"].includes(label))) return false;
    return true;
  }).sort((a, b) => a.stockItem.name.localeCompare(b.stockItem.name, "nb", { sensitivity: "base" }));

  const apply = async (entry, kind, quantity, destination = "") => {
    setBusyId(entry.key);
    setMessage("");
    try {
      const proposal = {
        id: newId(), kind, name: entry.stockItem.name, stockItemId: entry.stockItem.id,
        quantity, unitLabel: entry.units[0]?.unitLabel || "item", opened: false,
        sourceLocationKey: "fridge", targetLocationKey: destination, sourcePhrase: "Manual update",
      };
      let [operation] = prepareInventoryOperations([proposal], {
        entries: allEntries, stockItems, locations, sourceLocationKey: "fridge",
      });
      if (operation.issues.some((issue) => issue.includes("weighed batch"))) {
        if (!window.confirm("This splits a weighed batch. The remaining weights will be unknown. Continue?")) return;
        [operation] = prepareInventoryOperations([{ ...proposal, allowUnknownWeight: true }], {
          entries: allEntries, stockItems, locations, sourceLocationKey: "fridge",
        });
      }
      if (operation.issues.length) throw new Error(operation.issues[0]);
      await applyInventoryOperations(db, householdId, [operation], locations);
      setMessage(kind === "move" ? "Moved to freezer." : kind === "discard" ? "Food discarded." : "Inventory updated.");
      setMoveId("");
    } catch (saveError) {
      setMessage(saveError.message || "Could not update inventory.");
    } finally {
      setBusyId("");
    }
  };

  return <div className="space-y-5">
    <section className="rounded-3xl bg-slate-900 p-5 text-white shadow-sm sm:p-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-200">Household fridge</p><h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">What’s in the fridge?</h1><p className="mt-2 text-sm text-slate-300">{stockLoading ? "Loading food…" : `${fridgeEntries.reduce((total, entry) => total + entry.count, 0)} items in ${fridgeEntries.length} groups`}</p></div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={voice.begin} className="min-h-12 rounded-xl bg-white px-5 py-3 text-sm font-bold text-slate-900">🎙 Speak inventory</button>
          <button type="button" onClick={() => setShowAdd(true)} className="min-h-12 rounded-xl bg-sky-500 px-5 py-3 text-sm font-bold text-white">+ Add food</button>
        </div>
      </div>
    </section>
    <InventoryExportControls stockItems={stockItems} freezers={freezers} defaultScope="fridge" disabled={stockLoading || Boolean(stockError)} />
    {(stockError || freezerError || message) && <p role="status" className="rounded-xl border border-sky-100 bg-sky-50 p-3 text-sm text-slate-800">{stockError || freezerError || message}</p>}
    <section aria-label="Fridge food" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="text-lg font-bold">Fridge food</h2><p className="text-xs text-slate-500">{visible.length} item groups</p></div>
        <div className="flex flex-col gap-2 sm:flex-row"><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search food" aria-label="Search fridge food" className="min-h-11 rounded-xl border border-slate-200 px-3 text-sm" />
          <select value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Filter fridge food" className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm"><option value="all">All food</option><option value="expiring">Expiring / expired</option><option value="opened">Opened</option><option value="leftovers">Leftovers / meals</option></select></div>
      </div>
      {stockLoading ? <p className="mt-5 text-sm text-slate-500">Loading inventory…</p> : visible.length === 0 ? <p className="mt-5 rounded-xl bg-slate-50 p-5 text-sm text-slate-600">{fridgeEntries.length ? "No food matches these filters." : "No fridge food yet. Add your first item."}</p> :
        <div className="mt-4 grid gap-2 sm:grid-cols-2">{visible.map((entry) => {
          const earliestUnit = entry.units.filter((unit) => unit.expiresAt).sort((a, b) => a.expiresAt - b.expiresAt)[0];
          return <article key={entry.key} className="rounded-2xl border border-slate-200 p-3.5">
            <div className="flex items-start gap-3"><div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-emerald-50 text-2xl">{entry.stockItem.emoji || "🥬"}</div>
              <div className="min-w-0 flex-1"><h3 className="truncate font-semibold text-slate-950">{entry.stockItem.name}</h3>
                <p className="text-xs text-slate-500">{entry.count} {entry.units[0]?.unitLabel === "package" ? "packages" : entry.units[0]?.unitLabel === "portion" ? "portions" : "items"}{entry.knownGrams > 0 ? ` · ${entry.knownGrams} g${entry.hasUnknown ? " known" : " total"}` : ""}</p>
                {entry.hasUnassigned && <p className="text-xs text-slate-500">Legacy item · location not set</p>}
                {earliestUnit && <p className="text-xs text-slate-500">{earliestUnit.expiryEstimated === false ? "Earliest expiry" : "Earliest estimated expiry"} {shortDate(earliestUnit.expiresAt)}</p>}
                {entry.expiredCount > 0 && <p className="text-xs font-medium text-rose-700">{entry.expiredCount} expired</p>}
                {entry.soonCount > 0 && <p className="text-xs font-medium text-amber-700">{entry.soonCount} expiring soon</p>}
                {entry.openedCount > 0 && <p className="text-xs text-amber-700">{entry.openedCount} opened</p>}
                {(entry.stockItem.labels || []).filter((label) => ["Leftover", "Prepared"].includes(label)).map((label) => <span key={label} className="mr-1 rounded-full bg-sky-50 px-2 py-0.5 text-xs text-sky-800">{label}</span>)}
              </div></div>
            <div className="mt-3 flex flex-wrap gap-2 text-sm">
              {entry.hasUnassigned && <button type="button" disabled={busyId === entry.key} onClick={async () => {
                setBusyId(entry.key);
                try { await assignLegacyToFridge(db, householdId, entry.stockItem.id); setMessage("Location set to fridge."); }
                catch (assignError) { setMessage(assignError.message || "Could not set location."); }
                finally { setBusyId(""); }
              }} className="min-h-10 rounded-xl border border-sky-200 px-3 text-sky-800 disabled:opacity-40">Set location: Fridge</button>}
              <button type="button" disabled={busyId === entry.key} onClick={() => apply(entry, "remove", Math.min(1, entry.count))} className="min-h-10 rounded-xl border border-slate-200 px-3 font-medium disabled:opacity-40">Use one</button>
              <button type="button" disabled={busyId === entry.key} onClick={() => apply(entry, "add", 1)} className="min-h-10 rounded-xl bg-emerald-700 px-3 font-semibold text-white disabled:opacity-40">+ One</button>
              <button type="button" disabled={busyId === entry.key || !entry.units.some((unit) => unit.state === "full")} onClick={() => apply(entry, "open", 1)} className="min-h-10 rounded-xl border border-amber-200 px-3 text-amber-800 disabled:opacity-40">Open</button>
              <button type="button" disabled={busyId === entry.key} onClick={() => apply(entry, "discard", Math.min(1, entry.count))} className="min-h-10 rounded-xl border border-rose-200 px-3 text-rose-700 disabled:opacity-40">Discard</button>
              <button type="button" onClick={() => setDetailsId(detailsId === entry.key ? "" : entry.key)} className="min-h-10 rounded-xl border border-slate-200 px-3">Details</button>
              {freezerLocations.length > 0 && <button type="button" onClick={() => { setMoveId(moveId === entry.key ? "" : entry.key); setTargetKey(freezerLocations[0].key); setMoveAmount("1"); }} className="min-h-10 rounded-xl border border-sky-200 px-3 text-sky-800">Move</button>}
            </div>
            {moveId === entry.key && <div className="mt-3 flex flex-wrap gap-2 rounded-xl bg-sky-50 p-3 text-sm">
              <label>Quantity<input type="number" min="0.01" max={entry.count} step="0.01" value={moveAmount} onChange={(event) => setMoveAmount(event.target.value)} className="mt-1 min-h-10 w-20 rounded-lg border px-2" /></label>
              <label className="min-w-40 flex-1">Move to<select value={targetKey} onChange={(event) => setTargetKey(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border bg-white px-2">{freezerLocations.map((location) => <option key={location.key} value={location.key}>{location.label}</option>)}</select></label>
              <button type="button" disabled={busyId === entry.key} onClick={() => apply(entry, "move", Number(moveAmount), targetKey)} className="min-h-10 self-end rounded-lg bg-sky-700 px-3 font-semibold text-white disabled:opacity-40">Move</button>
            </div>}
            {detailsId === entry.key && <div className="mt-3 space-y-2">{entry.units.map((unit) => <UnitDetailsRow key={unit.id} householdId={householdId} stockItemId={entry.stockItem.id} unit={unit} storageKind="fridge" onSaved={setMessage} />)}</div>}
          </article>;
        })}</div>}
    </section>
    {showAdd && <QuickAddDialog householdId={householdId} stockItems={stockItems} entries={allEntries} locations={locations} availableLocations={[FRIDGE_LOCATION]} defaultLocationKey="fridge" storageKind="fridge" onClose={() => setShowAdd(false)} onSaved={(savedMessage) => { setShowAdd(false); setMessage(savedMessage); }} />}
    {voice.open && <VoiceInventoryDialog householdId={householdId} stockItems={stockItems} entries={allEntries} locations={locations} defaultLocationKey="fridge" capturedText={voice.text} captureError={voice.error} listening={voice.listening} onStop={voice.stop} onRetry={voice.retry} onCancel={voice.cancel} onSaved={(savedMessage) => { voice.cancel(); setMessage(savedMessage); }} />}
  </div>;
}
