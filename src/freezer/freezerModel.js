const normalize = (value = "") => value.trim().toLocaleLowerCase("nb");

export const newId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const UNASSIGNED_ID = "unassigned";

export function stockUnits(stockItem) {
  if (Array.isArray(stockItem.items)) return stockItem.items;
  const count = Math.max(0, Math.ceil(Number(stockItem.quantity) || 0));
  return Array.from({ length: count }, (_, index) => ({
    id: `${stockItem.id || "unit"}-${index}`,
    state: stockItem.state || "full",
  }));
}
export function activeUnitCount(units) {
  return units.reduce((total, unit) =>
    total + (unit.state === "empty" ? 0 : Number(unit.amount) || 1), 0);
}

export function sortedFreezers(freezers) {
  return [...freezers].sort((a, b) =>
    (Number(a.position) || 0) - (Number(b.position) || 0) ||
    a.name.localeCompare(b.name, "nb", { sensitivity: "base" })
  );
}

export function locationOptions(freezers) {
  return sortedFreezers(freezers).flatMap((freezer) =>
    (freezer.compartments || []).map((compartment) => ({
      freezerId: freezer.id,
      compartmentId: compartment.id,
      freezerName: freezer.name,
      compartmentName: compartment.name,
      label: `${freezer.name} · ${compartment.name}`,
      key: `${freezer.id}/${compartment.id}`,
    }))
  );
}

export function buildFreezerEntries(stockItems, freezers) {
  const locations = new Map(locationOptions(freezers).map((location) => [location.key, location]));
  const entries = new Map();

  for (const stockItem of stockItems) {
    for (const unit of stockUnits(stockItem)) {
      if (unit.state === "empty" || (!stockItem.freezer && !unit.freezerId)) continue;
      const location = locations.get(`${unit.freezerId}/${unit.compartmentId}`);
      const freezerId = location?.freezerId || UNASSIGNED_ID;
      const compartmentId = location?.compartmentId || UNASSIGNED_ID;
      const key = `${stockItem.id}/${freezerId}/${compartmentId}`;
      if (!entries.has(key)) {
        entries.set(key, {
          key,
          stockItem,
          freezerId,
          compartmentId,
          locationLabel: location?.label || "Unassigned freezer items",
          units: [],
        });
      }
      entries.get(key).units.push(unit);
    }
  }

  return [...entries.values()].map((entry) => {
    const dates = [...new Set(entry.units.map((unit) => unit.frozenAt).filter(Boolean))];
    const labels = [...new Set(entry.units.map((unit) => unit.unitLabel || "item"))];
    return {
      ...entry,
      count: activeUnitCount(entry.units),
      unitLabel: labels.length === 1 ? labels[0] : "item",
      openedCount: activeUnitCount(entry.units.filter((unit) => unit.state === "opened")),
      unitIds: entry.units.map((unit) => unit.id),
      frozenAt: dates.length === 1 && entry.units.every((unit) => unit.frozenAt) ? dates[0] : "",
      mixedDates: dates.length > 1 || (dates.length === 1 && entry.units.some((unit) => !unit.frozenAt)),
    };
  });
}

export function filterFreezerEntries(entries, { search = "", freezerId = "all", compartmentId = "all" } = {}) {
  const term = normalize(search);
  return entries.filter((entry) =>
    (!term || normalize(entry.stockItem.name).includes(term)) &&
    (freezerId === "all" || entry.freezerId === freezerId) &&
    (compartmentId === "all" || entry.compartmentId === compartmentId)
  );
}

export function makeFrozenUnits(count, location, frozenAt = "", { state = "full", unitLabel = "item" } = {}) {
  const quantity = Number(count);
  if (!Number.isFinite(quantity) || quantity < 0.01 || quantity > 99 ||
      Math.abs(quantity * 100 - Math.round(quantity * 100)) > 0.000001) {
    throw new Error("Quantity must be between 0.01 and 99.");
  }
  const amounts = Array.from({ length: Math.floor(quantity) }, () => 1);
  const fraction = Math.round((quantity - Math.floor(quantity)) * 100) / 100;
  if (fraction) amounts.push(fraction);
  return amounts.map((amount) => ({
    id: newId(),
    state,
    ...(amount !== 1 ? { amount } : {}),
    unitLabel,
    addedAt: Date.now(),
    freezerId: location.freezerId,
    compartmentId: location.compartmentId,
    ...(frozenAt ? { frozenAt } : {}),
  }));
}
