import test from "node:test";
import assert from "node:assert/strict";
import { buildFreezerEntries, locationOptions } from "../src/freezer/freezerModel.js";
import {
  interpretInventoryText,
  prepareInventoryOperations,
  validateInventoryOperation,
} from "../src/freezer/inventoryInterpretation.js";
import { applyOperationToUnits } from "../src/freezer/inventoryChanges.js";
import { startBrowserTranscription } from "../src/freezer/browserTranscription.js";
import { buildFridgeEntries } from "../src/inventory/stockModel.js";

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

test("unrecognized text remains an editable food suggestion without an action or quantity", () => {
  const parsed = interpretInventoryText("Test");
  const [operation] = prepareInventoryOperations(parsed.proposals, context);
  assert.equal(operation.name, "Test");
  assert.equal(operation.kind, "unknown");
  assert.equal(operation.quantity, null);
  assert.ok(operation.issues.some((issue) => issue.includes("action")));
  assert.ok(operation.issues.some((issue) => issue.includes("quantity")));
  assert.ok(validateInventoryOperation(operation, locations).length > 0);
});

test("recognized speech reaches the same food interpretation as typed text", () => {
  const previousWindow = globalThis.window;
  let recognition;
  class FakeRecognition {
    start() { recognition = this; }
    stop() {}
    abort() {}
  }
  globalThis.window = { SpeechRecognition: FakeRecognition };
  try {
    let proposal;
    startBrowserTranscription({
      onTranscript: (text) => { [proposal] = interpretInventoryText(text).proposals; },
      onError: () => assert.fail("Speech should be recognized"),
      onEnd: () => {},
    });
    assert.equal(recognition.lang, "nb-NO");
    recognition.onresult({ results: [[{ transcript: "Legg til to pakker bacon" }]] });
    assert.equal(proposal.name, "Bacon");
    assert.equal(proposal.quantity, 2);
    assert.equal(proposal.kind, "add");
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
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

test("Norwegian weights stay separate from food and quantity", () => {
  const cases = [
    ["Legg til én kylling på 2 kilo", "Chicken", 1, 2000, "total"],
    ["Legg til en kylling 2000 gram", "Chicken", 1, 2000, "total"],
    ["Legg til 400 gram kjøttdeig", "Kjøttdeig", 1, 400, "total"],
    ["Legg til to pakker bacon på 150 gram hver", "Bacon", 2, 150, "per_unit"],
    ["Legg til en halv kilo scampi", "Scampi", 1, 500, "total"],
    ["Legg til halvannen kilo kylling", "Chicken", 1, 1500, "total"],
    ["Legg til kylling på 1,5 kilo", "Chicken", 1, 1500, "total"],
    ["Legg til to pakker bacon på 600 gram til sammen", "Bacon", 2, 600, "total"],
  ];
  for (const [speech, name, quantity, weightGrams, weightScope] of cases) {
    const [proposal] = interpretInventoryText(speech).proposals;
    assert.equal(proposal.name, name, speech);
    assert.equal(proposal.quantity, quantity, speech);
    assert.equal(proposal.weightGrams, weightGrams, speech);
    assert.equal(proposal.weightScope, weightScope, speech);
  }
});

test("weight without a per-unit or total cue stays unresolved for multiple items", () => {
  const [proposal] = interpretInventoryText("Legg til to pakker bacon på 300 gram").proposals;
  const [operation] = prepareInventoryOperations([proposal], context);
  assert.ok(operation.issues.some((issue) => issue.includes("total or per item")));
});

test("fridge phrases resolve location without putting it in the food name", () => {
  const withFridge = [{ key: "fridge", kind: "fridge", label: "Fridge" }, ...locations];
  const proposals = interpretInventoryText("Legg til to pakker kjøttdeig og tre paprika i kjøleskapet").proposals;
  assert.deepEqual(proposals.map((proposal) => proposal.name), ["Kjøttdeig", "Paprika"]);
  const fridgeAdds = prepareInventoryOperations(proposals, { ...context, locations: withFridge });
  assert.deepEqual(fridgeAdds.map((operation) => operation.sourceLocationKey), ["fridge", "fridge"]);
  const [move] = prepareInventoryOperations(
    interpretInventoryText("Flytt kyllingen fra fryseren til kjøleskapet").proposals,
    { ...context, locations: withFridge }
  );
  assert.equal(move.targetLocationKey, "fridge");
  assert.equal(move.sourceLocationKey, source.key);
  const fridgeProducts = [{ id: "milk", name: "Melk", freezer: false, items: [{ id: "m1", state: "full" }] }];
  const [used] = prepareInventoryOperations(
    interpretInventoryText("Vi har brukt opp melken").proposals,
    { entries: buildFridgeEntries(fridgeProducts), stockItems: fridgeProducts, locations: withFridge, sourceLocationKey: "fridge" }
  );
  assert.equal(used.kind, "remove");
  assert.equal(used.quantity, 1);
  assert.equal(used.issues.length, 0);
});

test("opened and used-up fridge phrases produce reviewed changes", () => {
  const fridge = { key: "fridge", kind: "fridge", label: "Fridge" };
  const product = { id: "ham", name: "Skinke", freezer: false, items: [
    { id: "h1", state: "full", storageKind: "fridge" },
    { id: "h2", state: "full", storageKind: "fridge" },
  ] };
  const fridgeContext = {
    entries: buildFridgeEntries([product]), stockItems: [product],
    locations: [fridge, ...locations], sourceLocationKey: "fridge",
  };
  const [opened] = prepareInventoryOperations(interpretInventoryText("Åpnet en pakke skinke").proposals, fridgeContext);
  assert.equal(opened.kind, "open");
  assert.equal(opened.quantity, 1);
  assert.equal(opened.issues.length, 0);
  const updated = applyOperationToUnits(product.items, opened, fridge);
  assert.equal(updated.filter((unit) => unit.state === "opened").length, 1);

  const usedContext = { ...fridgeContext, entries: buildFridgeEntries([{ ...product, items: updated }]) };
  const [used] = prepareInventoryOperations(interpretInventoryText("Vi har brukt opp skinke").proposals, usedContext);
  assert.equal(used.quantity, 2);
  assert.equal(used.issues.length, 0);
  assert.ok(applyOperationToUnits(updated, used, fridge).every((unit) => unit.state === "empty"));
});
