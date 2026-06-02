import React, { useEffect, useMemo, useState } from "react";
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
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
  { id: "overview", label: "Overview" },
  { id: "inventory", label: "Inventory" },
  { id: "shopping", label: "Shopping List" },
  { id: "recipes", label: "Recipes" },
  { id: "weekly", label: "Weekly Menu" },
];
const INVENTORY_MODES = [
  { id: "multi", label: "Multi View" },
  { id: "fridge", label: "Fridge View" },
  { id: "expiring", label: "Expiring Soon View" },
];

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
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const activeHouseholdStorageKey = (userId) => `${ACTIVE_HOUSEHOLD_STORAGE_PREFIX}.${userId}`;

const readStoredHouseholdId = (userId) => {
  if (!userId || typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(activeHouseholdStorageKey(userId)) || "";
  } catch {
    return "";
  }
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
    <div className="flex gap-2 overflow-x-auto rounded-xl bg-white p-1 shadow">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(option.id)}
          className={`min-h-10 shrink-0 rounded-lg px-3 py-2 text-sm font-medium ${
            value === option.id
              ? "bg-black text-white"
              : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function useAuthUser() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!auth) {
      setLoading(false);
      return undefined;
    }
    return onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setLoading(false);
    });
  }, []);

  return { user, loading };
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
    <main className="min-h-screen bg-slate-100 px-4 py-8">
      <section className="mx-auto max-w-xl rounded-xl bg-white p-5 shadow">
        <h1 className="text-xl font-bold text-slate-950">Firebase config needed</h1>
        <p className="mt-2 text-sm text-slate-600">
          Add the `VITE_FIREBASE_*` values in `.env` before running the app.
        </p>
      </section>
    </main>
  );
}

function SignInScreen() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const signIn = async () => {
    setBusy(true);
    setError("");
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      if (err?.code === "auth/account-exists-with-different-credential") {
        const provider = GoogleAuthProvider.credentialFromError(err);
        setError(provider ? "Use the Google account already linked to this email." : err.message);
      } else {
        setError(err.message || "Could not sign in.");
      }
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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

      await batch.commit();
      onCreated({ id: householdRef.id, ...householdSummary });
      onSelect(householdRef.id);
      setName("");
    } catch (err) {
      setError(err.message || "Could not create household.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <header className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">QuickStock</p>
          <h1 className="text-2xl font-bold text-slate-950">
            {memberships.find((household) => household.id === selectedId)?.name || "Household inventory"}
          </h1>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-wide text-slate-500">
            Household
            <select
              value={selectedId}
              onChange={(event) => onSelect(event.target.value)}
              disabled={loading || memberships.length === 0}
              className="min-h-10 min-w-52 rounded border border-slate-300 bg-white px-3 py-2 text-sm normal-case tracking-normal text-slate-900 disabled:opacity-60"
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
            onClick={() => signOut(auth)}
            className="min-h-10 rounded border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            Sign out
          </button>
        </div>
      </header>

      <section className="mb-4 rounded-xl bg-white p-3 shadow">
        <form onSubmit={createHousehold} className="flex gap-2">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={loading ? "Loading households..." : "New household name"}
            className="min-w-0 flex-1 rounded border border-slate-200 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="rounded bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Create
          </button>
        </form>
        {error && <p className="mt-2 text-sm text-rose-700">{error}</p>}
      </section>
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
    <div className="rounded-xl border border-slate-100 bg-white p-4 shadow">
      <div className="mb-3 flex items-start justify-between gap-3">
        <button
          onClick={() => addUnits(1)}
          className="grid h-20 w-20 shrink-0 touch-manipulation place-items-center rounded-xl bg-slate-100 text-5xl hover:bg-slate-200"
          aria-label={`Add ${product.name}`}
        >
          {product.emoji || pickEmoji(product.name)}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-lg font-semibold text-slate-950">{product.name}</h3>
            {product.freezer && <span className="text-xs">Frozen</span>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
            <span className="rounded-full bg-slate-100 px-2 py-0.5">{count} in stock</span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5">pack {product.packSize || 1}</span>
            {product.isBase && <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-indigo-700">Basisvare</span>}
            {(product.labels || []).map((label) => (
              <span key={label} className="rounded-full bg-slate-100 px-2 py-0.5">
                {label}
              </span>
            ))}
          </div>
        </div>
        <button onClick={() => setManage((value) => !value)} className="min-h-9 rounded border px-2 py-1 text-xs">
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
            {soon} soon
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={() => addUnits(product.packSize || 1)} className="min-h-10 rounded border px-3 py-1.5 text-sm hover:bg-slate-50">
          + pack
        </button>
        <button onClick={() => changeSome(["full"], "opened", 1)} className="min-h-10 rounded border px-3 py-1.5 text-sm hover:bg-slate-50">
          Open
        </button>
        <button
          onClick={() => changeSome(["opened", "full", "expired"], "empty", 1)}
          className="min-h-10 rounded border px-3 py-1.5 text-sm hover:bg-slate-50"
        >
          Empty
        </button>
        <button
          onClick={() => changeSome(["full", "opened"], "expired", 1)}
          className="min-h-10 rounded border px-3 py-1.5 text-sm hover:bg-slate-50"
        >
          Expire
        </button>
        <button
          onClick={onAddToShoppingList}
          className="min-h-10 rounded border px-3 py-1.5 text-sm hover:bg-slate-50"
        >
          Add to list
        </button>
        {manage && (
          <>
            <button onClick={onEdit} className="min-h-10 rounded border px-3 py-1.5 text-sm hover:bg-slate-50">
              Edit
            </button>
            <button
              onClick={onDelete}
              className="min-h-10 rounded border border-rose-200 px-3 py-1.5 text-sm text-rose-700 hover:bg-rose-50"
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
    <div className="relative flex min-h-[360px] flex-col rounded-[2rem] bg-sky-100 p-6 text-center shadow-sm ring-1 ring-sky-200/70">
      <div className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-black text-sm font-bold text-white shadow-sm">
        {count}
      </div>

      <button
        type="button"
        onClick={() => addUnits(1)}
        className="mx-auto mt-5 grid h-32 w-32 touch-manipulation place-items-center rounded-[1.75rem] bg-white/50 text-7xl shadow-sm hover:bg-white/70"
        aria-label={`Add ${product.name}`}
      >
        {emoji}
      </button>

      <div className="mt-5">
        <h3 className="mx-auto max-w-[14rem] text-2xl font-bold leading-tight text-slate-950">
          {product.name}
        </h3>
        <div className="mt-2 flex min-h-6 flex-wrap justify-center gap-1.5 text-xs">
          {product.freezer && <span className="rounded-full bg-white/70 px-2 py-0.5 text-slate-700">Frozen</span>}
          {product.isBase && <span className="rounded-full bg-white/70 px-2 py-0.5 text-slate-700">Basisvare</span>}
          {expired > 0 && (
            <span className="rounded-full bg-rose-100 px-2 py-0.5 text-rose-700">{expired} expired</span>
          )}
          {soon > 0 && <span className="rounded-full bg-white/70 px-2 py-0.5 text-sky-800">{soon} soon</span>}
        </div>
      </div>

      <div className="mt-5 flex justify-center gap-2">
        <button
          type="button"
          onClick={onEdit}
          className="min-h-10 rounded-full bg-white/80 px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm hover:bg-white"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={() => setManage((value) => !value)}
          className="min-h-10 rounded-full bg-white/80 px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm hover:bg-white"
        >
          Manage
        </button>
        <button
          type="button"
          onClick={() => addUnits(1)}
          className="grid min-h-10 min-w-10 touch-manipulation place-items-center rounded-full bg-black px-4 py-2 text-lg font-bold text-white shadow-sm hover:bg-slate-800"
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
              className={`grid h-10 w-10 touch-manipulation place-items-center rounded-full border text-lg shadow-sm ${
                unit.state === "opened"
                  ? "border-amber-200 bg-amber-50"
                  : unit.state === "expired"
                    ? "border-rose-200 bg-rose-50"
                    : "border-white bg-white/75"
              }`}
              title={unit.state || "full"}
            >
              {emoji}
            </button>
          ))
        )}
        {activeUnits.length > displayedUnits.length && (
          <span className="grid h-10 place-items-center rounded-full bg-white/70 px-3 text-xs font-semibold text-slate-600">
            +{activeUnits.length - displayedUnits.length}
          </span>
        )}
      </div>

      {manage && (
        <div className="mt-5 flex flex-wrap justify-center gap-2 border-t border-sky-200/70 pt-4">
          <button onClick={() => addUnits(product.packSize || 1)} className="min-h-10 rounded-full bg-white/75 px-3 py-1.5 text-sm hover:bg-white">
            + pack
          </button>
          <button onClick={() => changeSome(["full"], "opened", 1)} className="min-h-10 rounded-full bg-white/75 px-3 py-1.5 text-sm hover:bg-white">
            Open
          </button>
          <button
            onClick={() => changeSome(["opened", "full", "expired"], "empty", 1)}
            className="min-h-10 rounded-full bg-white/75 px-3 py-1.5 text-sm hover:bg-white"
          >
            Empty
          </button>
          <button
            onClick={() => changeSome(["full", "opened"], "expired", 1)}
            className="min-h-10 rounded-full bg-white/75 px-3 py-1.5 text-sm hover:bg-white"
          >
            Expire
          </button>
          <button onClick={onAddToShoppingList} className="min-h-10 rounded-full bg-white/75 px-3 py-1.5 text-sm hover:bg-white">
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
}) {
  const visibleItems = hideChecked
    ? shoppingItems.filter((item) => !item.checked)
    : shoppingItems;

  const checkItem = async (shoppingItem, checked) => {
    const shoppingRef = doc(db, "households", householdId, "shoppingList", shoppingItem.id);

    if (!checked) {
      await updateDoc(shoppingRef, { checked: false, checkedAt: null, updatedAt: serverTimestamp() });
      return;
    }

    const batch = writeBatch(db);
    const stockItem = shoppingItem.sourceStockItemId
      ? stockItems.find((item) => item.id === shoppingItem.sourceStockItemId)
      : null;

    if (stockItem) {
      const packs = Math.max(1, Number(shoppingItem.packs) || 1);
      const packSize = Math.max(1, Number(stockItem.packSize) || 1);
      const restockAmount = Math.max(1, packs * packSize);
      const nextUnits = toUnits(stockItem).concat(
        Array.from({ length: restockAmount }, () => genUnit(stockItem.shelfLifeDays))
      );
      batch.update(doc(db, "households", householdId, "stockItems", stockItem.id), {
        items: nextUnits,
        quantity: countInStock(nextUnits),
        updatedAt: serverTimestamp(),
      });
    }

    batch.update(shoppingRef, {
      checked: true,
      checkedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  };

  const deleteShoppingItem = (shoppingItemId) =>
    deleteDoc(doc(db, "households", householdId, "shoppingList", shoppingItemId));

  return (
    <aside className="rounded-xl bg-white p-3 shadow">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="font-semibold">Shopping List</div>
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={hideChecked}
            onChange={(event) => setHideChecked(event.target.checked)}
          />
          Hide checked
        </label>
      </div>

      {shoppingLoading ? (
        <div className="text-sm text-slate-500">Loading list...</div>
      ) : visibleItems.length === 0 ? (
        <div className="text-sm text-slate-500">List empty</div>
      ) : (
        <ul className="space-y-2">
          {visibleItems.map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 px-2 py-2 text-sm"
            >
              <label className="flex min-w-0 items-center gap-2">
                <input
                  type="checkbox"
                  checked={Boolean(item.checked)}
                  onChange={(event) => checkItem(item, event.target.checked)}
                />
                <span className={item.checked ? "truncate line-through opacity-60" : "truncate"}>
                  {item.name}
                  {item.packs ? ` x${item.packs}` : ""}
                </span>
              </label>
              <button
                onClick={() => deleteShoppingItem(item.id)}
                className="rounded border border-rose-200 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50"
              >
                Remove
              </button>
            </li>
          ))}
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
        <div className="text-sm text-slate-500">No recipes yet</div>
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
                    onClick={() => deleteDoc(doc(db, "households", householdId, "recipes", recipe.id))}
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

function WeeklyMenu({ householdId, recipes, stockItems }) {
  const [selectedWeekStart, setSelectedWeekStart] = useState(() => getStartOfIsoWeek(new Date()));
  const selectedWeekId = getIsoWeekId(selectedWeekStart);
  const selectedWeekStartDate = toDateInputValue(selectedWeekStart);
  const { plan, loading } = useWeeklyPlan(householdId, selectedWeekId);
  const [generating, setGenerating] = useState(false);
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

  const removeDay = (day) => saveDay(day, { recipeId: "", notes: "" });

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
    <section className="rounded-xl bg-white p-3 shadow">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="font-semibold">Weekly Menu</div>
          <div className="text-xs text-slate-500">
            {selectedWeekId} · starts {selectedWeekStartDate}
          </div>
        </div>
        <button
          onClick={generateMissingIngredients}
          disabled={generating || loading}
          className="rounded border border-slate-300 px-2 py-1 text-sm hover:bg-slate-50 disabled:opacity-50"
        >
          {generating ? "Generating..." : "Generate Missing Ingredients"}
        </button>
      </div>

      <div className="mb-3 grid grid-cols-3 gap-2">
        <button
          onClick={() => {
            setMessage("");
            setSelectedWeekStart((current) => shiftWeek(current, -1));
          }}
          className="rounded border border-slate-300 px-2 py-2 text-sm hover:bg-slate-50"
        >
          Previous
        </button>
        <button
          onClick={() => {
            setMessage("");
            setSelectedWeekStart(getStartOfIsoWeek(new Date()));
          }}
          className="rounded border border-slate-300 px-2 py-2 text-sm hover:bg-slate-50"
        >
          This week
        </button>
        <button
          onClick={() => {
            setMessage("");
            setSelectedWeekStart((current) => shiftWeek(current, 1));
          }}
          className="rounded border border-slate-300 px-2 py-2 text-sm hover:bg-slate-50"
        >
          Next
        </button>
      </div>

      <div className="space-y-2">
        {WEEK_DAYS.map((day) => {
          const recipe = recipes.find((item) => item.id === days[day]?.recipeId);
          return (
            <div key={day} className="rounded-lg border border-slate-100 p-2">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-sm font-medium capitalize">{day}</div>
                {recipe && (
                  <button
                    onClick={() => setOpenRecipe(recipe)}
                    className="rounded border px-2 py-1 text-xs hover:bg-slate-50"
                  >
                    Open
                  </button>
                )}
              </div>
              <select
                value={days[day]?.recipeId || ""}
                onChange={(event) => saveDay(day, { recipeId: event.target.value })}
                className="mb-2 w-full rounded border px-2 py-1 text-sm"
              >
                <option value="">No recipe</option>
                {recipes.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <input
                value={days[day]?.notes || ""}
                onChange={(event) => saveDay(day, { notes: event.target.value })}
                className="w-full rounded border px-2 py-1 text-sm"
                placeholder="Notes"
              />
              {(days[day]?.recipeId || days[day]?.notes) && (
                <button
                  onClick={() => removeDay(day)}
                  className="mt-2 rounded border border-rose-200 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50"
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

function Inventory({ householdId, householdName }) {
  const { items, loading } = useStockItems(householdId);
  const { items: shoppingItems, loading: shoppingLoading } = useShoppingList(householdId);
  const { recipes } = useRecipes(householdId);
  const [mainView, setMainView] = useState("overview");
  const [inventoryMode, setInventoryMode] = useState("multi");
  const [groupBy, setGroupBy] = useState("Category");
  const [soonDays, setSoonDays] = useState(2);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [addingTemplate, setAddingTemplate] = useState(false);
  const [templateMessage, setTemplateMessage] = useState("");
  const [hideCheckedShoppingItems, setHideCheckedShoppingItems] = useState(true);

  const availableDefaultItems = useMemo(() => {
    const existingNames = new Set(items.map((item) => normalize(item.name)));
    return DEFAULT_PANTRY_ITEMS.filter((item) => !existingNames.has(normalize(item.name)));
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
    if (availableDefaultItems.length === 0) {
      setTemplateMessage("Default pantry items are already in this household.");
      return;
    }

    setAddingTemplate(true);
    setTemplateMessage("");
    try {
      const batch = writeBatch(db);
      availableDefaultItems.forEach((item) => {
        const itemRef = doc(collection(db, "households", householdId, "stockItems"));
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
      setTemplateMessage(`Added ${availableDefaultItems.length} default pantry items.`);
    } catch (err) {
      setTemplateMessage(err.message || "Could not add default pantry items.");
    } finally {
      setAddingTemplate(false);
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

  const renderStockCards = (groups, emptyText, fullWidth = false) => (
    <div>
      {loading ? (
        <div className="rounded-xl bg-white p-4 text-sm text-slate-500 shadow">Loading stock...</div>
      ) : items.length === 0 ? (
        <div className="rounded-xl bg-white p-4 text-sm text-slate-500 shadow">
          <p>Add the first product to start this household inventory.</p>
          <button
            onClick={addDefaultPantryItems}
            disabled={addingTemplate}
            className="mt-3 rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {addingTemplate ? "Adding..." : "Add default pantry items"}
          </button>
        </div>
      ) : groups.length === 0 ? (
        <div className="rounded-xl bg-white p-4 text-sm text-slate-500 shadow">{emptyText}</div>
      ) : (
        groups.map(([group, products]) => (
          <section key={group} className="mb-4">
            <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-500">
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
                  onDelete={() => deleteDoc(doc(db, "households", householdId, "stockItems", product.id))}
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
        <div className="rounded-xl bg-white p-4 text-sm text-slate-500 shadow">Loading stock...</div>
      ) : items.length === 0 ? (
        <div className="rounded-xl bg-white p-4 text-sm text-slate-500 shadow">
          <p>Add the first product to start this household inventory.</p>
          <button
            onClick={addDefaultPantryItems}
            disabled={addingTemplate}
            className="mt-3 rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {addingTemplate ? "Adding..." : "Add default pantry items"}
          </button>
        </div>
      ) : groups.length === 0 ? (
        <div className="rounded-xl bg-white p-4 text-sm text-slate-500 shadow">{emptyText}</div>
      ) : (
        groups.map(([group, products]) => (
          <section key={group} className="mb-6">
            <div className="mb-2 text-[11px] uppercase tracking-wide text-slate-500">
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
                  onDelete={() => deleteDoc(doc(db, "households", householdId, "stockItems", product.id))}
                />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );

  const renderControls = () => (
    <div className="mb-4 rounded-xl bg-white p-3 shadow">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {MAIN_VIEWS.find((view) => view.id === mainView)?.label || "Overview"}
          </p>
          <h2 className="text-xl font-semibold text-slate-950">{householdName}</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setModalOpen(true)} className="rounded bg-black px-3 py-2 text-sm text-white">
            + Add Product
          </button>
          <button
            onClick={addDefaultPantryItems}
            disabled={addingTemplate || loading || availableDefaultItems.length === 0}
            className="rounded border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
          >
            {addingTemplate ? "Adding..." : "Add default pantry items"}
          </button>
          <label className="flex items-center gap-2 text-sm">
            <span>Soon</span>
            <input
              type="number"
              min={1}
              value={soonDays}
              onChange={(event) => setSoonDays(Math.max(1, Number(event.target.value) || 1))}
              className="w-16 rounded border px-2 py-1"
            />
          </label>
          <select
            value={groupBy}
            onChange={(event) => setGroupBy(event.target.value)}
            className="rounded border px-2 py-2 text-sm"
          >
            <option value="Category">Group: Category</option>
            <option value="Label">Group: Label</option>
            <option value="Base">Group: Basisvare</option>
            <option value="None">Group: None</option>
          </select>
        </div>
      </div>
      {templateMessage && <p className="mt-2 text-sm text-slate-500">{templateMessage}</p>}
    </div>
  );

  const renderOverview = () => (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <button
          type="button"
          onClick={() => setMainView("inventory")}
          className="rounded-xl bg-white p-3 text-left shadow hover:bg-slate-50"
        >
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Stock</div>
          <div className="mt-1 text-2xl font-semibold text-slate-950">{stockSummary.unitCount}</div>
          <div className="text-xs text-slate-500">{stockSummary.productCount} products</div>
        </button>
        <button
          type="button"
          onClick={() => {
            setInventoryMode("expiring");
            setMainView("inventory");
          }}
          className="rounded-xl bg-white p-3 text-left shadow hover:bg-slate-50"
        >
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Soon</div>
          <div className="mt-1 text-2xl font-semibold text-sky-700">{stockSummary.soonCount}</div>
          <div className="text-xs text-slate-500">within {soonDays} days</div>
        </button>
        <button
          type="button"
          onClick={() => {
            setInventoryMode("expiring");
            setMainView("inventory");
          }}
          className="rounded-xl bg-white p-3 text-left shadow hover:bg-slate-50"
        >
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Expired</div>
          <div className="mt-1 text-2xl font-semibold text-rose-700">{stockSummary.expiredCount}</div>
          <div className="text-xs text-slate-500">needs action</div>
        </button>
        <button
          type="button"
          onClick={() => setMainView("shopping")}
          className="rounded-xl bg-white p-3 text-left shadow hover:bg-slate-50"
        >
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Shopping</div>
          <div className="mt-1 text-2xl font-semibold text-slate-950">{stockSummary.shoppingCount}</div>
          <div className="text-xs text-slate-500">open items</div>
        </button>
        <button
          type="button"
          onClick={() => setMainView("recipes")}
          className="rounded-xl bg-white p-3 text-left shadow hover:bg-slate-50"
        >
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Recipes</div>
          <div className="mt-1 text-2xl font-semibold text-slate-950">{stockSummary.recipeCount}</div>
          <div className="text-xs text-slate-500">saved</div>
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        {renderStockCards(overviewGroups, "No matching stock items.")}
        <div className="space-y-4">
          <ShoppingListPanel
            householdId={householdId}
            shoppingItems={shoppingItems}
            shoppingLoading={shoppingLoading}
            stockItems={items}
            hideChecked={hideCheckedShoppingItems}
            setHideChecked={setHideCheckedShoppingItems}
          />
          <RecipeManager householdId={householdId} stockItems={items} />
          <WeeklyMenu householdId={householdId} recipes={recipes} stockItems={items} />
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
          : renderStockCards(inventoryGroups, "Nothing is expiring soon or expired.")}
        {inventoryMode === "multi" && (
          <div className="space-y-4">
            <ShoppingListPanel
              householdId={householdId}
              shoppingItems={shoppingItems}
              shoppingLoading={shoppingLoading}
              stockItems={items}
              hideChecked={hideCheckedShoppingItems}
              setHideChecked={setHideCheckedShoppingItems}
            />
            <section className="rounded-xl bg-white p-3 shadow">
              <div className="font-semibold">Soon & Expired</div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-lg bg-sky-50 p-3 text-sky-800">
                  <div className="text-2xl font-semibold">{stockSummary.soonCount}</div>
                  <div className="text-xs">Soon</div>
                </div>
                <div className="rounded-lg bg-rose-50 p-3 text-rose-800">
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
        />
      )}
      {mainView === "recipes" && <RecipeManager householdId={householdId} stockItems={items} />}
      {mainView === "weekly" && (
        <WeeklyMenu householdId={householdId} recipes={recipes} stockItems={items} />
      )}

      <ProductModal open={modalOpen} product={editing} onClose={closeModal} onSave={saveProduct} />
    </>
  );
}

export default function App() {
  const { user, loading: authLoading } = useAuthUser();
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
      <main className="grid min-h-screen place-items-center bg-slate-100 text-sm text-slate-500">
        Loading QuickStock...
      </main>
    );
  }
  if (!user) return <SignInScreen />;

  const selectedHousehold = availableHouseholds.find((household) => household.id === selectedHouseholdId);

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-100 to-slate-200 p-4 sm:p-6">
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
          <Inventory
            householdId={selectedHousehold.id}
            householdName={selectedHousehold.name || "Household"}
          />
        ) : (
          <section className="rounded-xl bg-white p-4 text-sm text-slate-500 shadow">
            Create a household to start tracking stock.
          </section>
        )}
      </div>
    </main>
  );
}
