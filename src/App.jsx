import React, { useState, useMemo } from "react";
import { getDailySuggestion, computeShoppingDelta } from './services/recipeHelper'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, useSortable, arrayMove, rectSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';



// --- Time & IDs -------------------------------------------------------------
const now = () => Date.now();
const DAY = 24 * 60 * 60 * 1000;
const genId = () => (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).slice(2);

// --- States & helpers -------------------------------------------------------

// explicit "expired" state + cycle
const nextState = { full: "opened", opened: "empty", expired: "empty", empty: "full" };

// Per user request: include EXPIRED in stock until manually emptied
const countInStock = (items) => items.reduce((n, it) => n + ((it.state === "full" || it.state === "opened" || it.state === "expired") ? 1 : 0), 0);

const toArray = (items) =>
  Array.isArray(items)
    ? items
    : items && typeof items === "object"
      ? Object.values(items)
      : [];

// Mark items as expired if past expiresAt (non-mutating)
const withExpiryApplied = (items = [], t = now()) =>
  toArray(items).map(it =>
    (it.state !== "empty" && it.state !== "expired" && it.expiresAt && it.expiresAt <= t)
      ? { ...it, state: "expired" }
      : it
  );

// Identify items that are soon to expire (<= days). If expiresAt is null (frozen pause), ignore.
const soonFlags = (items, days = 2, t = now()) => {
  const cutoff = t + days * DAY;
  let soon = 0;
  items.forEach(it => { if (it.expiresAt && it.state !== 'empty' && it.state !== 'expired' && it.expiresAt <= cutoff) soon += 1; });
  return { soonCount: soon };
};

// Transform helpers (state changes)
const transformChangeSome = (items, fromStates, toState, n) => {
  let left = n;
  return items.map((it) => {
    if (left > 0 && fromStates.includes(it.state)) {
      left -= 1;
      return { ...it, state: toState };
    }
    return it;
  });
};
const transformOpen = (items, n) => transformChangeSome(items, ["full"], "opened", n);
const transformEmpty = (items, n) => {
  const openedCount = items.filter((i) => i.state === "opened").length;
  const takeOpened = Math.min(n, openedCount);
  let next = transformChangeSome(items, ["opened"], "empty", takeOpened);
  const remaining = n - takeOpened;
  if (remaining > 0) next = transformChangeSome(next, ["full", "expired"], "empty", remaining);
  return next;
};
const transformExpire = (items, n) => transformChangeSome(items, ["full", "opened"], "expired", n);

// Create new full units with IDs/timestamps/expiry
const genUnit = (shelfLifeDays = 7) => ({
  id: genId(),
  state: "full",
  addedAt: now(),
  expiresAt: now() + Math.max(1, shelfLifeDays) * DAY,
});
const addUnits = (items, n, shelfLifeDays = 7) => items.concat(Array.from({ length: n }, () => genUnit(shelfLifeDays)));

const shouldAutoAdd = (product, beforeItems, afterItems) => {
  const before = countInStock(withExpiryApplied(beforeItems));
  const after = countInStock(withExpiryApplied(afterItems));
  return product.autoAddWhenEmpty === true && before > 0 && after === 0;
};



// --- Tiny runtime tests (executed once) -------------------------------------
(() => {
  const start = [{ state: "full" }, { state: "opened" }, { state: "expired" }, { state: "empty" }];
  console.assert(countInStock(start) === 3, 'countInStock should count full+opened+expired');
  const op = transformOpen(start, 1);
  console.assert(op.filter(i=>i.state==='opened').length >= 2, 'open should increase opened');
  const em1 = transformEmpty(start, 1);
  console.assert(em1.filter(i=>i.state==='empty').length >= 2, 'empty prefers opened first then full/expired');
  const ex1 = transformExpire(start, 1);
  console.assert(ex1.filter(i=>i.state==='expired').length >= 2, 'expire should convert one full/opened to expired');
  const add2 = addUnits([], 2, 3);
  console.assert(add2.length === 2 && add2.every(i=>i.state==='full') && add2[0].expiresAt > now(), 'addUnits creates full units with expiry');
})();

// --- Emoji catalog for picker ----------------------------------------------
export const EMOJI_CATALOG = [
  // fruits
  "🍎","🍏","🍐","🍊","🍋","🍌","🍉","🍇","🍓","🫐","🍈","🍒","🍑","🥭","🍍","🥥","🥝",
  // veggies
  "🍅","🍆","🥑","🥦","🥬","🥒","🌶️","🌽","🥕","🧄","🧅","🍄","🥔","🍠","🫑","🫛","🫚","🫒",
  // staples + ingredients
  "🧂","🧈","🍯","🫙","🫘","🥜","🧊",
  // bakery/bread/sweets
  "🍞","🥖","🥐","🥨","🥯","🥞","🧇","🧁","🍰","🎂","🥧","🍩","🍪","🍫","🍬","🍭","🍮",
  // dairy & eggs
  "🧀","🥚","🥛","🍦","🍨","🍧",
  // meat & seafood
  "🍖","🍗","🥩","🥓","🧆","🍤","🍣","🦪",
  // meals & dishes
  "🍔","🌭","🍟","🍕","🥪","🌮","🌯","🫔","🥙","🫓","🍝","🍜","🍲","🥘","🫕","🍛",
  "🍱","🍚","🍘","🍙","🍢","🍥","🍡","🥠","🥟","🥡","🥣","🍳","🍿","🥫",
  // drinks
  "🧃","🥤","🧋","🧉","🍵","☕️","🫖","🍼","🍺","🍻","🍷","🥂","🍸","🍹","🍶","🥃"
];

