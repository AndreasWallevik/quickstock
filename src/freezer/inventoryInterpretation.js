import { newId } from "./freezerModel.js";
import { dateToExpiry } from "../inventory/stockModel.js";

const NUMBER_WORDS = new Map([
  ["null", 0], ["en", 1], ["ei", 1], ["ett", 1], ["én", 1], ["éin", 1],
  ["to", 2], ["tre", 3], ["fire", 4], ["fem", 5], ["seks", 6],
  ["sju", 7], ["syv", 7], ["åtte", 8], ["ni", 9], ["ti", 10],
  ["halv", 0.5], ["halvt", 0.5], ["en halv", 0.5], ["ei halv", 0.5], ["ett halvt", 0.5],
  ["halvannen", 1.5],
]);
const NUMBER_PATTERN = /^(halvannen|en halv|ei halv|ett halvt|halvt|halv|null|én|éin|en|ei|ett|to|tre|fire|fem|seks|sju|syv|åtte|ni|ti|\d+(?:[.,]\d+)?)\b\s*/i;
const PACKAGE_PATTERN = /^(pakke(?:n|r)?|pk|stk|stykker?|porsjoner?)\b\s*/i;
const WEIGHT_PATTERN = /(?:^|\s)(?:(?:på|cirka|ca\.?|omtrent)\s+)*(halvannen|et halvt|en halv|ei halv|\d+(?:[.,]\d+)?)\s*(kilogram|kilo|kg|gram|g)\b(?:\s*(hver|per\s+pakke|til\s+sammen|totalt))?/i;
const ALIASES = new Map([
  ["tacolefse", "Tortillas"], ["tacolefser", "Tortillas"], ["tortilla", "Tortillas"], ["tortillas", "Tortillas"],
  ["laksefilet", "Salmon fillet"], ["laksefileter", "Salmon fillet"], ["salmon fillet", "Salmon fillet"],
  ["laks", "Salmon"], ["laksen", "Salmon"], ["salmon", "Salmon"],
  ["baguette", "Baguette"], ["baguetten", "Baguette"],
  ["kylling", "Chicken"], ["kyllingen", "Chicken"], ["chicken", "Chicken"],
  ["bacon", "Bacon"],
  ["melken", "Melk"],
]);

export const OPERATION_KINDS = ["add", "remove", "move", "set_quantity", "set_weight", "open", "discard"];

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

function extractWeight(text) {
  const match = text.match(WEIGHT_PATTERN);
  if (!match) return { text, weightGrams: null, weightScope: "" };
  const token = match[1].toLocaleLowerCase("nb");
  const amount = token === "halvannen" ? 1.5 : ["et halvt", "en halv", "ei halv"].includes(token)
    ? 0.5 : Number(token.replace(",", "."));
  const grams = amount * (/^(?:kilo|kg)/i.test(match[2]) ? 1000 : 1);
  const marker = (match[3] || "").toLocaleLowerCase("nb");
  const weightScope = /hver|per/.test(marker) ? "per_unit" : /sammen|totalt/.test(marker) ? "total" : "unspecified";
  return {
    text: `${text.slice(0, match.index)} ${text.slice(match.index + match[0].length)}`.replace(/\s+/g, " ").trim(),
    weightGrams: grams,
    weightScope,
  };
}

function extractDate(text) {
  const match = text.match(/\s+(?:best\s+før|utløper|går\s+ut)\s+(\d{4}-\d{2}-\d{2}|\d{1,2}\.\d{1,2}\.\d{4})\b/i);
  if (!match) return { text, expiryDate: "" };
  const date = match[1].includes(".")
    ? match[1].split(".").reverse().map((part, index) => index === 0 ? part : part.padStart(2, "0")).join("-")
    : match[1];
  return { text: text.replace(match[0], "").trim(), expiryDate: date };
}

