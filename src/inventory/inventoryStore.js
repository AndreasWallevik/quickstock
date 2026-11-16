import { doc, runTransaction, serverTimestamp } from "firebase/firestore";
import { activeUnitCount, dateToExpiry, materializeLegacyLocations, storageKindForUnit } from "./stockModel";

const hasField = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

export async function assignLegacyToFridge(db, householdId, stockItemId) {
  const itemRef = doc(db, "households", householdId, "stockItems", stockItemId);
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(itemRef);
    if (!snapshot.exists()) throw new Error("This food item no longer exists.");
    const product = { id: snapshot.id, ...snapshot.data() };
    const next = materializeLegacyLocations(product).map((unit) =>
      storageKindForUnit(unit, product) === "unassigned" ? { ...unit, storageKind: "fridge" } : unit);
    transaction.update(itemRef, { items: next, updatedAt: serverTimestamp() });
  });
}

export async function moveUnassignedFrozenToFridge(db, householdId, stockItemId, unitIds) {
  const itemRef = doc(db, "households", householdId, "stockItems", stockItemId);
  const selected = new Set(unitIds);
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(itemRef);
    if (!snapshot.exists()) throw new Error("This food item no longer exists.");
    const product = { id: snapshot.id, ...snapshot.data() };
    const units = materializeLegacyLocations(product);
    if (!units.some((unit) => selected.has(unit.id) && unit.state !== "empty" && unit.storageKind === "freezer")) {
      throw new Error("This freezer item changed. Reload and try again.");
    }
    const next = units.map((unit) => {
      if (unit.state === "empty" || unit.storageKind !== "freezer" || !selected.has(unit.id)) return unit;
      const moved = { ...unit, storageKind: "fridge" };
      delete moved.freezerId;
      delete moved.compartmentId;
      return moved;
    });
    transaction.update(itemRef, {
      items: next,
      quantity: activeUnitCount(next),
      freezer: next.some((unit) => unit.state !== "empty" && unit.storageKind === "freezer"),
      updatedAt: serverTimestamp(),
    });
  });
}

export async function updateStockUnitDetails(db, householdId, stockItemId, unitId, details) {
  const { weightGrams, expiryDate, frozenAt } = details;
  const grams = weightGrams === "" || weightGrams === null || weightGrams === undefined ? null : Number(weightGrams);
  if (grams !== null && (!Number.isInteger(grams) || grams <= 0 || grams > 1000000)) {
    throw new Error("Enter a positive weight in grams, or leave it unknown.");
  }
  const expiresAt = expiryDate ? dateToExpiry(expiryDate) : null;
  if (hasField(details, "frozenAt") && frozenAt) {
    try { dateToExpiry(frozenAt); }
    catch { throw new Error("Choose a valid freezing date."); }
  }
  const itemRef = doc(db, "households", householdId, "stockItems", stockItemId);
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(itemRef);
    if (!snapshot.exists()) throw new Error("This food item no longer exists.");
    const units = materializeLegacyLocations({ id: snapshot.id, ...snapshot.data() });
    if (!units.some((unit) => unit.id === unitId && unit.state !== "empty")) {
      throw new Error("This item changed. Reload and try again.");
    }
    const next = units.map((unit) => {
      if (unit.id !== unitId) return unit;
      const updated = { ...unit };
      if (hasField(details, "weightGrams")) {
        if (grams === null) delete updated.weightGrams;
        else updated.weightGrams = grams;
      }
      if (hasField(details, "expiryDate")) {
        if (expiresAt === null) { delete updated.expiresAt; delete updated.expiryEstimated; }
        else { updated.expiresAt = expiresAt; updated.expiryEstimated = false; }
      }
      if (hasField(details, "frozenAt")) {
        if (!frozenAt) delete updated.frozenAt;
        else updated.frozenAt = frozenAt;
      }
      return updated;
    });
    transaction.update(itemRef, { items: next, updatedAt: serverTimestamp() });
  });
}