// Expanded keywords (EN + NO). Add more anytime.
export const EMOJI_KEYWORDS = {
  // fruits
  "🍎": ["apple","eple","frukt","fruit","red apple","rød eple"],
  "🍏": ["green apple","grønt eple","eple"],
  "🍐": ["pear","pære","frukt"],
  "🍊": ["orange","appelsin","sitrus","citrus"],
  "🍋": ["lemon","sitron","sitrus","citrus"],
  "🍌": ["banana","banan","frukt"],
  "🍉": ["watermelon","vannmelon","melon"],
  "🍇": ["grapes","druer","drue"],
  "🍓": ["strawberry","jordbær","bær","berries"],
  "🫐": ["blueberries","blåbær","bær"],
  "🍈": ["melon","honningmelon","cantaloupe"],
  "🍒": ["cherries","kirsebær","bær"],
  "🍑": ["peach","fersken","frukt"],
  "🥭": ["mango","frukt"],
  "🍍": ["pineapple","ananas","frukt"],
  "🥥": ["coconut","kokos","kokosnøtt"],
  "🥝": ["kiwi","frukt"],

  // veggies
  "🍅": ["tomato","tomat","grønnsak"],
  "🍆": ["eggplant","aubergine","grønnsak"],
  "🥑": ["avocado","avokado"],
  "🥦": ["broccoli","brokkoli"],
  "🥬": ["leafy greens","salat","kål","spinat","grønnsak"],
  "🥒": ["cucumber","agurk"],
  "🌶️": ["chili","pepper","chilipepper","sterk","spicy"],
  "🌽": ["corn","mais","kolbe"],
  "🥕": ["carrot","gulrot"],
  "🧄": ["garlic","hvitløk"],
  "🧅": ["onion","løk","rødløk","gul løk"],
  "🍄": ["mushroom","sopp","sjampinjong"],
  "🥔": ["potato","potet"],
  "🍠": ["sweet potato","søtpotet","bakt"],
  "🫑": ["bell pepper","paprika","capsicum"],
  "🫛": ["peas","erter","belgfrukt"],
  "🫚": ["ginger","ingefær"],
  "🫒": ["olive","oliven"],

  // staples + ingredients
  "🧂": ["salt","krydder","seasoning"],
  "🧈": ["butter","smør","meieri","dairy"],
  "🍯": ["honey","honning"],
  "🫙": ["jar","krukke","syltetøy","pickles","marmelade"],
  "🫘": ["beans","bønner","kidney","kikerter","linser","legumes"],
  "🥜": ["peanuts","peanøtter","nøtter","peanut"],
  "🧊": ["ice","isbiter","is"],

  // bakery/sweets
  "🍞": ["bread","brød","loff"],
  "🥖": ["baguette","brød"],
  "🥐": ["croissant","butterdeig","wienerbrød"],
  "🥨": ["pretzel","kringla","saltstenger"],
  "🥯": ["bagel","ringer","frokost"],
  "🥞": ["pancakes","pannekaker","frokost"],
  "🧇": ["waffle","vaffel"],
  "🧁": ["cupcake","muffins"],
  "🍰": ["cake","kake","ostekake","suksessterte"],
  "🎂": ["birthday cake","bløtkake","kake"],
  "🥧": ["pie","pai","terte"],
  "🍩": ["doughnut","donut","smultring"],
  "🍪": ["cookie","kjeks","cookies"],
  "🍫": ["chocolate","sjokolade"],
  "🍬": ["candy","godteri","drops"],
  "🍭": ["lollipop","kjærlighet på pinne"],
  "🍮": ["custard","pudding","karamellpudding","flan"],

  // dairy & eggs
  "🧀": ["cheese","ost","parmesan","cheddar"],
  "🥚": ["egg","eggs","hønseegg"],
  "🥛": ["milk","melk","dairy","meieri"],
  "🍦": ["ice cream","iskrem","softis"],
  "🍨": ["ice cream","dessert","iskrem","gelato"],
  "🍧": ["shaved ice","slush","snøis"],

  // meat & seafood
  "🍖": ["meat","kjøtt","ribbe","bein"],
  "🍗": ["chicken leg","kyllinglår","kylling"],
  "🥩": ["steak","biff","entrecôte","kjøtt"],
  "🥓": ["bacon","frokost"],
  "🧆": ["falafel","kjøttboller","kebab","vegetar"],
  "🍤": ["shrimp","reker","tempura"],
  "🍣": ["sushi","laks","nigiri","sashimi"],
  "🦪": ["oyster","østers","skjell"],

  // meals & dishes
  "🍔": ["burger","hamburger"],
  "🌭": ["hot dog","pølse","wiener"],
  "🍟": ["fries","pommes frites","chips"],
  "🍕": ["pizza","ost","pepperoni"],
  "🥪": ["sandwich","smørbrød","baguette"],
  "🌮": ["taco","tacos","fredagstaco","maistortilla"],
  "🌯": ["burrito","wrap"],
  "🫔": ["tamale","tamal"],
  "🥙": ["kebab","gyros","pitabrød","falafel"],
  "🫓": ["flatbread","flatbrød","naan","lefse"],
  "🍝": ["spaghetti","pasta","bolognese","carbonara"],
  "🍜": ["ramen","nudler","noodles"],
  "🍲": ["stew","gryterett","suppe"],
  "🥘": ["paella","gryte","panne"],
  "🫕": ["fondue","ostefondue"],
  "🍛": ["curry","karri","indisk"],
  "🍱": ["bento","bentoboks","japansk"],
  "🍚": ["rice","ris","kokt ris"],
  "🍘": ["rice cracker","riskjeks","senbei"],
  "🍙": ["rice ball","risball","onigiri"],
  "🍢": ["oden","japansk gryte"],
  "🍥": ["fish cake","narutomaki","fiskekake"],
  "🍡": ["dango","riskake","mochi"],
  "🥠": ["fortune cookie","lykkekjeks"],
  "🥟": ["dumpling","dumplings","gyoza","pelmeni"],
  "🥡": ["takeout box","takeaway","ta med"],
  "🥣": ["bowl","skål","grøt","frokostblanding"],
  "🍳": ["fried egg","speilegg","panne","egg"],
  "🍿": ["popcorn","kinosnacks","snacks"],
  "🥫": ["canned food","hermetikk","boks"],

  // drinks
  "🧃": ["juice","drikkekartong","saft"],
  "🥤": ["soda","brus","leskedrikk","shake"],
  "🧋": ["bubble tea","boba","boblete","bobletea"],
  "🧉": ["mate","yerba mate","drikk"],
  "🍵": ["green tea","te","matcha"],
  "☕️": ["coffee","kaffe","espresso","latte"],
  "🫖": ["teapot","kanne","te"],
  "🍼": ["milk bottle","tåteflaske","baby"],
  "🍺": ["beer","øl"],
  "🍻": ["beers","skål","øl"],
  "🍷": ["wine","vin","rødvin","hvitvin"],
  "🥂": ["champagne","skåle","musserende"],
  "🍸": ["martini","cocktail","drink"],
  "🍹": ["cocktail","tropisk","pina colada","drink"],
  "🍶": ["sake","risvin","japansk"],
  "🥃": ["whisky","whiskey","bourbon","dram"]
};

const EMOJI_LIST = Array.from(new Set(EMOJI_CATALOG));

const CATEGORY_ORDER = ["Produce","Dairy & Eggs","Meat & Seafood","Bakery","Pantry","Meals","Snacks & Sweets","Drinks","Frozen","Other"];
const CATEGORY_WEIGHT = Object.fromEntries(CATEGORY_ORDER.map((c,i)=>[c,i]));