function parseItemPhrase(phrase, kind) {
  const sourcePhrase = phrase.trim();
  const opened = /(?:^|\s)(?:åpnet|opnet|opened|åpne)(?=\s|$)/i.test(sourcePhrase);
  let text = sourcePhrase.replace(/(?:^|\s)(?:åpnet|opnet|opened|åpne)(?=\s|$)/gi, " ").replace(/\s+/g, " ").trim();
  const date = extractDate(text);
  text = date.text;
  const weight = extractWeight(text);
  text = weight.text;
  const sourceMatch = text.match(/\s+(?:i|fra)\s+(kjøleskapet|kjøleskap|fridge|fryseren|fryser|[\p{L}]+fryseren)\s*$/iu);
  const sourceText = sourceMatch ? sourceMatch[1] : "";
  if (sourceMatch) text = text.slice(0, sourceMatch.index).trim();
  const count = readQuantity(text);
  let quantity = count.quantity;
  text = count.rest;
  if (/^den\s+/i.test(text)) { quantity = 1; text = text.replace(/^den\s+/i, ""); }
  const packageMatch = text.match(PACKAGE_PATTERN);
  const unitLabel = packageMatch && /pakke|pk/i.test(packageMatch[0]) ? "package"
    : packageMatch && /porsjon/i.test(packageMatch[0]) ? "portion" : "item";
  if (packageMatch) text = text.slice(packageMatch[0].length).trim();
  text = text.replace(/^med\s+/i, "").trim();
  if (weight.weightGrams !== null && quantity === null && kind === "add") quantity = 1;
  return {
    id: newId(), kind, name: canonicalName(text), quantity, unitLabel,
    opened, stockItemId: "", targetLocationKey: "", targetText: "", sourceText, sourcePhrase,
    weightGrams: weight.weightGrams,
    weightScope: weight.weightScope === "unspecified" && quantity === 1 ? "total" : weight.weightScope,
    expiryDate: date.expiryDate,
    stateFilter: kind === "discard" && opened ? "opened" : "",
    label: /hjemmelaget|rester?/i.test(text) ? "Prepared" : "",
  };
}

function splitItems(text) {
  const commaParts = [];
  let current = "";
  for (let index = 0; index < text.length; index += 1) {
    const decimalComma = text[index] === "," && /\d/.test(text[index - 1] || "") && /\d/.test(text[index + 1] || "");
    if (text[index] === "," && !decimalComma) {
      commaParts.push(current);
      current = "";
    } else {
      current += text[index];
    }
  }
  commaParts.push(current);
  return commaParts.flatMap((part) => part.split(/\s+og\s+|\s*;\s*/i)).map((part) => part.trim()).filter(Boolean);
}

