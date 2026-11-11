import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  runTransaction,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { activeUnitCount, makeFrozenUnits, newId, stockUnits } from "./freezerModel";

const freezerCollection = (db, householdId) => collection(db, "households", householdId, "freezers");
const stockRef = (db, householdId, itemId) => doc(db, "households", householdId, "stockItems", itemId);
const normalize = (value = "") => value.trim().toLocaleLowerCase("nb");

export async function createFreezer(db, householdId, name, position) {
  return addDoc(freezerCollection(db, householdId), {
    name: name.trim(),
    position,
    compartments: [{ id: newId(), name: "Main" }],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function renameFreezer(db, householdId, freezerId, name) {
  return updateDoc(doc(db, "households", householdId, "freezers", freezerId), {
    name: name.trim(),
    updatedAt: serverTimestamp(),
  });
}

export async function deleteEmptyFreezer(db, householdId, freezerId) {
  return deleteDoc(doc(db, "households", householdId, "freezers", freezerId));
}

export async function reorderFreezers(db, householdId, first, second) {
  const batch = writeBatch(db);
  batch.update(doc(db, "households", householdId, "freezers", first.id), {
    position: second.position,
    updatedAt: serverTimestamp(),
  });
  batch.update(doc(db, "households", householdId, "freezers", second.id), {
    position: first.position,
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
}

export async function updateCompartments(db, householdId, freezerId, transform) {
  const freezerRef = doc(db, "households", householdId, "freezers", freezerId);
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(freezerRef);
    if (!snapshot.exists()) throw new Error("Freezer no longer exists.");
    const compartments = transform(snapshot.data().compartments || []);
    if (compartments.length === 0) throw new Error("A freezer needs at least one compartment.");
    transaction.update(freezerRef, { compartments, updatedAt: serverTimestamp() });
  });
}

export async function addFrozenStock(db, householdId, stockItems, { name, count, location, frozenAt }) {
  const matching = stockItems.find((item) => item.freezer && normalize(item.name) === normalize(name));
  const newUnits = makeFrozenUnits(count, location, frozenAt);
  if (matching) {
    const itemRef = stockRef(db, householdId, matching.id);
    await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(itemRef);
      if (!snapshot.exists()) throw new Error("Stock item was removed. Please try again.");
      const units = stockUnits({ id: snapshot.id, ...snapshot.data() }).concat(newUnits);
      transaction.update(itemRef, {
        items: units,
        quantity: activeUnitCount(units),
        freezer: true,
        updatedAt: serverTimestamp(),
      });
    });
    return;
  }

  await addDoc(collection(db, "households", householdId, "stockItems"), {
    name: name.trim(),
    emoji: "🧊",
    unit: "pcs",
    packSize: 1,
    shelfLifeDays: 365,
    freezer: true,
    autoAddWhenEmpty: false,
    isBase: false,
    depleteOnCook: true,
    labels: [],
    items: newUnits,
    quantity: activeUnitCount(newUnits),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function changeFrozenStock(db, householdId, entry, delta) {
  const itemRef = stockRef(db, householdId, entry.stockItem.id);
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(itemRef);
    if (!snapshot.exists()) throw new Error("Stock item no longer exists.");
    let units = stockUnits({ id: snapshot.id, ...snapshot.data() });
    if (delta > 0) {
      const location = { freezerId: entry.freezerId, compartmentId: entry.compartmentId };
      units = units.concat(makeFrozenUnits(delta, location, entry.frozenAt));
    } else {
      const selected = new Set(entry.unitIds);
      let remaining = Math.min(-delta, entry.unitIds.length);
      units = units.map((unit) => {
        if (remaining <= 0 || !selected.has(unit.id) || unit.state === "empty") return unit;
        remaining -= 1;
        return { ...unit, state: "empty", emptiedAt: Date.now() };
      });
      if (remaining > 0) throw new Error("Stock changed. Please try again.");
    }
    transaction.update(itemRef, {
      items: units,
      quantity: activeUnitCount(units),
      updatedAt: serverTimestamp(),
    });
  });
}

export async function moveFrozenStock(db, householdId, entry, location, frozenAt) {
  const itemRef = stockRef(db, householdId, entry.stockItem.id);
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(itemRef);
    if (!snapshot.exists()) throw new Error("Stock item no longer exists.");
    const selected = new Set(entry.unitIds);
    const units = stockUnits({ id: snapshot.id, ...snapshot.data() }).map((unit) => {
      if (!selected.has(unit.id) || unit.state === "empty") return unit;
      const next = { ...unit, freezerId: location.freezerId, compartmentId: location.compartmentId };
      if (frozenAt) next.frozenAt = frozenAt;
      else if (!entry.mixedDates) delete next.frozenAt;
      return next;
    });
    transaction.update(itemRef, { items: units, freezer: true, updatedAt: serverTimestamp() });
  });
}