const CATS = {
  "Produce": new Set(["🍎","🍏","🍐","🍊","🍋","🍌","🍉","🍇","🍓","🫐","🍈","🍒","🍑","🥭","🍍","🥥","🥝","🍅","🍆","🥑","🥦","🥬","🥒","🌶️","🌽","🥕","🧄","🧅","🍄","🥔","🍠","🫑","🫛","🫚","🫒"]),
  "Dairy & Eggs": new Set(["🧀","🥚","🥛"]),
  "Meat & Seafood": new Set(["🍖","🍗","🥩","🥓","🧆","🍤","🍣","🦪"]),
  "Bakery": new Set(["🍞","🥖","🥐","🥨","🥯","🧇","🥞"]),
  "Snacks & Sweets": new Set(["🧁","🍰","🎂","🥧","🍩","🍪","🍫","🍬","🍭","🍮","🍿"]),
  "Meals": new Set(["🍔","🌭","🍟","🍕","🥪","🌮","🌯","🫔","🥙","🫓","🍝","🍜","🍲","🥘","🫕","🍛","🍱","🍢","🍥","🍡","🥠","🥟","🥡","🥣","🍳"]),
  "Pantry": new Set(["🧂","🧈","🍯","🫙","🫘","🥜","🧊","🍚","🍘","🍙","🥫"]),
  "Drinks": new Set(["🧃","🥤","🧋","🧉","🍵","☕️","🫖","🍼","🍺","🍻","🍷","🥂","🍸","🍹","🍶","🥃"]),
};

const NAME_CATEGORY = {
  // Dairy & eggs
  "milk":"Dairy & Eggs","melk":"Dairy & Eggs","cheese":"Dairy & Eggs","ost":"Dairy & Eggs","egg":"Dairy & Eggs","eggs":"Dairy & Eggs","yoghurt":"Dairy & Eggs","yogurt":"Dairy & Eggs","cream":"Dairy & Eggs","fløte":"Dairy & Eggs",
  // Produce
  "apple":"Produce","eple":"Produce","banana":"Produce","banan":"Produce","tomato":"Produce","tomat":"Produce","salat":"Produce","lettuce":"Produce","brokkoli":"Produce","potet":"Produce","potato":"Produce","carrot":"Produce","gulrot":"Produce","onion":"Produce","løk":"Produce","garlic":"Produce","hvitløk":"Produce","agurk":"Produce","cucumber":"Produce","avocado":"Produce","avokado":"Produce","spinat":"Produce","spinach":"Produce","paprika":"Produce","pepper":"Produce",
  // Meat & seafood
  "chicken":"Meat & Seafood","kylling":"Meat & Seafood","beef":"Meat & Seafood","biff":"Meat & Seafood","pork":"Meat & Seafood","svin":"Meat & Seafood","ham":"Meat & Seafood","skinke":"Meat & Seafood","sausage":"Meat & Seafood","pølse":"Meat & Seafood","fish":"Meat & Seafood","fisk":"Meat & Seafood","salmon":"Meat & Seafood","laks":"Meat & Seafood","shrimp":"Meat & Seafood","reke":"Meat & Seafood","reker":"Meat & Seafood","tuna":"Meat & Seafood","tunfisk":"Meat & Seafood",
  // Bakery
  "bread":"Bakery","brød":"Bakery","baguette":"Bakery","bagett":"Bakery","bun":"Bakery","bolle":"Bakery","flatbread":"Bakery","flatbrød":"Bakery","naan":"Bakery","lefse":"Bakery","wrap":"Bakery",
  // Meals
  "pizza":"Meals","burger":"Meals","hamburger":"Meals","taco":"Meals","burrito":"Meals","pasta":"Meals","spaghetti":"Meals","ramen":"Meals","curry":"Meals","soup":"Meals","suppe":"Meals","gryte":"Meals","stew":"Meals",
  // Pantry
  "rice":"Pantry","ris":"Pantry","beans":"Pantry","bønner":"Pantry","salt":"Pantry","honey":"Pantry","honning":"Pantry","oil":"Pantry","olje":"Pantry","flour":"Pantry","mel":"Pantry","sauce":"Pantry","saus":"Pantry","can":"Pantry","boks":"Pantry","hermetikk":"Pantry",
  // Snacks & sweets
  "chocolate":"Snacks & Sweets","sjokolade":"Snacks & Sweets","candy":"Snacks & Sweets","godteri":"Snacks & Sweets","cookie":"Snacks & Sweets","kjeks":"Snacks & Sweets","chips":"Snacks & Sweets","popcorn":"Snacks & Sweets","cake":"Snacks & Sweets","kake":"Snacks & Sweets","muffin":"Snacks & Sweets","cupcake":"Snacks & Sweets","pie":"Snacks & Sweets","pai":"Snacks & Sweets","dessert":"Snacks & Sweets",
  // Drinks
  "juice":"Drinks","saft":"Drinks","brus":"Drinks","soda":"Drinks","coffee":"Drinks","kaffe":"Drinks","tea":"Drinks","te":"Drinks","beer":"Drinks","øl":"Drinks","wine":"Drinks","vin":"Drinks","smoothie":"Drinks"
};

const pickEmoji = (name="") => {
  const q = name.toLowerCase();
  for (const [emoji, kws] of Object.entries(EMOJI_KEYWORDS || {})) {
    if (kws?.some(k => q.includes(k))) return emoji;
  }
  return null;
};
const resolveEmoji = (p) => p?.emoji || pickEmoji(p?.name) || null;


function getCategory(product) {
  if (product?.freezer) return "Frozen";
  const e = product?.emoji;
  for (const [cat, set] of Object.entries(CATS)) if (set.has(e)) return cat;
  const n = (product?.name || "").toLowerCase();
  for (const [kw, cat] of Object.entries(NAME_CATEGORY)) if (n.includes(kw)) return cat;
  return "Other";
}




// a tiny wrapper that makes any card draggable
function SortableCard({ id, children }) {
  const {attributes, listeners, setNodeRef, transform, transition, isDragging} = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="cursor-move">
      {children}
    </div>
  );
}



function EmojiPicker({ value, onChange, onClose }) {
  const [q, setQ] = useState("");
  const qn = q.trim().toLowerCase();

  const filtered = qn
    ? EMOJI_LIST.filter(e =>
        e.includes(q) || (EMOJI_KEYWORDS[e]?.some(k => k.includes(qn)))
      )
    : EMOJI_LIST;

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-[520px] max-w-[90vw] p-4" onClick={e=>e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div className="font-semibold text-lg">Emoji</div>
          <button onClick={onClose} className="px-2 py-1 text-sm rounded bg-slate-100 hover:bg-slate-200">Close</button>
        </div>
        <input
          value={q}
          onChange={e=>setQ(e.target.value)}
          placeholder="Search by emoji or text (e.g. melk, ost)"
          className="w-full border rounded px-2 py-1 mb-2 text-sm"
        />
        <div className="max-h-40 overflow-auto grid grid-cols-10 gap-1 border rounded p-2">
          {(filtered.length ? filtered : EMOJI_LIST).map((e, i) => (
            <button key={i} onClick={()=>onChange(e)} className={`text-2xl rounded ${value===e?"ring-2 ring-indigo-500":""}`}>{e}</button>
          ))}
        </div>
      </div>
    </div>
  );
}


