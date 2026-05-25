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
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { auth, db, firebaseReady, googleProvider } from "./firebase";

const DAY = 24 * 60 * 60 * 1000;
const STOCK_STATES = ["full", "opened", "empty", "expired"];
const nextState = { full: "opened", opened: "empty", expired: "empty", empty: "full" };

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
  const [memberships, setMemberships] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user || !db) {
      setMemberships([]);
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    const membershipsQuery = query(collection(db, "users", user.uid, "households"), orderBy("name"));
    return onSnapshot(
      membershipsQuery,
      (snapshot) => {
        setMemberships(snapshot.docs.map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() })));
        setLoading(false);
      },
      () => {
        setMemberships([]);
        setLoading(false);
      }
    );
  }, [user]);

  return { memberships, loading };
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
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => signOut(auth)}
            className="rounded border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            Sign out
          </button>
        </div>
      </header>

      <section className="mb-4 rounded-xl bg-white p-3 shadow">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {memberships.map((household) => (
            <button
              key={household.id}
              type="button"
              onClick={() => onSelect(household.id)}
              className={`shrink-0 rounded-full border px-3 py-2 text-sm ${
                household.id === selectedId
                  ? "border-black bg-black text-white"
                  : "border-slate-200 bg-white text-slate-700"
              }`}
            >
              {household.name}
            </button>
          ))}
        </div>
        <form onSubmit={createHousehold} className="mt-3 flex gap-2">
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

function ProductCard({ product, onPatch, onEdit, onDelete, soonDays }) {
  const units = withExpiryApplied(toUnits(product));
  const count = countInStock(units);
  const expired = units.filter((unit) => unit.state === "expired").length;
  const soon = soonCount(units, soonDays);
  const activeUnits = units.filter((unit) => unit.state !== "empty");
  const displayedUnits = activeUnits.slice(0, 18);
  const [manage, setManage] = useState(false);

  const patchUnits = (nextUnits, extraPatch = {}) => onPatch({ ...extraPatch, items: nextUnits });
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
    <div className="rounded-xl bg-white p-4 shadow">
      <div className="mb-3 flex items-start justify-between gap-3">
        <button
          onClick={() => addUnits(1)}
          className="grid h-16 w-16 shrink-0 place-items-center rounded-xl bg-slate-100 text-4xl hover:bg-slate-200"
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
        <button onClick={() => setManage((value) => !value)} className="rounded border px-2 py-1 text-xs">
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
              className={`grid h-8 w-8 place-items-center rounded-full border text-sm ${
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
          <span className="grid h-8 place-items-center rounded-full bg-slate-100 px-2 text-xs text-slate-500">
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
        <button onClick={() => addUnits(product.packSize || 1)} className="rounded border px-3 py-1.5 text-sm hover:bg-slate-50">
          + pack
        </button>
        <button onClick={() => changeSome(["full"], "opened", 1)} className="rounded border px-3 py-1.5 text-sm hover:bg-slate-50">
          Open
        </button>
        <button
          onClick={() => changeSome(["opened", "full", "expired"], "empty", 1)}
          className="rounded border px-3 py-1.5 text-sm hover:bg-slate-50"
        >
          Empty
        </button>
        <button
          onClick={() => changeSome(["full", "opened"], "expired", 1)}
          className="rounded border px-3 py-1.5 text-sm hover:bg-slate-50"
        >
          Expire
        </button>
        {manage && (
          <>
            <button onClick={onEdit} className="rounded border px-3 py-1.5 text-sm hover:bg-slate-50">
              Edit
            </button>
            <button
              onClick={onDelete}
              className="rounded border border-rose-200 px-3 py-1.5 text-sm text-rose-700 hover:bg-rose-50"
            >
              Delete
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function Inventory({ householdId, householdName }) {
  const { items, loading } = useStockItems(householdId);
  const [groupBy, setGroupBy] = useState("Category");
  const [soonDays, setSoonDays] = useState(2);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const groupedProducts = useMemo(() => {
    const groups = new Map();
    for (const product of items) {
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
  }, [items, groupBy]);

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

  const openEdit = (product) => {
    setEditing(product);
    setModalOpen(true);
  };

  const closeModal = () => {
    setEditing(null);
    setModalOpen(false);
  };

  return (
    <>
      <div className="mb-4 rounded-xl bg-white p-3 shadow">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Inventory</p>
            <h2 className="text-xl font-semibold text-slate-950">{householdName}</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setModalOpen(true)} className="rounded bg-black px-3 py-2 text-sm text-white">
              + Add Product
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
      </div>

      {loading ? (
        <div className="rounded-xl bg-white p-4 text-sm text-slate-500 shadow">Loading stock...</div>
      ) : items.length === 0 ? (
        <div className="rounded-xl bg-white p-4 text-sm text-slate-500 shadow">
          Add the first product to start this household inventory.
        </div>
      ) : (
        groupedProducts.map(([group, products]) => (
          <section key={group} className="mb-4">
            <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-500">
              {group} <span className="text-slate-400">({products.length})</span>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
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
                  onEdit={() => openEdit(product)}
                  onDelete={() => deleteDoc(doc(db, "households", householdId, "stockItems", product.id))}
                />
              ))}
            </div>
          </section>
        ))
      )}

      <ProductModal open={modalOpen} product={editing} onClose={closeModal} onSave={saveProduct} />
    </>
  );
}

export default function App() {
  const { user, loading: authLoading } = useAuthUser();
  const { memberships, loading: householdsLoading } = useHouseholds(user);
  const [selectedHouseholdId, setSelectedHouseholdId] = useState("");
  const [createdHouseholds, setCreatedHouseholds] = useState([]);

  const availableHouseholds = useMemo(() => {
    const byId = new Map();
    [...createdHouseholds, ...memberships].forEach((household) => {
      if (household?.id) byId.set(household.id, household);
    });
    return [...byId.values()];
  }, [createdHouseholds, memberships]);

  useEffect(() => {
    if (!selectedHouseholdId && availableHouseholds.length > 0) {
      setSelectedHouseholdId(availableHouseholds[0].id);
    }
  }, [availableHouseholds, selectedHouseholdId]);

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
              household,
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
