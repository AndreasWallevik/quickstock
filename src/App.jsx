import React, { useEffect, useMemo, useState } from "react";
import {
  getRedirectResult,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
} from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { auth, db, firebaseReady, googleProvider } from "./firebase";
import starterStockItems from "../data/stockItems.seed.json";
import demoRecipes from "../data/recipes.seed.json";

const DAY = 24 * 60 * 60 * 1000;
const STOCK_STATES = ["full", "opened", "empty", "expired"];
const nextState = { full: "opened", opened: "empty", expired: "empty", empty: "full" };
const WEEK_DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];
const MAIN_VIEWS = [
  { id: "weekly", label: "Weekly Menu", icon: "🍽" },
  { id: "shopping", label: "Shopping List", icon: "🛒" },
  { id: "inventory", label: "Inventory", icon: "🧊" },
  { id: "recipes", label: "Recipes", icon: "📖" },
  { id: "overview", label: "Management", icon: "⚙️" },
];
const INVENTORY_MODES = [
  { id: "fridge", label: "Fridge View" },
  { id: "multi", label: "Multi View" },
];
const STAT_CARD_STYLES = {
  Menu: {
    icon: "🍽",
    className: "border-emerald-100 bg-emerald-50/80 text-emerald-900",
    iconClassName: "bg-emerald-600 text-white",
  },
  Inventory: {
    icon: "🧊",
    className: "border-emerald-100 bg-emerald-50/80 text-emerald-900",
    iconClassName: "bg-emerald-600 text-white",
  },
  Stock: {
    icon: "🧊",
    className: "border-emerald-100 bg-emerald-50/80 text-emerald-900",
    iconClassName: "bg-emerald-600 text-white",
  },
  Shopping: {
    icon: "🛒",
    className: "border-sky-100 bg-sky-50/80 text-sky-900",
    iconClassName: "bg-sky-600 text-white",
  },
  Recipes: {
    icon: "📖",
    className: "border-amber-100 bg-amber-50/80 text-amber-900",
    iconClassName: "bg-amber-500 text-white",
  },
  Attention: {
    icon: "!",
    className: "border-rose-100 bg-rose-50/80 text-rose-900",
    iconClassName: "bg-rose-500 text-white",
  },
};
const DAY_STYLES = {
  monday: { icon: "1", className: "border-amber-100 bg-amber-50/70", chip: "bg-amber-100 text-amber-900" },
  tuesday: { icon: "2", className: "border-emerald-100 bg-emerald-50/70", chip: "bg-emerald-100 text-emerald-900" },
  wednesday: { icon: "3", className: "border-stone-200 bg-stone-50", chip: "bg-stone-200 text-stone-900" },
  thursday: { icon: "4", className: "border-emerald-100 bg-emerald-50/70", chip: "bg-emerald-100 text-emerald-900" },
  friday: { icon: "5", className: "border-amber-100 bg-amber-50/70", chip: "bg-amber-100 text-amber-900" },
  saturday: { icon: "6", className: "border-rose-100 bg-rose-50/60", chip: "bg-rose-100 text-rose-900" },
  sunday: { icon: "7", className: "border-stone-200 bg-stone-50", chip: "bg-stone-200 text-stone-900" },
};
const READINESS_BADGE_STYLES = {
  ready: "bg-emerald-700 text-white",
  completed: "bg-emerald-700 text-white",
  missing: "bg-rose-100 text-rose-800",
  review: "bg-amber-100 text-amber-900",
};

const toDateInputValue = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const getStartOfIsoWeek = (date = new Date()) => {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = next.getDay() || 7;
  next.setDate(next.getDate() - day + 1);
  next.setHours(0, 0, 0, 0);
  return next;
};

const getIsoWeekId = (date = new Date()) => {
  const weekStart = getStartOfIsoWeek(date);
  const thursday = new Date(weekStart);
  thursday.setDate(weekStart.getDate() + 3);
  const firstThursday = new Date(thursday.getFullYear(), 0, 4);
  const firstWeekStart = getStartOfIsoWeek(firstThursday);
  const week = 1 + Math.round((weekStart - firstWeekStart) / (7 * DAY));
  return `${thursday.getFullYear()}-W${String(week).padStart(2, "0")}`;
};

const getWeekDayKey = (date = new Date()) => WEEK_DAYS[(date.getDay() + 6) % 7];

const shiftWeek = (weekStart, amount) => {
  const next = new Date(weekStart);
  next.setDate(next.getDate() + amount * 7);
  return getStartOfIsoWeek(next);
};

const CATEGORY_ORDER = [
  "Produce",
  "Dairy & Eggs",
  "Meat & Seafood",
  "Bakery",
  "Pantry",
  "Meals",
  "Snacks & Sweets",
  "Drinks",
  "Frozen",
  "Other",
];
const CATEGORY_WEIGHT = Object.fromEntries(CATEGORY_ORDER.map((category, index) => [category, index]));

const EMOJI_BY_CATEGORY = {
  Produce: new Set(["🍎", "🍌", "🍅", "🥦", "🥬", "🥒", "🥕", "🧄", "🧅", "🥔", "🌽"]),
  "Dairy & Eggs": new Set(["🧀", "🥚", "🥛"]),
  "Meat & Seafood": new Set(["🍖", "🍗", "🥩", "🥓", "🍤", "🍣"]),
  Bakery: new Set(["🍞", "🥖", "🥐", "🥯"]),
  "Snacks & Sweets": new Set(["🍫", "🍪", "🍿", "🍰"]),
  Meals: new Set(["🍕", "🌮", "🍝", "🍜", "🍛", "🥣"]),
  Pantry: new Set(["🧂", "🧈", "🍯", "🫘", "🍚", "🥫"]),
  Drinks: new Set(["🧃", "🥤", "☕️", "🍺", "🍷"]),
};

const NAME_CATEGORY = {
  milk: "Dairy & Eggs",
  melk: "Dairy & Eggs",
  cheese: "Dairy & Eggs",
  ost: "Dairy & Eggs",
  egg: "Dairy & Eggs",
  eggs: "Dairy & Eggs",
  apple: "Produce",
  eple: "Produce",
  banana: "Produce",
  banan: "Produce",
  tomato: "Produce",
  tomat: "Produce",
  salad: "Produce",
  salat: "Produce",
  carrot: "Produce",
  gulrot: "Produce",
  onion: "Produce",
  lok: "Produce",
  potato: "Produce",
  potet: "Produce",
  chicken: "Meat & Seafood",
  kylling: "Meat & Seafood",
  beef: "Meat & Seafood",
  biff: "Meat & Seafood",
  fish: "Meat & Seafood",
  fisk: "Meat & Seafood",
  bread: "Bakery",
  brod: "Bakery",
  rice: "Pantry",
  ris: "Pantry",
  beans: "Pantry",
  salt: "Pantry",
  taco: "Meals",
  pasta: "Meals",
  pizza: "Meals",
  coffee: "Drinks",
  kaffe: "Drinks",
  juice: "Drinks",
  saft: "Drinks",
};

const EMOJI_GUESSES = [
  ["milk|melk", "🥛"],
  ["cheese|ost", "🧀"],
  ["egg", "🥚"],
  ["bread|brod|brød", "🍞"],
  ["taco", "🌮"],
  ["pasta", "🍝"],
  ["rice|ris", "🍚"],
  ["chicken|kylling", "🍗"],
  ["beef|biff", "🥩"],
  ["fish|fisk|salmon|laks", "🍣"],
  ["tomato|tomat", "🍅"],
  ["carrot|gulrot", "🥕"],
  ["salad|salat", "🥬"],
  ["onion|lok|løk", "🧅"],
  ["garlic|hvitlok|hvitløk", "🧄"],
  ["coffee|kaffe", "☕️"],
  ["juice|saft", "🧃"],
];

const ACTIVE_HOUSEHOLD_STORAGE_PREFIX = "quickstock.activeHouseholdId";
const OPTIMISTIC_HOUSEHOLD_GRACE_MS = 15000;

const makeInviteCode = () => `HOUSE-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
const now = () => Date.now();
const genId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

const normalize = (value = "") =>
  value
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const PANTRY_ALIAS_KEYWORDS = [
  { key: "onion", aliases: ["onion", "onions", "lok", "løk"] },
  { key: "garlic", aliases: ["garlic", "hvitlok", "hvitløk"] },
  { key: "carrot", aliases: ["carrot", "carrots", "gulrot", "gulrøtter", "gulrotter"] },
  { key: "milk", aliases: ["milk", "melk"] },
  { key: "cheese", aliases: ["cheese", "ost"] },
  { key: "butter", aliases: ["butter", "smor", "smør"] },
  { key: "egg", aliases: ["egg", "eggs"] },
  { key: "bread", aliases: ["bread", "brod", "brød"] },
  { key: "pasta", aliases: ["pasta"] },
  { key: "rice", aliases: ["rice", "ris"] },
];

const pantryItemKey = (name = "") => {
  const normalized = normalize(name);
  const compact = normalized.replace(/[^a-z0-9]+/g, " ").trim();
  const words = new Set(compact.split(/\s+/).filter(Boolean));
  const alias = PANTRY_ALIAS_KEYWORDS.find((item) =>
    item.aliases.some((aliasName) => words.has(normalize(aliasName)))
  );
  return alias?.key || compact;
};

const seedDocId = (entry, prefix) =>
  entry.id || `${prefix}-${pantryItemKey(entry.name).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;

const activeHouseholdStorageKey = (userId) => `${ACTIVE_HOUSEHOLD_STORAGE_PREFIX}.${userId}`;

const readStoredHouseholdId = (userId) => {
  if (!userId || typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(activeHouseholdStorageKey(userId)) || "";
  } catch {
    return "";
  }
};

const isIosDevice = () => {
  if (typeof navigator === "undefined") return false;
  const userAgent = navigator.userAgent || "";
  return (
    /iPad|iPhone|iPod/i.test(userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
};

const isStandalonePwa = () => {
  if (typeof window === "undefined") return false;
  return (
    window.navigator.standalone === true ||
    window.matchMedia?.("(display-mode: standalone)")?.matches
  );
};

const shouldUseRedirectSignIn = () => {
  if (typeof navigator === "undefined") return false;
  const userAgent = navigator.userAgent || "";
  return isIosDevice() || isStandalonePwa() || /Android|Mobile/i.test(userAgent);
};

const AUTH_DEBUG_STORAGE_KEY = "quickstockAuthDebug";
const EMPTY_AUTH_DEBUG = {
  signInClicked: false,
  authMethod: "not-started",
  redirectResult: "not-checked",
  authStateUser: "not-observed",
  authErrorCode: "",
  authErrorMessage: "",
};

const formatAuthDebugUser = (user) => {
  if (!user) return "null";
  const email = user.email || "no email";
  return `${email} (${user.uid})`;
};

const readStoredAuthDebug = () => {
  if (typeof window === "undefined") return EMPTY_AUTH_DEBUG;
  try {
    const stored = window.localStorage.getItem(AUTH_DEBUG_STORAGE_KEY);
    return stored ? { ...EMPTY_AUTH_DEBUG, ...JSON.parse(stored) } : EMPTY_AUTH_DEBUG;
  } catch {
    return EMPTY_AUTH_DEBUG;
  }
};

const writeStoredAuthDebug = (debug) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(AUTH_DEBUG_STORAGE_KEY, JSON.stringify(debug));
  } catch {
    // Auth debug must never break sign-in when storage is unavailable.
  }
};

const mergeAuthDebug = (setAuthDebug, patch) => {
  setAuthDebug((current) => {
    const next = { ...EMPTY_AUTH_DEBUG, ...current, ...patch };
    writeStoredAuthDebug(next);
    return next;
  });
};

const authDebugErrorMessage = (err) => {
  const code = err?.code || "unknown";
  const message = err?.message || "Could not sign in.";
  return `Auth error\ncode: ${code}\nmessage: ${message}`;
};

const writeStoredHouseholdId = (userId, householdId) => {
  if (!userId || typeof window === "undefined") return;
  try {
    if (householdId) {
      window.localStorage.setItem(activeHouseholdStorageKey(userId), householdId);
    } else {
      window.localStorage.removeItem(activeHouseholdStorageKey(userId));
    }
  } catch {
    // localStorage can be unavailable in private or restricted browser contexts.
  }
};

const pickEmoji = (name = "") => {
  const normalized = normalize(name);
  const found = EMOJI_GUESSES.find(([pattern]) =>
    pattern.split("|").some((keyword) => normalized.includes(normalize(keyword)))
  );
  return found?.[1] || "🧺";
};

const genUnit = (shelfLifeDays = 7) => ({
  id: genId(),
  state: "full",
  addedAt: now(),
  expiresAt: now() + Math.max(1, Number(shelfLifeDays) || 7) * DAY,
});

const toUnits = (product) => {
  if (Array.isArray(product.items)) return product.items;
  const quantity = Math.max(0, Math.ceil(Number(product.quantity) || 0));
  return Array.from({ length: quantity }, (_, index) => ({
    id: `${product.id || "unit"}-${index}`,
    state: product.state || "full",
  }));
};

const withExpiryApplied = (units = [], t = now()) =>
  units.map((unit) =>
    unit.state !== "empty" && unit.state !== "expired" && unit.expiresAt && unit.expiresAt <= t
      ? { ...unit, state: "expired" }
      : unit
  );

const countInStock = (units) =>
  units.reduce(
    (count, unit) =>
      count + (["full", "opened", "expired"].includes(unit.state || "full") ? 1 : 0),
    0
  );

const isUsableStockUnit = (unit = {}) => ["full", "opened"].includes(unit.state || "full");

const shoppingRestockAmount = (shoppingItem, stockItem = {}) => {
  const packs = Math.max(1, Number(shoppingItem?.packs) || 1);
  const packSize = Math.max(1, Number(stockItem?.packSize) || 1);

  if (shoppingItem?.sourceType === "weeklyPlan" || shoppingItem?.autoGenerated || shoppingItem?.packs) {
    return Math.max(1, Math.ceil(packs * packSize));
  }

  const quantity = Number(shoppingItem?.quantity);
  if (quantity > 0) return Math.max(1, Math.ceil(quantity));

  return Math.max(1, Math.ceil(packs * packSize));
};

const shoppingStockItemId = (shoppingItem = {}) => {
  if (shoppingItem.sourceType === "weeklyPlan" || shoppingItem.autoGenerated) {
    return (
      shoppingItem.ingredientStockItemId ||
      shoppingItem.stockItemId ||
      shoppingItem.sourceStockItemId ||
      ""
    );
  }

  return shoppingItem.sourceStockItemId || shoppingItem.stockItemId || shoppingItem.ingredientStockItemId || "";
};

const canConsumeUnit = (unit) => ["full", "opened", "expired"].includes(unit.state || "full");

const soonCount = (units, days = 2, t = now()) => {
  const cutoff = t + days * DAY;
  return units.filter(
    (unit) =>
      unit.expiresAt &&
      unit.state !== "empty" &&
      unit.state !== "expired" &&
      unit.expiresAt <= cutoff
  ).length;
};

const getCategory = (product) => {
  if (product?.freezer) return "Frozen";
  const emoji = product?.emoji;
  for (const [category, emojis] of Object.entries(EMOJI_BY_CATEGORY)) {
    if (emojis.has(emoji)) return category;
  }
  const normalized = normalize(product?.name || "");
  for (const [keyword, category] of Object.entries(NAME_CATEGORY)) {
    if (normalized.includes(normalize(keyword))) return category;
  }
  return "Other";
};

const getStockSignals = (product, soonDays = 2) => {
  const units = withExpiryApplied(toUnits(product));
  return {
    units,
    inStock: countInStock(units),
    expired: units.filter((unit) => unit.state === "expired").length,
    soon: soonCount(units, soonDays),
  };
};

const getAvailableStockUnitCount = (stockItem) =>
  withExpiryApplied(toUnits(stockItem)).filter(isUsableStockUnit).length;

const isStockItemAvailable = (stockItem) => getAvailableStockUnitCount(stockItem) > 0;

const getStockAvailability = (stockItems = []) => {
  const byId = new Map();
  stockItems.forEach((item) => {
    byId.set(item.id, isStockItemAvailable(item));
  });
  return byId;
};

const getRecipeReadiness = (recipe, stockItems = []) => {
  const availabilityById = getStockAvailability(stockItems);
  const stockById = new Map(stockItems.map((item) => [item.id, item]));
  const ingredients = recipe?.ingredients || [];
  let needsReview = ingredients.length === 0;
  const missingStockItemIds = new Set();

  ingredients.forEach((ingredient) => {
    if (!ingredient?.stockItemId) {
      needsReview = true;
      return;
    }

    if (!stockById.has(ingredient.stockItemId)) {
      needsReview = true;
      return;
    }

    if (!availabilityById.get(ingredient.stockItemId)) {
      missingStockItemIds.add(ingredient.stockItemId);
    }
  });

  if (needsReview) {
    return { status: "review", label: "Needs review", missingCount: missingStockItemIds.size };
  }

  if (missingStockItemIds.size > 0) {
    const suffix = missingStockItemIds.size === 1 ? "item" : "items";
    return {
      status: "missing",
      label: `Missing ${missingStockItemIds.size} ${suffix}`,
      missingCount: missingStockItemIds.size,
    };
  }

  return { status: "ready", label: "Ready", missingCount: 0 };
};

const recipeQuantityText = (quantity) => `${quantity ?? ""}`.trim();

const getWeeklyReadiness = (weeklyPlan, recipes = [], stockItems = []) => {
  const days = weeklyPlan?.days || {};
  const readinessByDay = {};
  let plannedCount = 0;
  let readyCount = 0;

  WEEK_DAYS.forEach((day) => {
    const dayPlan = days[day] || {};
    const recipe = recipes.find((item) => item.id === dayPlan.recipeId);
    if (!recipe) return;

    plannedCount += 1;
    if (dayPlan.consumedAt) {
      readinessByDay[day] = { status: "completed", label: "Completed", missingCount: 0 };
      readyCount += 1;
      return;
    }

    const readiness = getRecipeReadiness(recipe, stockItems);
    readinessByDay[day] = readiness;
    if (readiness.status === "ready") readyCount += 1;
  });

  return {
    days: readinessByDay,
    plannedCount,
    readyCount,
    readyPercent: plannedCount > 0 ? Math.round((readyCount / plannedCount) * 100) : 0,
  };
};

const deleteCollectionDocs = async (collectionRef) => {
  const snapshot = await getDocs(collectionRef);
  if (snapshot.empty) return 0;

  let batch = writeBatch(db);
  let pending = 0;

  for (const itemDoc of snapshot.docs) {
    batch.delete(itemDoc.ref);
    pending += 1;

    if (pending === 450) {
      await batch.commit();
      batch = writeBatch(db);
      pending = 0;
    }
  }

  if (pending > 0) {
    await batch.commit();
  }

  return snapshot.size;
};

const groupStockProducts = (products, groupBy) => {
  const groups = new Map();
  for (const product of products) {
    const key =
      groupBy === "Category"
        ? getCategory(product)
        : groupBy === "Label"
          ? product.labels?.[0] || "Unlabeled"
          : groupBy === "Base"
            ? product.isBase
              ? "Basisvarer"
              : "Andre"
            : "All";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(product);
  }
  const sortKey = (key) =>
    groupBy === "Category"
      ? CATEGORY_WEIGHT[key] ?? 999
      : groupBy === "Base"
        ? key === "Basisvarer"
          ? 0
          : 1
        : key.toLocaleLowerCase("nb");

  return [...groups.entries()]
    .sort((a, b) => (sortKey(a[0]) > sortKey(b[0]) ? 1 : -1))
    .map(([key, products]) => [
      key,
      products.slice().sort((a, b) => {
        if (groupBy === "None") {
          const availabilitySort = Number(isStockItemAvailable(b)) - Number(isStockItemAvailable(a));
          if (availabilitySort !== 0) return availabilitySort;
        }
        return a.name.localeCompare(b.name, "nb", { sensitivity: "base" });
      }),
    ]);
};

function ViewSelector({ options, value, onChange }) {
  return (
    <div className="flex gap-2 overflow-x-auto rounded-2xl border border-stone-200/80 bg-white/90 p-1.5 shadow-sm">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(option.id)}
          className={`min-h-11 shrink-0 rounded-xl px-4 py-2 text-sm font-semibold transition ${
            value === option.id
              ? "bg-emerald-700 text-white shadow-sm"
              : "text-slate-600 hover:bg-stone-100 hover:text-slate-950"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function StatsStrip({ stats, onStatClick }) {
  return (
    <section className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
      {stats.map((stat) => {
        const style = STAT_CARD_STYLES[stat.label] || STAT_CARD_STYLES.Inventory;
        const clickable = Boolean(stat.targetView && onStatClick);
        const Card = clickable ? "button" : "div";
        return (
          <Card
            key={stat.label}
            type={clickable ? "button" : undefined}
            onClick={clickable ? () => onStatClick(stat) : undefined}
            className={`rounded-2xl border p-3.5 text-left shadow-sm transition hover:shadow-md ${style.className} ${
              clickable ? "cursor-pointer hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2" : ""
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide opacity-70">
                {stat.label}
              </div>
              <div className={`grid h-8 w-8 place-items-center rounded-full text-sm ${style.iconClassName}`}>
                {style.icon}
              </div>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <div className={stat.valueClassName || "text-3xl font-bold leading-none"}>{stat.value}</div>
              {stat.completed && (
                <span
                  className="shrink-0 rounded-full bg-emerald-700 px-1.5 py-0.5 text-[10px] font-bold uppercase leading-none text-white"
                  title="Completed"
                  aria-label="Completed"
                >
                  Done
                </span>
              )}
            </div>
            <div className="mt-1 text-xs opacity-70">{stat.detail}</div>
          </Card>
        );
      })}
    </section>
  );
}

