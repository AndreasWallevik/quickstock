import test from "node:test";
import assert from "node:assert/strict";
import {
  activeUnitCount,
  buildFreezerEntries,
  filterFreezerEntries,
  locationOptions,
  makeFrozenUnits,
  UNASSIGNED_ID,
} from "../src/freezer/freezerModel.js";

const freezers = [
  { id: "garage", name: "Garage", position: 1, compartments: [{ id: "top", name: "Top" }] },
  { id: "kitchen", name: "Kitchen", position: 0, compartments: [{ id: "drawer", name: "Drawer" }] },
];

test("legacy frozen stock stays visible as unassigned and non-frozen stock stays out", () => {
  const entries = buildFreezerEntries([
    { id: "a", name: "Peas", freezer: true, quantity: 2 },
    { id: "b", name: "Milk", freezer: false, quantity: 1 },
  ], freezers);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].count, 2);
  assert.equal(entries[0].freezerId, UNASSIGNED_ID);
});

test("units in multiple compartments remain separate and can be filtered", () => {
  const entries = buildFreezerEntries([{
    id: "chicken", name: "Chicken", freezer: true, items: [
      { id: "1", state: "full", freezerId: "kitchen", compartmentId: "drawer", frozenAt: "2026-11-01" },
      { id: "2", state: "full", freezerId: "garage", compartmentId: "top" },
      { id: "3", state: "empty", freezerId: "garage", compartmentId: "top" },
    ],
  }], freezers);
  assert.equal(entries.length, 2);
  assert.equal(entries.reduce((sum, entry) => sum + entry.count, 0), 2);
  const kitchen = filterFreezerEntries(entries, { search: "chick", freezerId: "kitchen", compartmentId: "drawer" });
  assert.equal(kitchen.length, 1);
  assert.equal(kitchen[0].frozenAt, "2026-11-01");
  assert.equal(locationOptions(freezers)[0].label, "Kitchen · Drawer");
});

test("a missing location leaves food visible for reassignment", () => {
  const entries = buildFreezerEntries([{
    id: "fish", name: "Fish", freezer: true, items: [
      { id: "1", state: "full", freezerId: "removed", compartmentId: "drawer", frozenAt: "2026-10-01" },
    ],
  }], freezers);
  assert.equal(entries[0].freezerId, UNASSIGNED_ID);
  assert.equal(entries[0].count, 1);
});

test("new frozen units have location and optional date without a fresh-food expiry", () => {
  const units = makeFrozenUnits(2, { freezerId: "garage", compartmentId: "top" }, "2026-11-11");
  assert.equal(units.length, 2);
  assert.notEqual(units[0].id, units[1].id);
  assert.equal(units[0].frozenAt, "2026-11-11");
  assert.equal(units[0].expiresAt, undefined);
  assert.equal(activeUnitCount([...units, { id: "old", state: "empty" }]), 2);
});
