import test from "node:test";
import assert from "node:assert/strict";
import { applyOperationToUnits, unitInLocation } from "../src/freezer/inventoryChanges.js";
import { buildFreezerEntries, locationOptions } from "../src/freezer/freezerModel.js";
import { buildFridgeEntries, makeStockUnits, materializeLegacyLocations, weightSummary } from "../src/inventory/stockModel.js";
import { interpretInventoryText, prepareInventoryOperations } from "../src/freezer/inventoryInterpretation.js";

const freezer = { id: "f1", name: "Kitchen freezer", compartments: [{ id: "top", name: "Top" }] };
const frozen = locationOptions([freezer])[0];
const fridge = { key: "fridge", kind: "fridge", label: "Fridge" };
const locations = [fridge, frozen];

test("whole-unit transfer keeps weight, expiry, state, and identity", () => {
  const [unit] = makeStockUnits(1, frozen, { weightGrams: 2000, opened: true, expiresAt: 1795000000000 });
  const [moved] = applyOperationToUnits([unit], { kind: "move", name: "Chicken", quantity: 1 }, frozen, fridge);
  assert.equal(moved.id, unit.id);
  assert.equal(moved.weightGrams, 2000);
  assert.equal(moved.expiresAt, unit.expiresAt);
  assert.equal(moved.state, "opened");
  assert.equal(moved.storageKind, "fridge");
  assert.equal(moved.freezerId, undefined);
  const product = { id: "chicken", name: "Chicken", freezer: true, items: [moved] };
  assert.equal(buildFreezerEntries([product], [freezer]).length, 0);
  assert.equal(buildFridgeEntries([product])[0].knownGrams, 2000);
});

test("a partial weighed-batch transfer requires explicit unknown-weight acceptance", () => {
  const [batch] = makeStockUnits(2, fridge, { weightGrams: 600, weightScope: "total", unitLabel: "package" });
  const product = { id: "bacon", name: "Bacon", freezer: false, items: [batch] };
  const proposal = { ...interpretInventoryText("Flytt en pakke bacon til kitchen freezer").proposals[0],
    stockItemId: "bacon", sourceLocationKey: "fridge", targetLocationKey: frozen.key };
  const context = { entries: buildFridgeEntries([product]), stockItems: [product], locations, sourceLocationKey: "fridge" };
  const [blocked] = prepareInventoryOperations([proposal], context);
  assert.ok(blocked.issues.some((issue) => issue.includes("weighed batch")));
  assert.throws(() => applyOperationToUnits([batch], blocked, fridge, frozen), /unknown weight/i);
  const [approved] = prepareInventoryOperations([{ ...proposal, allowUnknownWeight: true }], context);
  assert.equal(approved.issues.length, 0);
  const split = applyOperationToUnits([batch], approved, fridge, frozen);
  assert.equal(split.length, 2);
  assert.equal(split.filter((unit) => unitInLocation(unit, fridge)).length, 1);
  assert.equal(split.filter((unit) => unitInLocation(unit, frozen)).length, 1);
  assert.deepEqual(weightSummary(split), { knownGrams: 0, hasUnknown: true });
});

test("partial consumption of a weighed batch never leaves a misleading weight", () => {
  const [batch] = makeStockUnits(2, frozen, { weightGrams: 2000, weightScope: "total" });
  assert.throws(() => applyOperationToUnits([batch], { kind: "remove", name: "Chicken", quantity: 1 }, frozen), /unknown weight/i);
  const [remaining] = applyOperationToUnits([batch], { kind: "remove", name: "Chicken", quantity: 1, allowUnknownWeight: true }, frozen);
  assert.equal(remaining.amount, 1);
  assert.equal(remaining.weightGrams, undefined);
  assert.equal(remaining.state, "opened");
});

test("opened-only discard leaves unopened packages available", () => {
  const [opened] = makeStockUnits(1, fridge, { opened: true, unitLabel: "package" });
  const [full] = makeStockUnits(1, fridge, { unitLabel: "package" });
  const product = { id: "ham", name: "Skinke", freezer: false, items: [opened, full] };
  const proposal = { ...interpretInventoryText("Kast den åpne pakken med skinke").proposals[0], stockItemId: "ham" };
  const [operation] = prepareInventoryOperations([proposal], {
    entries: buildFridgeEntries([product]), stockItems: [product], locations, sourceLocationKey: "fridge",
  });
  assert.equal(operation.issues.length, 0);
  const changed = applyOperationToUnits(product.items, operation, fridge);
  assert.equal(changed.find((unit) => unit.id === opened.id).state, "empty");
  assert.equal(changed.find((unit) => unit.id === full.id).state, "full");
});

test("remaining weight edits one batch and keeps quantity", () => {
  const [batch] = makeStockUnits(1, fridge, { weightGrams: 400 });
  const product = { id: "mince", name: "Kjøttdeig", freezer: false, items: [batch] };
  const [operation] = prepareInventoryOperations(
    interpretInventoryText("Det ligger cirka 300 gram kjøttdeig igjen").proposals,
    { entries: buildFridgeEntries([product]), stockItems: [product], locations, sourceLocationKey: "fridge" }
  );
  assert.equal(operation.kind, "set_weight");
  assert.equal(operation.weightGrams, 300);
  assert.equal(operation.issues.length, 0);
  const [updated] = applyOperationToUnits([batch], operation, fridge);
  assert.equal(updated.weightGrams, 300);
  assert.equal(updated.amount, undefined);
});

test("review and update use the same earliest-expiry batch order", () => {
  const [later] = makeStockUnits(2, fridge, { weightGrams: 600, weightScope: "total", expiresAt: 1800000000000 });
  const [earlier] = makeStockUnits(1, fridge, { expiresAt: 1790000000000 });
  const product = { id: "ham", name: "Skinke", freezer: false, items: [later, earlier] };
  const [operation] = prepareInventoryOperations([{
    kind: "remove", name: "Skinke", quantity: 1, unitLabel: "item", opened: false,
    stockItemId: "ham", sourceLocationKey: "fridge",
  }], { entries: buildFridgeEntries([product]), stockItems: [product], locations, sourceLocationKey: "fridge" });
  assert.equal(operation.issues.length, 0);
  const changed = applyOperationToUnits(product.items, operation, fridge);
  assert.equal(changed.find((unit) => unit.id === earlier.id).state, "empty");
  assert.equal(changed.find((unit) => unit.id === later.id).weightGrams, 600);
});

test("legacy nonfrozen units stay unassigned beside newly frozen units of the same product", () => {
  const oldProduct = { id: "lasagne", name: "Lasagne", freezer: false, items: [{ id: "old", state: "full" }] };
  const units = materializeLegacyLocations(oldProduct).concat(makeStockUnits(1, frozen));
  const product = { ...oldProduct, freezer: true, items: units };
  assert.equal(buildFridgeEntries([product])[0].hasUnassigned, true);
  assert.equal(buildFreezerEntries([product], [freezer])[0].count, 1);
});
