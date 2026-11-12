import { collection, doc, runTransaction, serverTimestamp } from "firebase/firestore";
import { activeUnitCount, makeFrozenUnits, newId, stockUnits } from "./freezerModel.js";
import { canonicalName, nameKey, validateInventoryOperation } from "./inventoryInterpretation.js";

const amountOf = (unit) => Number(unit.amount) || 1;
const inLocation = (unit, location) =>
  unit.state !== "empty" && unit.freezerId === location.freezerId && unit.compartmentId === location.compartmentId;
const round = (value) => Math.round(value * 100) / 100;

export function applyOperationToUnits(units, operation, source, target) {
  const next = units.map((unit) => ({ ...unit }));
  if (operation.kind === "add") {
    return next.concat(makeFrozenUnits(operation.quantity, source, "", {
      state: operation.opened ? "opened" : "full",
      unitLabel: operation.unitLabel,
    }));
  }

  const available = round(next.filter((unit) => inLocation(unit, source))
    .reduce((total, unit) => total + amountOf(unit), 0));
  const requested = operation.kind === "set_quantity" ? round(available - operation.quantity) : operation.quantity;
  if (operation.kind === "set_quantity" && requested < 0) {
    return next.concat(makeFrozenUnits(-requested, source, "", { unitLabel: operation.unitLabel }));
  }
  if (requested > available) throw new Error(`Only ${available} ${operation.name} is available in this compartment.`);
  if (requested === 0) return next;

  let remaining = requested;
  const indices = next.map((unit, index) => ({ unit, index }))
    .filter(({ unit }) => inLocation(unit, source))
    .sort((a, b) => (a.unit.frozenAt || "9999-99-99").localeCompare(b.unit.frozenAt || "9999-99-99"));

  for (const { index } of indices) {
    if (remaining <= 0) break;
    const unit = next[index];
    const amount = amountOf(unit);
    const taken = Math.min(remaining, amount);
    remaining = round(remaining - taken);
    if (operation.kind === "move") {
      if (!target) throw new Error("Destination compartment is missing.");
      if (taken === amount) {
        next[index] = { ...unit, freezerId: target.freezerId, compartmentId: target.compartmentId };
      } else {
        next[index] = { ...unit, amount: round(amount - taken) };
        next.push({ ...unit, id: newId(), amount: taken, freezerId: target.freezerId, compartmentId: target.compartmentId });
      }
    } else if (taken === amount) {
      next[index] = { ...unit, state: "empty", emptiedAt: Date.now() };
    } else {
      next[index] = { ...unit, amount: round(amount - taken), state: "opened" };
    }
  }
  if (remaining > 0) throw new Error("Stock changed. Review and try again.");
  return next;
}

const newStockItem = (name) => ({
  name, emoji: "🧊", unit: "pcs", packSize: 1, shelfLifeDays: 365,
  freezer: true, autoAddWhenEmpty: false, isBase: false, depleteOnCook: true,
  labels: [], items: [],
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
      if (freezerSnapshots.has(location.freezerId)) continue;
      const freezerRef = doc(db, "households", householdId, "freezers", location.freezerId);
      freezerSnapshots.set(location.freezerId, await transaction.get(freezerRef));
    }
    for (const location of neededLocations.values()) {
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
      if (!record.data) {
        if (operation.kind !== "add") throw new Error(`${operation.name} was removed. Review and try again.`);
        record.data = { id: itemId, ...newStockItem(operation.name) };
      } else if (nameKey(canonicalName(record.data.name)) !== nameKey(canonicalName(operation.name))) {
        throw new Error(`The selected item changed. Review ${operation.name} and try again.`);
      }
      const source = locations.find((location) => location.key === operation.sourceLocationKey);
      const target = locations.find((location) => location.key === operation.targetLocationKey);
      record.data.items = applyOperationToUnits(stockUnits(record.data), operation, source, target);
      record.data.quantity = activeUnitCount(record.data.items);
      record.data.freezer = true;
    }

    for (const record of touched.values()) {
      const { id: _id, ...data } = record.data;
      if (record.isNew) transaction.set(record.ref, { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      else transaction.update(record.ref, { items: data.items, quantity: data.quantity, freezer: true, updatedAt: serverTimestamp() });
    }
  });
}
