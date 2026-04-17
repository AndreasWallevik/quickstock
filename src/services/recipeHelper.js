// Recipe helper: fetch suggestions + compute shopping deltas vs stock
// Works with TheMealDB (public) by default. Optional Spoonacular support with VITE_SPOONACULAR_KEY.

const ALIASES = {
  'bell pepper': 'pepper',
  'red bell pepper': 'pepper',
  'green bell pepper': 'pepper',
  'scallion': 'spring onion',
  'spring onions': 'spring onion',
  'cilantro': 'coriander',
  'ground beef': 'minced beef',
  'minced meat': 'minced beef',
  'yoghurt': 'yogurt',
  'chick peas': 'chickpeas',
};

const UNIT_MAP = {
  g: 'g', gram: 'g', grams: 'g',
  kg: 'kg', kilogram: 'kg', kilograms: 'kg',
  ml: 'ml', milliliter: 'ml', milliliters: 'ml',
  l: 'l', liter: 'l', liters: 'l',
  tsp: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp',
  tbsp: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp',
  cup: 'cup', cups: 'cup',
  piece: 'pc', pieces: 'pc', pc: 'pc', pcs: 'pc'
};

function normalizeUnit(u) {
  if (!u) return null;
  const key = String(u).trim().toLowerCase();
  return UNIT_MAP[key] || key;
}

function normalizeName(name) {
  if (!name) return '';
  let n = name.toLowerCase().replace(/[\p{Emoji_Presentation}\p{Emoji}\uFE0F]/gu, ''); // strip emojis
  n = n.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  n = ALIASES[n] || n;
  // singularize simple plurals (very naive)
  if (n.endsWith('es') && !n.endsWith('ches') && !n.endsWith('shes')) n = n.slice(0, -2);
  else if (n.endsWith('s')) n = n.slice(0, -1);
  return n;
}

function parseAmount(rawMeasure) {
  if (!rawMeasure) return { amount: 1, unit: null }; // default to 1 unit
  const m = rawMeasure.toLowerCase().trim();

  // Handle mixed like "1 1/2 cup"
  const frac = m.match(/(\d+)\s+(\d+)\/(\d+)/);
  if (frac) {
    const whole = parseFloat(frac[1]);
    const num = parseFloat(frac[2]);
    const den = parseFloat(frac[3] || 1);
    const unit = m.replace(frac[0], '').trim();
    return { amount: whole + num/den, unit: normalizeUnit(unit) };
  }

  // Handle simple fraction "1/2 cup"
  const simple = m.match(/^(\d+)\/(\d+)\s*(.*)$/);
  if (simple) {
    const amount = parseFloat(simple[1]) / parseFloat(simple[2] || 1);
    const unit = normalizeUnit(simple[3]);
    return { amount, unit };
  }

  // Handle "2 cups", "400 g", "3"
  const numUnit = m.match(/^([\d.]+)\s*(.*)$/);
  if (numUnit) {
    const amount = parseFloat(numUnit[1]);
    const unit = normalizeUnit(numUnit[2]);
    return { amount: isNaN(amount) ? 1 : amount, unit };
  }

  return { amount: 1, unit: normalizeUnit(m) };
}

// Basic compare: if you track quantities, pass stock as {name, qty, unit?}.
function buildStockIndex(stockItems) {
  const idx = new Map();
  for (const it of (stockItems || [])) {
    const key = normalizeName(it.name || it.id || '');
    if (!key) continue;
    const qty = typeof it.stock === 'number' ? it.stock
              : typeof it.qty === 'number' ? it.qty
              : (it.count ?? 0);
    const unit = normalizeUnit(it.unit || null);
    idx.set(key, { qty: qty || 0, unit });
  }
  return idx;
}

// Compare recipe ingredients vs stock → what to add
export function computeShoppingDelta({ ingredients, stock }) {
  const stockIndex = buildStockIndex(stock);
  const need = [];
  const have = [];

  for (const ing of ingredients) {
    const key = normalizeName(ing.name);
    const { amount = 1, unit = null } = parseAmount(ing.measure);

    const s = stockIndex.get(key);
    if (!s) {
      need.push({ name: ing.name, amount, unit, reason: 'not-in-stock' });
      continue;
    }

    // If units differ, we won’t convert aggressively—assume different units = need to buy
    if (s.unit && unit && s.unit !== unit) {
      need.push({ name: ing.name, amount, unit, reason: `unit-mismatch(${s.unit} vs ${unit})` });
      continue;
    }

    const haveQty = s.qty || 0;
    if (haveQty >= amount || haveQty > 0 && !amount) {
      have.push({ name: ing.name, amount, unit, inStock: haveQty });
    } else {
      const missing = Math.max(0, amount - haveQty);
      need.push({ name: ing.name, amount: missing || amount, unit, reason: 'insufficient' });
    }
  }

  return { need, have };
}

// --------- Recipe providers ---------

// TheMealDB (no key). We'll use random recipes to keep it simple.
// API returns fields: strIngredient1..20, strMeasure1..20
async function fetchRandomMealDBRecipe() {
  const res = await fetch('https://www.themealdb.com/api/json/v1/1/random.php');
  const json = await res.json();
  const meal = json?.meals?.[0];
  if (!meal) throw new Error('No recipe found');

  const ingredients = [];
  for (let i = 1; i <= 20; i++) {
    const n = meal[`strIngredient${i}`];
    const m = meal[`strMeasure${i}`];
    if (!n) continue;
    ingredients.push({ name: n, measure: m || '' });
  }

  return {
    id: meal.idMeal,
    title: meal.strMeal,
    image: meal.strMealThumb,
    url: meal.strSource || meal.strYoutube || null,
    ingredients,
  };
}

// Spoonacular (optional; requires key). Example: random recipes with ingredients.
async function fetchRandomSpoonacularRecipe(apiKey) {
  const url = `https://api.spoonacular.com/recipes/random?number=1&apiKey=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Spoonacular error');
  const json = await res.json();
  const r = json?.recipes?.[0];
  if (!r) throw new Error('No recipe found');

  const ingredients = (r.extendedIngredients || []).map(x => ({
    name: x.nameClean || x.name || '',
    measure: x.original || `${x.amount || ''} ${x.unit || ''}`.trim(),
  }));

  return {
    id: r.id,
    title: r.title,
    image: r.image,
    url: r.sourceUrl || null,
    ingredients,
  };
}

// Public API first, fallback chain
export async function getDailySuggestion() {
  // Prefer Spoonacular if key is present
  const key = import.meta.env.VITE_SPOONACULAR_KEY;
  try {
    if (key) return await fetchRandomSpoonacularRecipe(key);
  } catch (e) {
    console.warn('Spoonacular failed, falling back to TheMealDB:', e);
  }
  return await fetchRandomMealDBRecipe();
}
