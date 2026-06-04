import React, { useEffect, useMemo, useState } from "react";
import {
  getRedirectResult,
  GoogleAuthProvider,
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

const DEFAULT_PANTRY_ITEMS = [
  { name: "Milk", emoji: "🥛", packSize: 1, shelfLifeDays: 7 },
  { name: "Eggs", emoji: "🥚", packSize: 12, shelfLifeDays: 28 },
  { name: "Butter", emoji: "🧈", packSize: 1, shelfLifeDays: 60 },
  { name: "Bread", emoji: "🍞", packSize: 1, shelfLifeDays: 5 },
  { name: "Pasta", emoji: "🍝", packSize: 1, shelfLifeDays: 365 },
  { name: "Cheese", emoji: "🧀", packSize: 1, shelfLifeDays: 21 },
  { name: "Tomato sauce", emoji: "🥫", packSize: 1, shelfLifeDays: 365 },
  { name: "Salt", emoji: "🧂", packSize: 1, shelfLifeDays: 3650 },
  { name: "Onion", emoji: "🧅", packSize: 1, shelfLifeDays: 30 },
  { name: "Potatoes", emoji: "🥔", packSize: 1, shelfLifeDays: 45 },
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

const defaultPantryDocId = (name = "") =>
  `default-${pantryItemKey(name).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || genId()}`;

const activeHouseholdStorageKey = (userId) => `${ACTIVE_HOUSEHOLD_STORAGE_PREFIX}.${userId}`;

const readStoredHouseholdId = (userId) => {
  if (!userId || typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(activeHouseholdStorageKey(userId)) || "";
  } catch {
    return "";
  }
};

const shouldUseRedirectSignIn = () => {
  if (typeof navigator === "undefined") return false;
  const userAgent = navigator.userAgent || "";
  return /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent);
};

const authErrorMessage = (err) => {
  if (err?.code === "auth/account-exists-with-different-credential") {
    const provider = GoogleAuthProvider.credentialFromError(err);
    return provider ? "Use the Google account already linked to this email." : err.message;
  }

  return err?.message || "Could not sign in.";
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

const deleteCollectionDocs = async (collectionRef) => {
  const snapshot = await getDocs(collectionRef);
  if (snapshot.empty) return 0;

  const batch = writeBatch(db);
  snapshot.docs.forEach((itemDoc) => batch.delete(itemDoc.ref));
  await batch.commit();
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
      products.slice().sort((a, b) => a.name.localeCompare(b.name, "nb", { sensitivity: "base" })),
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
            onClick={clickable ? () => onStatClick(stat.targetView) : undefined}
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
            <div className="mt-2 text-3xl font-bold leading-none">{stat.value}</div>
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

  useEffect(() => {
    if (!auth) {
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
      setUser(nextUser);
      authReady = true;
      finishLoading();
    });

    getRedirectResult(auth)
      .catch((err) => {
        if (active) setRedirectError(authErrorMessage(err));
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

  return { user, loading, redirectError };
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

function SignInScreen({ authError = "" }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setError(authError);
  }, [authError]);

  const signIn = async () => {
    setBusy(true);
    setError("");
    try {
      if (shouldUseRedirectSignIn()) {
        await signInWithRedirect(auth, googleProvider);
        return;
      }

      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setError(authErrorMessage(err));
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
          {error && <p className="mt-3 text-sm text-rose-700">{error}</p>}
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
    <div className="rounded-2xl border border-emerald-100 bg-white p-4 shadow-sm transition hover:shadow-md">
      <div className="mb-3 flex items-start justify-between gap-3">
        <button
          onClick={() => addUnits(1)}
          className="grid h-24 w-24 shrink-0 touch-manipulation place-items-center rounded-2xl bg-emerald-50 text-6xl transition hover:bg-emerald-100"
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
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-800">{count} in stock</span>
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
  const expired = units.filter((unit) => unit.state === "expired").length;
  const soon = soonCount(units, soonDays);
  const activeUnits = units.filter((unit) => unit.state !== "empty");
  const displayedUnits = activeUnits.slice(0, 24);
  const [manage, setManage] = useState(false);
  const emoji = product.emoji || pickEmoji(product.name);
  const fridgeCardClass = product.freezer
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
      <div className="absolute right-4 top-4 grid h-12 w-12 place-items-center rounded-full bg-emerald-700 text-base font-bold text-white shadow-sm">
        {count}
      </div>

      <button
        type="button"
        onClick={() => addUnits(1)}
        className="mx-auto mt-5 grid h-40 w-40 touch-manipulation place-items-center rounded-[1.75rem] bg-white/80 text-9xl shadow-sm transition hover:bg-white"
        aria-label={`Add ${product.name}`}
      >
        {emoji}
      </button>

      <div className="mt-5">
        <h3 className="mx-auto max-w-[14rem] text-2xl font-bold leading-tight tracking-tight text-slate-950">
          {product.name}
        </h3>
        <div className="mt-2 flex min-h-6 flex-wrap justify-center gap-1.5 text-xs">
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
          <button onClick={onAddToShoppingList} className="min-h-10 rounded-full bg-white/80 px-3 py-1.5 text-sm hover:bg-white">
            Add to list
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

      const stockItemId = latestShoppingItem.sourceStockItemId || shoppingItem.sourceStockItemId;
      if (stockItemId) {
        const stockRef = doc(db, "households", householdId, "stockItems", stockItemId);
        const stockSnapshot = await transaction.get(stockRef);
        if (stockSnapshot.exists()) {
          const stockItem = { id: stockSnapshot.id, ...stockSnapshot.data() };
          const packs = Math.max(1, Number(latestShoppingItem.packs) || 1);
          const packSize = Math.max(1, Number(stockItem.packSize) || 1);
          const restockAmount = Math.max(1, packs * packSize);
          const nextUnits = toUnits(stockItem).concat(
            Array.from({ length: restockAmount }, () => genUnit(stockItem.shelfLifeDays))
          );
          transaction.update(stockRef, {
            items: nextUnits,
            quantity: countInStock(nextUnits),
            updatedAt: serverTimestamp(),
          });
        }
      }

      transaction.update(shoppingRef, {
        checked: true,
        checkedAt: serverTimestamp(),
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
            const sourceStockItem = item.sourceStockItemId
              ? stockItems.find((stockItem) => stockItem.id === item.sourceStockItemId)
              : null;
            const emoji = item.emoji || sourceStockItem?.emoji || pickEmoji(item.name);
            const checked = Boolean(item.checked);
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
                      {item.packs ? `${item.packs} pack${Number(item.packs) === 1 ? "" : "s"}` : "1 item"}
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
          ? recipe.ingredients.map((ingredient) => ({
              stockItemId: ingredient.stockItemId || "",
              createStockItem: false,
              nameSnapshot: ingredient.nameSnapshot || "",
              emoji: pickEmoji(ingredient.nameSnapshot || ""),
              quantity: ingredient.quantity || 1,
              unit: ingredient.unit || "pcs",
            }))
          : [emptyIngredient()],
      stepsText: (recipe?.steps || []).join("\n"),
    });
  }, [open, recipe]);

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

  const saveRecipe = async () => {
    const name = form.name.trim();
    if (!name) return;

    setSaving(true);
    setError("");
    try {
      const ingredients = [];
      for (const ingredient of form.ingredients) {
        const quantity = Math.max(0, Number(ingredient.quantity) || 0);
        if (quantity <= 0) continue;

        if (ingredient.createStockItem) {
          const itemName = ingredient.nameSnapshot.trim();
          if (!itemName) continue;
          const newStockRef = await addDoc(
            collection(db, "households", householdId, "stockItems"),
            {
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
            }
          );
          ingredients.push({
            stockItemId: newStockRef.id,
            nameSnapshot: itemName,
            quantity,
            unit: ingredient.unit || "pcs",
          });
        } else {
          const stockItem = stockItems.find((item) => item.id === ingredient.stockItemId);
          const itemName = stockItem?.name || ingredient.nameSnapshot.trim();
          if (!itemName) continue;
          ingredients.push({
            stockItemId: ingredient.stockItemId || "",
            nameSnapshot: itemName,
            quantity,
            unit: ingredient.unit || "pcs",
          });
        }
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
            {form.ingredients.map((ingredient, index) => (
              <div key={index} className="rounded-lg border border-slate-200 p-2">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_90px_90px_auto]">
                  {ingredient.createStockItem ? (
                    <input
                      value={ingredient.nameSnapshot}
                      onChange={(event) =>
                        updateIngredient(index, {
                          nameSnapshot: event.target.value,
                          emoji: ingredient.emoji || pickEmoji(event.target.value),
                        })
                      }
                      className="rounded border px-2 py-1 text-sm"
                      placeholder="New stock item name"
                    />
                  ) : (
                    <select
                      value={ingredient.stockItemId}
                      onChange={(event) => {
                        const stockItem = stockItems.find((item) => item.id === event.target.value);
                        updateIngredient(index, {
                          stockItemId: event.target.value,
                          nameSnapshot: stockItem?.name || "",
                          unit: ingredient.unit || "pcs",
                        });
                      }}
                      className="rounded border px-2 py-1 text-sm"
                    >
                      <option value="">Select stock item</option>
                      {stockItems.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <input
                    type="number"
                    min={0}
                    step="0.1"
                    value={ingredient.quantity}
                    onChange={(event) => updateIngredient(index, { quantity: event.target.value })}
                    className="rounded border px-2 py-1 text-sm"
                    placeholder="Qty"
                  />
                  <input
                    value={ingredient.unit}
                    onChange={(event) => updateIngredient(index, { unit: event.target.value })}
                    className="rounded border px-2 py-1 text-sm"
                    placeholder="unit"
                  />
                  <button
                    onClick={() => removeIngredient(index)}
                    className="rounded border border-rose-200 px-2 py-1 text-sm text-rose-700 hover:bg-rose-50"
                  >
                    Remove
                  </button>
                </div>
                <label className="mt-2 flex items-center gap-2 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={ingredient.createStockItem}
                    onChange={(event) =>
                      updateIngredient(index, {
                        createStockItem: event.target.checked,
                        stockItemId: event.target.checked ? "" : ingredient.stockItemId,
                      })
                    }
                  />
                  Create this as a new stock item
                </label>
              </div>
            ))}
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
              Start cooking
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

function WeeklyMenu({ householdId, recipes, stockItems, onOpenRecipes }) {
  const [selectedWeekStart, setSelectedWeekStart] = useState(() => getStartOfIsoWeek(new Date()));
  const selectedWeekId = getIsoWeekId(selectedWeekStart);
  const selectedWeekStartDate = toDateInputValue(selectedWeekStart);
  const { plan, loading } = useWeeklyPlan(householdId, selectedWeekId);
  const [generating, setGenerating] = useState(false);
  const [completingDay, setCompletingDay] = useState("");
  const [undoingDay, setUndoingDay] = useState("");
  const [message, setMessage] = useState("");
  const [openRecipe, setOpenRecipe] = useState(null);

  const planRef = doc(db, "households", householdId, "weeklyPlans", selectedWeekId);
  const days = plan?.days || {};

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
      const required = new Map();

      plannedEntries.forEach(({ recipe }) => {
        (recipe.ingredients || []).forEach((ingredient) => {
          const key = `${ingredient.stockItemId || ingredient.nameSnapshot}|${ingredient.unit || ""}`;
          const current = required.get(key) || {
            name: ingredient.nameSnapshot,
            unit: ingredient.unit || "",
            quantity: 0,
            stockItemId: ingredient.stockItemId || "",
            sourceRecipeId: recipe.id,
            sourceRecipeIds: [],
          };
          current.quantity += Math.max(0, Number(ingredient.quantity) || 0);
          current.sourceRecipeIds = Array.from(new Set([...current.sourceRecipeIds, recipe.id]));
          required.set(key, current);
        });
      });

      const batch = writeBatch(db);
      let added = 0;

      required.forEach((ingredient) => {
        const stockItem = ingredient.stockItemId
          ? stockItems.find((item) => item.id === ingredient.stockItemId)
          : stockItems.find((item) => normalize(item.name) === normalize(ingredient.name));
        const stockUnit = stockItem?.unit || "pcs";
        const recipeUnit = ingredient.unit || "";
        const unitsMatch = Boolean(stockItem) && recipeUnit && stockUnit === recipeUnit;
        const available = unitsMatch ? countInStock(toUnits(stockItem)) : 0;
        const missingQuantity = unitsMatch
          ? Math.max(0, ingredient.quantity - available)
          : ingredient.quantity;
        const needsReview = !unitsMatch;

        if (missingQuantity <= 0 && !needsReview) return;

        const shoppingRef = doc(collection(db, "households", householdId, "shoppingList"));
        batch.set(shoppingRef, {
          name: ingredient.name,
          quantity: missingQuantity,
          unit: recipeUnit,
          packs: 1,
          checked: false,
          needsReview,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          sourceStockItemId: stockItem?.id || ingredient.stockItemId || "",
          sourceType: "weeklyPlan",
          sourceRecipeId: ingredient.sourceRecipeId,
          sourceRecipeIds: ingredient.sourceRecipeIds,
          sourceWeeklyPlanId: selectedWeekId,
          autoGenerated: true,
        });
        added += 1;
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
                  {consumed && (
                    <span className="hidden rounded-full bg-emerald-700 px-2.5 py-1 text-xs font-semibold text-white sm:inline-flex">
                      Completed
                    </span>
                  )}
                </div>
                {recipe && (
                  <div className="flex shrink-0 flex-wrap justify-end gap-2">
                    <button
                      onClick={() => setOpenRecipe(recipe)}
                      className="min-h-10 rounded-xl border border-slate-200 bg-white/90 px-2.5 py-1 text-xs font-medium hover:bg-white"
                    >
                      {(recipe.steps || []).length > 0 ? "Start Cooking" : "Open Recipe"}
                    </button>
                    <button
                      onClick={() => markMealDone(day, recipe)}
                      disabled={consumed || completingDay === day}
                      className="min-h-10 rounded-xl bg-emerald-700 px-2.5 py-1 text-xs font-semibold text-white shadow-sm hover:bg-emerald-800 disabled:opacity-50"
                    >
                      {consumed ? "Done" : completingDay === day ? "Saving..." : "Done Cooking"}
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
      <RecipeOpenModal recipe={openRecipe} onClose={() => setOpenRecipe(null)} />
    </section>
  );
}

function Inventory({ householdId }) {
  const { items, loading } = useStockItems(householdId);
  const { items: shoppingItems, loading: shoppingLoading } = useShoppingList(householdId);
  const { recipes } = useRecipes(householdId);
  const [mainView, setMainView] = useState("weekly");
  const [inventoryMode, setInventoryMode] = useState("fridge");
  const [groupBy, setGroupBy] = useState("Category");
  const [soonDays, setSoonDays] = useState(2);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [addingTemplate, setAddingTemplate] = useState(false);
  const [clearingStock, setClearingStock] = useState(false);
  const [templateMessage, setTemplateMessage] = useState("");
  const [hideCheckedShoppingItems, setHideCheckedShoppingItems] = useState(false);

  useEffect(() => {
    setMainView("weekly");
  }, [householdId]);

  const availableDefaultItems = useMemo(() => {
    const existingNames = new Set(items.map((item) => pantryItemKey(item.name)));
    return DEFAULT_PANTRY_ITEMS.filter((item) => !existingNames.has(pantryItemKey(item.name)));
  }, [items]);

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

  const statsStripItems = useMemo(
    () => [
      {
        label: "Menu",
        value: "Plan",
        detail: "this week",
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
    ],
    [stockSummary]
  );

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

  const addDefaultPantryItems = async () => {
    setAddingTemplate(true);
    setTemplateMessage("");
    try {
      const stockItemsRef = collection(db, "households", householdId, "stockItems");
      const stockSnapshot = await getDocs(stockItemsRef);
      const existingNames = new Set(
        stockSnapshot.docs.map((itemDoc) => pantryItemKey(itemDoc.data().name))
      );
      const itemsToAdd = DEFAULT_PANTRY_ITEMS.filter(
        (item) => !existingNames.has(pantryItemKey(item.name))
      );

      if (itemsToAdd.length === 0) {
        setTemplateMessage("Default pantry items already exist in this household.");
        return;
      }

      const batch = writeBatch(db);
      itemsToAdd.forEach((item) => {
        const itemRef = doc(stockItemsRef, defaultPantryDocId(item.name));
        batch.set(itemRef, {
          ...item,
          items: [genUnit(item.shelfLifeDays)],
          labels: ["Starter"],
          freezer: false,
          autoAddWhenEmpty: false,
          isBase: ["Pasta", "Salt", "Potatoes", "Onion"].includes(item.name),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      });
      await batch.commit();
      setTemplateMessage(`Added ${itemsToAdd.length} default pantry items.`);
    } catch (err) {
      setTemplateMessage(err.message || "Could not add default pantry items.");
    } finally {
      setAddingTemplate(false);
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

  const addStockItemToShoppingList = async (product) => {
    const existingItem = shoppingItems.find(
      (item) => !item.checked && item.sourceStockItemId === product.id
    );

    if (existingItem) {
      await updateDoc(doc(db, "households", householdId, "shoppingList", existingItem.id), {
        packs: Math.max(1, Number(existingItem.packs) || 1) + 1,
        quantity:
          (Math.max(1, Number(existingItem.packs) || 1) + 1) *
          Math.max(1, Number(product.packSize) || 1),
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
              onClick={addDefaultPantryItems}
              disabled={addingTemplate}
              className="mt-3 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {addingTemplate ? "Adding..." : "Add default pantry items"}
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
              onClick={addDefaultPantryItems}
              disabled={addingTemplate || loading || availableDefaultItems.length === 0}
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
            >
              {addingTemplate ? "Adding..." : "Add default pantry items"}
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
            onOpenRecipes={() => setMainView("recipes")}
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
        <StatsStrip stats={statsStripItems} onStatClick={setMainView} />
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
          onOpenRecipes={() => setMainView("recipes")}
        />
      )}

      <ProductModal open={modalOpen} product={editing} onClose={closeModal} onSave={saveProduct} />
    </>
  );
}

export default function App() {
  const { user, loading: authLoading, redirectError } = useAuthUser();
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
  if (!user) return <SignInScreen authError={redirectError} />;

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
