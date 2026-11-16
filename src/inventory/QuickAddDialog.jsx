import { useState } from "react";
import { db } from "../firebase";
import { newId } from "./stockModel";
import { canonicalName, nameKey, prepareInventoryOperations } from "../freezer/inventoryInterpretation";
import { applyInventoryOperations } from "../freezer/inventoryChanges";

export default function QuickAddDialog({
  householdId, stockItems, entries, locations, availableLocations,
  defaultLocationKey, storageKind, onClose, onSaved,
}) {
  const [name, setName] = useState("");
  const [stockItemId, setStockItemId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unitLabel, setUnitLabel] = useState("item");
  const [weight, setWeight] = useState("");
  const [weightUnit, setWeightUnit] = useState("g");
  const [weightScope, setWeightScope] = useState("total");
  const [locationKey, setLocationKey] = useState(defaultLocationKey);
  const [opened, setOpened] = useState(false);
  const [label, setLabel] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [estimateExpiry, setEstimateExpiry] = useState(false);
  const [frozenAt, setFrozenAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const matches = stockItems.filter((item) => nameKey(canonicalName(item.name)) === nameKey(canonicalName(name)));
  const matchedProduct = stockItems.find((item) => item.id === stockItemId) || (matches.length === 1 ? matches[0] : null);
  const shelfLifeDays = Number(matchedProduct?.shelfLifeDays);
  const canEstimateExpiry = Number.isFinite(shelfLifeDays) && shelfLifeDays > 0 && shelfLifeDays <= 3650;

  const submit = async (event) => {
    event.preventDefault();
    const grams = weight.trim() ? Number(weight.replace(",", ".")) * (weightUnit === "kg" ? 1000 : 1) : null;
    const estimate = new Date();
    estimate.setDate(estimate.getDate() + shelfLifeDays);
    const estimatedDate = storageKind === "fridge" && !expiryDate && estimateExpiry && canEstimateExpiry
      ? `${estimate.getFullYear()}-${String(estimate.getMonth() + 1).padStart(2, "0")}-${String(estimate.getDate()).padStart(2, "0")}` : "";
    const proposal = {
      id: newId(), kind: "add", name: name.trim(), stockItemId, quantity,
      unitLabel, opened, weightGrams: grams, weightScope: grams === null ? "" : weightScope,
      sourceLocationKey: locationKey, targetLocationKey: "", sourcePhrase: "Manual addition",
      expiryDate: storageKind === "fridge" ? expiryDate || estimatedDate : "",
      expiryEstimated: Boolean(estimatedDate),
      frozenAt: storageKind === "freezer" ? frozenAt : "",
      label,
    };
    const [operation] = prepareInventoryOperations([proposal], {
      entries, stockItems, locations, sourceLocationKey: locationKey,
    });
    if (operation.issues.length) { setError(operation.issues[0]); return; }
    setSaving(true);
    setError("");
    try {
      await applyInventoryOperations(db, householdId, [operation], locations);
      onSaved(`${operation.name} added.`);
    } catch (saveError) {
      setError(saveError.message || "Could not add food. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-2 sm:items-center" role="presentation">
    <form onSubmit={submit} className="max-h-[96vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
      <div className="flex items-center justify-between gap-2"><h2 className="text-xl font-bold">Add {storageKind === "fridge" ? "fridge" : "frozen"} food</h2><button type="button" onClick={onClose} className="min-h-10 px-2 text-sm">Cancel</button></div>
      <label className="mt-4 block text-sm font-medium">Food<input autoFocus required value={name} onChange={(event) => { setName(event.target.value); setStockItemId(""); }} placeholder="e.g. Chicken" className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 px-3" /></label>
      {matches.length > 1 && <label className="mt-2 block text-sm font-medium">Which existing food?<select value={stockItemId} onChange={(event) => setStockItemId(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-amber-300 bg-white px-3"><option value="">Choose an item to avoid a duplicate</option>{matches.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.id.slice(0, 6)}</option>)}</select></label>}
      <div className="mt-3 grid grid-cols-[1fr_1fr] gap-2">
        <label className="text-sm font-medium">Quantity<input type="number" min="0.01" max="99" step="0.01" required value={quantity} onChange={(event) => setQuantity(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 px-3" /></label>
        <label className="text-sm font-medium">Counted as<select value={unitLabel} onChange={(event) => setUnitLabel(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3"><option value="item">Items</option><option value="package">Packages</option><option value="portion">Portions</option></select></label>
      </div>
      {availableLocations.length > 1 && <label className="mt-3 block text-sm font-medium">Location<select value={locationKey} onChange={(event) => setLocationKey(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3">{availableLocations.map((location) => <option key={location.key} value={location.key}>{location.label}</option>)}</select></label>}
      <div className="mt-3 grid grid-cols-[1fr_90px] gap-2">
        <label className="text-sm font-medium">Weight <span className="font-normal text-slate-500">(optional)</span><input type="text" inputMode="decimal" value={weight} onChange={(event) => setWeight(event.target.value)} placeholder="e.g. 400" className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 px-3" /></label>
        <label className="text-sm font-medium">Unit<select value={weightUnit} onChange={(event) => setWeightUnit(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-2"><option value="g">g</option><option value="kg">kg</option></select></label>
      </div>
      {weight.trim() && Number(quantity) > 1 && <label className="mt-2 block text-sm font-medium">Weight means<select value={weightScope} onChange={(event) => setWeightScope(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3"><option value="total">Total for all</option><option value="per_unit">Per item/package</option></select></label>}
      {storageKind === "fridge" && <>
        <label className="mt-3 block text-sm font-medium">Expires <span className="font-normal text-slate-500">(if known)</span><input type="date" value={expiryDate} onChange={(event) => setExpiryDate(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 px-3" /></label>
        {canEstimateExpiry && !expiryDate && <label className="mt-2 flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={estimateExpiry} onChange={(event) => setEstimateExpiry(event.target.checked)} />Estimate expiry using {shelfLifeDays} days of shelf life</label>}
        <label className="mt-3 block text-sm font-medium">Type<select value={label} onChange={(event) => setLabel(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3"><option value="">Food</option><option value="Leftover">Leftover</option><option value="Prepared">Prepared meal</option></select></label>
      </>}
      {storageKind === "freezer" && <label className="mt-3 block text-sm font-medium">Date frozen <span className="font-normal text-slate-500">(optional)</span><input type="date" value={frozenAt} onChange={(event) => setFrozenAt(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 px-3" /></label>}
      <label className="mt-3 flex min-h-11 items-center gap-2 text-sm font-medium"><input type="checkbox" checked={opened} onChange={(event) => setOpened(event.target.checked)} />Opened</label>
      {error && <p role="alert" className="mt-2 text-sm text-rose-700">{error}</p>}
      <button type="submit" disabled={saving} className="mt-4 min-h-12 w-full rounded-xl bg-emerald-700 px-4 font-bold text-white disabled:opacity-40">{saving ? "Saving…" : "Add food"}</button>
    </form>
  </div>;
}
