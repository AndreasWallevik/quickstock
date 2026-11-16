import { stockUnits, storageKindForUnit, unitAmount } from "./stockModel.js";
import { locationOptions } from "../freezer/freezerModel.js";

const CATEGORY_ORDER = ["leftovers", "meat", "fish", "fruit", "vegetables", "dairy", "bakery", "meals", "drinks", "pantry", "protein", "other"];
const CATEGORY_BY_FIELD = {
  protein: "protein", dairy: "dairy", carbs: "pantry", vegetables: "vegetables",
  fruit: "fruit", fruits: "fruit", berries: "fruit", sauce: "pantry",
  spice: "pantry", baking: "pantry", produce: "vegetables",
  bakery: "bakery", meals: "meals", drinks: "drinks", meat: "meat",
  fish: "fish", seafood: "fish", leftovers: "leftovers", other: "other",
  "dairy & eggs": "dairy", "meat & seafood": "protein",
  pantry: "pantry", "snacks & sweets": "other",
};
const NAME_RULES = [
  ["fish", /\b(?:salmon|laks|fisk|fish|cod|torsk|scampi|shrimp|reke|prawn|tuna|tunfisk|crab|krabbe)\b/],
  ["meat", /\b(?:chicken|kylling|beef|biff|bacon|pork|svin|ham|skinke|turkey|kalkun|meat|kjott|kjottdeig)\b/],
  ["fruit", /\b(?:blueberr\w*|blabaer|strawberr\w*|jordbaer|raspberr\w*|bringebaer|mango|apple|eple|banana|banan|fruit|frukt|berry|berries|baer)\b/],
  ["vegetables", /\b(?:pepper|paprika|broccoli|brokkoli|carrot|gulrot|tomato|tomat|onion|lok|potato|potet|vegetable|gronnsak|salad|salat)\b/],
  ["dairy", /\b(?:milk|melk|cheese|ost|yoghurt|yogurt|egg|eggs|flote|cream|butter|smor)\b/],
  ["bakery", /\b(?:bread|brod|baguette|roll|rundstykke|croissant|bolle)\b/],
  ["meals", /\b(?:lasagne|lasagna|pizza|taco|soup|suppe|stew|gryte)\b/],
  ["drinks", /\b(?:juice|saft|coffee|kaffe|soda|brus)\b/],
];
const EMOJI_CATEGORY = {
  "🥩": "meat", "🍗": "meat", "🥓": "meat", "🍖": "meat",
  "🐟": "fish", "🍣": "fish", "🍤": "fish",
  "🫐": "fruit", "🍓": "fruit", "🍎": "fruit", "🍌": "fruit",
  "🥦": "vegetables", "🥕": "vegetables", "🥬": "vegetables", "🌽": "vegetables",
  "🥛": "dairy", "🧀": "dairy", "🥚": "dairy",
  "🍞": "bakery", "🥖": "bakery", "🥐": "bakery",
  "🍲": "meals", "🍕": "meals", "🍝": "meals",
};
const LABELS = {
  en: {
    freezer: "FREEZER", fridge: "FRIDGE", empty: "No items",
    unassignedFreezer: "Unassigned freezer", unassigned: "location not set",
    opened: "opened", unopened: "unopened", expired: "expired", known: "known",
    item: ["item", "items"], package: ["pack", "packs"], portion: ["portion", "portions"],
    categories: { leftovers: "🍲 Leftovers", meat: "🥩 Meat & poultry", fish: "🐟 Fish & seafood", fruit: "🫐 Fruit & berries", vegetables: "🥦 Vegetables", dairy: "🥛 Dairy & eggs", bakery: "🥖 Bakery", meals: "🍽️ Meals", drinks: "🥤 Drinks", pantry: "🥫 Pantry", protein: "🍽️ Protein", other: "📦 Other" },
  },
  nb: {
    freezer: "FRYSER", fridge: "KJØLESKAP", empty: "Ingen varer",
    unassignedFreezer: "Uplassert i fryser", unassigned: "plassering ikke angitt",
    opened: "åpnet", unopened: "uåpnet", expired: "utgått", known: "kjent vekt",
    item: ["stk", "stk"], package: ["pakke", "pakker"], portion: ["porsjon", "porsjoner"],
    categories: { leftovers: "🍲 Rester", meat: "🥩 Kjøtt og fjørfe", fish: "🐟 Fisk og sjømat", fruit: "🫐 Frukt og bær", vegetables: "🥦 Grønnsaker", dairy: "🥛 Meieri og egg", bakery: "🥖 Bakervarer", meals: "🍽️ Måltider", drinks: "🥤 Drikke", pantry: "🥫 Tørrvarer", protein: "🍽️ Protein", other: "📦 Annet" },
  },
};