function mergeRepeatedAdds(proposals) {
  const merged = [];
  for (const proposal of proposals) {
    const existing = merged.find((item) =>
      item.kind === "add" && proposal.kind === "add" && item.quantity !== null && proposal.quantity !== null &&
      nameKey(item.name) === nameKey(proposal.name) && item.opened === proposal.opened && item.unitLabel === proposal.unitLabel &&
      item.weightGrams === null && proposal.weightGrams === null && item.expiryDate === proposal.expiryDate
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

function parseAddList(text) {
  const locationMatch = text.match(/\s+i\s+(kjøleskapet|kjøleskap|fridge|fryseren|fryser|[\p{L}]+fryseren)\s*$/iu);
  const sourceText = locationMatch?.[1] || "";
  const list = locationMatch ? text.slice(0, locationMatch.index).trim() : text;
  return mergeRepeatedAdds(splitItems(list).map((part) => {
    const proposal = parseItemPhrase(part, "add");
    if (sourceText && !proposal.sourceText) proposal.sourceText = sourceText;
    return proposal;
  }));
}

export function interpretInventoryText(transcript) {
  const text = transcript.trim().replace(/[.!?]+$/, "");
  if (!text) return { spokenLocation: "", proposals: [] };
  const colon = text.indexOf(":");
  const spokenLocation = colon > 0 && colon < 60 ? text.slice(0, colon).trim() : "";
  const command = spokenLocation ? text.slice(colon + 1).trim() : text;
  let match = command.match(/^(?:flytt|flyttet|move)\s+(.+?)(?:\s+fra\s+(.+?))?\s+til\s+(.+)$/i);
  if (match) {
    const proposal = parseItemPhrase(match[1], "move");
    proposal.sourceText = match[2]?.trim() || "";
    proposal.targetText = match[3].trim();
    return { spokenLocation, proposals: [proposal] };
  }
  match = command.match(/^(?:det\s+ligger|det\s+er)\s+(.+?)\s+igjen$/i);
  if (match && extractWeight(match[1]).weightGrams !== null) return { spokenLocation, proposals: [parseItemPhrase(match[1], "set_weight")] };
  match = command.match(/^(?:det er\s+)?(?:bare\s+)?(.+?)\s+igjen$/i);
  if (match) return { spokenLocation, proposals: [parseItemPhrase(match[1], "set_quantity")] };
  match = command.match(/^(?:åpnet|åpne|har\s+åpnet)\s+(.+)$/i);
  if (match) return { spokenLocation, proposals: [parseItemPhrase(match[1], "open")] };
  match = command.match(/^(?:kast|kastet|kaste)\s+(.+)$/i);
  if (match) return { spokenLocation, proposals: [parseItemPhrase(match[1], "discard")] };
  match = command.match(/^(?:vi\s+)?(?:har\s+)?brukt\s+opp\s+(.+)$/i);
  if (match) { const proposal = parseItemPhrase(match[1], "remove"); proposal.all = true; return { spokenLocation, proposals: [proposal] }; }
  match = command.match(/^(?:vi\s+)?(?:brukte|har brukt|fjern|fjernet|tok ut|ta ut|remove|use)\s+(.+)$/i);
  if (match) return { spokenLocation, proposals: splitItems(match[1]).map((part) => parseItemPhrase(part, "remove")) };
  match = command.match(/^(?:legg til|la til|frys ned|add|put|freeze)\s+(.+)$/i);
  if (match) return { spokenLocation, proposals: parseAddList(match[1]) };
  match = command.match(/^(?:jeg har|vi har|det ligger)\s+(.+)$/i);
  if (match) return { spokenLocation, proposals: parseAddList(match[1]) };
  if (spokenLocation) return { spokenLocation, proposals: parseAddList(command) };
  if (readQuantity(command).quantity !== null) return { spokenLocation, proposals: parseAddList(command) };
  return { spokenLocation, proposals: [{
    id: newId(), kind: "unknown", name: canonicalName(command), quantity: null, unitLabel: "item", opened: false,
    stockItemId: "", targetLocationKey: "", targetText: "", sourcePhrase: command,
  }] };
}

function findLocation(text, locations, selectedKey = "") {
  if (!text) return "";
  const value = nameKey(text).replace(/^(?:fra|til|i)\s+/, "").trim();
  if (["kjøleskapet", "kjøleskap", "fridge"].some((item) => nameKey(item) === value)) {
    return locations.find((location) => location.kind === "fridge")?.key || "";
  }
  if (["fryseren", "fryser", "freezer"].includes(value)) {
    const selected = locations.find((location) => location.key === selectedKey);
    if (selected?.kind === "freezer") return selected.key;
    const freezers = locations.filter((location) => location.kind === "freezer");
    return freezers.length === 1 ? freezers[0].key : "";
  }
  const normalized = value.replace(/\s*fryser(?:en)?$/, "").replace(/en$/, "").trim();
  const matches = locations.filter((location) => location.kind === "freezer" &&
    nameKey(location.freezerName).replace(/\s*fryser(?:en)?$/, "").replace(/en$/, "").trim() === normalized);
  return matches.length === 1 ? matches[0].key : "";
}

function uniqueProducts(products) {
  return [...new Map(products.map((product) => [product.id, product])).values()];
}

export function prepareInventoryOperations(proposals, { entries, stockItems, locations, sourceLocationKey }) {
  return proposals.map((proposal) => {
    const issues = [];
    const kind = proposal.kind;
    const name = canonicalName(proposal.name || "");
    let quantity = proposal.quantity === "" || proposal.quantity === null || proposal.quantity === undefined
      ? null : Number(proposal.quantity);
    const resolvedSourceKey = proposal.sourceLocationKey ||
      (proposal.sourceText ? findLocation(proposal.sourceText, locations, sourceLocationKey) : sourceLocationKey);
    const sourceLocation = locations.find((location) => location.key === resolvedSourceKey);
    const sourceEntries = entries.filter((entry) =>
      (entry.locationKey || `${entry.freezerId}/${entry.compartmentId}`) === resolvedSourceKey
    );
    const candidates = kind === "add"
      ? uniqueProducts(stockItems.filter((item) => nameKey(canonicalName(item.name)) === nameKey(name)))
      : uniqueProducts(sourceEntries.filter((entry) => nameKey(canonicalName(entry.stockItem.name)) === nameKey(name))
        .map((entry) => entry.stockItem));
    const explicit = proposal.stockItemId
      ? (kind === "add" ? stockItems : sourceEntries.map((entry) => entry.stockItem))
        .find((item) => item.id === proposal.stockItemId)
      : null;
    let stockItemId = explicit?.id || "";
    if (proposal.stockItemId && !explicit) issues.push("Selected stock item is no longer available here.");
    if (!stockItemId && candidates.length === 1) stockItemId = candidates[0].id;
    if (!stockItemId && candidates.length > 1) issues.push("Several stock items match. Choose the correct one.");
    const matchingEntry = sourceEntries.find((entry) => entry.stockItem.id === stockItemId);
    if (proposal.all && matchingEntry) quantity = matchingEntry.count;
    const weightGrams = proposal.weightGrams === "" || proposal.weightGrams === null || proposal.weightGrams === undefined
      ? null : Number(proposal.weightGrams);
    const weightScope = weightGrams === null ? "" : proposal.weightScope === "unspecified"
      ? (quantity !== null && quantity > 1 ? "unspecified" : "total") : proposal.weightScope || "total";
    if (!OPERATION_KINDS.includes(kind)) issues.push("Choose an action.");
    if (!sourceLocation) issues.push("Choose a storage location.");
    if (kind !== "set_weight" && (quantity === null || !Number.isFinite(quantity) || quantity < 0 || quantity > 99 ||
        Math.abs(quantity * 100 - Math.round(quantity * 100)) > 0.000001 ||
        (kind !== "set_quantity" && quantity === 0))) {
      issues.push("Enter a clear quantity between 0 and 99.");
    }
    if (!name) issues.push("Choose or enter the food item.");
    if (kind !== "add" && !stockItemId && name) issues.push("Choose an existing item in this location.");
    if (weightGrams !== null && (!Number.isInteger(weightGrams) || weightGrams <= 0 || weightGrams > 1000000)) {
      issues.push("Enter a valid weight in grams.");
    }
    if (kind === "set_weight" && weightGrams === null) issues.push("Enter the remaining weight.");
    if (weightGrams !== null && weightScope === "unspecified") issues.push("Choose whether weight is total or per item.");
    if (weightGrams !== null && weightScope === "per_unit" && quantity !== null && !Number.isInteger(quantity)) {
      issues.push("Per-item weight needs a whole item count.");
    }
    if (proposal.expiryDate) {
      try { dateToExpiry(proposal.expiryDate); }
      catch { issues.push("Choose a valid expiration date."); }
    }
    if (proposal.frozenAt) {
      try { dateToExpiry(proposal.frozenAt); }
      catch { issues.push("Choose a valid freezing date."); }
    }
    if (["remove", "discard", "move", "open"].includes(kind) && matchingEntry && quantity !== null && quantity > matchingEntry.count) {
      issues.push(`Only ${matchingEntry.count} is available here.`);
    }
    const targetLocationKey = proposal.targetLocationKey || findLocation(proposal.targetText, locations);
    if (kind === "move") {
      if (!targetLocationKey || !locations.some((location) => location.key === targetLocationKey)) issues.push("Choose the destination compartment.");
      else if (targetLocationKey === resolvedSourceKey) issues.push("Choose a different destination.");
    }
    const sourceUnits = matchingEntry?.units?.filter((unit) => unit.state !== "empty" &&
      (!proposal.stateFilter || unit.state === proposal.stateFilter) &&
      (kind !== "open" || unit.state === "full"))?.sort((a, b) =>
        (a.expiresAt || Infinity) - (b.expiresAt || Infinity) ||
        (a.frozenAt || "9999-99-99").localeCompare(b.frozenAt || "9999-99-99")
      ) || [];
    const availableMatching = sourceUnits.reduce((total, unit) => total + (Number(unit.amount) || 1), 0);
    if (["discard", "open"].includes(kind) && quantity !== null && quantity > availableMatching && matchingEntry) {
      issues.push(`Only ${availableMatching} matching item(s) are available here.`);
    }
    if (kind === "set_weight" && sourceUnits.length !== 1 && !proposal.unitId) issues.push("Choose which item or batch has this weight.");
    const requested = kind === "set_quantity" && matchingEntry ? matchingEntry.count - quantity : quantity;
    if (["remove", "discard", "move", "open", "set_quantity"].includes(kind) && requested > 0 && !proposal.allowUnknownWeight) {
      let left = requested;
      for (const unit of sourceUnits) {
        if (left <= 0) break;
        const amount = Number(unit.amount) || 1;
        if (left < amount && unit.weightGrams) {
          issues.push("Partial change to a weighed batch: accept unknown remaining weight or enter a new weight.");
          break;
        }
        left -= Math.min(left, amount);
      }
    }
    return {
      ...proposal, kind, name, quantity, weightGrams, weightScope, stockItemId,
      sourceLocationKey: resolvedSourceKey, targetLocationKey,
      unitLabel: ["package", "portion"].includes(proposal.unitLabel) ? proposal.unitLabel : "item",
      opened: Boolean(proposal.opened), issues,
    };
  });
}

export function validateInventoryOperation(operation, locations) {
  const issues = [];
  if (!OPERATION_KINDS.includes(operation.kind)) issues.push("Invalid action.");
  if (typeof operation.name !== "string" || !operation.name.trim() || operation.name.length > 120) issues.push("Invalid item name.");
  if (operation.stockItemId && typeof operation.stockItemId !== "string") issues.push("Invalid stock item.");
  if (!["item", "package", "portion"].includes(operation.unitLabel)) issues.push("Invalid unit type.");
  if (typeof operation.opened !== "boolean") issues.push("Invalid opened state.");
  if (operation.kind !== "set_weight" && (!Number.isFinite(operation.quantity) || operation.quantity < 0 || operation.quantity > 99 ||
      Math.abs(operation.quantity * 100 - Math.round(operation.quantity * 100)) > 0.000001 ||
      (operation.kind !== "set_quantity" && operation.quantity === 0))) issues.push("Invalid quantity.");
  if (operation.weightGrams !== null && operation.weightGrams !== undefined &&
      (!Number.isInteger(operation.weightGrams) || operation.weightGrams <= 0 || operation.weightGrams > 1000000 ||
      !["total", "per_unit"].includes(operation.weightScope))) issues.push("Invalid weight.");
  if (operation.kind === "set_weight" && !Number.isInteger(operation.weightGrams)) issues.push("Invalid remaining weight.");
  if (!locations.some((location) => location.key === operation.sourceLocationKey)) issues.push("Invalid source location.");
  if (operation.kind !== "add" && !operation.stockItemId) issues.push("An existing item is required.");
  if (operation.kind === "move" && (!locations.some((location) => location.key === operation.targetLocationKey) ||
      operation.targetLocationKey === operation.sourceLocationKey)) issues.push("Invalid destination compartment.");
  return issues;
}