function AddProductModal({ open, onClose, onCreate }) {
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("🍎");
  const [picker, setPicker] = useState(false);
  const [packSize, setPackSize] = useState(1);
  const [shelfLifeDays, setShelfLifeDays] = useState(7);
  const [freezer, setFreezer] = useState(false);
  const [autoAddWhenEmpty, setAutoAdd] = useState(false);

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-[520px] max-w-[90vw] p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="font-semibold text-lg">Add product</div>
          <button onClick={onClose} className="px-2 py-1 text-sm rounded bg-slate-100 hover:bg-slate-200">Close</button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm">Name
            <input value={name} onChange={e=>setName(e.target.value)} className="mt-1 w-full border rounded px-2 py-1" placeholder="e.g., Milk" />
          </label>
          <label className="text-sm">Pack size
            <input type="number" min={1} value={packSize} onChange={e=>setPackSize(Math.max(1, Number(e.target.value)||1))} className="mt-1 w-full border rounded px-2 py-1" />
          </label>
          <label className="text-sm">Shelf‑life (days)
            <input type="number" min={1} value={shelfLifeDays} onChange={e=>setShelfLifeDays(Math.max(1, Number(e.target.value)||1))} className="mt-1 w-full border rounded px-2 py-1" />
          </label>
          <div className="text-sm flex items-center gap-3 mt-6">
            <label className="flex items-center gap-1"><input type="checkbox" checked={freezer} onChange={e=>setFreezer(e.target.checked)} /> Frozen ❄️</label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={autoAddWhenEmpty} onChange={e=>setAutoAdd(e.target.checked)} /> Auto‑add when empty</label>
          </div>
        </div>

        <div className="mt-4">
          <div className="text-sm mb-1">Emoji</div>
          <button onClick={()=>setPicker(true)} className="px-2 py-1 rounded border bg-white hover:bg-slate-50 text-2xl">{emoji}</button>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <div className="text-sm text-slate-600">Preview: <span className="text-2xl ml-2">{emoji}</span></div>
          <button
            onClick={()=>{
              if (!name.trim()) return;
              onCreate({ id: genId(), name: name.trim(), emoji, packSize, shelfLifeDays, freezer, autoAddWhenEmpty, items: [] });
              onClose();
            }}
            className="px-3 py-1.5 rounded bg-black text-white hover:opacity-90"
          >Add</button>
        </div>
      </div>
      {picker && <EmojiPicker value={emoji} onChange={(e)=>{ setEmoji(e); setPicker(false); }} onClose={()=>setPicker(false)} />}
    </div>
  );
}

