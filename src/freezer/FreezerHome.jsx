import { useMemo, useState } from "react";
import { db } from "../firebase";
import {
  buildFreezerEntries,
  filterFreezerEntries,
  locationOptions,
  newId,
  UNASSIGNED_ID,
} from "./freezerModel";
import VoiceInventoryDialog from "./VoiceInventoryDialog";
import useFreezers from "./useFreezers";
import useVoiceCapture from "../inventory/useVoiceCapture";
import { buildFridgeEntries } from "../inventory/stockModel";
import QuickAddDialog from "../inventory/QuickAddDialog";
import UnitDetailsRow from "../inventory/UnitDetailsRow";
import InventoryExportControls from "../inventory/InventoryExportControls";
import { moveUnassignedFrozenToFridge } from "../inventory/inventoryStore";
import { prepareInventoryOperations } from "./inventoryInterpretation";
import { applyInventoryOperations } from "./inventoryChanges";
import {
  changeFrozenStock,
  createFreezer,
  deleteEmptyFreezer,
  moveFrozenStock,
  renameFreezer,
  reorderFreezers,
  updateCompartments,
} from "./freezerStore";

function LocationSelect({ value, onChange, locations, className = "" }) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={`min-h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm ${className}`}
      aria-label="Freezer compartment"
    >
      {locations.map((location) => (
        <option key={location.key} value={location.key}>{location.label}</option>
      ))}
    </select>
  );
}

