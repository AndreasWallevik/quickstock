import { collection, doc, runTransaction, serverTimestamp } from "firebase/firestore";
import { activeUnitCount } from "./freezerModel.js";
import {
  dateToExpiry, makeStockUnits, materializeLegacyLocations, newId,
  storageKindForUnit, unitAmount,
} from "../inventory/stockModel.js";
import { canonicalName, nameKey, validateInventoryOperation } from "./inventoryInterpretation.js";

const round = (value) => Math.round(value * 100) / 100;

export function unitInLocation(unit, location, stockItem = {}) {
  if (!location || unit.state === "empty") return false;
  const kind = storageKindForUnit(unit, stockItem);
  if (location.kind === "fridge") return kind === "fridge" || kind === "unassigned";
  return kind === "freezer" && unit.freezerId === location.freezerId && unit.compartmentId === location.compartmentId;
}

function movedUnit(unit, target) {
  const next = { ...unit, storageKind: target.kind };
  if (target.kind === "freezer") {
    next.freezerId = target.freezerId;
    next.compartmentId = target.compartmentId;
  } else {
    delete next.freezerId;
    delete next.compartmentId;
  }
  return next;
}

function addUnits(operation, source, count = operation.quantity) {
  return makeStockUnits(count, source, {
    opened: operation.opened,
    unitLabel: operation.unitLabel,
    weightGrams: operation.weightGrams,
    weightScope: operation.weightScope,
    ...(operation.expiryDate ? { expiresAt: dateToExpiry(operation.expiryDate) } : {}),
    expiryEstimated: Boolean(operation.expiryEstimated),
    frozenAt: operation.frozenAt,
  });
}

export function applyOperationToUnits(units, operation, source, target, stockItem = {}) {
  const next = units.map((unit) => ({ ...unit }));
  if (operation.kind === "add") return next.concat(addUnits(operation, source));

  const matching = next.map((unit, index) => ({ unit, index }))
    .filter(({ unit }) => unitInLocation(unit, source, stockItem) &&
      (!operation.stateFilter || unit.state === operation.stateFilter) &&
      (operation.kind !== "open" || unit.state === "full"));
  if (operation.kind === "set_weight") {
    const selected = operation.unitId ? matching.find(({ unit }) => unit.id === operation.unitId) : matching.length === 1 ? matching[0] : null;
    if (!selected) throw new Error("Choose which item or batch has this weight.");
    next[selected.index] = { ...selected.unit, weightGrams: operation.weightGrams };
    return next;
  }

  const available = round(matching.reduce((total, { unit }) => total + unitAmount(unit), 0));
  const requested = operation.kind === "set_quantity" ? round(available - operation.quantity) : operation.quantity;
  if (operation.kind === "set_quantity" && requested < 0) {
    return next.concat(addUnits({ ...operation, weightGrams: null }, source, -requested));
  }
  if (requested > available) throw new Error(`Only ${available} ${operation.name} is available in this location.`);
  if (requested === 0) return next;

  let remaining = requested;
  const indices = matching.sort((a, b) =>
    (a.unit.expiresAt || Infinity) - (b.unit.expiresAt || Infinity) ||
    (a.unit.frozenAt || "9999-99-99").localeCompare(b.unit.frozenAt || "9999-99-99")
  );

  for (const { index } of indices) {
    if (remaining <= 0) break;
    const unit = next[index];
    const amount = unitAmount(unit);
    const taken = Math.min(remaining, amount);
    remaining = round(remaining - taken);
    if (taken < amount && unit.weightGrams && !operation.allowUnknownWeight) {
      throw new Error("Review the unknown weight after splitting this batch.");
    }
    if (operation.kind === "move") {
      if (!target) throw new Error("Destination is missing.");
      if (taken === amount) {
        next[index] = movedUnit(unit, target);
      } else {
        next[index] = { ...unit, amount: round(amount - taken) };
        const moved = movedUnit({ ...unit, id: newId(), amount: taken }, target);
        if (unit.weightGrams) { delete next[index].weightGrams; delete moved.weightGrams; }
        next.push(moved);
      }
    } else if (operation.kind === "open") {
      if (taken === amount) next[index] = { ...unit, state: "opened" };
      else {
        next[index] = { ...unit, amount: round(amount - taken) };
        const opened = { ...unit, id: newId(), amount: taken, state: "opened" };
        if (unit.weightGrams) { delete next[index].weightGrams; delete opened.weightGrams; }
        next.push(opened);
      }
    } else if (taken === amount) {
      next[index] = { ...unit, state: "empty", emptiedAt: Date.now() };
    } else {
      next[index] = { ...unit, amount: round(amount - taken), state: "opened" };
      if (unit.weightGrams) delete next[index].weightGrams;
    }
  }
  if (remaining > 0) throw new Error("Stock changed. Review and try again.");
  return next;
}

