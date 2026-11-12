import { newId } from "./freezerModel.js";

const NUMBER_WORDS = new Map([
  ["null", 0], ["en", 1], ["ei", 1], ["ett", 1], ["én", 1], ["éin", 1],
  ["to", 2], ["tre", 3], ["fire", 4], ["fem", 5], ["seks", 6],
  ["sju", 7], ["syv", 7], ["åtte", 8], ["ni", 9], ["ti", 10],
  ["halv", 0.5], ["halvt", 0.5], ["en halv", 0.5], ["ei halv", 0.5], ["ett halvt", 0.5],
]);
const NUMBER_PATTERN = /^(en halv|ei halv|ett halvt|halvt|halv|null|én|éin|en|ei|ett|to|tre|fire|fem|seks|sju|syv|åtte|ni|ti|\d+(?:[.,]\d+)?)\b\s*/i;
const PACKAGE_PATTERN = /^(pakker?|pk|stk|stykker?|porsjoner?)\b\s*/i;
const ALIASES = new Map([
  ["tacolefse", "Tortillas"], ["tacolefser", "Tortillas"], ["tortilla", "Tortillas"], ["tortillas", "Tortillas"],
  ["laksefilet", "Salmon fillet"], ["laksefileter", "Salmon fillet"], ["salmon fillet", "Salmon fillet"],
  ["laks", "Salmon"], ["laksen", "Salmon"], ["salmon", "Salmon"],
  ["baguette", "Baguette"], ["baguetten", "Baguette"],
  ["kylling", "Chicken"], ["kyllingen", "Chicken"], ["chicken", "Chicken"],
  ["bacon", "Bacon"],
]);

export const OPERATION_KINDS = ["add", "remove", "move", "set_quantity"];

export function nameKey(value = "") {
  return value.trim().toLocaleLowerCase("nb").normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[.!?]+$/, "").replace(/\s+/g, " ");
}

export function canonicalName(value = "") {
  const cleaned = value.trim().replace(/[.!?]+$/, "");
  return ALIASES.get(nameKey(cleaned)) || cleaned.replace(/^./, (letter) => letter.toLocaleUpperCase("nb"));
}

function readQuantity(text) {
  const match = text.match(NUMBER_PATTERN);
  if (!match) return { quantity: null, rest: text };
  const token = match[1].toLocaleLowerCase("nb");
  return {
    quantity: NUMBER_WORDS.has(token) ? NUMBER_WORDS.get(token) : Number(token.replace(",", ".")),
    rest: text.slice(match[0].length).trim(),
  };
}

function parseItemPhrase(phrase, kind) {
  const sourcePhrase = phrase.trim();
  const opened = /(?:^|\s)(?:åpnet|opnet|opened)(?=\s|$)/i.test(sourcePhrase);
  let text = sourcePhrase.replace(/(?:^|\s)(?:åpnet|opnet|opened)(?=\s|$)/gi, " ").replace(/\s+/g, " ").trim();
  const { quantity, rest } = readQuantity(text);
  text = rest;
  const packageMatch = text.match(PACKAGE_PATTERN);
  const unitLabel = packageMatch && /pakke|pk/i.test(packageMatch[0]) ? "package" : "item";
  if (packageMatch) text = text.slice(packageMatch[0].length).trim();
  return {
    id: newId(), kind, name: canonicalName(text), quantity, unitLabel,
    opened, stockItemId: "", targetLocationKey: "", targetText: "", sourcePhrase,
  };
}

function splitItems(text) {
  return text.split(/\s*,\s*|\s+og\s+|\s*;\s*/i).map((part) => part.trim()).filter(Boolean);
}