function useAuthUser() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [redirectError, setRedirectError] = useState("");
  const [authDebug, setAuthDebug] = useState(readStoredAuthDebug);

  useEffect(() => {
    if (!auth) {
      mergeAuthDebug(setAuthDebug, {
        authErrorCode: "missing-auth",
        authErrorMessage: "Firebase Auth was not initialized.",
      });
      setLoading(false);
      return undefined;
    }

    let active = true;
    let authReady = false;
    let redirectReady = false;
    const finishLoading = () => {
      if (active && authReady && redirectReady) setLoading(false);
    };

    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      if (!active) return;
      const authStateUser = nextUser ? `user: ${formatAuthDebugUser(nextUser)}` : "null";
      console.log("auth state user:", authStateUser);
      mergeAuthDebug(setAuthDebug, { authStateUser });
      setUser(nextUser);
      authReady = true;
      finishLoading();
    });

    mergeAuthDebug(setAuthDebug, { redirectResult: "checking" });
    getRedirectResult(auth)
      .then((result) => {
        if (!active) return;
        const redirectResult = result?.user ? `user: ${formatAuthDebugUser(result.user)}` : "null";
        console.log("redirect result:", redirectResult);
        mergeAuthDebug(setAuthDebug, { redirectResult });
        if (result?.user) setUser(result.user);
      })
      .catch((err) => {
        if (!active) return;
        console.log("redirect result error:", err?.code || "unknown", err?.message || "");
        mergeAuthDebug(setAuthDebug, {
          redirectResult: "error",
          authErrorCode: err?.code || "unknown",
          authErrorMessage: err?.message || "Could not complete redirect sign-in.",
        });
        setRedirectError(authDebugErrorMessage(err));
      })
      .finally(() => {
        redirectReady = true;
        finishLoading();
      });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return {
    user,
    loading,
    redirectError,
    authDebug,
    updateAuthDebug: (patch) => mergeAuthDebug(setAuthDebug, patch),
  };
}

function useHouseholds(user) {
  const userId = user?.uid || "";
  const [state, setState] = useState({ memberships: [], loading: false, userId: "" });

  useEffect(() => {
    if (!userId || !db) {
      setState({ memberships: [], loading: false, userId });
      return undefined;
    }

    setState({ memberships: [], loading: true, userId });
    const membershipsQuery = query(collection(db, "users", userId, "households"), orderBy("name"));
    return onSnapshot(
      membershipsQuery,
      (snapshot) => {
        setState({
          memberships: snapshot.docs.map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() })),
          loading: false,
          userId,
        });
      },
      () => {
        setState({ memberships: [], loading: false, userId });
      }
    );
  }, [userId]);

  return state;
}

function useStockItems(householdId) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!householdId || !db) {
      setItems([]);
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    const itemsQuery = query(
      collection(db, "households", householdId, "stockItems"),
      orderBy("name")
    );

    return onSnapshot(
      itemsQuery,
      (snapshot) => {
        setItems(snapshot.docs.map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() })));
        setLoading(false);
      },
      () => {
        setItems([]);
        setLoading(false);
      }
    );
  }, [householdId]);

  return { items, loading };
}

function useShoppingList(householdId) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!householdId || !db) {
      setItems([]);
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    const itemsQuery = query(
      collection(db, "households", householdId, "shoppingList"),
      orderBy("createdAt")
    );

    return onSnapshot(
      itemsQuery,
      (snapshot) => {
        setItems(snapshot.docs.map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() })));
        setLoading(false);
      },
      () => {
        setItems([]);
        setLoading(false);
      }
    );
  }, [householdId]);

  return { items, loading };
}

function useRecipes(householdId) {
  const [recipes, setRecipes] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!householdId || !db) {
      setRecipes([]);
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    const recipesQuery = query(
      collection(db, "households", householdId, "recipes"),
      orderBy("name")
    );

    return onSnapshot(
      recipesQuery,
      (snapshot) => {
        setRecipes(snapshot.docs.map((recipeDoc) => ({ id: recipeDoc.id, ...recipeDoc.data() })));
        setLoading(false);
      },
      () => {
        setRecipes([]);
        setLoading(false);
      }
    );
  }, [householdId]);

  return { recipes, loading };
}

function useWeeklyPlan(householdId, weekId) {
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!householdId || !weekId || !db) {
      setPlan(null);
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    return onSnapshot(
      doc(db, "households", householdId, "weeklyPlans", weekId),
      (snapshot) => {
        setPlan(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : { id: weekId });
        setLoading(false);
      },
      () => {
        setPlan({ id: weekId });
        setLoading(false);
      }
    );
  }, [householdId, weekId]);

  return { plan, loading };
}

function MissingFirebaseConfig() {
  return (
    <main className="min-h-screen bg-stone-100 px-4 py-8">
      <section className="mx-auto max-w-xl rounded-xl bg-white p-5 shadow">
        <h1 className="text-xl font-bold text-slate-950">Firebase config needed</h1>
        <p className="mt-2 text-sm text-slate-600">
          Add the `VITE_FIREBASE_*` values in `.env` before running the app.
        </p>
      </section>
    </main>
  );
}

