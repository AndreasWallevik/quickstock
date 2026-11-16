import { activeUnitCount, makeStockUnits, newId, stockUnits, storageKindForUnit, weightSummary } from "../inventory/stockModel.js";

const normalize = (value = "") => value.trim().toLocaleLowerCase("nb");

export { activeUnitCount, newId, stockUnits };

export const UNASSIGNED_ID = "unassigned";

export function sortedFreezers(freezers) {
  return [...freezers].sort((a, b) =>
    (Number(a.position) || 0) - (Number(b.position) || 0) ||
    a.name.localeCompare(b.name, "nb", { sensitivity: "base" })
  );
}

export function locationOptions(freezers) {
  return sortedFreezers(freezers).flatMap((freezer) =>
    (freezer.compartments || []).map((compartment) => ({
      kind: "freezer",
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
      if (unit.state === "empty" || storageKindForUnit(unit, stockItem) !== "freezer") continue;
      const location = locations.get(`${unit.freezerId}/${unit.compartmentId}`);
      const freezerId = location?.freezerId || UNASSIGNED_ID;
      const compartmentId = location?.compartmentId || UNASSIGNED_ID;
      const key = `${stockItem.id}/${freezerId}/${compartmentId}`;
      if (!entries.has(key)) {
        entries.set(key, {
          key,
          locationKey: `${freezerId}/${compartmentId}`,
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
    const { knownGrams, hasUnknown } = weightSummary(entry.units);
    return {
      ...entry,
      knownGrams, hasUnknown,
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
  return makeStockUnits(count, { ...location, kind: "freezer" }, { opened: state === "opened", unitLabel, frozenAt });
}
