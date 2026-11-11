import { useEffect, useMemo, useRef, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";
import {
  buildFreezerEntries,
  filterFreezerEntries,
  locationOptions,
  newId,
  parseVoiceCommand,
  sortedFreezers,
  UNASSIGNED_ID,
} from "./freezerModel";
import {
  addFrozenStock,
  changeFrozenStock,
  createFreezer,
  deleteEmptyFreezer,
  moveFrozenStock,
  renameFreezer,
  reorderFreezers,
  updateCompartments,
} from "./freezerStore";

const emptyDraft = { name: "", count: 1, locationKey: "", frozenAt: "" };

function useFreezers(householdId) {
  const [state, setState] = useState({ freezers: [], loading: true, error: "" });
  useEffect(() => {
    if (!householdId) return undefined;
    return onSnapshot(
      collection(db, "households", householdId, "freezers"),
      (snapshot) => setState({
        freezers: sortedFreezers(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))),
        loading: false,
        error: "",
      }),
      (error) => setState({ freezers: [], loading: false, error: error.message || "Could not load freezers." })
    );
  }, [householdId]);
  return state;
}

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
  const { freezers, loading: freezersLoading, error: loadError } = useFreezers(householdId);
  const entries = useMemo(() => buildFreezerEntries(stockItems, freezers), [stockItems, freezers]);
  const locations = useMemo(() => locationOptions(freezers), [freezers]);
  const [search, setSearch] = useState("");
  const [freezerFilter, setFreezerFilter] = useState("all");
  const [compartmentFilter, setCompartmentFilter] = useState("all");
  const [showAdd, setShowAdd] = useState(false);
  const [showVoice, setShowVoice] = useState(false);
  const [showLocations, setShowLocations] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  const [voiceText, setVoiceText] = useState("");
  const [voiceCommand, setVoiceCommand] = useState(null);
  const [voiceLocationKey, setVoiceLocationKey] = useState("");
  const [listening, setListening] = useState(false);
  const [editingEntry, setEditingEntry] = useState("");
  const [editLocationKey, setEditLocationKey] = useState("");
  const [editDate, setEditDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyEntry, setBusyEntry] = useState("");
  const [message, setMessage] = useState("");
  const recognitionRef = useRef(null);

  useEffect(() => {
    return () => recognitionRef.current?.abort();
  }, []);

  const visibleEntries = useMemo(() => filterFreezerEntries(entries, {
    search,
    freezerId: freezerFilter,
    compartmentId: compartmentFilter,
  }).sort((a, b) => a.stockItem.name.localeCompare(b.stockItem.name, "nb", { sensitivity: "base" })),
  [entries, search, freezerFilter, compartmentFilter]);
  const totalUnits = entries.reduce((total, entry) => total + entry.count, 0);
  const unassignedCount = entries.filter((entry) => entry.freezerId === UNASSIGNED_ID)
    .reduce((total, entry) => total + entry.count, 0);
  const defaultLocationKey = locations.find((location) => location.freezerId === freezerFilter)?.key || locations[0]?.key || "";
  const selectedLocation = (key) => locations.find((location) => location.key === key);

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
      await changeFrozenStock(db, householdId, entry, delta);
    } catch (error) {
      setMessage(error.message || "Could not update stock.");
    } finally {
      setBusyEntry("");
    }
  };

  const submitAdd = async (event) => {
    event.preventDefault();
    const name = draft.name.trim();
    const location = selectedLocation(draft.locationKey || defaultLocationKey);
    if (!name || !location) return;
    const saved = await run(
      () => addFrozenStock(db, householdId, stockItems, { name, count: draft.count, location, frozenAt: draft.frozenAt }),
      `${name} added to ${location.label}.`
    );
    if (saved) {
      setDraft(emptyDraft);
      setShowAdd(false);
    }
  };

  const addFreezer = async () => {
    const name = window.prompt("Name this freezer (for example, Kitchen freezer)")?.trim();
    if (!name) return;
    const nextPosition = Math.max(-1, ...freezers.map((freezer) => Number(freezer.position) || 0)) + 1;
    await run(() => createFreezer(db, householdId, name, nextPosition), `${name} added.`);
  };

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

  const beginVoice = () => {
    setShowVoice(true);
    setVoiceCommand(null);
    setVoiceText("");
    setVoiceLocationKey(defaultLocationKey);
    setMessage("");
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setMessage("Voice capture is unavailable in this browser. Type a command below instead.");
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = navigator.language || "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      setVoiceText(transcript);
      setVoiceCommand(parseVoiceCommand(transcript));
    };
    recognition.onerror = (event) => setMessage(`Voice capture: ${event.error}. You can type the command instead.`);
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
    } catch {
      setMessage("Could not start voice capture. You can type the command instead.");
    }
  };

  const confirmVoice = async () => {
    const command = voiceCommand;
    const location = selectedLocation(voiceLocationKey || defaultLocationKey);
    if (!command || !location) return;
    if (command.action === "add") {
      const saved = await run(() => addFrozenStock(db, householdId, stockItems, {
        name: command.name, count: command.count, location, frozenAt: "",
      }), `${command.count} ${command.name} added.`);
      if (saved) setShowVoice(false);
      return;
    }
    const match = entries.find((entry) =>
      entry.freezerId === location.freezerId &&
      entry.compartmentId === location.compartmentId &&
      entry.stockItem.name.toLocaleLowerCase("nb") === command.name.toLocaleLowerCase("nb")
    );
    if (!match || match.count < command.count) {
      setMessage(`Could not find ${command.count} ${command.name} in ${location.label}. Select the right compartment or edit the command.`);
      return;
    }
    const saved = await run(() => changeFrozenStock(db, householdId, match, -command.count),
      `${command.count} ${command.name} removed.`);
    if (saved) setShowVoice(false);
  };

  const saveEntryDetails = async (entry) => {
    const location = selectedLocation(editLocationKey);
    if (!location) return;
    const saved = await run(() => moveFrozenStock(db, householdId, entry, location, editDate), "Location updated.");
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
              {stockLoading || freezersLoading ? "Loading frozen food…" : `${totalUnits} portions across ${freezers.length} freezer${freezers.length === 1 ? "" : "s"}`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => { setDraft({ ...emptyDraft, locationKey: defaultLocationKey }); setShowAdd(true); }}
              disabled={!locations.length} className="min-h-12 rounded-xl bg-white px-5 py-3 text-sm font-bold text-slate-900 disabled:opacity-40">
              + Add food
            </button>
            <button type="button" onClick={beginVoice} disabled={!locations.length}
              className="min-h-12 rounded-xl border border-sky-300 bg-sky-500 px-5 py-3 text-sm font-bold text-white disabled:opacity-40">
              🎙 Voice update
            </button>
          </div>
        </div>
      </section>

      {(loadError || stockError || message) && <p role="status" className="rounded-xl border border-sky-100 bg-sky-50 p-3 text-sm text-slate-800">{loadError || stockError || message}</p>}

      {freezers.length === 0 && !freezersLoading && (
        <section className="rounded-2xl border border-sky-100 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold">Add your first freezer</h2>
          <p className="mt-1 text-sm text-slate-600">Give it a name. We’ll add one compartment to start.</p>
          <button type="button" onClick={addFreezer} disabled={busy} className="mt-4 min-h-11 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">+ Add freezer</button>
        </section>
      )}

      {freezers.length > 0 && (
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
              return (
                <article key={freezer.id} className="rounded-2xl border border-sky-100 bg-white p-4 shadow-sm">
                  <button type="button" onClick={() => { setFreezerFilter(freezerFilter === freezer.id ? "all" : freezer.id); setCompartmentFilter("all"); }}
                    className="flex w-full items-center justify-between gap-2 text-left">
                    <span className="font-semibold text-slate-950">🧊 {freezer.name}</span>
                    <span className="rounded-full bg-sky-50 px-2 py-1 text-sm font-bold text-sky-800">{freezerCount}</span>
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
            {unassignedCount > 0 && <button type="button" onClick={() => { setFreezerFilter(UNASSIGNED_ID); setCompartmentFilter("all"); }} className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-left text-sm font-medium text-amber-900">Unassigned freezer items · {unassignedCount}</button>}
          </div>
          {showLocations && <button type="button" onClick={addFreezer} disabled={busy} className="min-h-11 rounded-xl border border-sky-200 bg-white px-4 text-sm font-semibold text-sky-800 disabled:opacity-40">+ Add freezer</button>}
        </section>
      )}

      <section aria-label="Frozen food" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
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
                </div>
                <div className="flex items-center gap-1.5">
                  <button type="button" onClick={() => changeEntry(entry, -1)} disabled={busyEntry === entry.key} aria-label={`Use one ${entry.stockItem.name}`} className="grid h-11 w-11 place-items-center rounded-xl border border-slate-200 text-xl font-bold disabled:opacity-40">−</button>
                  <span className="min-w-6 text-center text-lg font-bold" aria-label={`${entry.count} portions`}>{entry.count}</span>
                  <button type="button" onClick={() => changeEntry(entry, 1)} disabled={busyEntry === entry.key || entry.freezerId === UNASSIGNED_ID} aria-label={`Add one ${entry.stockItem.name}`} className="grid h-11 w-11 place-items-center rounded-xl bg-emerald-700 text-xl font-bold text-white disabled:opacity-40">+</button>
                </div>
              </div>
              <button type="button" onClick={() => { setEditingEntry(editingEntry === entry.key ? "" : entry.key); setEditLocationKey(entry.freezerId === UNASSIGNED_ID ? defaultLocationKey : `${entry.freezerId}/${entry.compartmentId}`); setEditDate(entry.frozenAt); }} className="mt-2 min-h-9 text-xs font-medium text-sky-800">{editingEntry === entry.key ? "Close" : "Move or edit date"}</button>
              {editingEntry === entry.key && <div className="flex flex-col gap-2 border-t border-slate-100 pt-3 sm:flex-row sm:items-end">
                <LocationSelect value={editLocationKey} onChange={setEditLocationKey} locations={locations} className="flex-1" />
                <label className="text-xs text-slate-600">Frozen on <input type="date" value={editDate} onChange={(event) => setEditDate(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 px-2 text-sm" /></label>
                <button type="button" onClick={() => saveEntryDetails(entry)} disabled={busy || !editLocationKey} className="min-h-11 rounded-xl bg-slate-900 px-3 text-sm font-semibold text-white disabled:opacity-40">Save</button>
              </div>}
            </article>
          ))}
        </div>}
      </section>

      {showAdd && <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-2 sm:items-center" role="presentation">
        <form onSubmit={submitAdd} className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
          <div className="flex items-center justify-between"><h2 className="text-xl font-bold">Add frozen food</h2><button type="button" onClick={() => setShowAdd(false)} className="min-h-10 px-2 text-sm">Close</button></div>
          <label className="mt-4 block text-sm font-medium">Food name<input autoFocus required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="e.g. Chicken thighs" className="mt-1 min-h-12 w-full rounded-xl border border-slate-200 px-3" /></label>
          <div className="mt-3 grid grid-cols-[100px_1fr] gap-3">
            <label className="text-sm font-medium">Portions<input type="number" min="1" max="99" required value={draft.count} onChange={(event) => setDraft({ ...draft, count: event.target.value })} className="mt-1 min-h-12 w-full rounded-xl border border-slate-200 px-3" /></label>
            <label className="text-sm font-medium">Location<LocationSelect value={draft.locationKey || defaultLocationKey} onChange={(value) => setDraft({ ...draft, locationKey: value })} locations={locations} className="mt-1 w-full" /></label>
          </div>
          <label className="mt-3 block text-sm font-medium">Date frozen <span className="font-normal text-slate-500">(optional)</span><input type="date" value={draft.frozenAt} onChange={(event) => setDraft({ ...draft, frozenAt: event.target.value })} className="mt-1 min-h-12 w-full rounded-xl border border-slate-200 px-3" /></label>
          {message && <p role="status" className="mt-3 text-sm text-rose-700">{message}</p>}
          <button type="submit" disabled={busy || !locations.length} className="mt-5 min-h-12 w-full rounded-xl bg-emerald-700 px-4 font-bold text-white disabled:opacity-40">{busy ? "Saving…" : "Add to freezer"}</button>
        </form>
      </div>}

      {showVoice && <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-2 sm:items-center" role="presentation">
        <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
          <div className="flex items-center justify-between"><h2 className="text-xl font-bold">Voice update</h2><button type="button" onClick={() => { recognitionRef.current?.abort(); setShowVoice(false); }} className="min-h-10 px-2 text-sm">Close</button></div>
          <p className="mt-2 text-sm text-slate-600">Say “add 2 chicken thighs” or “remove 1 pizza”. Review before saving.</p>
          <div className="mt-4 flex gap-2"><input value={voiceText} onChange={(event) => { setVoiceText(event.target.value); setVoiceCommand(null); }} placeholder={listening ? "Listening…" : "Type a command"} aria-label="Voice command" className="min-h-12 min-w-0 flex-1 rounded-xl border border-slate-200 px-3 text-sm" /><button type="button" onClick={() => setVoiceCommand(parseVoiceCommand(voiceText))} className="rounded-xl border border-slate-200 px-3 text-sm font-semibold">Review</button></div>
          <LocationSelect value={voiceLocationKey || defaultLocationKey} onChange={setVoiceLocationKey} locations={locations} className="mt-3 w-full" />
          {voiceCommand ? <p className="mt-3 rounded-xl bg-sky-50 p-3 text-sm">{voiceCommand.action === "add" ? "Add" : "Remove"} {voiceCommand.count} × {voiceCommand.name}</p> : voiceText && <p className="mt-3 text-sm text-amber-800">Use “add 2 name” or “remove 1 name”.</p>}
          {message && <p role="status" className="mt-3 text-sm text-rose-700">{message}</p>}
          <button type="button" onClick={confirmVoice} disabled={!voiceCommand || !locations.length || busy} className="mt-4 min-h-12 w-full rounded-xl bg-emerald-700 font-bold text-white disabled:opacity-40">Confirm update</button>
        </div>
      </div>}
    </div>
  );
}