function EditProductModal({ open, onClose, product, onSave }) {
  const [name, setName] = useState(product?.name || "");
  const [emoji, setEmoji] = useState(product?.emoji || "🍎");
  const [packSize, setPackSize] = useState(product?.packSize || 1);
  const [shelfLifeDays, setShelfLifeDays] = useState(product?.shelfLifeDays || 7);
  const [freezer, setFreezer] = useState(product?.freezer || false);
  const [autoAddWhenEmpty, setAutoAdd] = useState(product?.autoAddWhenEmpty || false);
  const [picker, setPicker] = useState(false);

  if (!open || !product) return null;

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-[520px] max-w-[90vw] p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="font-semibold text-lg">Edit product</div>
          <button onClick={onClose} className="px-2 py-1 text-sm rounded bg-slate-100 hover:bg-slate-200">Close</button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm">Name
            <input value={name} onChange={e=>setName(e.target.value)} className="mt-1 w-full border rounded px-2 py-1" />
          </label>
          <label className="text-sm">Pack size
            <input type="number" min={1} value={packSize} onChange={e=>setPackSize(Math.max(1, Number(e.target.value)||1))} className="mt-1 w-full border rounded px-2 py-1" />
          </label>
          <label className="text-sm">Shelf‑life (days)
            <input type="number" min={1} value={shelfLifeDays} onChange={e=>setShelfLifeDays(Math.max(1, Number(e.target.value)||1))} className="mt-1 w-full border rounded px-2 py-1" />
          </label>
          <div className="text-sm flex items-center gap-3 mt-6">
            <label className="flex items-center gap-1"><input type="checkbox" checked={freezer} onChange={e=>setFreezer(e.target.checked)} /> Frozen ❄️</label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={autoAddWhenEmpty} onChange={e=>setAutoAdd(e.target.checked)} /> Auto‑add when empty</label>
          </div>
        </div>

        <div className="mt-4">
          <div className="text-sm mb-1">Emoji</div>
          <button onClick={()=>setPicker(true)} className="px-2 py-1 rounded border bg-white hover:bg-slate-50 text-2xl">{emoji}</button>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <div className="text-sm text-slate-600">Preview: <span className="text-2xl ml-2">{emoji}</span></div>
          <button
            onClick={()=>{
              if (!name.trim()) return;
              onSave({ name: name.trim(), emoji, packSize, shelfLifeDays, freezer, autoAddWhenEmpty });
              onClose();
            }}
            className="px-3 py-1.5 rounded bg-black text-white hover:opacity-90"
          >Save</button>
        </div>
      </div>
      {picker && <EmojiPicker value={emoji} onChange={(e)=>{ setEmoji(e); setPicker(false); }} onClose={()=>setPicker(false)} />}
    </div>
  );
}
{/* --------------------------------------------- PRODUCT CARDS --------------------------------------------- */}
function ProductCard({
  product,
  onUpdate,
  onAddToList,
  hideEmptyMinis,
  soonDays,
  onEdit,
  onAddLabel = () => {},
  onRemoveLabel = () => {},
  onToggleBase = () => {},
}) {
  const {
    id, name,
    emoji = resolveEmoji(product),
    items = [],
    packSize = 1,
    autoAddWhenEmpty = false,
    shelfLifeDays = 7,
    freezer = false,
    labels = [],
    isBase = false,
  } = product;

  const [newLabel, setNewLabel] = useState("");





  // Apply expiry except when frozen is on and item is paused (expiresAt === null)
  const applied = withExpiryApplied(items);
  const [listPacks, setListPacks] = useState(1);
  const [showManage, setShowManage] = useState(false); // <— NEW
  const inStock = countInStock(applied);
  const expiredCount = applied.filter(i => i.state === "expired").length;
  const { soonCount } = soonFlags(applied, soonDays);
  const isDepleted = inStock === 0;

  const commit = (nextItems) => {
    if (shouldAutoAdd(product, items, nextItems)) {
      onAddToList({ id, name, emoji, packs: 1 });
    }
    onUpdate(id, nextItems);
  };

  const toggleItem = (idx) => {
    const base = withExpiryApplied(items);
    const newItems = base.map((it, i) => (i === idx ? { ...it, state: nextState[it.state] } : it));
    commit(newItems);
  };

  const add = (n) => commit(addUnits(items, n, shelfLifeDays));
  const openSome = (n) => commit(transformOpen(applied, Math.min(n, applied.filter((i) => i.state === "full").length)));
  const emptySome = (n) => commit(transformEmpty(applied, n));
  const expireSome = (n) => commit(transformExpire(applied, n));

  const minisSource = hideEmptyMinis ? applied.filter((i) => i.state !== "empty") : applied;

  return (
    <div className={`relative rounded-3xl shadow p-4 flex flex-col items-center transition ${isDepleted ? "bg-gray-300" : "bg-blue-100"}`}>
      {/* Non-blocking ribbons/badges */}
      {isDepleted && (
        <div className="absolute top-2 left-2 text-[20px] font-bold px-5 py-0.5 rounded-full bg-rose-100 text-rose-700 border border-rose-200 pointer-events-none">
          Needs restock
        </div>
      )}
      {expiredCount > 0 && (
        <div className="absolute top-2 right-2 text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200 pointer-events-none">
          {expiredCount} expired
        </div>
      )}
      {soonCount > 0 && (
        <div className="absolute top-8 right-2 text-[10px] px-2 py-0.5 rounded-full bg-sky-100 text-sky-700 border border-sky-200 pointer-events-none">
          {soonCount} soon
        </div>
      )}

      {/* Count badge (includes expired per spec) */}
      <div className="absolute -top-2 -right-2 bg-black text-white text-xs rounded-full px-2 py-0.5 shadow" title={`${inStock} in stock (incl. expired)`}>
        {inStock}
      </div>

      {/* HEADER + EMOJI (click to +1) */}
      <button className={`text-8xl p-4 leading-none transition-transform duration-150 hover:scale-110 hover:brightness-110 ${isDepleted ? "grayscale" : ""}`} title="Click to add one" onClick={()=>add(1)}>
        {emoji}
      </button>
      <div className="mt-1 text-3xl font-bold text-gray-600 text-center">
        {name}
        {freezer && <span title="Frozen" className="ml-1">❄️</span>}
        <div className="mt-2 flex gap-2">
          <button 
            className="ml-2 text-xs px-2 py-0.5 rounded border bg-slate-50 hover:bg-slate-100" 
            onClick={()=>onEdit(product)}>Edit</button>
            
          <button 
            className="ml-1 text-xs px-2 py-0.5 rounded border bg-slate-50 hover:bg-slate-100" 
            onClick={()=>setShowManage(v=>!v)}>{showManage ? 'Hide' : 'Manage'}</button>



 




          {/* labels chips */}
          {product.labels?.length ? (
            <div className="mt-2 flex flex-wrap justify-center gap-1">
              {product.labels.map(l => (
                <span key={l} className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100">
                  {l}
                </span>
              ))}
            </div>
          ) : null}

          <button
            title="Add to shopping list"
            className="text-xl px-2 py-0.5 rounded border bg-emerald-50 hover:bg-emerald-100"
            onClick={()=>{
              const { id, name, emoji } = product;
              onAddToList({ id, name, emoji, packs: 1 }); // quick add
            }}
          >+</button>
        </div>


        


        
      </div>
      <div className="text-xs text-slate-500">{inStock} in stock</div>

      {/* Mini icons */}
      <div className="flex gap-1 mt-2 flex-wrap justify-center">
        {minisSource.map((it, i) => (
          <button
            key={it.id || i}
            onClick={() => toggleItem(applied.indexOf(it))}
            className="relative text-2xl leading-none"
            title={`Click to mark as ${nextState[it.state]}`}
          >
            {it.state === "full" && <span className="drop-shadow-sm">{emoji}</span>}
            {it.state === "opened" && <span className="opacity-80 border-b-2 border-amber-500 drop-shadow-sm">{emoji}</span>}
            {it.state === "expired" && (
              <span className="opacity-90 ring-2 ring-amber-500 rounded">
                {emoji}
                <span className="absolute -top-1 -right-1 text-[10px] bg-amber-600 text-white rounded px-1">EXP</span>
              </span>
            )}
            {it.state === "empty" && <span className="opacity-30 line-through">{emoji}</span>}
          </button>
        ))}
      </div>

      {/* Batch controls (collapsible via Manage) */}
      {showManage && (
        <>
          <div className="mt-3 grid grid-cols-3 gap-2 w-full text-xs">
            <button onClick={() => add(1)} className="px-2 py-1 rounded bg-emerald-100 hover:bg-emerald-200">+1</button>
            <button onClick={() => openSome(1)} className="px-2 py-1 rounded bg-amber-100 hover:bg-amber-200">Open 1</button>
            <button onClick={() => emptySome(1)} className="px-2 py-1 rounded bg-rose-100 hover:bg-rose-200">Empty 1</button>

            <button onClick={() => add(packSize)} className="px-2 py-1 rounded bg-emerald-100 hover:bg-emerald-200 col-span-1">+{packSize} pack</button>
            <button onClick={() => openSome(packSize)} className="px-2 py-1 rounded bg-amber-100 hover:bg-amber-200 col-span-1">Open {packSize}</button>
            <button onClick={() => emptySome(packSize)} className="px-2 py-1 rounded bg-rose-100 hover:bg-rose-200 col-span-1">Empty {packSize}</button>

            <button onClick={() => expireSome(1)} className="px-2 py-1 rounded bg-amber-50 hover:bg-amber-100 col-span-3">Mark 1 expired (test)</button>

            <label className="flex items-center gap-2 text-xs mt-2">
              <input type="checkbox"
                    checked={product.isBase}
                    onChange={e=>onToggleBase && onToggleBase(e.target.checked)} />
              Basisvare
            </label>

            <div className="mt-2 text-xs">
              <div className="mb-1">Labels</div>
              <div className="flex flex-wrap gap-1">
                {(product.labels||[]).map(l=>(
                  <span key={l} className="px-2 py-0.5 rounded-full bg-slate-100">
                    {l}
                    <button className="ml-1" onClick={()=>onRemoveLabel(l)}>×</button>
                  </span>
                ))}
              </div>
              <div className="mt-1 flex gap-1">
                <input value={newLabel} onChange={e=>setNewLabel(e.target.value)} className="border rounded px-2 py-1" />
                <button className="px-2 py-1 border rounded" 
                  onClick={()=>{ 
                    const L = newLabel.trim();
                    if (!L) return;
                    onAddLabel(newLabel); setNewLabel(""); }}>
                  Add
                </button>
              </div>
            </div>

          </div>

          {/* List + config */}
          <div className="mt-3 w-full flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <button onClick={() => onAddToList({ id, name, emoji, packs: listPacks })} className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 border">Add to list</button>
              <label className="flex items-center gap-1">
                <span>Packs:</span>
                <input type="number" min={1} value={listPacks} onChange={(e)=>setListPacks(Math.max(1, Number(e.target.value)||1))} className="w-14 border rounded px-1 py-0.5" />
              </label>
            </div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1">
                <span className="opacity-70">Pack size:</span>
                <input type="number" min={1} value={packSize} onChange={(e)=> onUpdate(id, items, { packSize: Math.max(1, Number(e.target.value)||1) })} className="w-16 border rounded px-1 py-0.5" />
              </label>
              <label className="flex items-center gap-1">
                <span className="opacity-70">Shelf‑life (days):</span>
                <input type="number" min={1} value={shelfLifeDays} onChange={(e)=> onUpdate(id, items, { shelfLifeDays: Math.max(1, Number(e.target.value)||1) })} className="w-20 border rounded px-1 py-0.5" />
              </label>
            </div>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={autoAddWhenEmpty} onChange={(e) => onUpdate(id, items, { autoAddWhenEmpty: e.target.checked })} />
              Auto‑add when empty
            </label>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={freezer} onChange={(e) => onUpdate(id, items, { freezer: e.target.checked })} />
              Frozen ❄️
            </label>
          </div>
        </>
      )}
    </div>
  );
}