const newStockItem = (name, source, operation) => ({
  name, emoji: source.kind === "freezer" ? "🧊" : "🧺", unit: "pcs", packSize: 1,
  shelfLifeDays: source.kind === "freezer" ? 365 : 7,
  freezer: source.kind === "freezer", autoAddWhenEmpty: false,
  isBase: false, depleteOnCook: true,
  labels: operation.label ? [operation.label] : [], items: [],
});

export async function applyInventoryOperations(db, householdId, operations, locations) {
  if (!Array.isArray(operations) || operations.length === 0 || operations.length > 20) {
    throw new Error("Review between 1 and 20 changes at a time.");
  }
  for (const operation of operations) {
    const issues = validateInventoryOperation(operation, locations);
    if (operation.issues?.length || issues.length) throw new Error((operation.issues || []).concat(issues)[0]);
  }

  await runTransaction(db, async (transaction) => {
    const touched = new Map();
    const neededLocations = new Map();
    for (const operation of operations) {
      const source = locations.find((location) => location.key === operation.sourceLocationKey);
      const target = locations.find((location) => location.key === operation.targetLocationKey);
      neededLocations.set(source.key, source);
      if (target) neededLocations.set(target.key, target);
      const itemId = operation.stockItemId || `voice-${encodeURIComponent(nameKey(operation.name))}`;
      if (!touched.has(itemId)) {
        touched.set(itemId, {
          ref: doc(collection(db, "households", householdId, "stockItems"), itemId),
          isNew: false, data: null,
        });
      }
    }

    const freezerSnapshots = new Map();
    for (const location of neededLocations.values()) {
      if (location.kind !== "freezer" || freezerSnapshots.has(location.freezerId)) continue;
      const freezerRef = doc(db, "households", householdId, "freezers", location.freezerId);
      freezerSnapshots.set(location.freezerId, await transaction.get(freezerRef));
    }
    for (const location of neededLocations.values()) {
      if (location.kind !== "freezer") continue;
      const snapshot = freezerSnapshots.get(location.freezerId);
      if (!snapshot.exists() || !(snapshot.data().compartments || []).some((item) => item.id === location.compartmentId)) {
        throw new Error("A freezer location changed. Review the update and try again.");
      }
    }

    for (const record of touched.values()) {
      const snapshot = await transaction.get(record.ref);
      record.isNew = !snapshot.exists();
      record.data = snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
    }

    for (const operation of operations) {
      const itemId = operation.stockItemId || `voice-${encodeURIComponent(nameKey(operation.name))}`;
      const record = touched.get(itemId);
      const source = locations.find((location) => location.key === operation.sourceLocationKey);
      const target = locations.find((location) => location.key === operation.targetLocationKey);
      if (!record.data) {
        if (operation.kind !== "add") throw new Error(`${operation.name} was removed. Review and try again.`);
        record.data = { id: itemId, ...newStockItem(operation.name, source, operation) };
      } else if (nameKey(canonicalName(record.data.name)) !== nameKey(canonicalName(operation.name))) {
        throw new Error(`The selected item changed. Review ${operation.name} and try again.`);
      }
      record.data.items = applyOperationToUnits(materializeLegacyLocations(record.data), operation, source, target, record.data);
      record.data.quantity = activeUnitCount(record.data.items);
      record.data.freezer = record.data.items.some((unit) => unit.state !== "empty" && unit.storageKind === "freezer");
      if (operation.label && !record.data.labels?.includes(operation.label)) {
        record.data.labels = [...(record.data.labels || []), operation.label];
      }
    }

    for (const record of touched.values()) {
      const { id: _id, ...data } = record.data;
      if (record.isNew) transaction.set(record.ref, { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      else transaction.update(record.ref, {
        items: data.items, quantity: data.quantity, freezer: data.freezer,
        labels: data.labels || [], updatedAt: serverTimestamp(),
      });
    }
  });
}
