import test from "node:test";
import assert from "node:assert/strict";
import { formatInventoryExport } from "../src/inventory/inventoryExport.js";
import { copyText } from "../src/inventory/clipboard.js";

const freezers = [{ id: "kitchen", name: "Kitchen freezer", compartments: [{ id: "top", name: "Top drawer" }] }];
const frozen = { storageKind: "freezer", freezerId: "kitchen", compartmentId: "top" };
const stock = [
  { id: "chicken", name: "Chicken breast", category: "protein", items: [
    { id: "c1", state: "full", weightGrams: 2000, ...frozen },
    { id: "c2", state: "empty", weightGrams: 500, ...frozen },
  ] },
  { id: "bacon", name: "Bacon", items: [
    { id: "b1", state: "opened", unitLabel: "package", amount: 2, ...frozen },
  ] },
  { id: "milk", name: "Milk", category: "dairy", items: [
    { id: "m1", state: "full", unitLabel: "package", storageKind: "fridge" },
    { id: "m2", state: "opened", unitLabel: "package", storageKind: "fridge" },
  ] },
  { id: "unknown", name: "Mystery pouch", items: [{ id: "u1", state: "full", storageKind: "fridge" }] },
];

test("combined export groups active food, quantities, weights, states and freezer compartments", () => {
  const text = formatInventoryExport(stock, freezers, "both", "en");
  assert.match(text, /^🧊 FREEZER/);
  assert.match(text, /🥩 Meat & poultry/);
  assert.match(text, /Chicken breast – 1 item, 2 kg \(unopened; Kitchen freezer · Top drawer\)/);
  assert.match(text, /Bacon – 2 packs \(opened; Kitchen freezer · Top drawer\)/);
  assert.match(text, /---\n\n🥛 FRIDGE/);
  assert.match(text, /🥛 Dairy & eggs/);
  assert.match(text, /Milk – 1 pack \(opened\)/);
  assert.match(text, /Milk – 1 pack \(unopened\)/);
  assert.match(text, /📦 Other\n- Mystery pouch/);
  assert.doesNotMatch(text, /2\.5 kg|500 g/);
});

test("scope exports only the chosen location and retains legacy unassigned stock", () => {
  const legacy = [
    { id: "old-frozen", name: "Scampi", freezer: true, items: [{ id: "s1", state: "opened", weightGrams: 500 }] },
    { id: "old-fridge", name: "Lasagne", freezer: false, labels: ["Leftover"], items: [{ id: "l1", state: "full", amount: 2, unitLabel: "portion" }] },
  ];
  const freezerText = formatInventoryExport(legacy, freezers, "freezer", "en");
  assert.match(freezerText, /Scampi – 1 item, 500 g \(opened; Unassigned freezer\)/);
  assert.doesNotMatch(freezerText, /Lasagne|FRIDGE/);
  const fridgeText = formatInventoryExport(legacy, freezers, "fridge", "en");
  assert.match(fridgeText, /🍲 Leftovers/);
  assert.match(fridgeText, /Lasagne – 2 portions \(unopened; location not set\)/);
  assert.doesNotMatch(fridgeText, /Scampi|FREEZER/);
});

test("Norwegian export uses localized headings and decimal weight without inventing missing weight", () => {
  const products = [{ id: "k", name: "Kylling", items: [
    { id: "k1", state: "full", weightGrams: 1500, ...frozen },
    { id: "k2", state: "full", ...frozen },
  ] }];
  const text = formatInventoryExport(products, freezers, "freezer", "nb-NO");
  assert.match(text, /^🧊 FRYSER/);
  assert.match(text, /Kylling – 2 stk, 1,5 kg kjent vekt \(uåpnet;/);
  assert.doesNotMatch(text, /0 g/);
});

test("clipboard uses the modern API, then a selectable textarea fallback", async () => {
  let written = "";
  assert.equal(await copyText("inventory", { clipboard: { writeText: async (text) => { written = text; } } }), true);
  assert.equal(written, "inventory");

  let copied = false;
  let removed = false;
  const field = { value: "", style: {}, setAttribute() {}, focus() {}, select() {}, setSelectionRange() {} };
  const documentObject = {
    body: { appendChild() {}, removeChild() { removed = true; } },
    createElement() { return field; },
    execCommand(command) { copied = command === "copy"; return copied; },
  };
  assert.equal(await copyText("fallback", { clipboard: { writeText: async () => { throw new Error("Denied"); } } }, documentObject), true);
  assert.equal(field.value, "fallback");
  assert.equal(copied, true);
  assert.equal(removed, true);
  assert.equal(await copyText("manual", {}, {}), false);
});
