import { useState } from "react";
import { db } from "../firebase";
import { updateStockUnitDetails } from "./inventoryStore";

const inputDate = (timestamp) => timestamp ? new Date(timestamp).toISOString().slice(0, 10) : "";

export default function UnitDetailsRow({ householdId, stockItemId, unit, storageKind, onSaved }) {
  const [weight, setWeight] = useState(unit.weightGrams?.toString() || "");
  const [date, setDate] = useState(storageKind === "freezer" ? unit.frozenAt || "" : inputDate(unit.expiresAt));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await updateStockUnitDetails(db, householdId, stockItemId, unit.id, {
        weightGrams: weight,
        ...(storageKind === "freezer" ? { frozenAt: date } : { expiryDate: date }),
      });
      onSaved("Details saved.");
    } catch (saveError) {
      setError(saveError.message || "Could not save details.");
    } finally {
      setBusy(false);
    }
  };
  return <div className="rounded-xl bg-slate-50 p-3 text-xs">
    <p className="mb-2 font-medium text-slate-700">{unit.amount || 1} {unit.unitLabel || "item"} · {unit.state || "full"}</p>
    <div className="grid grid-cols-2 gap-2">
      <label>Weight (g)<input type="number" min="1" step="1" value={weight} onChange={(event) => setWeight(event.target.value)} placeholder="Unknown" className="mt-1 min-h-10 w-full rounded-lg border bg-white px-2" /></label>
      <label>{storageKind === "freezer" ? "Frozen on" : "Expires"}<input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border bg-white px-2" /></label>
    </div>
    {error && <p role="alert" className="mt-1 text-rose-700">{error}</p>}
    <button type="button" disabled={busy} onClick={save} className="mt-2 min-h-10 rounded-lg border border-slate-300 bg-white px-3 font-medium disabled:opacity-40">{busy ? "Saving…" : "Save details"}</button>
  </div>;
}