function SignInScreen({ authError = "", authDebug = EMPTY_AUTH_DEBUG, onAuthDebugChange = () => {} }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setError(authError);
  }, [authError]);

  const signIn = async () => {
    console.log("signIn clicked");
    onAuthDebugChange({
      signInClicked: true,
      authMethod: "starting",
      authErrorCode: "",
      authErrorMessage: "",
    });
    setBusy(true);
    setError("");
    try {
      const authMethod = shouldUseRedirectSignIn() ? "redirect" : "popup";
      console.log("selected auth method:", authMethod);
      onAuthDebugChange({ signInClicked: true, authMethod });

      if (authMethod === "redirect") {
        console.log("signInWithRedirect called");
        await signInWithRedirect(auth, googleProvider);
        return;
      }

      console.log("signInWithPopup called");
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      onAuthDebugChange({
        authErrorCode: err?.code || "unknown",
        authErrorMessage: err?.message || "Could not sign in.",
      });
      setError(authDebugErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const signInWithPopupFallback = async () => {
    console.log("alternative signIn clicked");
    onAuthDebugChange({
      signInClicked: true,
      authMethod: "popup-forced",
      authErrorCode: "",
      authErrorMessage: "",
    });
    setBusy(true);
    setError("");
    try {
      console.log("selected auth method:", "popup-forced");
      console.log("signInWithPopup called");
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      onAuthDebugChange({
        authErrorCode: err?.code || "unknown",
        authErrorMessage: err?.message || "Could not sign in.",
      });
      setError(authDebugErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-100 to-slate-200 p-6">
      <section className="mx-auto flex min-h-[80vh] max-w-md flex-col justify-center">
        <div className="rounded-xl bg-white p-5 shadow">
          <p className="text-sm font-medium text-slate-500">QuickStock</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-950">Shared kitchen inventory</h1>
          <button
            type="button"
            onClick={signIn}
            disabled={busy}
            className="mt-6 w-full rounded bg-black px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {busy ? "Signing in..." : "Continue with Google"}
          </button>
          <button
            type="button"
            onClick={signInWithPopupFallback}
            disabled={busy}
            className="mt-3 w-full rounded border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-950 disabled:opacity-60"
          >
            Try alternative Google sign-in
          </button>
          {error && (
            <pre className="mt-3 whitespace-pre-wrap rounded border border-rose-200 bg-rose-50 p-3 text-left text-xs text-rose-800">
              {error}
            </pre>
          )}
          <div className="mt-4 rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
            <p className="font-semibold text-slate-900">Auth debug:</p>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt>signInClicked</dt>
              <dd className="break-all">{String(Boolean(authDebug.signInClicked))}</dd>
              <dt>authMethod</dt>
              <dd className="break-all">{authDebug.authMethod || ""}</dd>
              <dt>redirectResult</dt>
              <dd className="break-all">{authDebug.redirectResult || ""}</dd>
              <dt>authStateUser</dt>
              <dd className="break-all">{authDebug.authStateUser || ""}</dd>
              <dt>authErrorCode</dt>
              <dd className="break-all">{authDebug.authErrorCode || ""}</dd>
              <dt>authErrorMessage</dt>
              <dd className="break-all">{authDebug.authErrorMessage || ""}</dd>
            </dl>
          </div>
        </div>
      </section>
    </main>
  );
}

function HouseholdBar({
  user,
  memberships,
  selectedId,
  onSelect,
  onCreated,
  loading,
}) {
  const [name, setName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [manageOpen, setManageOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [renameName, setRenameName] = useState("");
  const [busy, setBusy] = useState(false);
  const [joinBusy, setJoinBusy] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [renameBusy, setRenameBusy] = useState(false);
  const [error, setError] = useState("");
  const [joinError, setJoinError] = useState("");
  const [inviteError, setInviteError] = useState("");
  const [renameError, setRenameError] = useState("");
  const [renameMessage, setRenameMessage] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const [householdDetails, setHouseholdDetails] = useState(null);
  const [memberDetails, setMemberDetails] = useState(null);
  const [inviteCodeOverride, setInviteCodeOverride] = useState("");

  const selectedHousehold = memberships.find((household) => household.id === selectedId);
  const currentRole = memberDetails?.role || selectedHousehold?.role || "";
  const isAdmin = currentRole === "admin";
  const displayHouseholdName =
    householdDetails?.name || selectedHousehold?.name || "Household inventory";
  const selectedInviteCode =
    inviteCodeOverride || selectedHousehold?.inviteCode || householdDetails?.inviteCode || "";

  useEffect(() => {
    setCopyMessage("");
    setInviteError("");
    setManageOpen(false);
    setSettingsOpen(false);
    setInviteCodeOverride("");
    setRenameError("");
    setRenameMessage("");
    setHouseholdDetails(null);
    setMemberDetails(null);
  }, [selectedId]);

  useEffect(() => {
    if (!manageOpen) return;
    setRenameName(householdDetails?.name || selectedHousehold?.name || "");
  }, [householdDetails?.name, manageOpen, selectedHousehold?.name]);

  useEffect(() => {
    if (!selectedId || !db) {
      setHouseholdDetails(null);
      return undefined;
    }

    return onSnapshot(
      doc(db, "households", selectedId),
      (snapshot) => setHouseholdDetails(snapshot.exists() ? snapshot.data() : null),
      () => setHouseholdDetails(null),
    );
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId || !user?.uid || !db) {
      setMemberDetails(null);
      return undefined;
    }

    return onSnapshot(
      doc(db, "households", selectedId, "members", user.uid),
      (snapshot) => setMemberDetails(snapshot.exists() ? snapshot.data() : null),
      () => setMemberDetails(null),
    );
  }, [selectedId, user?.uid]);

  const createHousehold = async (event) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    setBusy(true);
    setError("");
    try {
      const householdRef = doc(collection(db, "households"));
      const memberRef = doc(db, "households", householdRef.id, "members", user.uid);
      const userHouseholdRef = doc(db, "users", user.uid, "households", householdRef.id);
      const householdSummary = {
        name: trimmed,
        role: "admin",
        inviteCode: makeInviteCode(),
      };
      const inviteRef = doc(db, "householdInvites", householdSummary.inviteCode);
      const batch = writeBatch(db);

      batch.set(householdRef, {
        name: householdSummary.name,
        inviteCode: householdSummary.inviteCode,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.set(memberRef, {
        uid: user.uid,
        displayName: user.displayName || "",
        email: user.email || "",
        photoURL: user.photoURL || "",
        role: "admin",
        joinedAt: serverTimestamp(),
      });
      batch.set(userHouseholdRef, {
        ...householdSummary,
        householdId: householdRef.id,
        joinedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.set(inviteRef, {
        householdId: householdRef.id,
        name: householdSummary.name,
        inviteCode: householdSummary.inviteCode,
        updatedAt: serverTimestamp(),
      });

      await batch.commit();
      onCreated({ id: householdRef.id, ...householdSummary });
      onSelect(householdRef.id);
      setName("");
      setManageOpen(false);
    } catch (err) {
      setError(err.message || "Could not create household.");
    } finally {
      setBusy(false);
    }
  };

  const ensureInviteCode = async () => {
    if (!selectedHousehold || !isAdmin) return "";

    const code = selectedInviteCode || makeInviteCode();
    const householdName =
      householdDetails?.name || selectedHousehold.name || "Household";
    const batch = writeBatch(db);

    if (!selectedInviteCode) {
      batch.update(doc(db, "households", selectedHousehold.id), {
        inviteCode: code,
        updatedAt: serverTimestamp(),
      });
    }

    batch.set(
      doc(db, "users", user.uid, "households", selectedHousehold.id),
      {
        householdId: selectedHousehold.id,
        name: householdName,
        role: currentRole || "admin",
        inviteCode: code,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    batch.set(
      doc(db, "householdInvites", code),
      {
        householdId: selectedHousehold.id,
        name: householdName,
        inviteCode: code,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    await batch.commit();
    setInviteCodeOverride(code);
    return code;
  };

  const openManageHousehold = async () => {
    setManageOpen(true);
    setError("");
    setJoinError("");
    setRenameError("");
    setRenameMessage("");
    setCopyMessage("");
    setRenameName(householdDetails?.name || selectedHousehold?.name || "");

    if (!selectedHousehold || !isAdmin || selectedInviteCode) return;

    setInviteBusy(true);
    setInviteError("");
    try {
      await ensureInviteCode();
    } catch (err) {
      setInviteError(err.message || "Could not load invite code.");
    } finally {
      setInviteBusy(false);
    }
  };

  const copyInviteCode = async () => {
    if (!selectedHousehold) return;

    setCopyMessage("");
    setInviteError("");
    try {
      const code = isAdmin ? await ensureInviteCode() : selectedInviteCode;
      if (!code) return;
      await navigator.clipboard.writeText(code);
      setCopyMessage("Copied");
    } catch (err) {
      setInviteError(err.message || "Could not copy invite code.");
      setCopyMessage("Copy failed");
    }
  };

  const renameHousehold = async (event) => {
    event.preventDefault();
    const trimmed = renameName.trim();
    if (!selectedHousehold || !isAdmin || !trimmed) return;

    setRenameBusy(true);
    setRenameError("");
    setRenameMessage("");
    try {
      const code = selectedInviteCode;
      const batch = writeBatch(db);
      batch.update(doc(db, "households", selectedHousehold.id), {
        name: trimmed,
        updatedAt: serverTimestamp(),
      });
      batch.set(
        doc(db, "users", user.uid, "households", selectedHousehold.id),
        {
          householdId: selectedHousehold.id,
          name: trimmed,
          role: currentRole || "admin",
          inviteCode: code || "",
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      if (code) {
        batch.set(
          doc(db, "householdInvites", code),
          {
            householdId: selectedHousehold.id,
            name: trimmed,
            inviteCode: code,
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
      }

      await batch.commit();
      setRenameMessage("Household renamed.");
    } catch (err) {
      setRenameError(err.message || "Could not rename household.");
    } finally {
      setRenameBusy(false);
    }
  };

  const joinHousehold = async (event) => {
    event.preventDefault();
    const code = inviteCode.trim().toUpperCase();
    if (!code) return;

    setJoinBusy(true);
    setJoinError("");
    try {
      const inviteSnapshot = await getDoc(doc(db, "householdInvites", code));

      if (!inviteSnapshot.exists()) {
        setJoinError("No household found for that invite code.");
        return;
      }

      const invite = inviteSnapshot.data();
      const householdId = invite.householdId;
      if (!householdId) {
        setJoinError("No household found for that invite code.");
        return;
      }

      const existingHousehold = memberships.find((household) => household.id === householdId);

      if (existingHousehold) {
        onSelect(existingHousehold.id);
        setInviteCode("");
        setJoinError("You are already in that household.");
        return;
      }

      const householdSummary = {
        name: invite.name || "Household",
        role: "member",
        inviteCode: invite.inviteCode || code,
      };
      const memberRef = doc(db, "households", householdId, "members", user.uid);
      const userHouseholdRef = doc(db, "users", user.uid, "households", householdId);
      const batch = writeBatch(db);

      batch.set(memberRef, {
        uid: user.uid,
        displayName: user.displayName || "",
        email: user.email || "",
        photoURL: user.photoURL || "",
        role: "member",
        inviteCode: code,
        joinedAt: serverTimestamp(),
      });
      batch.set(userHouseholdRef, {
        ...householdSummary,
        householdId,
        joinedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await batch.commit();
      onCreated({ id: householdId, ...householdSummary });
      onSelect(householdId);
      setInviteCode("");
      setManageOpen(false);
    } catch (err) {
      setJoinError(err.message || "Could not join household.");
    } finally {
      setJoinBusy(false);
    }
  };

  const selectHousehold = (householdId) => {
    onSelect(householdId);
  };

  return (
    <>
      <header className="mb-7 flex items-center justify-between gap-3 rounded-2xl border border-stone-200/80 bg-white/90 p-4 shadow-sm">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">QuickStock</p>
          <h1 className="mt-1 truncate text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">
            {displayHouseholdName}
          </h1>
        </div>
        <div className="hidden items-center gap-2 lg:flex">
          <label className="flex h-11 items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
            <span>Household</span>
            <select
              value={selectedId}
              onChange={(event) => selectHousehold(event.target.value)}
              disabled={loading || memberships.length === 0}
              className="h-11 min-w-52 rounded-xl border border-slate-300 bg-white px-3 text-sm normal-case tracking-normal text-slate-900 disabled:opacity-60"
            >
              {loading && memberships.length === 0 ? (
                <option value="">Loading households...</option>
              ) : memberships.length === 0 ? (
                <option value="">No households yet</option>
              ) : null}
              {memberships.map((household) => (
                <option key={household.id} value={household.id}>
                  {household.name || "Household"}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={openManageHousehold}
            className="h-11 rounded-xl bg-emerald-700 px-3 text-sm font-semibold text-white shadow-sm hover:bg-emerald-800"
          >
            Manage Household
          </button>
          <button
            type="button"
            onClick={() => signOut(auth)}
            className="h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm hover:bg-slate-50"
          >
            Sign out
          </button>
        </div>
        <div className="flex shrink-0 items-center gap-2 lg:hidden">
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            aria-label="Household settings"
            className="grid h-11 w-11 place-items-center rounded-xl border border-slate-300 bg-white text-lg hover:bg-slate-50"
          >
            ⚙️
          </button>
          <button
            type="button"
            onClick={() => signOut(auth)}
            aria-label="Sign out"
            className="grid h-11 w-11 place-items-center rounded-xl border border-slate-300 bg-white text-lg hover:bg-slate-50"
          >
            ⏻
          </button>
        </div>
      </header>

      {settingsOpen && (
        <div className="fixed inset-0 z-40 flex items-start justify-end bg-slate-950/30 p-3 lg:hidden">
          <button
            type="button"
            aria-label="Close household settings"
            className="absolute inset-0 cursor-default"
            onClick={() => setSettingsOpen(false)}
          />
          <section className="relative mt-16 w-full max-w-sm rounded-2xl bg-white p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                Household
              </p>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="min-h-9 rounded-xl border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
              >
                Close
              </button>
            </div>
            <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-wide text-slate-500">
              Household
              <select
                value={selectedId}
                onChange={(event) => selectHousehold(event.target.value)}
                disabled={loading || memberships.length === 0}
                className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm normal-case tracking-normal text-slate-900 disabled:opacity-60"
              >
                {loading && memberships.length === 0 ? (
                  <option value="">Loading households...</option>
                ) : memberships.length === 0 ? (
                  <option value="">No households yet</option>
                ) : null}
                {memberships.map((household) => (
                  <option key={household.id} value={household.id}>
                    {household.name || "Household"}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => {
                setSettingsOpen(false);
                openManageHousehold();
              }}
              className="mt-3 min-h-11 w-full rounded-xl bg-emerald-700 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-800"
            >
              Manage Household
            </button>
          </section>
        </div>
      )}

      {manageOpen && (
        <div className="fixed inset-0 z-50 flex items-end bg-slate-950/40 p-0 sm:items-center sm:p-4">
          <section className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white p-4 shadow-xl sm:mx-auto sm:max-w-2xl sm:rounded-2xl sm:p-5">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                  Household
                </p>
                <h2 className="mt-1 text-2xl font-bold text-slate-950">Manage Household</h2>
              </div>
              <button
                type="button"
                onClick={() => setManageOpen(false)}
                className="min-h-10 rounded-xl border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50"
              >
                Close
              </button>
            </div>

            {selectedHousehold && (
              <div className="mb-4 rounded-2xl border border-slate-200 p-3">
                <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Current household
                    </p>
                    <p className="text-lg font-semibold text-slate-950">{displayHouseholdName}</p>
                    {currentRole && (
                      <p className="text-xs capitalize text-slate-500">{currentRole}</p>
                    )}
                  </div>
                </div>

                {isAdmin && (
                  <form onSubmit={renameHousehold} className="mb-4 flex flex-col gap-2 sm:flex-row">
                    <input
                      value={renameName}
                      onChange={(event) => setRenameName(event.target.value)}
                      placeholder="Household name"
                      className="min-h-11 min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm"
                    />
                    <button
                      type="submit"
                      disabled={renameBusy || !renameName.trim()}
                      className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                    >
                      {renameBusy ? "Saving..." : "Rename"}
                    </button>
                  </form>
                )}
                {renameError && <p className="mb-3 text-sm text-rose-700">{renameError}</p>}
                {renameMessage && <p className="mb-3 text-sm text-emerald-700">{renameMessage}</p>}

                <div className="flex flex-col gap-2 border-t border-slate-100 pt-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Invite code
                    </p>
                    <p className="font-mono text-sm font-semibold text-slate-950">
                      {inviteBusy ? "Loading..." : selectedInviteCode || "No invite code yet"}
                    </p>
                    {inviteError && <p className="mt-1 text-sm text-rose-700">{inviteError}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    {copyMessage && <span className="text-xs text-slate-500">{copyMessage}</span>}
                    <button
                      type="button"
                      onClick={copyInviteCode}
                      disabled={inviteBusy || (!isAdmin && !selectedInviteCode)}
                      className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
                    >
                      Copy invite code
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="grid gap-3 lg:grid-cols-2">
              <form onSubmit={createHousehold} className="rounded-2xl border border-slate-200 p-3">
                <p className="mb-2 text-sm font-semibold text-slate-950">Create household</p>
                <div className="flex gap-2">
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder={loading ? "Loading households..." : "New household name"}
                    className="min-h-11 min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  />
                  <button
                    type="submit"
                    disabled={busy || !name.trim()}
                    className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                  >
                    {busy ? "Creating..." : "Create"}
                  </button>
                </div>
                {error && <p className="mt-2 text-sm text-rose-700">{error}</p>}
              </form>

              <form onSubmit={joinHousehold} className="rounded-2xl border border-slate-200 p-3">
                <p className="mb-2 text-sm font-semibold text-slate-950">Join household</p>
                <div className="flex gap-2">
                  <input
                    value={inviteCode}
                    onChange={(event) => setInviteCode(event.target.value)}
                    placeholder="Invite code"
                    className="min-h-11 min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm uppercase"
                  />
                  <button
                    type="submit"
                    disabled={joinBusy || !inviteCode.trim()}
                    className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {joinBusy ? "Joining..." : "Join"}
                  </button>
                </div>
                {joinError && <p className="mt-2 text-sm text-rose-700">{joinError}</p>}
              </form>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function ProductModal({ open, product, onClose, onSave }) {
  const [form, setForm] = useState({
    name: "",
    emoji: "🍎",
    packSize: 1,
    shelfLifeDays: 7,
    freezer: false,
    autoAddWhenEmpty: false,
    isBase: false,
    labelsText: "",
  });

  useEffect(() => {
    if (!open) return;
    setForm({
      name: product?.name || "",
      emoji: product?.emoji || pickEmoji(product?.name || ""),
      packSize: product?.packSize || 1,
      shelfLifeDays: product?.shelfLifeDays || 7,
      freezer: Boolean(product?.freezer),
      autoAddWhenEmpty: Boolean(product?.autoAddWhenEmpty),
      isBase: Boolean(product?.isBase),
      labelsText: (product?.labels || []).join(", "),
    });
  }, [open, product]);

  if (!open) return null;

  const save = () => {
    const name = form.name.trim();
    if (!name) return;
    onSave({
      name,
      emoji: form.emoji || pickEmoji(name),
      packSize: Math.max(1, Number(form.packSize) || 1),
      shelfLifeDays: Math.max(1, Number(form.shelfLifeDays) || 7),
      freezer: Boolean(form.freezer),
      autoAddWhenEmpty: Boolean(form.autoAddWhenEmpty),
      isBase: Boolean(form.isBase),
      labels: form.labelsText
        .split(",")
        .map((label) => label.trim())
        .filter(Boolean),
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-[520px] max-w-[95vw] rounded-xl bg-white p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-lg font-semibold">{product ? "Edit product" : "Add product"}</div>
          <button onClick={onClose} className="rounded bg-slate-100 px-2 py-1 text-sm hover:bg-slate-200">
            Close
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm">
            Name
            <input
              value={form.name}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  name: event.target.value,
                  emoji: current.emoji || pickEmoji(event.target.value),
                }))
              }
              className="mt-1 w-full rounded border px-2 py-1"
              placeholder="e.g., Milk"
            />
          </label>
          <label className="text-sm">
            Emoji
            <input
              value={form.emoji}
              onChange={(event) => setForm((current) => ({ ...current, emoji: event.target.value }))}
              className="mt-1 w-full rounded border px-2 py-1 text-2xl"
            />
          </label>
          <label className="text-sm">
            Pack size
            <input
              type="number"
              min={1}
              value={form.packSize}
              onChange={(event) => setForm((current) => ({ ...current, packSize: event.target.value }))}
              className="mt-1 w-full rounded border px-2 py-1"
            />
          </label>
          <label className="text-sm">
            Shelf-life days
            <input
              type="number"
              min={1}
              value={form.shelfLifeDays}
              onChange={(event) =>
                setForm((current) => ({ ...current, shelfLifeDays: event.target.value }))
              }
              className="mt-1 w-full rounded border px-2 py-1"
            />
          </label>
          <label className="col-span-2 text-sm">
            Labels
            <input
              value={form.labelsText}
              onChange={(event) => setForm((current) => ({ ...current, labelsText: event.target.value }))}
              className="mt-1 w-full rounded border px-2 py-1"
              placeholder="Dinner, breakfast, pantry"
            />
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={form.freezer}
              onChange={(event) => setForm((current) => ({ ...current, freezer: event.target.checked }))}
            />
            Frozen
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={form.autoAddWhenEmpty}
              onChange={(event) =>
                setForm((current) => ({ ...current, autoAddWhenEmpty: event.target.checked }))
              }
            />
            Auto-add when empty
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={form.isBase}
              onChange={(event) => setForm((current) => ({ ...current, isBase: event.target.checked }))}
            />
            Basisvare
          </label>
        </div>
        <div className="mt-4 flex items-center justify-between">
          <div className="text-sm text-slate-600">
            Preview: <span className="ml-2 text-2xl">{form.emoji || pickEmoji(form.name)}</span>
          </div>
          <button onClick={save} className="rounded bg-black px-3 py-1.5 text-white hover:opacity-90">
            {product ? "Save changes" : "Add product"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ProductCard({ product, onPatch, onEdit, onDelete, onAddToShoppingList, soonDays }) {
  const units = withExpiryApplied(toUnits(product));
  const count = countInStock(units);
  const availableCount = getAvailableStockUnitCount(product);
  const available = isStockItemAvailable(product);
  const expired = units.filter((unit) => unit.state === "expired").length;
  const soon = soonCount(units, soonDays);
  const activeUnits = units.filter((unit) => unit.state !== "empty");
  const displayedUnits = activeUnits.slice(0, 18);
  const [manage, setManage] = useState(false);

  const patchUnits = async (nextUnits, extraPatch = {}) => {
    const hadStock = countInStock(units) > 0;
    const hasStock = countInStock(nextUnits) > 0;
    await onPatch({ ...extraPatch, items: nextUnits });
    if (product.autoAddWhenEmpty && hadStock && !hasStock) {
      await onAddToShoppingList();
    }
  };
  const addUnits = (amount = 1) =>
    patchUnits(units.concat(Array.from({ length: amount }, () => genUnit(product.shelfLifeDays))));

  const cycleUnit = (unitId) =>
    patchUnits(
      units.map((unit) =>
        unit.id === unitId ? { ...unit, state: nextState[unit.state || "full"] || "full" } : unit
      )
    );

  const changeSome = (fromStates, toState, amount) => {
    let left = amount;
    patchUnits(
      units.map((unit) => {
        if (left > 0 && fromStates.includes(unit.state || "full")) {
          left -= 1;
          return { ...unit, state: toState };
        }
        return unit;
      })
    );
  };

  return (
    <div
      className={`rounded-2xl border p-4 shadow-sm transition hover:shadow-md ${
        available ? "border-emerald-100 bg-white" : "border-slate-200 bg-slate-50/80 opacity-75"
      }`}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <button
          onClick={() => addUnits(1)}
          className={`grid h-24 w-24 shrink-0 touch-manipulation place-items-center rounded-2xl text-6xl transition ${
            available
              ? "bg-emerald-50 hover:bg-emerald-100"
              : "bg-slate-100 grayscale opacity-60 hover:bg-slate-200"
          }`}
          aria-label={`Add ${product.name}`}
        >
          {product.emoji || pickEmoji(product.name)}
        </button>
        <div className="flex shrink-0 flex-col gap-2">
          <button
            type="button"
            onClick={() => addUnits(1)}
            className="grid h-10 w-10 touch-manipulation place-items-center rounded-xl bg-emerald-700 text-lg font-bold text-white shadow-sm hover:bg-emerald-800"
            aria-label={`Add one ${product.name}`}
          >
            +
          </button>
          <button
            type="button"
            onClick={() => changeSome(["opened", "full", "expired"], "empty", 1)}
            disabled={count === 0}
            className="grid h-10 w-10 touch-manipulation place-items-center rounded-xl border border-stone-200 bg-white text-lg font-bold text-slate-700 shadow-sm hover:bg-stone-50 disabled:opacity-40"
            aria-label={`Use one ${product.name}`}
          >
            -
          </button>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-lg font-semibold text-slate-950">{product.name}</h3>
            {product.freezer && <span className="text-xs">Frozen</span>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-800">{availableCount} in stock</span>
            {!available && <span className="rounded-full bg-slate-200 px-2 py-0.5 text-slate-600">Out of stock</span>}
            <span className="rounded-full bg-stone-100 px-2 py-0.5">pack {product.packSize || 1}</span>
            {product.isBase && <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-indigo-700">Basisvare</span>}
            {(product.labels || []).map((label) => (
              <span key={label} className="rounded-full bg-stone-100 px-2 py-0.5">
                {label}
              </span>
            ))}
          </div>
        </div>
        <button onClick={() => setManage((value) => !value)} className="min-h-9 rounded-xl border px-2 py-1 text-xs font-medium hover:bg-slate-50">
          Manage
        </button>
      </div>

      <div className="mb-3 flex min-h-9 flex-wrap gap-1.5">
        {displayedUnits.length === 0 ? (
          <button
            onClick={() => addUnits(1)}
            className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-500"
          >
            add first unit
          </button>
        ) : (
          displayedUnits.map((unit) => (
            <button
              key={unit.id}
              onClick={() => cycleUnit(unit.id)}
              className={`grid h-10 w-10 touch-manipulation place-items-center rounded-full border text-base ${
                unit.state === "opened"
                  ? "border-amber-200 bg-amber-50"
                  : unit.state === "expired"
                    ? "border-rose-200 bg-rose-50"
                    : "border-emerald-200 bg-emerald-50"
              }`}
              title={unit.state || "full"}
            >
              {product.emoji || pickEmoji(product.name)}
            </button>
          ))
        )}
        {activeUnits.length > displayedUnits.length && (
          <span className="grid h-10 place-items-center rounded-full bg-slate-100 px-2 text-xs text-slate-500">
            +{activeUnits.length - displayedUnits.length}
          </span>
        )}
      </div>

      <div className="mb-3 flex flex-wrap gap-2 text-xs">
        {expired > 0 && (
          <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-1 text-rose-700">
            {expired} expired
          </span>
        )}
        {soon > 0 && (
          <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-1 text-sky-700">
            {soon} expiring
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={() => addUnits(product.packSize || 1)} className="min-h-10 rounded-xl border px-3 py-1.5 text-sm hover:bg-slate-50">
          + pack
        </button>
        <button onClick={() => changeSome(["full"], "opened", 1)} className="min-h-10 rounded-xl border px-3 py-1.5 text-sm hover:bg-slate-50">
          Open
        </button>
        <button
          onClick={() => changeSome(["opened", "full", "expired"], "empty", 1)}
          className="min-h-10 rounded-xl border px-3 py-1.5 text-sm hover:bg-slate-50"
        >
          Empty
        </button>
        <button
          onClick={() => changeSome(["full", "opened"], "expired", 1)}
          className="min-h-10 rounded-xl border px-3 py-1.5 text-sm hover:bg-slate-50"
        >
          Expire
        </button>
        <button
          onClick={onAddToShoppingList}
          className="min-h-10 rounded-xl border px-3 py-1.5 text-sm hover:bg-slate-50"
        >
          Add to list
        </button>
        {manage && (
          <>
            <button onClick={onEdit} className="min-h-10 rounded-xl border px-3 py-1.5 text-sm hover:bg-slate-50">
              Edit
            </button>
            <button
              onClick={onDelete}
              className="min-h-10 rounded-xl border border-rose-200 px-3 py-1.5 text-sm text-rose-700 hover:bg-rose-50"
            >
              Delete
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function FridgeProductCard({ product, onPatch, onEdit, onDelete, onAddToShoppingList, soonDays }) {
  const units = withExpiryApplied(toUnits(product));
  const count = countInStock(units);
  const availableCount = getAvailableStockUnitCount(product);
  const available = isStockItemAvailable(product);
  const expired = units.filter((unit) => unit.state === "expired").length;
  const soon = soonCount(units, soonDays);
  const activeUnits = units.filter((unit) => unit.state !== "empty");
  const displayedUnits = activeUnits.slice(0, 24);
  const [manage, setManage] = useState(false);
  const emoji = product.emoji || pickEmoji(product.name);
  const fridgeCardClass = !available
    ? "border-slate-200 bg-slate-50/80 ring-slate-200 opacity-75"
    : product.freezer
    ? "border-sky-100 bg-sky-50/80 ring-sky-100"
    : expired > 0
      ? "border-rose-100 bg-rose-50/70 ring-rose-100"
      : soon > 0
        ? "border-amber-100 bg-amber-50/80 ring-amber-100"
        : "border-emerald-100 bg-emerald-50/80 ring-emerald-100";

  const patchUnits = async (nextUnits, extraPatch = {}) => {
    const hadStock = countInStock(units) > 0;
    const hasStock = countInStock(nextUnits) > 0;
    await onPatch({ ...extraPatch, items: nextUnits });
    if (product.autoAddWhenEmpty && hadStock && !hasStock) {
      await onAddToShoppingList();
    }
  };

  const addUnits = (amount = 1) =>
    patchUnits(units.concat(Array.from({ length: amount }, () => genUnit(product.shelfLifeDays))));

  const cycleUnit = (unitId) =>
    patchUnits(
      units.map((unit) =>
        unit.id === unitId ? { ...unit, state: nextState[unit.state || "full"] || "full" } : unit
      )
    );

  const changeSome = (fromStates, toState, amount) => {
    let left = amount;
    patchUnits(
      units.map((unit) => {
        if (left > 0 && fromStates.includes(unit.state || "full")) {
          left -= 1;
          return { ...unit, state: toState };
        }
        return unit;
      })
    );
  };

  return (
    <div className={`relative flex min-h-[400px] flex-col rounded-[2rem] border p-6 text-center shadow-sm ring-1 transition hover:shadow-md ${fridgeCardClass}`}>
      <div
        className={`absolute right-4 top-4 grid h-12 w-12 place-items-center rounded-full text-base font-bold text-white shadow-sm ${
          available ? "bg-emerald-700" : "bg-slate-500"
        }`}
      >
        {availableCount}
      </div>

      <button
        type="button"
        onClick={() => addUnits(1)}
        className={`mx-auto mt-5 grid h-40 w-40 touch-manipulation place-items-center rounded-[1.75rem] text-9xl shadow-sm transition ${
          available ? "bg-white/80 hover:bg-white" : "bg-white/70 grayscale opacity-60 hover:bg-white/90"
        }`}
        aria-label={`Add ${product.name}`}
      >
        {emoji}
      </button>

      <div className="mt-5">
        <h3 className="mx-auto max-w-[14rem] text-2xl font-bold leading-tight tracking-tight text-slate-950">
          {product.name}
        </h3>
        <div className="mt-2 flex min-h-6 flex-wrap justify-center gap-1.5 text-xs">
          {!available && <span className="rounded-full bg-slate-200 px-2.5 py-1 font-medium text-slate-600">Out of stock</span>}
          {product.freezer && <span className="rounded-full bg-white/85 px-2.5 py-1 text-slate-700">Frozen</span>}
          {product.isBase && <span className="rounded-full bg-white/85 px-2.5 py-1 text-slate-700">Basisvare</span>}
          {expired > 0 && (
            <span className="rounded-full bg-rose-100 px-2.5 py-1 font-medium text-rose-700">{expired} expired</span>
          )}
          {soon > 0 && (
            <span className="rounded-full bg-amber-100 px-2.5 py-1 font-medium text-amber-800">
              {soon} expiring
            </span>
          )}
        </div>
      </div>

      <div className="mt-5 flex justify-center gap-2">
        <button
          type="button"
          onClick={onEdit}
          className="min-h-11 rounded-full bg-white/85 px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm hover:bg-white"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={() => setManage((value) => !value)}
          className="min-h-11 rounded-full bg-white/85 px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm hover:bg-white"
        >
          Manage
        </button>
        <button
          type="button"
          onClick={onAddToShoppingList}
          className="grid min-h-11 min-w-11 touch-manipulation place-items-center rounded-full bg-white/85 px-4 py-2 text-lg shadow-sm hover:bg-white"
          aria-label={`Add ${product.name} to shopping list`}
          title="Add to list"
        >
          🛒
        </button>
        <button
          type="button"
          onClick={() => changeSome(["opened", "full", "expired"], "empty", 1)}
          disabled={count === 0}
          className="grid min-h-11 min-w-11 touch-manipulation place-items-center rounded-full bg-white/85 px-4 py-2 text-lg font-bold text-slate-800 shadow-sm hover:bg-white disabled:opacity-40"
          aria-label={`Use one ${product.name}`}
        >
          -
        </button>
        <button
          type="button"
          onClick={() => addUnits(1)}
          className="grid min-h-11 min-w-11 touch-manipulation place-items-center rounded-full bg-emerald-700 px-4 py-2 text-lg font-bold text-white shadow-sm hover:bg-emerald-800"
          aria-label={`Add one ${product.name}`}
        >
          +
        </button>
      </div>

      <div className="mt-5 flex min-h-12 flex-wrap justify-center gap-2">
        {displayedUnits.length === 0 ? (
          <button
            type="button"
            onClick={() => addUnits(1)}
            className="rounded-full bg-white/70 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-white"
          >
            add first unit
          </button>
        ) : (
          displayedUnits.map((unit) => (
            <button
              key={unit.id}
              type="button"
              onClick={() => cycleUnit(unit.id)}
              className={`grid h-11 w-11 touch-manipulation place-items-center rounded-full border text-lg shadow-sm ${
                unit.state === "opened"
                  ? "border-amber-200 bg-amber-50"
                  : unit.state === "expired"
                    ? "border-rose-200 bg-rose-50"
                    : "border-white bg-white/85"
              }`}
              title={unit.state || "full"}
            >
              {emoji}
            </button>
          ))
        )}
        {activeUnits.length > displayedUnits.length && (
          <span className="grid h-11 place-items-center rounded-full bg-white/80 px-3 text-xs font-semibold text-slate-600">
            +{activeUnits.length - displayedUnits.length}
          </span>
        )}
      </div>

      {manage && (
        <div className="mt-5 flex flex-wrap justify-center gap-2 border-t border-white/70 pt-4">
          <button onClick={() => addUnits(product.packSize || 1)} className="min-h-10 rounded-full bg-white/80 px-3 py-1.5 text-sm hover:bg-white">
            + pack
          </button>
          <button onClick={() => changeSome(["full"], "opened", 1)} className="min-h-10 rounded-full bg-white/80 px-3 py-1.5 text-sm hover:bg-white">
            Open
          </button>
          <button
            onClick={() => changeSome(["opened", "full", "expired"], "empty", 1)}
            className="min-h-10 rounded-full bg-white/80 px-3 py-1.5 text-sm hover:bg-white"
          >
            Empty
          </button>
          <button
            onClick={() => changeSome(["full", "opened"], "expired", 1)}
            className="min-h-10 rounded-full bg-white/80 px-3 py-1.5 text-sm hover:bg-white"
          >
            Expire
          </button>
          <button
            onClick={onDelete}
            className="min-h-10 rounded-full bg-rose-50 px-3 py-1.5 text-sm text-rose-700 hover:bg-rose-100"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

function ShoppingListPanel({
  householdId,
  shoppingItems,
  shoppingLoading,
  stockItems,
  hideChecked,
  setHideChecked,
  onOpenInventory,
}) {
  const visibleItems = hideChecked
    ? shoppingItems.filter((item) => !item.checked)
    : shoppingItems;

  const checkItem = async (shoppingItem, checked) => {
    const shoppingRef = doc(db, "households", householdId, "shoppingList", shoppingItem.id);

    if (!checked) {
      await updateDoc(shoppingRef, { checked: false, updatedAt: serverTimestamp() });
      return;
    }

    await runTransaction(db, async (transaction) => {
      const shoppingSnapshot = await transaction.get(shoppingRef);
      if (!shoppingSnapshot.exists()) return;

      const latestShoppingItem = { id: shoppingSnapshot.id, ...shoppingSnapshot.data() };
      if (latestShoppingItem.checkedAt) {
        transaction.update(shoppingRef, {
          checked: true,
          updatedAt: serverTimestamp(),
        });
        return;
      }

      const linkedStockItemId = shoppingStockItemId(latestShoppingItem) || shoppingStockItemId(shoppingItem);
      const itemName = (latestShoppingItem.name || shoppingItem.name || "").trim();
      const matchingStockItem = stockItems.find((item) => normalize(item.name) === normalize(itemName));
      let stockRef = linkedStockItemId
        ? doc(db, "households", householdId, "stockItems", linkedStockItemId)
        : null;
      let stockSnapshot = stockRef ? await transaction.get(stockRef) : null;

      if (!stockSnapshot?.exists() && matchingStockItem && matchingStockItem.id !== linkedStockItemId) {
        stockRef = doc(db, "households", householdId, "stockItems", matchingStockItem.id);
        stockSnapshot = await transaction.get(stockRef);
      }

      let resolvedStockItemId = stockSnapshot?.exists() ? stockSnapshot.id : "";
      if (stockSnapshot?.exists()) {
        const stockItem = { id: stockSnapshot.id, ...stockSnapshot.data() };
        const restockAmount = shoppingRestockAmount(latestShoppingItem, stockItem);
        const nextUnits = toUnits(stockItem).concat(
          Array.from({ length: restockAmount }, () => genUnit(stockItem.shelfLifeDays))
        );
        transaction.update(stockRef, {
          items: nextUnits,
          quantity: countInStock(nextUnits),
          updatedAt: serverTimestamp(),
        });
      } else if (itemName) {
        const restockAmount = shoppingRestockAmount(latestShoppingItem);
        const nextUnits = Array.from({ length: restockAmount }, () => genUnit(30));
        stockRef = doc(collection(db, "households", householdId, "stockItems"));
        resolvedStockItemId = stockRef.id;
        transaction.set(stockRef, {
          name: itemName,
          emoji: latestShoppingItem.emoji || "🧺",
          unit: latestShoppingItem.unit || "pcs",
          packSize: restockAmount,
          shelfLifeDays: 30,
          freezer: false,
          autoAddWhenEmpty: false,
          isBase: false,
          labels: ["Shopping"],
          items: nextUnits,
          quantity: countInStock(nextUnits),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      transaction.update(shoppingRef, {
        checked: true,
        checkedAt: serverTimestamp(),
        ...(resolvedStockItemId
          ? {
              sourceStockItemId: resolvedStockItemId,
              stockItemId: resolvedStockItemId,
            }
          : {}),
        updatedAt: serverTimestamp(),
      });
    });
  };

  const deleteShoppingItem = (shoppingItemId) => {
    if (!window.confirm("Remove this shopping item?")) return;
    deleteDoc(doc(db, "households", householdId, "shoppingList", shoppingItemId));
  };

  const clearShoppingList = async () => {
    if (!window.confirm("Clear all shopping list items?")) return;
    await deleteCollectionDocs(collection(db, "households", householdId, "shoppingList"));
  };

  return (
    <aside className="rounded-2xl border border-sky-100 bg-white p-4 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-end gap-3">
        <label className="flex min-h-10 items-center gap-2 rounded-full bg-slate-50 px-3 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={hideChecked}
            onChange={(event) => setHideChecked(event.target.checked)}
          />
          Hide checked
        </label>
        <button
          type="button"
          onClick={clearShoppingList}
          disabled={shoppingItems.length === 0}
          className="min-h-10 rounded-full border border-rose-100 bg-white px-3 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-40"
        >
          Clear Shopping List
        </button>
      </div>

      {shoppingLoading ? (
        <div className="rounded-xl bg-sky-50 p-3 text-sm text-slate-500">Loading list...</div>
      ) : visibleItems.length === 0 ? (
        <div className="rounded-xl bg-sky-50 p-3 text-sm text-slate-500">
          <p>{shoppingItems.length > 0 ? "All shopping items are checked." : "Shopping list is empty."}</p>
          <p className="mt-1">Add items from Inventory or generate missing meal-plan ingredients.</p>
          {onOpenInventory && (
            <button
              type="button"
              onClick={onOpenInventory}
              className="mt-3 min-h-10 rounded-xl border border-sky-200 bg-white px-3 py-2 text-sm font-medium text-sky-800 hover:bg-sky-50"
            >
              Open Inventory
            </button>
          )}
        </div>
      ) : (
        <ul className="space-y-2.5">
          {visibleItems.map((item) => {
            const sourceStockItemId = shoppingStockItemId(item);
            const sourceStockItem = sourceStockItemId
              ? stockItems.find((stockItem) => stockItem.id === sourceStockItemId)
              : null;
            const emoji = item.emoji || sourceStockItem?.emoji || pickEmoji(item.name);
            const checked = Boolean(item.checked);
            const recipeQuantity = recipeQuantityText(item.recipeQuantity);
            const recipeAmount = recipeQuantity
              ? `${recipeQuantity} ${item.recipeUnit || item.unit || ""}`.trim()
              : "";
            const purchaseAmount = item.packs
              ? `${item.packs} pack${Number(item.packs) === 1 ? "" : "s"}`
              : "1 item";
            return (
              <li
                key={item.id}
                className={`flex items-center justify-between gap-3 rounded-2xl border px-3 py-3.5 text-sm shadow-sm transition hover:shadow-md ${
                  checked
                    ? "border-emerald-100 bg-emerald-50/70 text-slate-500"
                    : "border-sky-100 bg-white text-slate-900"
                }`}
              >
                <label className="flex min-w-0 flex-1 items-center gap-3">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => checkItem(item, event.target.checked)}
                    className="h-5 w-5 accent-emerald-700"
                  />
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-sky-50 text-2xl">
                    {checked ? "✓" : emoji}
                  </span>
                  <span className="min-w-0">
                    <span className={`block truncate font-semibold ${checked ? "line-through opacity-70" : ""}`}>
                      {item.name}
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-500">
                      {recipeAmount || purchaseAmount}
                      {item.autoGenerated ? " · from meal plan" : ""}
                    </span>
                  </span>
                </label>
                <button
                  onClick={() => deleteShoppingItem(item.id)}
                  className="min-h-10 rounded-xl border border-rose-100 bg-white/80 px-2.5 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50"
                >
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}

const emptyIngredient = () => ({
  stockItemId: "",
  createStockItem: false,
  nameSnapshot: "",
  emoji: "🧺",
  quantity: 1,
  unit: "pcs",
});

function RecipeModal({ open, recipe, stockItems, householdId, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: "",
    emoji: "🍽️",
    servings: 4,
    ingredients: [emptyIngredient()],
    stepsText: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setError("");
    setForm({
      name: recipe?.name || "",
      emoji: recipe?.emoji || "🍽️",
      servings: recipe?.servings || 4,
      ingredients:
        recipe?.ingredients?.length > 0
          ? recipe.ingredients.map((ingredient) => {
              const linkedStockItem = stockItems.find((item) => item.id === ingredient.stockItemId);
              const ingredientName = ingredient.nameSnapshot || "";
              return {
                stockItemId: ingredient.stockItemId || "",
                createStockItem: false,
                nameSnapshot: ingredientName,
                emoji: pickEmoji(ingredientName || linkedStockItem?.name || ""),
                quantity: ingredient.quantity ?? 1,
                unit: ingredient.unit || "pcs",
              };
            })
          : [emptyIngredient()],
      stepsText: (recipe?.steps || []).join("\n"),
    });
  }, [open, recipe, stockItems]);

  if (!open) return null;

  const updateIngredient = (index, patch) => {
    setForm((current) => ({
      ...current,
      ingredients: current.ingredients.map((ingredient, ingredientIndex) =>
        ingredientIndex === index ? { ...ingredient, ...patch } : ingredient
      ),
    }));
  };

  const removeIngredient = (index) => {
    setForm((current) => ({
      ...current,
      ingredients:
        current.ingredients.length === 1
          ? [emptyIngredient()]
          : current.ingredients.filter((_, ingredientIndex) => ingredientIndex !== index),
    }));
  };

  const selectIngredientStockItem = (index, stockItem) => {
    setForm((current) => ({
      ...current,
      ingredients: current.ingredients.map((ingredient, ingredientIndex) => {
        if (ingredientIndex !== index) return ingredient;

        return {
          ...ingredient,
          createStockItem: false,
          stockItemId: stockItem.id,
          nameSnapshot: stockItem.name,
          emoji: stockItem.emoji || pickEmoji(stockItem.name),
        };
      }),
    }));
  };

  const unlinkIngredientStockItem = (index) => {
    updateIngredient(index, { stockItemId: "", createStockItem: false });
  };

  const getStockItemSearchMatches = (query) => {
    const normalizedQuery = normalize(query || "");
    if (!normalizedQuery) return [];
    return stockItems
      .filter((item) => normalize(item.name).includes(normalizedQuery))
      .slice(0, 6);
  };

  const saveRecipe = async () => {
    const name = form.name.trim();
    if (!name) return;

    setSaving(true);
    setError("");
    try {
      const ingredients = [];
      for (const ingredient of form.ingredients) {
        const quantity = recipeQuantityText(ingredient.quantity);
        if (!quantity) continue;

        const stockItem = stockItems.find((item) => item.id === ingredient.stockItemId);
        const itemName = ingredient.nameSnapshot.trim() || stockItem?.name || "";
        if (!itemName) continue;

        if (ingredient.createStockItem && !stockItem) {
          const existingStockItem = stockItems.find((item) => normalize(item.name) === normalize(itemName));
          const linkedStockItem =
            existingStockItem ||
            (await addDoc(collection(db, "households", householdId, "stockItems"), {
              name: itemName,
              emoji: ingredient.emoji || pickEmoji(itemName),
              packSize: 1,
              shelfLifeDays: 30,
              freezer: false,
              autoAddWhenEmpty: false,
              isBase: false,
              labels: ["Recipe"],
              items: [],
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            }));

          ingredients.push({
            stockItemId: existingStockItem?.id || linkedStockItem.id,
            nameSnapshot: itemName,
            quantity,
            unit: ingredient.unit || "pcs",
          });
          continue;
        }

        ingredients.push({
          stockItemId: stockItem?.id || "",
          nameSnapshot: itemName,
          quantity,
          unit: ingredient.unit || "pcs",
        });
      }

      const payload = {
        name,
        emoji: form.emoji || "🍽️",
        servings: Math.max(1, Number(form.servings) || 1),
        ingredients,
        steps: form.stepsText
          .split("\n")
          .map((step) => step.trim())
          .filter(Boolean),
        updatedAt: serverTimestamp(),
      };

      if (recipe?.id) {
        await updateDoc(doc(db, "households", householdId, "recipes", recipe.id), payload);
      } else {
        await addDoc(collection(db, "households", householdId, "recipes"), {
          ...payload,
          createdAt: serverTimestamp(),
        });
      }
      onSaved();
    } catch (err) {
      setError(err.message || "Could not save recipe.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="max-h-[92vh] w-[720px] max-w-[96vw] overflow-auto rounded-xl bg-white p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-lg font-semibold">{recipe ? "Edit recipe" : "Create recipe"}</div>
          <button onClick={onClose} className="rounded bg-slate-100 px-2 py-1 text-sm hover:bg-slate-200">
            Close
          </button>
        </div>

        <div className="grid grid-cols-[80px_1fr_110px] gap-3">
          <label className="text-sm">
            Emoji
            <input
              value={form.emoji}
              onChange={(event) => setForm((current) => ({ ...current, emoji: event.target.value }))}
              className="mt-1 w-full rounded border px-2 py-1 text-2xl"
            />
          </label>
          <label className="text-sm">
            Name
            <input
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              className="mt-1 w-full rounded border px-2 py-1"
              placeholder="Tacos"
            />
          </label>
          <label className="text-sm">
            Servings
            <input
              type="number"
              min={1}
              value={form.servings}
              onChange={(event) => setForm((current) => ({ ...current, servings: event.target.value }))}
              className="mt-1 w-full rounded border px-2 py-1"
            />
          </label>
        </div>

        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="font-medium">Ingredients</div>
            <button
              onClick={() =>
                setForm((current) => ({
                  ...current,
                  ingredients: [...current.ingredients, emptyIngredient()],
                }))
              }
              className="rounded border px-2 py-1 text-sm hover:bg-slate-50"
            >
              + Ingredient
            </button>
          </div>

          <div className="space-y-2">
            {form.ingredients.map((ingredient, index) => {
              const linkedStockItem = stockItems.find((item) => item.id === ingredient.stockItemId);
              const stockMatches = linkedStockItem ? [] : getStockItemSearchMatches(ingredient.nameSnapshot);
              const canCreateStockItem = Boolean(!linkedStockItem && ingredient.nameSnapshot.trim());

              return (
                <div key={index} className="rounded-lg border border-slate-200 p-2">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_90px_90px_auto]">
                    <label className="text-xs font-medium text-slate-600">
                      Ingredient / stock item
                      <input
                        value={ingredient.nameSnapshot}
                        onChange={(event) =>
                          updateIngredient(index, {
                            nameSnapshot: event.target.value,
                            emoji: ingredient.emoji || pickEmoji(event.target.value),
                          })
                        }
                        className="mt-1 w-full rounded border px-2 py-1 text-sm font-normal text-slate-900"
                        placeholder="Type to search or name ingredient"
                      />
                    </label>
                    <label className="text-xs font-medium text-slate-600">
                      Quantity
                      <input
                        type="text"
                        value={ingredient.quantity}
                        onChange={(event) => updateIngredient(index, { quantity: event.target.value })}
                        className="mt-1 w-full rounded border px-2 py-1 text-sm font-normal text-slate-900"
                        placeholder="Qty"
                      />
                    </label>
                    <label className="text-xs font-medium text-slate-600">
                      Unit
                      <input
                        value={ingredient.unit}
                        onChange={(event) => updateIngredient(index, { unit: event.target.value })}
                        className="mt-1 w-full rounded border px-2 py-1 text-sm font-normal text-slate-900"
                        placeholder="unit"
                      />
                    </label>
                    <button
                      onClick={() => removeIngredient(index)}
                      className="self-end rounded border border-rose-200 px-2 py-1 text-sm text-rose-700 hover:bg-rose-50"
                    >
                      Remove
                    </button>
                  </div>

                  <div className="mt-2 flex min-h-9 flex-wrap items-center gap-2 text-xs">
                    {linkedStockItem && (
                      <button
                        type="button"
                        onClick={() => unlinkIngredientStockItem(index)}
                        className="rounded-full border border-slate-200 px-2 py-1 text-slate-600 hover:bg-slate-50"
                        aria-label={`Clear selected stock item for ${ingredient.nameSnapshot || "ingredient"}`}
                      >
                        Clear
                      </button>
                    )}
                    {!linkedStockItem && (
                      <label
                        className={`flex items-center gap-1 rounded-full border px-2 py-1 ${
                          canCreateStockItem
                            ? "border-slate-200 text-slate-600"
                            : "border-slate-100 text-slate-400"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={ingredient.createStockItem}
                          disabled={!canCreateStockItem}
                          onChange={(event) =>
                            updateIngredient(index, {
                              createStockItem: event.target.checked,
                              stockItemId: event.target.checked ? "" : ingredient.stockItemId,
                            })
                          }
                        />
                        Create this as a new stock item
                      </label>
                    )}
                  </div>

                  {stockMatches.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {stockMatches.map((stockItem) => (
                        <button
                          key={stockItem.id}
                          type="button"
                          onClick={() => selectIngredientStockItem(index, stockItem)}
                          className="rounded-full border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100"
                        >
                          {stockItem.emoji || pickEmoji(stockItem.name)} {stockItem.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <label className="mt-4 block text-sm">
          Steps
          <textarea
            value={form.stepsText}
            onChange={(event) => setForm((current) => ({ ...current, stepsText: event.target.value }))}
            className="mt-1 min-h-28 w-full rounded border px-2 py-1"
            placeholder={"One step per line\nCook pasta\nAdd sauce"}
          />
        </label>

        {error && <p className="mt-3 text-sm text-rose-700">{error}</p>}
        <div className="mt-4 flex justify-end">
          <button
            onClick={saveRecipe}
            disabled={saving || !form.name.trim()}
            className="rounded bg-black px-3 py-1.5 text-white hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Saving..." : recipe ? "Save recipe" : "Create recipe"}
          </button>
        </div>
      </div>
    </div>
  );
}

function RecipeManager({ householdId, stockItems }) {
  const { recipes, loading } = useRecipes(householdId);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const closeModal = () => {
    setEditing(null);
    setModalOpen(false);
  };

  const deleteRecipe = (recipe) => {
    if (!window.confirm(`Delete "${recipe.name}"?`)) return;
    deleteDoc(doc(db, "households", householdId, "recipes", recipe.id));
  };

  return (
    <section className="rounded-xl bg-white p-3 shadow">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="font-semibold">Recipes</div>
        <button
          onClick={() => setModalOpen(true)}
          className="rounded border border-slate-300 px-2 py-1 text-sm hover:bg-slate-50"
        >
          + Recipe
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-slate-500">Loading recipes...</div>
      ) : recipes.length === 0 ? (
        <div className="rounded-xl bg-amber-50 p-3 text-sm text-slate-600">
          <p>No recipes yet.</p>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="mt-3 min-h-10 rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm font-medium text-amber-900 hover:bg-amber-50"
          >
            Add first recipe
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {recipes.map((recipe) => (
            <article key={recipe.id} className="rounded-lg border border-slate-100 p-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-medium">
                    <span className="mr-1">{recipe.emoji || "🍽️"}</span>
                    {recipe.name}
                  </div>
                  <div className="text-xs text-slate-500">
                    {recipe.servings || 1} servings · {(recipe.ingredients || []).length} ingredients
                  </div>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => {
                      setEditing(recipe);
                      setModalOpen(true);
                    }}
                    className="rounded border px-2 py-1 text-xs hover:bg-slate-50"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => deleteRecipe(recipe)}
                    className="rounded border border-rose-200 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
              {(recipe.ingredients || []).length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {recipe.ingredients.slice(0, 5).map((ingredient, index) => (
                    <span key={index} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                      {ingredient.nameSnapshot}
                    </span>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      <RecipeModal
        open={modalOpen}
        recipe={editing}
        stockItems={stockItems}
        householdId={householdId}
        onClose={closeModal}
        onSaved={closeModal}
      />
    </section>
  );
}

function RecipeOpenModal({ recipe, onClose }) {
  const [cookingMode, setCookingMode] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const steps = recipe?.steps || [];

  useEffect(() => {
    setCookingMode(false);
    setStepIndex(0);
  }, [recipe?.id]);

  if (!recipe) return null;

  if (cookingMode) {
    const currentStep = steps[stepIndex] || "No steps added yet.";

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <div className="flex min-h-[70vh] w-[760px] max-w-[96vw] flex-col rounded-xl bg-white p-5 shadow-xl">
          <div className="mb-5 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-2xl font-bold text-slate-950">
                <span className="mr-2">{recipe.emoji || "ðŸ½ï¸"}</span>
                {recipe.name}
              </div>
              <div className="mt-1 text-sm text-slate-500">
                Step {steps.length ? stepIndex + 1 : 0} / {steps.length}
              </div>
            </div>
            <button
              onClick={() => setCookingMode(false)}
              className="rounded border border-slate-300 px-4 py-3 text-sm hover:bg-slate-50"
            >
              Exit
            </button>
          </div>

          <div className="flex flex-1 items-center justify-center rounded-xl bg-slate-50 p-6 text-center">
            <p className="text-3xl font-semibold leading-snug text-slate-950 sm:text-4xl">
              {currentStep}
            </p>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3">
            <button
              onClick={() => setStepIndex((current) => Math.max(0, current - 1))}
              disabled={stepIndex === 0}
              className="rounded bg-slate-100 px-4 py-4 text-lg font-semibold text-slate-900 hover:bg-slate-200 disabled:opacity-40"
            >
              Previous
            </button>
            <button
              onClick={() =>
                setStepIndex((current) => Math.min(Math.max(steps.length - 1, 0), current + 1))
              }
              disabled={steps.length === 0 || stepIndex >= steps.length - 1}
              className="rounded bg-black px-4 py-4 text-lg font-semibold text-white hover:opacity-90 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="max-h-[90vh] w-[560px] max-w-[96vw] overflow-auto rounded-xl bg-white p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-lg font-semibold">
              <span className="mr-1">{recipe.emoji || "🍽️"}</span>
              {recipe.name}
            </div>
            <div className="text-xs text-slate-500">{recipe.servings || 1} servings</div>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              onClick={() => {
                setStepIndex(0);
                setCookingMode(true);
              }}
              disabled={steps.length === 0}
              className="rounded bg-black px-3 py-2 text-sm text-white hover:opacity-90 disabled:opacity-40"
            >
              <span className="sm:hidden">Start</span>
              <span className="hidden sm:inline">Start cooking</span>
            </button>
            <button onClick={onClose} className="rounded bg-slate-100 px-2 py-1 text-sm hover:bg-slate-200">
              Close
            </button>
          </div>
        </div>

        {(recipe.ingredients || []).length > 0 && (
          <section className="mb-4">
            <div className="mb-2 text-sm font-medium">Ingredients</div>
            <ul className="space-y-1 text-sm">
              {recipe.ingredients.map((ingredient, index) => (
                <li key={index} className="flex justify-between gap-3 rounded bg-slate-50 px-2 py-1">
                  <span>{ingredient.nameSnapshot}</span>
                  <span className="text-slate-500">
                    {ingredient.quantity} {ingredient.unit}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {(recipe.steps || []).length > 0 && (
          <section>
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="text-sm font-medium">Steps</div>
            </div>
            <ol className="space-y-2 text-sm">
              {recipe.steps.map((step, index) => (
                <li key={index} className="rounded border border-slate-100 px-3 py-2">
                  <span className="mr-2 text-slate-400">{index + 1}.</span>
                  {step}
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>
    </div>
  );
}

function WeeklyMenu({
  householdId,
  recipes,
  stockItems,
  shoppingItems = [],
  onOpenRecipes,
  openRecipe,
  onOpenRecipe,
  onCloseRecipe,
}) {
  const [selectedWeekStart, setSelectedWeekStart] = useState(() => getStartOfIsoWeek(new Date()));
  const selectedWeekId = getIsoWeekId(selectedWeekStart);
  const selectedWeekStartDate = toDateInputValue(selectedWeekStart);
  const { plan, loading } = useWeeklyPlan(householdId, selectedWeekId);
  const [generating, setGenerating] = useState(false);
  const [completingDay, setCompletingDay] = useState("");
  const [undoingDay, setUndoingDay] = useState("");
  const [message, setMessage] = useState("");

  const planRef = doc(db, "households", householdId, "weeklyPlans", selectedWeekId);
  const days = plan?.days || {};
  const weeklyReadiness = useMemo(
    () => getWeeklyReadiness(plan, recipes, stockItems),
    [plan, recipes, stockItems]
  );

  const saveDay = async (day, patch) => {
    await setDoc(
      planRef,
      {
        days: {
          ...days,
          [day]: {
            recipeId: days[day]?.recipeId || "",
            notes: days[day]?.notes || "",
            consumedAt: days[day]?.consumedAt || null,
            consumptionUndo: days[day]?.consumptionUndo || [],
            ...patch,
          },
        },
        weekId: selectedWeekId,
        weekStartDate: selectedWeekStartDate,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  };

  const removeDay = (day) => {
    if (!window.confirm(`Remove ${day}'s meal from this week?`)) return;
    saveDay(day, { recipeId: "", notes: "", consumedAt: null, consumptionUndo: [] });
  };

  const markMealDone = async (day, recipe) => {
    if (!recipe || days[day]?.consumedAt) return;

    setCompletingDay(day);
    setMessage("");
    try {
      const latestPlan = await getDoc(planRef);
      const latestDay = latestPlan.exists() ? latestPlan.data()?.days?.[day] : null;
      if (latestDay?.consumedAt) {
        setMessage("Meal is already marked done.");
        return;
      }

      const batch = writeBatch(db);
      const skipped = [];
      const undoRecords = [];
      const requiredByStockItem = new Map();

      (recipe.ingredients || []).forEach((ingredient) => {
        const ingredientName = ingredient.nameSnapshot || "Ingredient";
        if (!ingredient.stockItemId) {
          skipped.push(`${ingredientName}: not linked to stock`);
          return;
        }

        // TODO: Support fractional quantities and unit conversion. For v1, stock is consumed
        // as whole household units so cooking reduces maintenance without blocking the flow.
        const quantity = Math.max(0, Math.ceil(Number(ingredient.quantity) || 0));
        if (quantity <= 0) return;

        const current = requiredByStockItem.get(ingredient.stockItemId) || {
          quantity: 0,
          names: [],
        };
        current.quantity += quantity;
        current.names.push(ingredientName);
        requiredByStockItem.set(ingredient.stockItemId, current);
      });

      requiredByStockItem.forEach((required, stockItemId) => {
        const stockItem = stockItems.find((item) => item.id === stockItemId);
        if (!stockItem) {
          skipped.push(`${required.names.join(", ")}: stock item not found`);
          return;
        }

        let remaining = required.quantity;
        const consumedUnits = [];
        const nextUnits = withExpiryApplied(toUnits(stockItem)).map((unit) => {
          if (remaining <= 0 || !canConsumeUnit(unit)) return unit;
          remaining -= 1;
          consumedUnits.push({ ...unit });
          return { ...unit, state: "empty", emptiedAt: now() };
        });
        const consumed = required.quantity - remaining;

        if (consumed > 0) {
          undoRecords.push({
            stockItemId: stockItem.id,
            name: stockItem.name,
            units: consumedUnits,
          });
          batch.update(doc(db, "households", householdId, "stockItems", stockItem.id), {
            items: nextUnits,
            quantity: countInStock(nextUnits),
            updatedAt: serverTimestamp(),
          });
        }

        if (remaining > 0) {
          skipped.push(`${stockItem.name}: consumed ${consumed}/${required.quantity}`);
        }
      });

      batch.set(
        planRef,
        {
          days: {
            ...days,
            [day]: {
              recipeId: days[day]?.recipeId || recipe.id,
              notes: days[day]?.notes || "",
              consumedAt: serverTimestamp(),
              consumptionUndo: undoRecords,
            },
          },
          weekId: selectedWeekId,
          weekStartDate: selectedWeekStartDate,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      await batch.commit();
      setMessage(
        skipped.length > 0
          ? `Done cooking. Skipped or partial: ${skipped.join("; ")}.`
          : "Done cooking. Linked ingredients were consumed from stock."
      );
    } catch (err) {
      setMessage(err.message || "Could not mark meal as done.");
    } finally {
      setCompletingDay("");
    }
  };

  const undoMealDone = async (day) => {
    const dayPlan = days[day] || {};
    if (!dayPlan.consumedAt) return;

    setUndoingDay(day);
    setMessage("");
    try {
      const batch = writeBatch(db);
      const skipped = [];

      (dayPlan.consumptionUndo || []).forEach((record) => {
        const stockItem = stockItems.find((item) => item.id === record.stockItemId);
        if (!stockItem) {
          skipped.push(`${record.name || "Stock item"}: stock item not found`);
          return;
        }

        const restoreById = new Map((record.units || []).map((unit) => [unit.id, unit]));
        let restored = 0;
        const nextUnits = toUnits(stockItem).map((unit) => {
          const original = restoreById.get(unit.id);
          if (!original) return unit;
          restored += 1;
          return original;
        });

        if (restored > 0) {
          batch.update(doc(db, "households", householdId, "stockItems", stockItem.id), {
            items: nextUnits,
            quantity: countInStock(nextUnits),
            updatedAt: serverTimestamp(),
          });
        }

        if (restored < (record.units || []).length) {
          skipped.push(`${stockItem.name}: restored ${restored}/${(record.units || []).length}`);
        }
      });

      batch.set(
        planRef,
        {
          days: {
            ...days,
            [day]: {
              recipeId: dayPlan.recipeId || "",
              notes: dayPlan.notes || "",
              consumedAt: null,
              consumptionUndo: [],
            },
          },
          weekId: selectedWeekId,
          weekStartDate: selectedWeekStartDate,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      await batch.commit();
      setMessage(
        skipped.length > 0
          ? `Cooking undone. Some stock could not be fully restored: ${skipped.join("; ")}.`
          : "Cooking undone. Consumed stock was restored."
      );
    } catch (err) {
      setMessage(err.message || "Could not undo cooking.");
    } finally {
      setUndoingDay("");
    }
  };

  const clearWeek = async () => {
    const hasCompletedMeals = WEEK_DAYS.some((day) => days[day]?.consumedAt);
    const message = hasCompletedMeals
      ? "This week has completed meals. Clear the plan without restoring stock?"
      : "Clear this week's meal plan?";
    if (!window.confirm(message)) {
      return;
    }

    setMessage("");
    try {
      await setDoc(
        planRef,
        {
          days: WEEK_DAYS.reduce((nextDays, day) => {
            nextDays[day] = {
              recipeId: "",
              notes: "",
              consumedAt: null,
              consumptionUndo: [],
            };
            return nextDays;
          }, {}),
          weekId: selectedWeekId,
          weekStartDate: selectedWeekStartDate,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      setMessage("Week cleared.");
    } catch (err) {
      setMessage(err.message || "Could not clear week.");
    }
  };

  const generateMissingIngredients = async () => {
    const plannedEntries = WEEK_DAYS.map((day) => ({
      day,
      recipe: recipes.find((recipe) => recipe.id === days[day]?.recipeId),
    })).filter((entry) => entry.recipe);

    if (plannedEntries.length === 0) {
      setMessage("Select recipes before generating ingredients.");
      return;
    }

    setGenerating(true);
    setMessage("");
    try {
      const batch = writeBatch(db);
      const availabilityById = getStockAvailability(stockItems);
      let added = 0;

      plannedEntries.forEach(({ day, recipe }) => {
        (recipe.ingredients || []).forEach((ingredient) => {
          const stockItem = ingredient.stockItemId
            ? stockItems.find((item) => item.id === ingredient.stockItemId)
            : stockItems.find((item) => normalize(item.name) === normalize(ingredient.nameSnapshot));
          const isAvailable = stockItem ? Boolean(availabilityById.get(stockItem.id)) : false;
          const requiredQuantity = recipeQuantityText(ingredient.quantity);
          const recipeUnit = ingredient.unit || "";
          const missingQuantity = isAvailable ? 0 : 1;
          const needsReview = !stockItem || !ingredient.stockItemId;

          if (missingQuantity <= 0) return;

          const existingItem = shoppingItems.find((item) => {
            if (item.sourceType !== "weeklyPlan") return false;
            if ((item.weekId || item.sourceWeeklyPlanId) !== selectedWeekId) return false;
            if (item.dayKey !== day) return false;
            if ((item.recipeId || item.sourceRecipeId) !== recipe.id) return false;
            if ((item.ingredientStockItemId || "") !== (ingredient.stockItemId || "")) return false;
            if (ingredient.stockItemId) return true;
            return normalize(item.name) === normalize(ingredient.nameSnapshot) && (item.unit || "") === recipeUnit;
          });

          if (existingItem) return;

          const shoppingRef = doc(collection(db, "households", householdId, "shoppingList"));
          batch.set(shoppingRef, {
            name: ingredient.nameSnapshot,
            quantity: 1,
            unit: recipeUnit,
            packs: 1,
            recipeQuantity: requiredQuantity || null,
            recipeUnit,
            checked: false,
            needsReview,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            sourceStockItemId: stockItem?.id || ingredient.stockItemId || "",
            stockItemId: stockItem?.id || ingredient.stockItemId || "",
            ingredientStockItemId: ingredient.stockItemId || "",
            sourceType: "weeklyPlan",
            sourceRecipeId: recipe.id,
            recipeId: recipe.id,
            sourceWeeklyPlanId: selectedWeekId,
            weekId: selectedWeekId,
            dayKey: day,
            autoGenerated: true,
          });
          added += 1;
        });
      });

      if (added > 0) {
        await batch.commit();
      }
      setMessage(added > 0 ? `Added ${added} shopping item(s).` : "Nothing missing.");
    } catch (err) {
      setMessage(err.message || "Could not generate missing ingredients.");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <section className="rounded-2xl border border-emerald-100 bg-white p-4 shadow-sm">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-xs text-slate-500">
          {selectedWeekId} · starts {selectedWeekStartDate}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            onClick={clearWeek}
            disabled={loading}
            className="min-h-10 rounded-xl border border-rose-200 px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
          >
            Clear Week
          </button>
          <button
            onClick={generateMissingIngredients}
            disabled={generating || loading}
            className="min-h-10 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
          >
            {generating ? "Adding..." : "Add Missing Items"}
          </button>
        </div>
      </div>

      {weeklyReadiness.plannedCount > 0 && (
        <div className="mb-4">
          <div className="mb-1 flex items-center justify-between gap-3 text-xs font-medium text-slate-600">
            <span>
              {weeklyReadiness.readyCount}/{weeklyReadiness.plannedCount} meals ready
            </span>
            <span>{weeklyReadiness.readyPercent}% ready</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-emerald-600 transition-all"
              style={{ width: `${weeklyReadiness.readyPercent}%` }}
            />
          </div>
        </div>
      )}

      <div className="mb-4 grid grid-cols-3 gap-2">
        <button
          onClick={() => {
            setMessage("");
            setSelectedWeekStart((current) => shiftWeek(current, -1));
          }}
          className="min-h-11 rounded-xl border border-slate-200 bg-stone-50 px-2 py-2 text-sm font-medium hover:bg-stone-100"
        >
          Previous
        </button>
        <button
          onClick={() => {
            setMessage("");
            setSelectedWeekStart(getStartOfIsoWeek(new Date()));
          }}
          className="min-h-11 rounded-xl border border-emerald-200 bg-emerald-50 px-2 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100"
        >
          This week
        </button>
        <button
          onClick={() => {
            setMessage("");
            setSelectedWeekStart((current) => shiftWeek(current, 1));
          }}
          className="min-h-11 rounded-xl border border-slate-200 bg-stone-50 px-2 py-2 text-sm font-medium hover:bg-stone-100"
        >
          Next
        </button>
      </div>

      {recipes.length === 0 && (
        <div className="mb-4 rounded-2xl border border-amber-100 bg-amber-50 p-3 text-sm text-amber-900">
          <p>No recipes yet. Add a recipe before planning meals.</p>
          {onOpenRecipes && (
            <button
              type="button"
              onClick={onOpenRecipes}
              className="mt-3 min-h-10 rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm font-medium hover:bg-amber-50"
            >
              Open Recipes
            </button>
          )}
        </div>
      )}

      <div className="space-y-3">
        {WEEK_DAYS.map((day) => {
          const dayPlan = days[day] || {};
          const recipe = recipes.find((item) => item.id === dayPlan.recipeId);
          const consumed = Boolean(dayPlan.consumedAt);
          const dayStyle = DAY_STYLES[day] || DAY_STYLES.sunday;
          const readiness = weeklyReadiness.days[day];
          const readinessLabel = consumed ? "Completed" : readiness?.label || "";
          const readinessClassName =
            READINESS_BADGE_STYLES[consumed ? "completed" : readiness?.status] ||
            "bg-slate-100 text-slate-700";
          return (
            <div
              key={day}
              className={`rounded-2xl border p-3.5 shadow-sm transition hover:shadow-md ${
                consumed ? "border-emerald-300 bg-emerald-100/80 ring-1 ring-emerald-200" : dayStyle.className
              }`}
            >
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-2xl text-xl ${consumed ? "bg-emerald-600 text-white" : dayStyle.chip}`}>
                    {consumed ? "✓" : dayStyle.icon}
                  </div>
                  <div className="min-w-0">
                    <div className="text-base font-bold capitalize text-slate-950">{day}</div>
                    <div className="truncate text-xs text-slate-500">
                      {recipe ? `${recipe.emoji || "🍽"} ${recipe.name}` : "No meal planned"}
                    </div>
                  </div>
                  {recipe && readinessLabel && (
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${readinessClassName}`}>
                      {readinessLabel}
                    </span>
                  )}
                </div>
                {recipe && (
                  <div className="flex shrink-0 flex-wrap justify-end gap-2">
                    <button
                      onClick={() => onOpenRecipe(recipe)}
                      className="min-h-10 rounded-xl border border-slate-200 bg-white/90 px-2.5 py-1 text-xs font-medium hover:bg-white"
                    >
                      {(recipe.steps || []).length > 0 ? (
                        <>
                          <span className="sm:hidden">Start</span>
                          <span className="hidden sm:inline">Start Cooking</span>
                        </>
                      ) : (
                        "Open Recipe"
                      )}
                    </button>
                    <button
                      onClick={() => markMealDone(day, recipe)}
                      disabled={consumed || completingDay === day}
                      className="min-h-10 rounded-xl bg-emerald-700 px-2.5 py-1 text-xs font-semibold text-white shadow-sm hover:bg-emerald-800 disabled:opacity-50"
                    >
                      {consumed ? (
                        "Done"
                      ) : completingDay === day ? (
                        "Saving..."
                      ) : (
                        <>
                          <span className="sm:hidden">Done</span>
                          <span className="hidden sm:inline">Done Cooking</span>
                        </>
                      )}
                    </button>
                    {consumed && (
                      <button
                        onClick={() => undoMealDone(day)}
                        disabled={undoingDay === day}
                        className="min-h-10 rounded-xl border border-emerald-200 bg-white/90 px-2.5 py-1 text-xs font-medium text-emerald-800 hover:bg-white disabled:opacity-40"
                      >
                        {undoingDay === day ? "Undoing..." : "Undo"}
                      </button>
                    )}
                  </div>
                )}
              </div>
              <select
                value={dayPlan.recipeId || ""}
                onChange={(event) =>
                  saveDay(day, {
                    recipeId: event.target.value,
                    consumedAt: null,
                    consumptionUndo: [],
                  })
                }
                className="mb-2 min-h-11 w-full rounded-xl border border-slate-200 bg-white/90 px-3 py-2 text-sm"
              >
                <option value="">No recipe</option>
                {recipes.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <input
                value={dayPlan.notes || ""}
                onChange={(event) => saveDay(day, { notes: event.target.value })}
                className="min-h-11 w-full rounded-xl border border-slate-200 bg-white/90 px-3 py-2 text-sm"
                placeholder="Notes"
              />
              {(dayPlan.recipeId || dayPlan.notes) && (
                <button
                  onClick={() => removeDay(day)}
                  className="mt-3 min-h-9 rounded-xl border border-rose-200 bg-white px-2.5 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50"
                >
                  Remove
                </button>
              )}
            </div>
          );
        })}
      </div>

      {message && <p className="mt-3 text-sm text-slate-500">{message}</p>}
      <RecipeOpenModal recipe={openRecipe} onClose={onCloseRecipe} />
    </section>
  );
}

function Inventory({ householdId }) {
  const { items, loading } = useStockItems(householdId);
  const { items: shoppingItems, loading: shoppingLoading } = useShoppingList(householdId);
  const { recipes } = useRecipes(householdId);
  const today = new Date();
  const todayWeekId = getIsoWeekId(today);
  const todayDay = getWeekDayKey(today);
  const { plan: todayPlan } = useWeeklyPlan(householdId, todayWeekId);
  const [mainView, setMainView] = useState("weekly");
  const [inventoryMode, setInventoryMode] = useState("fridge");
  const [groupBy, setGroupBy] = useState("None");
  const [soonDays, setSoonDays] = useState(2);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [addingStarterPantry, setAddingStarterPantry] = useState(false);
  const [addingDemoRecipes, setAddingDemoRecipes] = useState(false);
  const [clearingStock, setClearingStock] = useState(false);
  const [clearingRecipes, setClearingRecipes] = useState(false);
  const [templateMessage, setTemplateMessage] = useState("");
  const [hideCheckedShoppingItems, setHideCheckedShoppingItems] = useState(false);
  const [openRecipe, setOpenRecipe] = useState(null);

  useEffect(() => {
    setMainView("weekly");
    setOpenRecipe(null);
  }, [householdId]);

  const stockSummary = useMemo(() => {
    const signals = items.map((item) => getStockSignals(item, soonDays));
    return {
      productCount: items.length,
      unitCount: signals.reduce((total, item) => total + item.inStock, 0),
      soonCount: signals.reduce((total, item) => total + item.soon, 0),
      expiredCount: signals.reduce((total, item) => total + item.expired, 0),
      shoppingCount: shoppingItems.filter((item) => !item.checked).length,
      recipeCount: recipes.length,
    };
  }, [items, recipes.length, shoppingItems, soonDays]);

  const todayMealPlan = todayPlan?.days?.[todayDay] || {};
  const todayRecipe = useMemo(
    () => recipes.find((recipe) => recipe.id === todayMealPlan.recipeId),
    [recipes, todayMealPlan.recipeId]
  );

  const statsStripItems = useMemo(() => {
    return [
      {
        label: "Menu",
        value: todayRecipe?.name || "No meal planned",
        valueClassName: "max-w-full break-words text-xl font-bold leading-tight",
        detail: "today",
        completed: Boolean(todayRecipe && todayMealPlan.consumedAt),
        targetView: "weekly",
      },
      {
        label: "Shopping",
        value: stockSummary.shoppingCount,
        detail: "open items",
        targetView: "shopping",
      },
      {
        label: "Inventory",
        value: stockSummary.unitCount,
        detail: `${stockSummary.productCount} products`,
        targetView: "inventory",
      },
      {
        label: "Recipes",
        value: stockSummary.recipeCount,
        detail: "saved",
        targetView: "recipes",
      },
    ];
  }, [stockSummary, todayMealPlan.consumedAt, todayRecipe]);

  const handleStatClick = (stat) => {
    if (!stat?.targetView) return;

    setMainView(stat.targetView);
    if (stat.targetView === "weekly") {
      setOpenRecipe(todayRecipe || null);
    }
  };

  const overviewGroups = useMemo(() => groupStockProducts(items, groupBy), [items, groupBy]);

  const inventoryProducts = useMemo(() => {
    if (inventoryMode === "fridge") {
      return items.filter((product) => !product.freezer);
    }
    if (inventoryMode === "expiring") {
      return items.filter((product) => {
        const signals = getStockSignals(product, soonDays);
        return signals.soon > 0 || signals.expired > 0;
      });
    }
    return items;
  }, [inventoryMode, items, soonDays]);

  const inventoryGroups = useMemo(
    () => groupStockProducts(inventoryProducts, groupBy),
    [inventoryProducts, groupBy]
  );

  const currentView = MAIN_VIEWS.find((view) => view.id === mainView) || MAIN_VIEWS[4];
  const showManagementControls = mainView === "overview";
  const showInventoryViewControls = mainView === "inventory";

  const saveProduct = async (payload) => {
    if (editing) {
      await updateDoc(doc(db, "households", householdId, "stockItems", editing.id), {
        ...payload,
        updatedAt: serverTimestamp(),
      });
    } else {
      await addDoc(collection(db, "households", householdId, "stockItems"), {
        ...payload,
        items: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    setEditing(null);
    setModalOpen(false);
  };

  const addStarterPantryItems = async () => {
    setAddingStarterPantry(true);
    setTemplateMessage("");
    try {
      const stockItemsRef = collection(db, "households", householdId, "stockItems");
      const stockSnapshot = await getDocs(stockItemsRef);
      const existingIds = new Set(stockSnapshot.docs.map((itemDoc) => itemDoc.id));
      const existingNames = new Set(
        stockSnapshot.docs.map((itemDoc) => pantryItemKey(itemDoc.data().name))
      );
      const itemsToAdd = starterStockItems.filter(
        (item) => !existingIds.has(seedDocId(item, "stock")) && !existingNames.has(pantryItemKey(item.name))
      );
      const skipped = starterStockItems.length - itemsToAdd.length;

      if (itemsToAdd.length > 0) {
        const batch = writeBatch(db);
        itemsToAdd.forEach((item) => {
          const data = { ...item };
          delete data.id;
          batch.set(doc(stockItemsRef, seedDocId(item, "stock")), {
            ...data,
            items: Array.isArray(data.items) ? data.items : [],
            quantity: Math.max(0, Number(data.quantity) || 0),
            labels: Array.isArray(data.labels) ? data.labels : ["Starter"],
            seeded: true,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        });
        await batch.commit();
      }

      setTemplateMessage(`Starter pantry import: added ${itemsToAdd.length}, skipped ${skipped} existing.`);
    } catch (err) {
      setTemplateMessage(err.message || "Could not add starter pantry items.");
    } finally {
      setAddingStarterPantry(false);
    }
  };

  const addDemoRecipes = async () => {
    setAddingDemoRecipes(true);
    setTemplateMessage("");
    try {
      const recipesRef = collection(db, "households", householdId, "recipes");
      const recipeSnapshot = await getDocs(recipesRef);
      const existingIds = new Set(recipeSnapshot.docs.map((recipeDoc) => recipeDoc.id));
      const existingNames = new Set(
        recipeSnapshot.docs.map((recipeDoc) => normalize(recipeDoc.data().name))
      );
      const recipesToAdd = demoRecipes.filter(
        (recipe) => !existingIds.has(seedDocId(recipe, "recipe")) && !existingNames.has(normalize(recipe.name))
      );
      const skipped = demoRecipes.length - recipesToAdd.length;

      if (recipesToAdd.length > 0) {
        const batch = writeBatch(db);
        recipesToAdd.forEach((recipe) => {
          const data = { ...recipe };
          delete data.id;
          batch.set(doc(recipesRef, seedDocId(recipe, "recipe")), {
            ...data,
            ingredients: Array.isArray(data.ingredients) ? data.ingredients : [],
            steps: Array.isArray(data.steps) ? data.steps : [],
            seeded: true,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        });
        await batch.commit();
      }

      setTemplateMessage(`Demo recipe import: added ${recipesToAdd.length}, skipped ${skipped} existing.`);
    } catch (err) {
      setTemplateMessage(err.message || "Could not add demo recipes.");
    } finally {
      setAddingDemoRecipes(false);
    }
  };

  const clearStockItems = async () => {
    if (!window.confirm("Are you sure? This will remove all stock items.")) return;

    setClearingStock(true);
    setTemplateMessage("");
    try {
      const deletedCount = await deleteCollectionDocs(
        collection(db, "households", householdId, "stockItems")
      );
      setTemplateMessage(
        deletedCount > 0 ? `Removed ${deletedCount} stock item(s).` : "Inventory is already empty."
      );
    } catch (err) {
      setTemplateMessage(err.message || "Could not clear inventory.");
    } finally {
      setClearingStock(false);
    }
  };

  const clearAllRecipes = async () => {
    if (!window.confirm("Are you sure? This will delete all recipes.")) return;

    setClearingRecipes(true);
    setTemplateMessage("");
    try {
      const deletedCount = await deleteCollectionDocs(
        collection(db, "households", householdId, "recipes")
      );
      setTemplateMessage(
        deletedCount > 0 ? `Deleted ${deletedCount} recipe(s).` : "Recipes are already empty."
      );
    } catch (err) {
      setTemplateMessage(err.message || "Could not clear recipes.");
    } finally {
      setClearingRecipes(false);
    }
  };

  const addStockItemToShoppingList = async (product) => {
    const existingItem = shoppingItems.find(
      (item) => !item.checked && shoppingStockItemId(item) === product.id
    );

    if (existingItem) {
      await updateDoc(doc(db, "households", householdId, "shoppingList", existingItem.id), {
        packs: Math.max(1, Number(existingItem.packs) || 1) + 1,
        quantity:
          (Math.max(1, Number(existingItem.packs) || 1) + 1) *
          Math.max(1, Number(product.packSize) || 1),
        sourceStockItemId: product.id,
        stockItemId: product.id,
        updatedAt: serverTimestamp(),
      });
      return;
    }

    await addDoc(collection(db, "households", householdId, "shoppingList"), {
      name: product.name,
      quantity: Math.max(1, Number(product.packSize) || 1),
      packs: 1,
      checked: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      sourceStockItemId: product.id,
      stockItemId: product.id,
      sourceType: "manual",
      sourceRecipeId: null,
      sourceWeeklyPlanId: null,
      autoGenerated: false,
    });
  };

  const openEdit = (product) => {
    setEditing(product);
    setModalOpen(true);
  };

  const closeModal = () => {
    setEditing(null);
    setModalOpen(false);
  };

  const deleteStockItem = (product) => {
    if (!window.confirm(`Delete "${product.name}" from inventory?`)) return;
    deleteDoc(doc(db, "households", householdId, "stockItems", product.id));
  };

  const renderStockCards = (groups, emptyText, fullWidth = false, showDefaultPantryAction = false) => (
    <div>
      {loading ? (
        <div className="rounded-2xl border border-slate-200/70 bg-white p-4 text-sm text-slate-500 shadow-sm">Loading stock...</div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-slate-200/70 bg-white p-4 text-sm text-slate-500 shadow-sm">
          <p>Add the first product to start this household inventory.</p>
          {showDefaultPantryAction && (
            <button
              onClick={addStarterPantryItems}
              disabled={addingStarterPantry}
              className="mt-3 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {addingStarterPantry ? "Adding..." : "Add starter pantry items"}
            </button>
          )}
          {!showDefaultPantryAction && (
            <button
              type="button"
              onClick={() => setMainView("overview")}
              className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100"
            >
              Open Management
            </button>
          )}
        </div>
      ) : groups.length === 0 ? (
        <div className="rounded-2xl border border-slate-200/70 bg-white p-4 text-sm text-slate-500 shadow-sm">{emptyText}</div>
      ) : (
        groups.map(([group, products]) => (
          <section key={group} className="mb-6">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {group} <span className="text-slate-400">({products.length})</span>
            </div>
            <div className={`grid grid-cols-1 gap-4 ${fullWidth ? "md:grid-cols-2 xl:grid-cols-3" : "sm:grid-cols-2"}`}>
              {products.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  soonDays={soonDays}
                  onPatch={(patch) =>
                    updateDoc(doc(db, "households", householdId, "stockItems", product.id), {
                      ...patch,
                      updatedAt: serverTimestamp(),
                    })
                  }
                  onAddToShoppingList={() => addStockItemToShoppingList(product)}
                  onEdit={() => openEdit(product)}
                  onDelete={() => deleteStockItem(product)}
                />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );

  const renderFridgeStockCards = (groups, emptyText) => (
    <div>
      {loading ? (
        <div className="rounded-2xl border border-slate-200/70 bg-white p-4 text-sm text-slate-500 shadow-sm">Loading stock...</div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-slate-200/70 bg-white p-4 text-sm text-slate-500 shadow-sm">
          <p>Add the first product to start this household inventory.</p>
          <button
            type="button"
            onClick={() => setMainView("overview")}
            className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100"
          >
            Open Management
          </button>
        </div>
      ) : groups.length === 0 ? (
        <div className="rounded-2xl border border-slate-200/70 bg-white p-4 text-sm text-slate-500 shadow-sm">{emptyText}</div>
      ) : (
        groups.map(([group, products]) => (
          <section key={group} className="mb-8">
            <div className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {group} <span className="text-slate-400">({products.length})</span>
            </div>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              {products.map((product) => (
                <FridgeProductCard
                  key={product.id}
                  product={product}
                  soonDays={soonDays}
                  onPatch={(patch) =>
                    updateDoc(doc(db, "households", householdId, "stockItems", product.id), {
                      ...patch,
                      updatedAt: serverTimestamp(),
                    })
                  }
                  onAddToShoppingList={() => addStockItemToShoppingList(product)}
                  onEdit={() => openEdit(product)}
                  onDelete={() => deleteStockItem(product)}
                />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );

  const renderControls = () => (
    <div className="mb-5 rounded-2xl border border-slate-200/70 bg-white/90 p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Current view
          </p>
          <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">
            <span aria-hidden="true">{currentView.icon}</span> {currentView.label}
          </h2>
        </div>
        {showManagementControls && (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setModalOpen(true)}
              className="rounded-xl bg-emerald-700 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-800"
            >
              + Add Product
            </button>
            <button
              onClick={addStarterPantryItems}
              disabled={addingStarterPantry || loading}
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
            >
              {addingStarterPantry ? "Adding..." : "Add starter pantry items"}
            </button>
            <button
              onClick={addDemoRecipes}
              disabled={addingDemoRecipes}
              className="rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm font-medium text-amber-800 hover:bg-amber-50 disabled:opacity-50"
            >
              {addingDemoRecipes ? "Adding..." : "Add demo recipes"}
            </button>
            <label className="flex items-center gap-2 text-sm">
              <span>Expiring within</span>
              <input
                type="number"
                min={1}
                value={soonDays}
                onChange={(event) => setSoonDays(Math.max(1, Number(event.target.value) || 1))}
                className="w-16 rounded-lg border px-2 py-1"
              />
              <span>days</span>
            </label>
            <button
              type="button"
              onClick={clearStockItems}
              disabled={clearingStock || items.length === 0}
              className="rounded-xl border border-rose-200 bg-white px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
            >
              {clearingStock ? "Clearing..." : "Clear Inventory"}
            </button>
            <button
              type="button"
              onClick={clearAllRecipes}
              disabled={clearingRecipes || recipes.length === 0}
              className="rounded-xl border border-rose-200 bg-white px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
            >
              {clearingRecipes ? "Clearing..." : "Clear all recipes"}
            </button>
          </div>
        )}
        {showInventoryViewControls && (
          <div className="flex flex-wrap gap-2">
            <select
              value={groupBy}
              onChange={(event) => setGroupBy(event.target.value)}
              className="rounded-xl border px-2 py-2 text-sm"
            >
              <option value="Category">Group: Category</option>
              <option value="Label">Group: Label</option>
              <option value="Base">Group: Basisvare</option>
              <option value="None">Group: None</option>
            </select>
          </div>
        )}
      </div>
      {showManagementControls && templateMessage && (
        <p className="mt-2 text-sm text-slate-500">{templateMessage}</p>
      )}
    </div>
  );

  const renderOverview = () => (
    <>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        {renderStockCards(overviewGroups, "No matching stock items.", false, true)}
        <div className="space-y-4">
          <ShoppingListPanel
            householdId={householdId}
            shoppingItems={shoppingItems}
            shoppingLoading={shoppingLoading}
            stockItems={items}
            hideChecked={hideCheckedShoppingItems}
            setHideChecked={setHideCheckedShoppingItems}
            onOpenInventory={() => setMainView("inventory")}
          />
          <RecipeManager householdId={householdId} stockItems={items} />
          <WeeklyMenu
            householdId={householdId}
            recipes={recipes}
            stockItems={items}
            shoppingItems={shoppingItems}
            onOpenRecipes={() => setMainView("recipes")}
            openRecipe={openRecipe}
            onOpenRecipe={setOpenRecipe}
            onCloseRecipe={() => setOpenRecipe(null)}
          />
        </div>
      </div>
    </>
  );

  const renderInventoryView = () => (
    <>
      <div className="mb-4">
        <ViewSelector options={INVENTORY_MODES} value={inventoryMode} onChange={setInventoryMode} />
      </div>
      <div className={inventoryMode === "multi" ? "grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]" : ""}>
        {inventoryMode === "fridge"
          ? renderFridgeStockCards(inventoryGroups, "No fridge-view stock items yet.")
          : renderStockCards(inventoryGroups, "Nothing is expiring within this window or expired.")}
        {inventoryMode === "multi" && (
          <div className="space-y-4">
            <ShoppingListPanel
              householdId={householdId}
              shoppingItems={shoppingItems}
              shoppingLoading={shoppingLoading}
              stockItems={items}
              hideChecked={hideCheckedShoppingItems}
              setHideChecked={setHideCheckedShoppingItems}
              onOpenInventory={() => setMainView("inventory")}
            />
            <section className="rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm">
              <div className="text-lg font-bold text-slate-950">Expiring & Expired</div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-xl bg-amber-50 p-3 text-amber-800">
                  <div className="text-2xl font-semibold">{stockSummary.soonCount}</div>
                  <div className="text-xs">Expiring within {soonDays} days</div>
                </div>
                <div className="rounded-xl bg-rose-50 p-3 text-rose-800">
                  <div className="text-2xl font-semibold">{stockSummary.expiredCount}</div>
                  <div className="text-xs">Expired</div>
                </div>
              </div>
            </section>
          </div>
        )}
      </div>
    </>
  );

  return (
    <>
      <div className="mb-4">
        <ViewSelector options={MAIN_VIEWS} value={mainView} onChange={setMainView} />
      </div>

      {renderControls()}
      <div className="mb-6">
        <StatsStrip stats={statsStripItems} onStatClick={handleStatClick} />
      </div>

      {mainView === "overview" && renderOverview()}
      {mainView === "inventory" && renderInventoryView()}
      {mainView === "shopping" && (
        <ShoppingListPanel
          householdId={householdId}
          shoppingItems={shoppingItems}
          shoppingLoading={shoppingLoading}
          stockItems={items}
          hideChecked={hideCheckedShoppingItems}
          setHideChecked={setHideCheckedShoppingItems}
          onOpenInventory={() => setMainView("inventory")}
        />
      )}
      {mainView === "recipes" && <RecipeManager householdId={householdId} stockItems={items} />}
      {mainView === "weekly" && (
        <WeeklyMenu
          householdId={householdId}
          recipes={recipes}
          stockItems={items}
          shoppingItems={shoppingItems}
          onOpenRecipes={() => setMainView("recipes")}
          openRecipe={openRecipe}
          onOpenRecipe={setOpenRecipe}
          onCloseRecipe={() => setOpenRecipe(null)}
        />
      )}

      <ProductModal open={modalOpen} product={editing} onClose={closeModal} onSave={saveProduct} />
    </>
  );
}

export default function App() {
  const { user, loading: authLoading, redirectError, authDebug, updateAuthDebug } = useAuthUser();
  const {
    memberships,
    loading: householdsLoading,
    userId: householdsUserId,
  } = useHouseholds(user);
  const [selectedHouseholdId, setSelectedHouseholdId] = useState("");
  const [selectionLoadedForUserId, setSelectionLoadedForUserId] = useState("");
  const [createdHouseholds, setCreatedHouseholds] = useState([]);

  const availableHouseholds = useMemo(() => {
    const byId = new Map();
    [...createdHouseholds, ...memberships].forEach((household) => {
      if (household?.id) byId.set(household.id, household);
    });
    return [...byId.values()];
  }, [createdHouseholds, memberships]);

  useEffect(() => {
    if (!user?.uid) {
      setSelectedHouseholdId("");
      setSelectionLoadedForUserId("");
      setCreatedHouseholds([]);
      return;
    }

    setSelectedHouseholdId(readStoredHouseholdId(user.uid));
    setSelectionLoadedForUserId(user.uid);
    setCreatedHouseholds([]);
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid || selectionLoadedForUserId !== user.uid || householdsUserId !== user.uid) return;
    if (householdsLoading) return;

    if (availableHouseholds.length === 0) {
      if (selectedHouseholdId) setSelectedHouseholdId("");
      return;
    }

    if (
      !selectedHouseholdId ||
      !availableHouseholds.some((household) => household.id === selectedHouseholdId)
    ) {
      setSelectedHouseholdId(availableHouseholds[0].id);
    }
  }, [
    availableHouseholds,
    householdsLoading,
    householdsUserId,
    selectedHouseholdId,
    selectionLoadedForUserId,
    user?.uid,
  ]);

  useEffect(() => {
    if (!user?.uid || selectionLoadedForUserId !== user.uid) return;
    writeStoredHouseholdId(user.uid, selectedHouseholdId);
  }, [selectedHouseholdId, selectionLoadedForUserId, user?.uid]);

  useEffect(() => {
    if (!user?.uid || householdsUserId !== user.uid || householdsLoading) return;

    const membershipIds = new Set(memberships.map((household) => household.id));
    setCreatedHouseholds((current) =>
      current.filter((household) => {
        if (membershipIds.has(household.id)) return false;
        return now() - (household.optimisticCreatedAt || 0) < OPTIMISTIC_HOUSEHOLD_GRACE_MS;
      })
    );
  }, [householdsLoading, householdsUserId, memberships, user?.uid]);

  if (!firebaseReady) return <MissingFirebaseConfig />;
  if (authLoading) {
    return (
      <main className="grid min-h-screen place-items-center bg-stone-100 text-sm text-slate-500">
        Loading QuickStock...
      </main>
    );
  }
  if (!user) {
    return (
      <SignInScreen
        authError={redirectError}
        authDebug={authDebug}
        onAuthDebugChange={updateAuthDebug}
      />
    );
  }

  const selectedHousehold = availableHouseholds.find((household) => household.id === selectedHouseholdId);

  return (
    <main className="min-h-screen bg-stone-100 p-3 sm:p-6">
      <div className="mx-auto max-w-6xl">
        <HouseholdBar
          user={user}
          memberships={availableHouseholds}
          selectedId={selectedHouseholdId}
          onSelect={setSelectedHouseholdId}
          loading={householdsLoading}
          onCreated={(household) =>
            setCreatedHouseholds((current) => [
              { ...household, optimisticCreatedAt: now() },
              ...current.filter((item) => item.id !== household.id),
            ])
          }
        />

        {selectedHousehold ? (
          <Inventory householdId={selectedHousehold.id} />
        ) : (
          <section className="rounded-2xl border border-slate-200/70 bg-white p-4 text-sm text-slate-500 shadow-sm">
            Create a household to start tracking stock.
          </section>
        )}
      </div>
    </main>
  );
}