function mergeRepeatedAdds(proposals) {
  const merged = [];
  for (const proposal of proposals) {
    const existing = merged.find((item) =>
      item.kind === "add" && proposal.kind === "add" && item.quantity !== null && proposal.quantity !== null &&
      nameKey(item.name) === nameKey(proposal.name) && item.opened === proposal.opened && item.unitLabel === proposal.unitLabel
    );
    if (existing) {
      existing.quantity += proposal.quantity;
      existing.sourcePhrase += `; ${proposal.sourcePhrase}`;
    } else {
      merged.push(proposal);
    }
  }
  return merged;
}

export function interpretInventoryText(transcript) {
  const text = transcript.trim().replace(/[.!?]+$/, "");
  if (!text) return { spokenLocation: "", proposals: [] };
  const colon = text.indexOf(":");
  const spokenLocation = colon > 0 && colon < 60 ? text.slice(0, colon).trim() : "";
  const command = spokenLocation ? text.slice(colon + 1).trim() : text;
  let match = command.match(/^(?:flytt|flyttet|move)\s+(.+?)\s+til\s+(.+)$/i);
  if (match) {
    const proposal = parseItemPhrase(match[1], "move");
    proposal.targetText = match[2].trim();
    return { spokenLocation, proposals: [proposal] };
  }
  match = command.match(/^(?:det er\s+)?(?:bare\s+)?(.+?)\s+igjen$/i);
  if (match) return { spokenLocation, proposals: [parseItemPhrase(match[1], "set_quantity")] };
  match = command.match(/^(?:vi\s+)?(?:brukte|har brukt|fjern|fjernet|tok ut|ta ut|remove|use)\s+(.+)$/i);
  if (match) return { spokenLocation, proposals: splitItems(match[1]).map((part) => parseItemPhrase(part, "remove")) };
  match = command.match(/^(?:legg til|la til|frys ned|add|put|freeze)\s+(.+)$/i);
  if (match) return { spokenLocation, proposals: mergeRepeatedAdds(splitItems(match[1]).map((part) => parseItemPhrase(part, "add"))) };
  match = command.match(/^(?:jeg har|vi har|det ligger)\s+(.+)$/i);
  if (match) return { spokenLocation, proposals: mergeRepeatedAdds(splitItems(match[1]).map((part) => parseItemPhrase(part, "add"))) };
  if (spokenLocation) return { spokenLocation, proposals: mergeRepeatedAdds(splitItems(command).map((part) => parseItemPhrase(part, "add"))) };
  if (readQuantity(command).quantity !== null) return { spokenLocation, proposals: mergeRepeatedAdds(splitItems(command).map((part) => parseItemPhrase(part, "add"))) };
  return { spokenLocation, proposals: [{
    id: newId(), kind: "unknown", name: "", quantity: null, unitLabel: "item", opened: false,
    stockItemId: "", targetLocationKey: "", targetText: "", sourcePhrase: command,
  }] };
}

function findTargetLocation(targetText, locations) {
  if (!targetText) return "";
  const freezerKey = (value) => nameKey(value).replace(/^(?:til|i)\s+/, "")
    .replace(/\s*fryser(?:en)?$/, "").replace(/en$/, "").trim();
  const target = freezerKey(targetText);
  const matchingFreezers = [...new Set(locations.filter((location) => {
    return freezerKey(location.freezerName) === target;
  }).map((location) => location.freezerId))];
  if (matchingFreezers.length !== 1) return "";
  const compartments = locations.filter((location) => location.freezerId === matchingFreezers[0]);
  return compartments.length === 1 ? compartments[0].key : "";
}

function uniqueProducts(products) {
  return [...new Map(products.map((product) => [product.id, product])).values()];
}

