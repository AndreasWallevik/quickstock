import test from "node:test";
import assert from "node:assert/strict";
import {
  activeUnitCount, buildFridgeEntries, dateToExpiry, makeStockUnits, materializeLegacyLocations,
  storageKindForUnit, weightSummary,
} from "../src/inventory/stockModel.js";

const fridge = { key: "fridge", kind: "fridge", label: "Fridge" };

test("optional weight stays on individual units and does not change item count", () => {
  const units = makeStockUnits(2, fridge, { unitLabel: "package", weightGrams: 150, weightScope: "per_unit" });
  assert.equal(units.length, 2);
  assert.deepEqual(units.map((unit) => unit.weightGrams), [150, 150]);
  assert.equal(activeUnitCount(units), 2);
  assert.deepEqual(weightSummary(units), { knownGrams: 300, hasUnknown: false });
});

test("a known batch total is stored once without assuming equal unit weights", () => {
  const [batch] = makeStockUnits(2, fridge, { unitLabel: "package", weightGrams: 600, weightScope: "total" });
  assert.equal(batch.amount, 2);
  assert.equal(batch.weightGrams, 600);
  assert.equal(activeUnitCount([batch]), 2);
});

test("unequal unit weights stay separate and missing weight stays unknown", () => {
  const [first] = makeStockUnits(1, fridge, { weightGrams: 400 });
  const [second] = makeStockUnits(1, fridge, { weightGrams: 550 });
  const [unknown] = makeStockUnits(1, fridge);
  assert.deepEqual([first.weightGrams, second.weightGrams, unknown.weightGrams], [400, 550, undefined]);
  assert.deepEqual(weightSummary([first, second, unknown]), { knownGrams: 950, hasUnknown: true });
});

test("expiry is optional and invalid calendar dates are rejected", () => {
  assert.equal(makeStockUnits(1, fridge)[0].expiresAt, undefined);
  assert.ok(dateToExpiry("2026-11-16") > 0);
  assert.throws(() => dateToExpiry("2026-02-30"), /valid expiration date/);
});

test("legacy nonfrozen units remain visible but have no assigned fridge location", () => {
  const product = { id: "milk", name: "Milk", freezer: false, items: [{ id: "one", state: "full" }] };
  assert.equal(storageKindForUnit(product.items[0], product), "unassigned");
  assert.equal(buildFridgeEntries([product])[0].hasUnassigned, true);
  assert.equal(materializeLegacyLocations(product)[0].storageKind, "unassigned");
  assert.deepEqual(weightSummary(product.items), { knownGrams: 0, hasUnknown: true });
});
