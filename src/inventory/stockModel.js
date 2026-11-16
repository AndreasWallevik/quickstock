export const newId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const unitAmount = (unit) => Number(unit.amount) || 1;

export function stockUnits(stockItem) {
  if (Array.isArray(stockItem.items)) return stockItem.items;
  const count = Math.max(0, Math.ceil(Number(stockItem.quantity) || 0));
  return Array.from({ length: count }, (_, index) => ({
    id: `${stockItem.id || "unit"}-${index}`,
    state: stockItem.state || "full",
  }));
}

export function activeUnitCount(units) {
  return units.reduce((total, unit) => total + (unit.state === "empty" ? 0 : unitAmount(unit)), 0);
}

export function storageKindForUnit(unit, stockItem = {}) {
  if (["fridge", "freezer", "unassigned"].includes(unit.storageKind)) return unit.storageKind;
  if (unit.freezerId || stockItem.freezer) return "freezer";
  return "unassigned";
}

export function materializeLegacyLocations(stockItem) {
  return stockUnits(stockItem).map((unit) => ({
    ...unit,
    storageKind: storageKindForUnit(unit, stockItem),
  }));
}

export function weightSummary(units) {
  const active = units.filter((unit) => unit.state !== "empty");
  return {
    knownGrams: active.reduce((total, unit) => total + (Number(unit.weightGrams) || 0), 0),
    hasUnknown: active.some((unit) => !Number.isFinite(unit.weightGrams) || unit.weightGrams <= 0),
  };
}

export function dateToExpiry(date) {
  if (!date) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Choose a valid expiration date.");
  const [year, month, day] = date.split("-").map(Number);
  const calendarDay = new Date(year, month - 1, day);
  if (calendarDay.getFullYear() !== year || calendarDay.getMonth() !== month - 1 || calendarDay.getDate() !== day) {
    throw new Error("Choose a valid expiration date.");
  }
  const expiry = new Date(`${date}T23:59:59.999`).getTime();
  if (!Number.isFinite(expiry)) throw new Error("Choose a valid expiration date.");
  return expiry;
}

export function makeStockUnits(quantity, location, {
  opened = false, unitLabel = "item", weightGrams = null, weightScope = "total",
  expiresAt, expiryEstimated = false, frozenAt = "",
} = {}) {
  const count = Number(quantity);
  if (!Number.isFinite(count) || count <= 0 || count > 99 ||
      Math.abs(count * 100 - Math.round(count * 100)) > 0.000001) {
    throw new Error("Quantity must be between 0.01 and 99.");
  }
  if (!location || !["fridge", "freezer"].includes(location.kind)) throw new Error("Choose a storage location.");
  const weight = weightGrams === null || weightGrams === "" || weightGrams === undefined ? null : Number(weightGrams);
  if (weight !== null && (!Number.isInteger(weight) || weight <= 0 || weight > 1000000)) {
    throw new Error("Weight must be a positive number of grams.");
  }
  if (weight !== null && weightScope === "per_unit" && !Number.isInteger(count)) {
    throw new Error("Per-unit weight requires a whole item count.");
  }
  const amounts = weight !== null && weightScope === "total"
    ? [count]
    : [...Array.from({ length: Math.floor(count) }, () => 1), ...(
      count % 1 ? [Math.round((count % 1) * 100) / 100] : []
    )];
  return amounts.map((amount) => ({
    id: newId(),
    state: opened ? "opened" : "full",
    ...(amount !== 1 ? { amount } : {}),
    unitLabel,
    addedAt: Date.now(),
    storageKind: location.kind,
    ...(location.kind === "freezer" ? { freezerId: location.freezerId, compartmentId: location.compartmentId } : {}),
    ...(weight !== null ? { weightGrams: weight } : {}),
    ...(expiresAt !== undefined ? { expiresAt } : {}),
    ...(expiresAt !== undefined ? { expiryEstimated: Boolean(expiryEstimated) } : {}),
    ...(frozenAt ? { frozenAt } : {}),
  }));
}

export function buildFridgeEntries(stockItems) {
  return stockItems.flatMap((stockItem) => {
    const units = stockUnits(stockItem).filter((unit) =>
      unit.state !== "empty" && ["fridge", "unassigned"].includes(storageKindForUnit(unit, stockItem))
    );
    if (!units.length) return [];
    const { knownGrams, hasUnknown } = weightSummary(units);
    return [{
      key: `${stockItem.id}/fridge`, locationKey: "fridge", stockItem, units,
      count: activeUnitCount(units), unitIds: units.map((unit) => unit.id),
      openedCount: activeUnitCount(units.filter((unit) => unit.state === "opened")),
      knownGrams, hasUnknown,
      hasUnassigned: units.some((unit) => storageKindForUnit(unit, stockItem) === "unassigned"),
      expiredCount: activeUnitCount(units.filter((unit) => unit.state === "expired" || (unit.expiresAt && unit.expiresAt <= Date.now()))),
      soonCount: activeUnitCount(units.filter((unit) => unit.state !== "expired" && unit.expiresAt &&
        unit.expiresAt > Date.now() && unit.expiresAt <= Date.now() + 2 * 86400000)),
    }];
  });
}