const languageKey = (locale) => /^(nb|nn|no)(-|$)/i.test(locale || "") ? "nb" : "en";
const normalizedName = (name) => String(name || "").toLocaleLowerCase("nb").normalize("NFD").replace(/[\u0300-\u036f]/g, "");

export function exportCategory(product) {
  if ((product.labels || []).some((label) => /^(leftover|prepared|rester?)$/i.test(label))) return "leftovers";
  const name = normalizedName(product.name);
  const specific = NAME_RULES.find(([, pattern]) => pattern.test(name))?.[0];
  const explicit = CATEGORY_BY_FIELD[String(product.category || "").toLowerCase()];
  if (explicit && !(explicit === "protein" && specific)) return explicit;
  return specific || EMOJI_CATEGORY[product.emoji] || explicit || "other";
}

function weightText(grams, locale) {
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  return grams >= 1000 ? `${number.format(grams / 1000)} kg` : `${number.format(grams)} g`;
}

function quantityText(count, unitLabel, locale, labels) {
  const key = ["package", "portion"].includes(unitLabel) ? unitLabel : "item";
  const unit = labels[key][count === 1 ? 0 : 1];
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(count)} ${unit}`;
}

function sectionText(kind, stockItems, freezerLocations, locale, labels) {
  const groups = new Map();
  for (const product of stockItems) {
    for (const unit of stockUnits(product)) {
      if (unit.state === "empty" || (unit.amount !== undefined && Number(unit.amount) <= 0)) continue;
      const storage = storageKindForUnit(unit, product);
      if (kind === "freezer" ? storage !== "freezer" : !["fridge", "unassigned"].includes(storage)) continue;
      const category = exportCategory(product);
      const location = kind === "freezer"
        ? freezerLocations.get(`${unit.freezerId}/${unit.compartmentId}`) || labels.unassignedFreezer
        : storage === "unassigned" ? labels.unassigned : "";
      const status = unit.state === "opened" ? labels.opened : unit.state === "full" ? labels.unopened
        : unit.state === "expired" ? labels.expired : "";
      const unitLabel = unit.unitLabel || "item";
      const key = JSON.stringify([category, product.id || product.name, product.name, location, status, unitLabel]);
      if (!groups.has(key)) groups.set(key, { category, name: product.name, location, status, unitLabel, count: 0, grams: 0, unknownWeight: false });
      const group = groups.get(key);
      group.count += unitAmount(unit);
      if (Number.isFinite(unit.weightGrams) && unit.weightGrams > 0) group.grams += unit.weightGrams;
      else group.unknownWeight = true;
    }
  }

  const heading = kind === "freezer" ? `🧊 ${labels.freezer}` : `🥛 ${labels.fridge}`;
  if (groups.size === 0) return `${heading}\n\n${labels.empty}`;
  const byCategory = new Map();
  for (const group of groups.values()) {
    if (!byCategory.has(group.category)) byCategory.set(group.category, []);
    byCategory.get(group.category).push(group);
  }
  const sections = [heading];
  for (const category of CATEGORY_ORDER) {
    const items = byCategory.get(category);
    if (!items?.length) continue;
    const lines = items.sort((a, b) => a.name.localeCompare(b.name, locale, { sensitivity: "base" }) || a.location.localeCompare(b.location, locale));
    sections.push(`${labels.categories[category]}\n${lines.map((item) => {
      const details = [quantityText(item.count, item.unitLabel, locale, labels)];
      if (item.grams > 0) details.push(`${weightText(item.grams, locale)}${item.unknownWeight ? ` ${labels.known}` : ""}`);
      const notes = [item.status, item.location].filter(Boolean);
      return `- ${item.name} – ${details.join(", ")}${notes.length ? ` (${notes.join("; ")})` : ""}`;
    }).join("\n")}`);
  }
  return sections.join("\n\n");
}

export function formatInventoryExport(stockItems, freezers, scope = "both", locale = "en") {
  if (!["fridge", "freezer", "both"].includes(scope)) throw new Error("Choose an inventory scope.");
  const labels = LABELS[languageKey(locale)];
  const locations = new Map(locationOptions(freezers).map((location) => [location.key, location.label]));
  const sections = [];
  if (scope !== "fridge") sections.push(sectionText("freezer", stockItems, locations, locale, labels));
  if (scope !== "freezer") sections.push(sectionText("fridge", stockItems, locations, locale, labels));
  return sections.join("\n\n---\n\n");
}