export default function App() {
  const [products, setProducts] = useState([
    { id: "1", name: "Melk",              emoji: "🥛", packSize: 1, shelfLifeDays: 7, autoAddWhenEmpty: true, freezer: false, items: [genUnit(7), genUnit(7), { ...genUnit(7), state: "opened" }] },
    { id: "2", name: "Egg",               emoji: "🥚", packSize: 30, shelfLifeDays: 21, autoAddWhenEmpty: true, freezer: false, items: Array.from({ length: 12 }, (_, i) => (i < 10 ? genUnit(21) : i < 11 ? { ...genUnit(21), state: "opened" } : { ...genUnit(21), state: "empty" })) },
    { id: "3", name: "Juice",             emoji: "🧃", packSize: 1, shelfLifeDays: 5, autoAddWhenEmpty: false, freezer: false, items: [{ ...genUnit(5), state: "opened" }] },
    { id: "4",  name: "Kjøttdeig",        emoji: "🥩", packSize: 1, shelfLifeDays: 2,  autoAddWhenEmpty: true, freezer: false, items: [genUnit(2)] },
    { id: "5",  name: "Kylling",          emoji: "🍗", packSize: 1, shelfLifeDays: 2,  autoAddWhenEmpty: true, freezer: false, items: [genUnit(2)] },
    { id: "6",  name: "Ost",              emoji: "🧀", packSize: 1, shelfLifeDays: 30, autoAddWhenEmpty: true, freezer: false, items: [{ ...genUnit(30), state: "opened" }] },
    { id: "7",  name: "Gulrot",           emoji: "🥕", packSize: 1, shelfLifeDays: 21, autoAddWhenEmpty: false, freezer: false, items: [genUnit(21), genUnit(21)] },
    { id: "8",  name: "Salat",            emoji: "🥬", packSize: 1, shelfLifeDays: 5,  autoAddWhenEmpty: false, freezer: false, items: [genUnit(5)] },
    { id: "9",  name: "Agurk",            emoji: "🥒", packSize: 1, shelfLifeDays: 7,  autoAddWhenEmpty: false, freezer: false, items: [genUnit(7)] },
    { id: "10", name: "Hvitløk",          emoji: "🧄", packSize: 1, shelfLifeDays: 60, autoAddWhenEmpty: true, freezer: false, items: [genUnit(60)] },
    { id: "11", name: "Løk",              emoji: "🧅", packSize: 1, shelfLifeDays: 30, autoAddWhenEmpty: false, freezer: false, items: [genUnit(30), genUnit(30)] },
    { id: "12", name: "Fløte",            emoji: "🥛", packSize: 1, shelfLifeDays: 10, autoAddWhenEmpty: false, freezer: false, items: [{ ...genUnit(10), state: "opened" }] },
    { id: "13", name: "Frokostblanding",  emoji: "🥣", packSize: 1, shelfLifeDays: 180,autoAddWhenEmpty: true, freezer: false, items: [{ ...genUnit(180), state: "opened" }] },
    { id: "14", name: "Saft",             emoji: "🥤", packSize: 1, shelfLifeDays: 365,autoAddWhenEmpty: true, freezer: false, items: [{ ...genUnit(365), state: "opened" }] },

  ]);

  // group-by state
  const [groupBy, setGroupBy] = useState("Category"); // "None" | "Category" | "Label" | "Base"




  // mutators (useCallback optional)
  const addLabel = (id, label) => {
    const L = (label || "").trim();
    if (!L) return;
    setProducts(prev => prev.map(p =>
      p.id === id ? { ...p, labels: Array.from(new Set([...(p.labels||[]), L])) } : p
    ));
  };
  const removeLabel = (id, label) =>
    setProducts(prev => prev.map(p =>
      p.id === id ? { ...p, labels: (p.labels||[]).filter(x => x !== label) } : p
    ));
  const toggleBase = (id, v) =>
    setProducts(prev => prev.map(p => p.id === id ? { ...p, isBase: !!v } : p));

  const sensors = useSensors(
  useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  // key function (can be here or top-level if you pass mode in)
  const getGroupKey = (product, mode = groupBy) => {
    switch (mode) {
      case "Category": return getCategory(product);
      case "Label":    return product.labels?.[0] || "Unlabeled";
      case "Base":     return product.isBase ? "Basisvarer" : "Andre";
      default:         return "All";
    }
  };

  const onDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    setProducts(prev => {
      const oldIndex = prev.findIndex(p => p.id === active.id);
      const newIndex = prev.findIndex(p => p.id === over.id);
      return arrayMove(prev, oldIndex, newIndex);
    });
  };



  const [shoppingList, setShoppingList] = useState([]); // [{id,name,packs,checked}]
  const [hideEmptyMinis, setHideEmptyMinis] = useState(true);
  const [mode, setMode] = useState("multi"); // fridge | shopping | multi
  const [soonDays, setSoonDays] = useState(2); // global soon window (days)
  const [showAdd, setShowAdd] = useState(false); // add product modal
  const [showEdit, setShowEdit] = useState(false); // edit modal
  const [editing, setEditing] = useState(null);
  const [showNotif, setShowNotif] = useState(true); // simple notification stub
  const REMOVE_DELAY_MS = 1800; // ms delay before removing checked list items

  // updateProduct with freezer pause logic
  const updateProduct = (id, newItems, extraPatch = {}) => {
    setProducts((prev) => prev.map((p) => {
      if (p.id !== id) return p;
      const next = { ...p, ...extraPatch };

      // Freezer pause/resume: when turning on, save remaining time and null out expiresAt; when off, restore
      if (typeof extraPatch.freezer === 'boolean' && extraPatch.freezer !== p.freezer) {
        if (extraPatch.freezer) {
          // turning ON: compute remaining and store freezeRemainMs; null expiresAt to pause
          newItems = (newItems ?? p.items).map(it => {
            if (!it.expiresAt || it.state === 'empty') return it; // nothing to pause
            const remain = Math.max(0, it.expiresAt - now());
            return { ...it, freezeRemainMs: remain, expiresAt: null };
          });
        } else {
          // turning OFF: restore expiresAt from freezeRemainMs
          newItems = (newItems ?? p.items).map(it => {
            if (typeof it.freezeRemainMs === 'number') {
              return { ...it, expiresAt: now() + it.freezeRemainMs, freezeRemainMs: undefined };
            }
            return it;
          });
        }
      }

      return { ...next, items: newItems ?? p.items };
    }));
  };


const addToList = ({ id, name, emoji, packs = 1 }) => {
  setShoppingList(prev => {
    const prod = products.find(p => p.id === id) || { id, name, emoji };
    const resolvedEmoji = emoji ?? resolveEmoji(prod) ?? "🛒";
    const category = getCategory({ ...prod, emoji: resolvedEmoji });

    const found = prev.find(i => i.id === id);
    if (found) {
      return prev.map(i =>
        i.id === id
          ? {
              ...i,
              packs: (i.packs || 1) + packs,
              // never lose the emoji once set
              emoji: i.emoji ?? resolvedEmoji,
              category: i.category ?? category,
            }
          : i
      );
    }
    return prev.concat({ id, name, emoji: resolvedEmoji, category, packs, checked: false });
  });
};


  const handleCreateProduct = (p) => setProducts(prev => [...prev, p]);

  const openEdit = (p) => { setEditing(p); setShowEdit(true); };
  const applyEdit = (patch) => {
    if (!editing) return;
    updateProduct(editing.id, editing.items, { ...patch });
  };


  const groupedList = useMemo(() => {
  const groups = new Map();
  for (const it of shoppingList) {
    const p = products.find(x => x.id === it.id);
    const key =
      groupBy === "Category" ? (it.category || (p && getCategory(p)) || "Other") :
      groupBy === "Label"    ? (p?.labels?.[0] || "Unlabeled") :
      groupBy === "Base"     ? (p?.isBase ? "Basisvarer" : "Andre") :
                               "All";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }
  const sortKey = ([k]) =>
    groupBy === "Category" ? (CATEGORY_WEIGHT[k] ?? 999) :
    groupBy === "Base"     ? (k === "Basisvarer" ? 0 : 1) :
                             k.toLocaleLowerCase("nb");
  return [...groups.entries()]
    .sort((a,b)=> (sortKey(a) > sortKey(b) ? 1 : -1))
    .map(([k, arr]) => [k, arr.slice().sort((x,y)=> x.name.localeCompare(y.name,"nb",{sensitivity:"base"}))]);
}, [shoppingList, products, groupBy]);




  // Derived lists for side panel
  const withApplied = products.map(p => ({ ...p, items: withExpiryApplied(p.items) }));
  const soonList = withApplied
    .map(p => ({ ...p, soon: soonFlags(p.items, soonDays).soonCount }))
    .filter(p => p.soon > 0)
    .map(p => ({ id: p.id, name: p.name, emoji: p.emoji, count: p.soon }));
  const expiredList = withApplied
    .map(p => ({ ...p, expired: p.items.filter(i => i.state === 'expired').length }))
    .filter(p => p.expired > 0)
    .map(p => ({ id: p.id, name: p.name, emoji: p.emoji, count: p.expired }));

  const notifCount = soonList.reduce((a,b)=>a+b.count,0) + expiredList.reduce((a,b)=>a+b.count,0);

  const [suggestion, setSuggestion] = useState(null)
  const [missing, setMissing] = useState([])

  async function suggestToday() {
    const recipe = await getDailySuggestion()
    const { need } = computeShoppingDelta({ ingredients: recipe.ingredients, stock: products })
    setSuggestion(recipe)
    setMissing(need)
  }


  const groupedProducts = useMemo(() => {
    if (groupBy === "None") return [["All", products]];
    const m = new Map();
    for (const p of products) {
      const key =
        groupBy === "Category" ? getCategory(p) :
        groupBy === "Label"    ? (p.labels?.[0] || "Unlabeled") :
        /* Base */               (p.isBase ? "Basisvarer" : "Andre");
      if (!m.has(key)) m.set(key, []);
      m.get(key).push(p);
    }
    const sortKey = (k) =>
      groupBy === "Category" ? (CATEGORY_WEIGHT[k] ?? 999) :
      groupBy === "Base"     ? (k === "Basisvarer" ? 0 : 1) :
                              k.toLocaleLowerCase("nb");
    const out = [...m.entries()].sort((a,b)=> (sortKey(a[0]) > sortKey(b[0]) ? 1 : -1));
    out.forEach(([, arr]) => arr.sort((a,b)=> a.name.localeCompare(b.name,"nb",{sensitivity:"base"})));
    return out;
  }, [products, groupBy]);


  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 to-slate-200 p-6">
      {/* Simple notification stub */}
      {showNotif && notifCount > 0 && (
        <div className="mb-3 p-3 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-800 flex items-center justify-between">
          <div>
            Notifications: <b>{notifCount}</b> item(s) soon/expired. Check the sidebar list.
          </div>
          <button onClick={()=>setShowNotif(false)} className="text-sm underline">Dismiss</button>
        </div>
      )}

      <header className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">QuickStock</h1>
        <div className="flex items-center gap-4">
          <button onClick={()=>setShowAdd(true)} className="px-2 py-1 rounded bg-black text-white">+ Add Product</button>
          <label className="text-sm flex items-center gap-2">
            <span>Soon window</span>
            <input type="number" min={1} value={soonDays} onChange={e=>setSoonDays(Math.max(1, Number(e.target.value)||1))} className="w-16 border rounded px-2 py-1" />
            <span>days</span>
          </label>
          <select value={mode} onChange={(e) => setMode(e.target.value)} className="border rounded px-2 py-1 text-sm">
            <option value="multi">Multi</option>
            <option value="fridge">Fridge only</option>
            <option value="shopping">Shopping only</option>
          </select>
          <label className="text-sm flex items-center gap-2">
            <input type="checkbox" checked={hideEmptyMinis} onChange={(e) => setHideEmptyMinis(e.target.checked)} />
            Hide empty mini-icons
          </label>
        </div>
      </header>

      <div className={`grid gap-4 ${mode === "multi" ? "grid-cols-1 lg:grid-cols-3" : "grid-cols-1"}`}>
        {(mode === "fridge" || mode === "multi") && (
          <div className={mode === "multi" ? "lg:col-span-2" : ""}>
            {groupBy === "None" ? (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                <SortableContext items={products.map(p => p.id)} strategy={rectSortingStrategy}>
                  <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
                    {products.map(p => (
                      <SortableCard key={p.id} id={p.id}>
                        <ProductCard
                          product={p}
                          onUpdate={updateProduct}
                          onAddToList={addToList}
                          hideEmptyMinis={hideEmptyMinis}
                          soonDays={soonDays}
                          onEdit={openEdit}
                          onAddLabel={(label)=>addLabel(p.id, label)}
                          onRemoveLabel={(label)=>removeLabel(p.id, label)}
                          onToggleBase={(v)=>toggleBase(p.id, v)}
                        />
                      </SortableCard>
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
          ) : (
            groupedProducts.map(([group, arr]) => (
              <div key={group} className="mb-3">
                <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">
                  {group} <span className="text-slate-400">({arr.length})</span>
                </div>
                <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
                  {arr.map(p => (
                    <ProductCard
                      key={p.id}
                      product={p}
                      onUpdate={updateProduct}
                      onAddToList={addToList}
                      hideEmptyMinis={hideEmptyMinis}
                      soonDays={soonDays}
                      onEdit={openEdit}
                      onAddLabel={(label)=>addLabel(p.id, label)}
                      onRemoveLabel={(label)=>removeLabel(p.id, label)}
                      onToggleBase={(v)=>toggleBase(p.id, v)}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}

        {(mode === "shopping" || mode === "multi") && (
          <aside className="space-y-4">
            <section className="bg-white rounded-xl shadow p-3">
              <div className="font-semibold mb-2">Shopping List</div>
              {shoppingList.length === 0 ? (
                <div className="text-sm text-slate-500">List empty</div>
              ) : (
                groupedList.map(([cat, items]) => (
                  <div key={cat} className="mb-3">
                    <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">
                      {cat} <span className="text-slate-400">({items.length})</span>
                    </div>
                    <ul className="space-y-2">
                      {items.map(it => (
                        <li key={it.id} className="flex items-center justify-between text-sm">
                          {/* keep your existing label/checkbox/Remove button exactly as-is */}
                          {/* START existing <label> block */}
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={it.checked}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                setShoppingList(prev => prev.map(x => x.id === it.id ? { ...x, checked } : x));
                                if (checked) {
                                  const p = products.find(x => x.id === it.id);
                                  if (p) {
                                    const packs = it.packs || 1;
                                    const amount = Math.max(1, (p.packSize || 1) * packs);
                                    let newItems = addUnits(p.items, amount, p.shelfLifeDays);
                                    if (p.freezer) {
                                      newItems = newItems.map(u => ({ ...u, freezeRemainMs: Math.max(0, (u.expiresAt ?? (now()+p.shelfLifeDays*DAY)) - now()), expiresAt: null }));
                                    }
                                    updateProduct(p.id, newItems);
                                  }
                                  setTimeout(() => {
                                    setShoppingList(prev => prev.filter(x => x.id !== it.id));
                                  }, REMOVE_DELAY_MS);
                                }
                              }}
                            />
                            <span className={it.checked ? "line-through opacity-60" : ""}>
                              <span className="text-lg mr-1">{it.emoji || "🛒"}</span>
                              {it.name}{it.packs ? ` ×${it.packs}` : ""}
                            </span>
                          </label>
                          <button
                            className="text-xs px-2 py-1 rounded bg-rose-50 border hover:bg-rose-200"
                            onClick={() => setShoppingList(prev => prev.filter(x => x.id !== it.id))}
                          >
                            Remove
                          </button>
                          {/* END existing block */}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))
              )}
            </section>

            <div className="mt-2 flex justify-center gap-2">
              <select
                value={groupBy}
                onChange={e=>setGroupBy(e.target.value)}
                className="text-sm border rounded px-2 py-1"
              >
                <option value="Category">Group: Category</option>
                <option value="Label">Group: Label</option>
                <option value="Base">Group: Basisvare</option>
                <option value="None">Group: None</option>
              </select>
            </div>

            {/* Soon to expire list + tiny recipe suggestions (placeholder) */}
            {(soonList.length > 0 || expiredList.length > 0) && (
              <section className="bg-white rounded-xl shadow p-3 space-y-3">
                <div className="font-semibold">Soon & Expired</div>
                {soonList.length > 0 && (
                  <div>
                    <div className="text-sm font-medium mb-1">Soon (≤{soonDays} days)</div>
                    <ul className="text-sm space-y-1">
                      {soonList.map(it => (
                        <li key={`soon-${it.id}`} className="flex items-center justify-between">
                          <span>{it.emoji} {it.name}</span>
                          <span className="text-xs text-sky-700 bg-sky-100 border border-sky-200 rounded px-2 py-0.5">{it.count}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {expiredList.length > 0 && (
                  <div>
                    <div className="text-sm font-medium mb-1">Expired</div>
                    <ul className="text-sm space-y-1">
                      {expiredList.map(it => (
                        <li key={`exp-${it.id}`} className="flex items-center justify-between">
                          <span>{it.emoji} {it.name}</span>
                          <span className="text-xs text-amber-700 bg-amber-100 border border-amber-200 rounded px-2 py-0.5">{it.count}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="text-xs text-slate-600">
                  Recipe ideas (mock): omelette, soup, smoothie with items above.
                </div>
              </section>
            )}
          </aside>
        )}
      </div>

      <section>
        <button onClick={suggestToday}>🎲 Suggest Recipe</button>

        {suggestion && (
          <div>
            <h3>{suggestion.title}</h3>
            {suggestion.image && <img src={suggestion.image} alt={suggestion.title} width={200} />}
            <button onClick={() => addToShoppingList(missing)}>➕ Add Missing Ingredients</button>
          </div>
        )}
      </section>



      <div className="mt-8 p-4 bg-white rounded-xl shadow text-sm text-slate-600 space-y-1">
        <p>Click big emoji to <b>add +1</b>. Click mini-icons to cycle states: <b>Full → Opened → Empty</b>; <b>Expired → Empty</b>. Expired items are included in the stock badge until you empty them.</p>
        <p>Use <b>Edit</b> to change name/emoji and settings, and <b>Manage</b> to show/hide action buttons.</p>
        <p>Badges: <b>expired</b> and <b>soon</b> (≤ configurable days). Side panel shows a combined list plus simple recipe ideas.</p>
        <p>Shopping: checking an item restocks by <i>packs × packSize</i>, strikes it out, then removes it.</p>
        <p>Modes: switch <b>Fridge</b>, <b>Shopping</b>, <b>Multi</b> in the header.</p>
      </div>

      <AddProductModal open={showAdd} onClose={()=>setShowAdd(false)} onCreate={handleCreateProduct} />
      <EditProductModal
        open={showEdit}
        onClose={()=>setShowEdit(false)}
        product={editing}
        onSave={applyEdit}
      />
    </div>
  );
}