export function prepareInventoryOperations(proposals, { entries, stockItems, locations, sourceLocationKey }) {
  const sourceLocation = locations.find((location) => location.key === sourceLocationKey);
  return proposals.map((proposal) => {
    const issues = [];
    const kind = proposal.kind;
    const name = canonicalName(proposal.name || "");
    const quantity = proposal.quantity === "" || proposal.quantity === null || proposal.quantity === undefined
      ? null : Number(proposal.quantity);
    if (!OPERATION_KINDS.includes(kind)) issues.push("Choose an action.");
    if (!sourceLocation) issues.push("Choose a freezer compartment.");
    if (quantity === null || !Number.isFinite(quantity) || quantity < 0 || quantity > 99 ||
        Math.abs(quantity * 100 - Math.round(quantity * 100)) > 0.000001 ||
        (kind !== "set_quantity" && quantity === 0)) {
      issues.push("Enter a clear quantity between 0 and 99.");
    }
    if (!name) issues.push("Choose or enter the food item.");

    const sourceEntries = entries.filter((entry) =>
      `${entry.freezerId}/${entry.compartmentId}` === sourceLocationKey
    );
    const candidates = kind === "add"
      ? uniqueProducts(stockItems.filter((item) => item.freezer && nameKey(canonicalName(item.name)) === nameKey(name)))
      : uniqueProducts(sourceEntries.filter((entry) => nameKey(canonicalName(entry.stockItem.name)) === nameKey(name))
        .map((entry) => entry.stockItem));
    const explicit = proposal.stockItemId
      ? (kind === "add" ? stockItems.filter((item) => item.freezer) : sourceEntries.map((entry) => entry.stockItem))
        .find((item) => item.id === proposal.stockItemId)
      : null;
    let stockItemId = explicit?.id || "";
    if (proposal.stockItemId && !explicit) issues.push("Selected stock item is no longer available here.");
    if (!stockItemId && candidates.length === 1) stockItemId = candidates[0].id;
    if (!stockItemId && candidates.length > 1) issues.push("Several stock items match. Choose the correct one.");
    if (kind !== "add" && !stockItemId && name) issues.push("Choose an existing item in this compartment.");

    const matchingEntry = sourceEntries.find((entry) => entry.stockItem.id === stockItemId);
    if ((kind === "remove" || kind === "move") && matchingEntry && quantity !== null && quantity > matchingEntry.count) {
      issues.push(`Only ${matchingEntry.count} is available here.`);
    }
    const targetLocationKey = proposal.targetLocationKey || findTargetLocation(proposal.targetText, locations);
    if (kind === "move") {
      if (!targetLocationKey || !locations.some((location) => location.key === targetLocationKey)) issues.push("Choose the destination compartment.");
      else if (targetLocationKey === sourceLocationKey) issues.push("Choose a different destination.");
    }
    return {
      ...proposal, kind, name, quantity, stockItemId, sourceLocationKey, targetLocationKey,
      unitLabel: proposal.unitLabel === "package" ? "package" : "item", opened: Boolean(proposal.opened), issues,
    };
  });
}

export function validateInventoryOperation(operation, locations) {
  const issues = [];
  if (!OPERATION_KINDS.includes(operation.kind)) issues.push("Invalid action.");
  if (typeof operation.name !== "string" || !operation.name.trim() || operation.name.length > 120) issues.push("Invalid item name.");
  if (operation.stockItemId && typeof operation.stockItemId !== "string") issues.push("Invalid stock item.");
  if (!["item", "package"].includes(operation.unitLabel)) issues.push("Invalid unit type.");
  if (typeof operation.opened !== "boolean") issues.push("Invalid opened state.");
  if (!Number.isFinite(operation.quantity) || operation.quantity < 0 || operation.quantity > 99 ||
      Math.abs(operation.quantity * 100 - Math.round(operation.quantity * 100)) > 0.000001 ||
      (operation.kind !== "set_quantity" && operation.quantity === 0)) issues.push("Invalid quantity.");
  if (!locations.some((location) => location.key === operation.sourceLocationKey)) issues.push("Invalid source compartment.");
  if (operation.kind !== "add" && !operation.stockItemId) issues.push("An existing item is required.");
  if (operation.kind === "move" && (!locations.some((location) => location.key === operation.targetLocationKey) ||
      operation.targetLocationKey === operation.sourceLocationKey)) issues.push("Invalid destination compartment.");
  return issues;
}
