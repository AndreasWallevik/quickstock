import test from "node:test";
import assert from "node:assert/strict";
import { buildFreezerEntries, locationOptions } from "../src/freezer/freezerModel.js";
import {
  interpretInventoryText,
  prepareInventoryOperations,
  validateInventoryOperation,
} from "../src/freezer/inventoryInterpretation.js";
import { applyOperationToUnits } from "../src/freezer/inventoryChanges.js";

const freezers = [
  { id: "kitchen", name: "Kjøkkenfryser", position: 0, compartments: [{ id: "top", name: "Øverste skuff" }] },
  { id: "basement", name: "Kjellerfryser", position: 1, compartments: [{ id: "main", name: "Hovedrom" }] },
];
const locations = locationOptions(freezers);
const source = locations[0];
const target = locations[1];
const stockItems = [
  { id: "bacon", name: "Bacon", freezer: true, items: [{ id: "b1", state: "full", freezerId: "kitchen", compartmentId: "top" }] },
  { id: "salmon", name: "Laks", freezer: true, items: [{ id: "s1", state: "full", freezerId: "kitchen", compartmentId: "top" }] },
  { id: "chicken", name: "Kylling", freezer: true, items: [{ id: "c1", state: "full", freezerId: "kitchen", compartmentId: "top" }] },
];
const context = { entries: buildFreezerEntries(stockItems, freezers), stockItems, locations, sourceLocationKey: source.key };

test("Norwegian compartment dictation yields four reviewed items, including opened and half", () => {
  const parsed = interpretInventoryText("Øverste skuff: to pakker bacon, en åpnet pakke tacolefser, en laksefilet og en halv baguette.");
  assert.equal(parsed.spokenLocation, "Øverste skuff");
  assert.deepEqual(parsed.proposals.map(({ name, quantity, opened }) => ({ name, quantity, opened })), [
    { name: "Bacon", quantity: 2, opened: false },
    { name: "Tortillas", quantity: 1, opened: true },
    { name: "Salmon fillet", quantity: 1, opened: false },
    { name: "Baguette", quantity: 0.5, opened: false },
  ]);
  const ready = prepareInventoryOperations(parsed.proposals, context);
  assert.ok(ready.every((operation) => operation.issues.length === 0));
  assert.equal(ready[0].stockItemId, "bacon");
  assert.equal(ready[3].sourceLocationKey, source.key);
});

test("repeated additions merge and reuse an existing product", () => {
  const parsed = interpretInventoryText("Legg til to pakker bacon og en pakke bacon.");
  assert.equal(parsed.proposals.length, 1);
  assert.equal(parsed.proposals[0].quantity, 3);
  assert.equal(prepareInventoryOperations(parsed.proposals, context)[0].stockItemId, "bacon");
});

test("a natural item list without a command is proposed as additions", () => {
  const parsed = interpretInventoryText("To pakker bacon og en halv baguette");
  assert.deepEqual(parsed.proposals.map((item) => item.quantity), [2, 0.5]);
});

test("simple English add and remove text still enters the same review pipeline", () => {
  assert.equal(interpretInventoryText("Add 3 pizzas.").proposals[0].quantity, 3);
  assert.equal(interpretInventoryText("Remove 1 chicken.").proposals[0].kind, "remove");
});

test("used item without a quantity stays blocked until corrected", () => {
  const parsed = interpretInventoryText("Vi brukte laksen.");
  let [operation] = prepareInventoryOperations(parsed.proposals, context);
  assert.equal(operation.kind, "remove");
  assert.equal(operation.stockItemId, "salmon");
  assert.ok(operation.issues.some((issue) => issue.includes("quantity")));
  [operation] = prepareInventoryOperations([{ ...parsed.proposals[0], quantity: 1 }], context);
  assert.equal(operation.issues.length, 0);
  const result = applyOperationToUnits(stockItems[1].items, operation, source);
  assert.equal(result[0].state, "empty");
});

test("move requires quantity but resolves a single-compartment freezer", () => {
  const parsed = interpretInventoryText("Flytt kyllingen til kjellerfryseren.");
  let [operation] = prepareInventoryOperations(parsed.proposals, context);
  assert.equal(operation.kind, "move");
  assert.equal(operation.targetLocationKey, target.key);
  assert.ok(operation.issues.some((issue) => issue.includes("quantity")));
  [operation] = prepareInventoryOperations([{ ...parsed.proposals[0], quantity: 1 }], context);
  assert.equal(operation.issues.length, 0);
  const result = applyOperationToUnits(stockItems[2].items, operation, source, target);
  assert.equal(result[0].freezerId, "basement");
});

test("remaining count without an item stays blocked; zero remaining empties stock", () => {
  const parsed = interpretInventoryText("Det er bare én pakke igjen.");
  const [ambiguous] = prepareInventoryOperations(parsed.proposals, context);
  assert.equal(ambiguous.kind, "set_quantity");
  assert.ok(ambiguous.issues.some((issue) => issue.includes("item")));
  const [corrected] = prepareInventoryOperations([{ ...parsed.proposals[0], name: "Bacon", quantity: 0 }], context);
  assert.equal(corrected.issues.length, 0);
  assert.equal(applyOperationToUnits(stockItems[0].items, corrected, source)[0].state, "empty");
});

test("setting the remaining count removes only the difference", () => {
  const units = [
    { id: "one", state: "full", freezerId: "kitchen", compartmentId: "top" },
    { id: "two", state: "full", freezerId: "kitchen", compartmentId: "top" },
  ];
  const result = applyOperationToUnits(units, { kind: "set_quantity", name: "Bacon", quantity: 1 }, source);
  assert.equal(result.filter((unit) => unit.state !== "empty").length, 1);
});

test("multiple matching products require explicit choice", () => {
  const duplicates = [...stockItems, { id: "bacon-2", name: "Bacon", freezer: true, items: [{ id: "b2", state: "full", freezerId: "kitchen", compartmentId: "top" }] }];
  const duplicateContext = { ...context, stockItems: duplicates, entries: buildFreezerEntries(duplicates, freezers) };
  const [operation] = prepareInventoryOperations(interpretInventoryText("Fjern en pakke bacon.").proposals, duplicateContext);
  assert.ok(operation.issues.some((issue) => issue.includes("Several")));
});

test("incorrect transcript produces no executable action", () => {
  const parsed = interpretInventoryText("baken kanskje to");
  const [operation] = prepareInventoryOperations(parsed.proposals, context);
  assert.equal(operation.kind, "unknown");
  assert.ok(operation.issues.length > 0);
  assert.ok(validateInventoryOperation(operation, locations).length > 0);
});

test("vague quantity is never interpreted as one", () => {
  const [operation] = prepareInventoryOperations(interpretInventoryText("Legg til noen pakker bacon").proposals, context);
  assert.equal(operation.quantity, null);
  assert.ok(operation.issues.some((issue) => issue.includes("quantity")));
});

test("fractional removal and move preserve the rest of a portion", () => {
  const units = [{ id: "one", state: "full", freezerId: "kitchen", compartmentId: "top" }];
  const used = applyOperationToUnits(units, { kind: "remove", name: "Baguette", quantity: 0.5 }, source);
  assert.equal(used[0].amount, 0.5);
  assert.equal(used[0].state, "opened");
  const moved = applyOperationToUnits(units, { kind: "move", name: "Baguette", quantity: 0.5 }, source, target);
  assert.equal(moved.length, 2);
  assert.equal(moved[0].amount, 0.5);
  assert.equal(moved[1].amount, 0.5);
  assert.equal(moved[1].freezerId, "basement");
});