export default function FreezerHome({ householdId, stockItems, stockLoading, stockError = "" }) {
  const { freezers, loading: freezersLoading, error: loadError, errorCode } = useFreezers(householdId);
  const entries = useMemo(() => buildFreezerEntries(stockItems, freezers), [stockItems, freezers]);
  const locations = useMemo(() => locationOptions(freezers), [freezers]);
  const allLocations = useMemo(() => [{ key: "fridge", kind: "fridge", label: "Fridge" }, ...locations], [locations]);
  const allEntries = useMemo(() => [...entries, ...buildFridgeEntries(stockItems)], [entries, stockItems]);
  const voice = useVoiceCapture();
  const [search, setSearch] = useState("");
  const [freezerFilter, setFreezerFilter] = useState("all");
  const [compartmentFilter, setCompartmentFilter] = useState("all");
  const [showAdd, setShowAdd] = useState(false);
  const [showLocations, setShowLocations] = useState(false);
  const [showAddFreezer, setShowAddFreezer] = useState(false);
  const [freezerName, setFreezerName] = useState("");
  const [addFreezerError, setAddFreezerError] = useState("");
  const [editingEntry, setEditingEntry] = useState("");
  const [editLocationKey, setEditLocationKey] = useState("");
  const [editDate, setEditDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyEntry, setBusyEntry] = useState("");
  const [message, setMessage] = useState("");

  const visibleEntries = useMemo(() => filterFreezerEntries(entries, {
    search,
    freezerId: freezerFilter,
    compartmentId: compartmentFilter,
  }).sort((a, b) => a.stockItem.name.localeCompare(b.stockItem.name, "nb", { sensitivity: "base" })),
  [entries, search, freezerFilter, compartmentFilter]);
  const totalUnits = entries.reduce((total, entry) => total + entry.count, 0);
  const unassignedCount = entries.filter((entry) => entry.freezerId === UNASSIGNED_ID)
    .reduce((total, entry) => total + entry.count, 0);
  const defaultLocationKey = locations.find((location) => location.freezerId === freezerFilter && location.compartmentId === compartmentFilter)?.key ||
    locations.find((location) => location.freezerId === freezerFilter)?.key || locations[0]?.key || "";
  const selectedLocation = (key) => allLocations.find((location) => location.key === key);

  const run = async (action, success) => {
    setBusy(true);
    setMessage("");
    try {
      await action();
      if (success) setMessage(success);
      return true;
    } catch (error) {
      setMessage(error.message || "Could not save changes.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const changeEntry = async (entry, delta) => {
    setBusyEntry(entry.key);
    setMessage("");
    try {
      if (entry.freezerId === UNASSIGNED_ID) {
        await changeFrozenStock(db, householdId, entry, delta);
        return;
      }
      const proposal = {
        id: newId(), kind: delta > 0 ? "add" : "remove", name: entry.stockItem.name,
        stockItemId: entry.stockItem.id, quantity: Math.abs(delta), unitLabel: entry.unitLabel,
        opened: false, sourceLocationKey: entry.locationKey, targetLocationKey: "",
        frozenAt: delta > 0 ? entry.frozenAt : "", sourcePhrase: "Manual update",
      };
      let [operation] = prepareInventoryOperations([proposal], {
        entries: allEntries, stockItems, locations: allLocations, sourceLocationKey: entry.locationKey,
      });
      if (operation.issues.some((issue) => issue.includes("weighed batch"))) {
        if (!window.confirm("This splits a weighed batch. The remaining weight will be unknown. Continue?")) return;
        [operation] = prepareInventoryOperations([{ ...proposal, allowUnknownWeight: true }], {
          entries: allEntries, stockItems, locations: allLocations, sourceLocationKey: entry.locationKey,
        });
      }
      if (operation.issues.length) throw new Error(operation.issues[0]);
      await applyInventoryOperations(db, householdId, [operation], allLocations);
    } catch (error) {
      setMessage(error.message || "Could not update stock.");
    } finally {
      setBusyEntry("");
    }
  };

  const openAddFreezer = () => {
    console.info("[QuickStock freezer] Add freezer clicked", { existingFreezers: freezers.length });
    setAddFreezerError("");
    setShowAddFreezer(true);
  };

  const addFreezer = async (event) => {
    event.preventDefault();
    const name = freezerName.trim();
    if (!name) {
      console.warn("[QuickStock freezer] Add freezer stopped: name is empty");
      setAddFreezerError("Enter a name for the freezer.");
      return;
    }
    if (!householdId) {
      console.error("[QuickStock freezer] Add freezer stopped: no household selected");
      setAddFreezerError("No household is selected. Reload the page and try again.");
      return;
    }
    const nextPosition = Math.max(-1, ...freezers.map((freezer) => Number(freezer.position) || 0)) + 1;
    console.info("[QuickStock freezer] Creating freezer", { position: nextPosition });
    setBusy(true);
    setMessage("");
    setAddFreezerError("");
    try {
      const result = await createFreezer(db, householdId, name, nextPosition);
      console.info("[QuickStock freezer] Freezer created", { id: result.id });
      setFreezerName("");
      setShowAddFreezer(false);
      setMessage(`${name} added.`);
    } catch (error) {
      console.error("[QuickStock freezer] Create freezer failed", { code: error.code, message: error.message });
      setAddFreezerError(error.message || "Could not add the freezer. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const addFreezerForm = showAddFreezer && (
    <form onSubmit={addFreezer} className="mt-4 flex flex-col gap-2 rounded-xl bg-slate-50 p-3 sm:max-w-md">
      <label htmlFor="new-freezer-name" className="text-sm font-medium text-slate-800">Freezer name</label>
      <input id="new-freezer-name" type="text" value={freezerName} onChange={(event) => setFreezerName(event.target.value)}
        placeholder="For example, Kitchen freezer" autoFocus maxLength={80}
        className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm" />
      {addFreezerError && <p role="alert" className="text-sm text-rose-700">{addFreezerError}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className="min-h-11 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Adding…" : "Save freezer"}</button>
        <button type="button" disabled={busy} onClick={() => { console.info("[QuickStock freezer] Add freezer canceled"); setShowAddFreezer(false); setFreezerName(""); setAddFreezerError(""); }}
          className="min-h-11 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-50">Cancel</button>
      </div>
    </form>
  );

  const rename = async (freezer) => {
    const name = window.prompt("Freezer name", freezer.name)?.trim();
    if (!name || name === freezer.name) return;
    await run(() => renameFreezer(db, householdId, freezer.id, name), "Freezer renamed.");
  };

  const addCompartment = async (freezer) => {
    const name = window.prompt("Compartment name (for example, Top drawer)")?.trim();
    if (!name) return;
    await run(() => updateCompartments(db, householdId, freezer.id, (compartments) =>
      [...compartments, { id: newId(), name }]), "Compartment added.");
  };

  const renameCompartment = async (freezer, compartment) => {
    const name = window.prompt("Compartment name", compartment.name)?.trim();
    if (!name || name === compartment.name) return;
    await run(() => updateCompartments(db, householdId, freezer.id, (compartments) =>
      compartments.map((item) => item.id === compartment.id ? { ...item, name } : item)), "Compartment renamed.");
  };

  const removeCompartment = async (freezer, compartment) => {
    const used = entries.some((entry) => entry.freezerId === freezer.id && entry.compartmentId === compartment.id);
    if (used) {
      setMessage("Move items out of this compartment before removing it.");
      return;
    }
    if (freezer.compartments.length === 1) {
      setMessage("A freezer needs at least one compartment.");
      return;
    }
    if (!window.confirm(`Remove ${compartment.name}?`)) return;
    await run(() => updateCompartments(db, householdId, freezer.id, (compartments) =>
      compartments.filter((item) => item.id !== compartment.id)), "Compartment removed.");
  };

  const moveCompartment = async (freezer, index, direction) => {
    const compartmentId = freezer.compartments[index]?.id;
    if (!compartmentId) return;
    await run(() => updateCompartments(db, householdId, freezer.id, (compartments) => {
      const current = compartments.findIndex((item) => item.id === compartmentId);
      const other = current + direction;
      if (current < 0 || other < 0 || other >= compartments.length) return compartments;
      const next = [...compartments];
      [next[current], next[other]] = [next[other], next[current]];
      return next;
    }));
  };

  const removeFreezer = async (freezer) => {
    if (entries.some((entry) => entry.freezerId === freezer.id)) {
      setMessage("Move items out of this freezer before removing it.");
      return;
    }
    if (!window.confirm(`Remove ${freezer.name} and its empty compartments?`)) return;
    await run(() => deleteEmptyFreezer(db, householdId, freezer.id), "Freezer removed.");
    if (freezerFilter === freezer.id) {
      setFreezerFilter("all");
      setCompartmentFilter("all");
    }
  };

  const saveEntryDetails = async (entry) => {
    const location = selectedLocation(editLocationKey);
    if (!location) return;
    const saved = await run(async () => {
      if (location.kind === "freezer") return moveFrozenStock(db, householdId, entry, location, editDate);
      if (entry.freezerId === UNASSIGNED_ID) return moveUnassignedFrozenToFridge(db, householdId, entry.stockItem.id, entry.unitIds);
      const [operation] = prepareInventoryOperations([{
        id: newId(), kind: "move", name: entry.stockItem.name,
        stockItemId: entry.stockItem.id, quantity: entry.count, unitLabel: entry.unitLabel,
        opened: false, sourceLocationKey: entry.locationKey, targetLocationKey: location.key,
        sourcePhrase: "Manual move",
      }], { entries: allEntries, stockItems, locations: allLocations, sourceLocationKey: entry.locationKey });
      if (operation.issues.length) throw new Error(operation.issues[0]);
      return applyInventoryOperations(db, householdId, [operation], allLocations);
    }, "Location updated.");
    if (saved) setEditingEntry("");
  };

  return (
    <div className="space-y-5">
      <section className="rounded-3xl bg-slate-900 p-5 text-white shadow-sm sm:p-7">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-200">Household freezer</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">What’s in the freezer?</h1>
            <p className="mt-2 text-sm text-slate-300">
              {stockLoading || freezersLoading ? "Loading frozen food…" : loadError ? "Freezer locations unavailable" : `${totalUnits} portions across ${freezers.length} freezer${freezers.length === 1 ? "" : "s"}`}
            </p>
          </div>
          {!loadError && <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => { setMessage(""); voice.begin(); }} disabled={!locations.length}
              className="min-h-12 rounded-xl bg-white px-5 py-3 text-sm font-bold text-slate-900 shadow-sm disabled:opacity-40">
              🎙 Speak inventory
            </button>
            <button type="button" onClick={() => setShowAdd(true)}
              disabled={!locations.length} className="min-h-12 rounded-xl border border-sky-300 bg-sky-500 px-5 py-3 text-sm font-bold text-white disabled:opacity-40">
              + Add food
            </button>
          </div>}
        </div>
      </section>

      <InventoryExportControls stockItems={stockItems} freezers={freezers} defaultScope="freezer" disabled={stockLoading || freezersLoading || Boolean(stockError || loadError)} />
      {loadError && <section role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950">
        <h2 className="font-semibold">Freezer locations could not be loaded</h2>
        <p className="mt-1">{errorCode === "permission-denied"
          ? "Your account can open household stock, but access to freezer locations is blocked. The app owner needs to update the Firestore permissions for freezers."
          : loadError}</p>
        <button type="button" onClick={() => window.location.reload()} className="mt-3 min-h-10 rounded-xl border border-amber-300 bg-white px-3 font-medium">Reload after access is fixed</button>
      </section>}
      {!loadError && (stockError || message) && <p role="status" className="rounded-xl border border-sky-100 bg-sky-50 p-3 text-sm text-slate-800">{stockError || message}</p>}

      {!loadError && freezers.length === 0 && !freezersLoading && (
        <section className="rounded-2xl border border-sky-100 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold">Add your first freezer</h2>
          <p className="mt-1 text-sm text-slate-600">Give it a name. We’ll add one compartment to start.</p>
          {!showAddFreezer && <button type="button" onClick={openAddFreezer} disabled={busy} className="mt-4 min-h-11 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">+ Add freezer</button>}
          {addFreezerForm}
        </section>
      )}

      {!loadError && freezers.length > 0 && (
        <section aria-label="Freezers" className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-slate-950">Locations</h2>
            <button type="button" onClick={() => setShowLocations((value) => !value)} className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700">
              {showLocations ? "Done" : "Manage locations"}
            </button>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {freezers.map((freezer) => {
              const freezerCount = entries.filter((entry) => entry.freezerId === freezer.id).reduce((sum, entry) => sum + entry.count, 0);
              const isSelected = freezerFilter === freezer.id;
              return (
                <article key={freezer.id} className={`rounded-2xl border p-4 shadow-sm ${isSelected ? "border-emerald-600 bg-emerald-50 ring-2 ring-emerald-200" : "border-sky-100 bg-white"}`}>
                  <button type="button" onClick={() => { setFreezerFilter(freezerFilter === freezer.id ? "all" : freezer.id); setCompartmentFilter("all"); }}
                    aria-pressed={isSelected}
                    className="flex w-full items-center justify-between gap-2 text-left">
                    <span className="font-semibold text-slate-950">🧊 {freezer.name}</span>
                    <span className="flex items-center gap-2">
                      {isSelected && <span className="text-xs font-semibold text-emerald-800">Selected</span>}
                      <span className="rounded-full bg-sky-50 px-2 py-1 text-sm font-bold text-sky-800">{freezerCount}</span>
                    </span>
                  </button>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {(freezer.compartments || []).map((compartment) => {
                      const count = entries.filter((entry) => entry.freezerId === freezer.id && entry.compartmentId === compartment.id)
                        .reduce((sum, entry) => sum + entry.count, 0);
                      return <button key={compartment.id} type="button"
                        onClick={() => { setFreezerFilter(freezer.id); setCompartmentFilter(compartment.id); }}
                        className={`min-h-9 rounded-full px-3 text-xs font-medium ${freezerFilter === freezer.id && compartmentFilter === compartment.id ? "bg-sky-600 text-white" : "bg-slate-100 text-slate-700"}`}>
                        {compartment.name} · {count}
                      </button>;
                    })}
                  </div>
                  {showLocations && (
                    <div className="mt-4 space-y-3 border-t border-slate-100 pt-3 text-xs">
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => rename(freezer)} className="rounded-lg border px-2 py-1.5">Rename</button>
                        <button type="button" onClick={() => addCompartment(freezer)} className="rounded-lg border px-2 py-1.5">+ Compartment</button>
                        <button type="button" onClick={() => removeFreezer(freezer)} className="rounded-lg border border-rose-200 px-2 py-1.5 text-rose-700">Remove freezer</button>
                      </div>
                      <div className="flex gap-2">
                        <button type="button" disabled={freezers[0].id === freezer.id} onClick={() => reorderFreezers(db, householdId, freezer, freezers[freezers.indexOf(freezer) - 1]).catch((error) => setMessage(error.message))} className="rounded-lg border px-2 py-1.5 disabled:opacity-40">↑ Freezer</button>
                        <button type="button" disabled={freezers[freezers.length - 1].id === freezer.id} onClick={() => reorderFreezers(db, householdId, freezer, freezers[freezers.indexOf(freezer) + 1]).catch((error) => setMessage(error.message))} className="rounded-lg border px-2 py-1.5 disabled:opacity-40">↓ Freezer</button>
                      </div>
                      {(freezer.compartments || []).map((compartment, index) => (
                        <div key={compartment.id} className="flex flex-wrap items-center gap-1.5 rounded-lg bg-slate-50 p-2">
                          <span className="mr-auto font-medium">{compartment.name}</span>
                          <button type="button" onClick={() => renameCompartment(freezer, compartment)} className="rounded border bg-white px-2 py-1">Rename</button>
                          <button type="button" disabled={index === 0} onClick={() => moveCompartment(freezer, index, -1)} className="rounded border bg-white px-2 py-1 disabled:opacity-40" aria-label={`Move ${compartment.name} up`}>↑</button>
                          <button type="button" disabled={index === freezer.compartments.length - 1} onClick={() => moveCompartment(freezer, index, 1)} className="rounded border bg-white px-2 py-1 disabled:opacity-40" aria-label={`Move ${compartment.name} down`}>↓</button>
                          <button type="button" onClick={() => removeCompartment(freezer, compartment)} className="rounded border border-rose-200 bg-white px-2 py-1 text-rose-700">Remove</button>
                        </div>
                      ))}
                    </div>
                  )}
                </article>
              );
            })}
            {unassignedCount > 0 && <button type="button" onClick={() => { setFreezerFilter(UNASSIGNED_ID); setCompartmentFilter("all"); }} aria-pressed={freezerFilter === UNASSIGNED_ID}
              className={`rounded-2xl border bg-amber-50 p-4 text-left text-sm font-medium text-amber-900 ${freezerFilter === UNASSIGNED_ID ? "border-amber-600 ring-2 ring-amber-200" : "border-amber-200"}`}>
              Unassigned freezer items · {unassignedCount}{freezerFilter === UNASSIGNED_ID && <span className="ml-2 text-xs font-semibold">Selected</span>}
            </button>}
          </div>
          {showLocations && !showAddFreezer && <button type="button" onClick={openAddFreezer} disabled={busy} className="min-h-11 rounded-xl border border-sky-200 bg-white px-4 text-sm font-semibold text-sky-800 disabled:opacity-40">+ Add freezer</button>}
          {showLocations && addFreezerForm}
        </section>
      )}

      {!loadError && <section aria-label="Frozen food" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div><h2 className="text-lg font-bold text-slate-950">Frozen food</h2><p className="text-xs text-slate-500">{visibleEntries.length} item groups</p></div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search frozen food" aria-label="Search frozen food"
              className="min-h-11 rounded-xl border border-slate-200 px-3 text-sm sm:w-56" />
            <select value={freezerFilter} onChange={(event) => { setFreezerFilter(event.target.value); setCompartmentFilter("all"); }} aria-label="Filter by freezer" className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm">
              <option value="all">All freezers</option>
              {freezers.map((freezer) => <option key={freezer.id} value={freezer.id}>{freezer.name}</option>)}
              {unassignedCount > 0 && <option value={UNASSIGNED_ID}>Unassigned</option>}
            </select>
            {freezerFilter !== "all" && freezerFilter !== UNASSIGNED_ID && <select value={compartmentFilter} onChange={(event) => setCompartmentFilter(event.target.value)} aria-label="Filter by compartment" className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm">
              <option value="all">All compartments</option>
              {(freezers.find((freezer) => freezer.id === freezerFilter)?.compartments || []).map((compartment) => <option key={compartment.id} value={compartment.id}>{compartment.name}</option>)}
            </select>}
          </div>
        </div>
        {stockLoading || freezersLoading ? <p className="mt-5 text-sm text-slate-500">Loading inventory…</p> : visibleEntries.length === 0 ? (
          <div className="mt-5 rounded-xl bg-slate-50 p-5 text-sm text-slate-600">
            {entries.length === 0 ? "No frozen food yet. Add your first item to get started." : "No food matches these filters."}
          </div>
        ) : <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {visibleEntries.map((entry) => (
            <article key={entry.key} className="rounded-2xl border border-slate-200 p-3.5">
              <div className="flex items-start gap-3">
                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-sky-50 text-2xl">{entry.stockItem.emoji || "🧊"}</div>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate font-semibold text-slate-950">{entry.stockItem.name}</h3>
                  <p className="text-xs text-slate-500">{entry.locationLabel}</p>
                  {entry.frozenAt && <p className="mt-0.5 text-xs text-slate-500">Frozen {entry.frozenAt}</p>}
                  {entry.mixedDates && <p className="mt-0.5 text-xs text-slate-500">Mixed freezing dates</p>}
                  {entry.openedCount > 0 && <p className="mt-0.5 text-xs text-amber-700">{entry.openedCount} opened</p>}
                  {entry.knownGrams > 0 && <p className="mt-0.5 text-xs text-slate-600">{entry.knownGrams} g{entry.hasUnknown ? " known" : " total"}</p>}
                </div>
                <div className="flex items-center gap-1.5">
                  <button type="button" onClick={() => changeEntry(entry, -Math.min(1, entry.count))} disabled={busyEntry === entry.key} aria-label={`Use one ${entry.stockItem.name}`} className="grid h-11 w-11 place-items-center rounded-xl border border-slate-200 text-xl font-bold disabled:opacity-40">−</button>
                  <span className="min-w-6 text-center" aria-label={`${entry.count} ${entry.unitLabel === "package" ? "packages" : "items"}`}><span className="block text-lg font-bold leading-none">{entry.count}</span><span className="text-[10px] text-slate-500">{entry.unitLabel === "package" ? "pkgs" : "items"}</span></span>
                  <button type="button" onClick={() => changeEntry(entry, 1)} disabled={busyEntry === entry.key || entry.freezerId === UNASSIGNED_ID} aria-label={`Add one ${entry.stockItem.name}`} className="grid h-11 w-11 place-items-center rounded-xl bg-emerald-700 text-xl font-bold text-white disabled:opacity-40">+</button>
                </div>
              </div>
              <button type="button" onClick={() => { setEditingEntry(editingEntry === entry.key ? "" : entry.key); setEditLocationKey(entry.freezerId === UNASSIGNED_ID ? defaultLocationKey : `${entry.freezerId}/${entry.compartmentId}`); setEditDate(entry.frozenAt); }} className="mt-2 min-h-9 text-xs font-medium text-sky-800">{editingEntry === entry.key ? "Close" : "Move or edit details"}</button>
              {editingEntry === entry.key && <div className="space-y-3 border-t border-slate-100 pt-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <LocationSelect value={editLocationKey} onChange={setEditLocationKey} locations={allLocations} className="flex-1" />
                  {editLocationKey !== "fridge" && <label className="text-xs text-slate-600">Frozen on <input type="date" value={editDate} onChange={(event) => setEditDate(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 px-2 text-sm" /></label>}
                  <button type="button" onClick={() => saveEntryDetails(entry)} disabled={busy || !editLocationKey} className="min-h-11 rounded-xl bg-slate-900 px-3 text-sm font-semibold text-white disabled:opacity-40">Save location</button>
                </div>
                <div className="max-h-64 space-y-2 overflow-y-auto">{entry.units.map((unit) => <UnitDetailsRow key={unit.id} householdId={householdId} stockItemId={entry.stockItem.id} unit={unit} storageKind="freezer" onSaved={setMessage} />)}</div>
              </div>}
            </article>
          ))}
        </div>}
      </section>}

      {showAdd && <QuickAddDialog householdId={householdId} stockItems={stockItems} entries={allEntries}
        locations={allLocations} availableLocations={locations} defaultLocationKey={defaultLocationKey}
        storageKind="freezer" onClose={() => setShowAdd(false)}
        onSaved={(savedMessage) => { setShowAdd(false); setMessage(savedMessage); }} />}

      {voice.open && <VoiceInventoryDialog
        householdId={householdId} stockItems={stockItems} entries={allEntries} locations={allLocations}
        defaultLocationKey={defaultLocationKey} capturedText={voice.text} captureError={voice.error}
        listening={voice.listening} onStop={voice.stop} onRetry={voice.retry}
        onCancel={voice.cancel} onSaved={(savedMessage) => { voice.cancel(); setMessage(savedMessage); }}
      />}
    </div>
  );
}
