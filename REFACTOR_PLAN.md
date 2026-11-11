# Quick Stock: freezer-first refactor plan

Status: repository analysis recorded before implementation. The approved freezer-first foundation is now being implemented in the application; product decisions below remain relevant for later phases. This document does not describe live Firestore data or deployed behavior.

## 1. Goal and recommended MVP

Make the first screen answer three household questions quickly: **what is in the freezer, what should be used soon, and what can we cook with it?** The main action should be adding or using a frozen item in a few taps on a phone or iPad. Keep Google sign-in, shared households, Firestore, the existing stock collection, and saved recipes. Oda remains the grocery-shopping workflow; Quick Stock does not need to reproduce checkout or a full shopping list to meet this goal.

Recommended first release (phases 1–2): a freezer home showing available frozen products, counts, and a simple "use one" action; a prominent quick-add action; and a "cook from freezer" section using saved recipes and existing `stockItemId` links. Surface dated items as "use soon" only after the date semantics are agreed. Keep broader inventory and recipes accessible during transition, and keep existing Firestore collections intact. Do not connect to Oda or add AI, speech, a backend server, or new libraries for this release.

## 2. Repository and architecture findings

| Area | Current implementation | Implication |
| --- | --- | --- |
| Frontend | React 19, Vite 7, TailwindCSS 3.4 and a small CSS entry; `src/main.jsx` mounts `App` | Preserve this stack and SPA approach. |
| Data/auth | Firebase 12 client SDK, Google Auth, Firestore; `src/firebase.js` adapts redirect auth for installed iOS PWA | Reuse. Validate on iPhone/iPad before touching auth behavior. |
| Hosting/PWA | Firebase Hosting SPA rewrite, manifest/icons, hand-written `public/sw.js` registered in `src/main.jsx`; Vite legacy plugin | Keep the install flow. The spec mentions `vite-plugin-pwa`, but it is not installed or used. The service worker caches the app shell, not Firestore data. |
| Navigation | One URL (`/`), no router. `MAIN_VIEWS` and `INVENTORY_MODES` select panels through React state in `Inventory` | A freezer-first landing screen can be added without routing or a new dependency. Browser deep links to views do not currently exist. |
| UI organization | Nearly all hooks, data operations, stock math, and views live in ~4,300 lines of `src/App.jsx`; `src/services/recipeHelper.js` is separate but unused | Split by existing domain boundaries as each slice is changed; avoid a full rewrite. |
| Subscriptions | Household membership, household detail/member, stock items, shopping list, recipes, and weekly plans use `onSnapshot` | Reuse household-scoped listeners; subscribe only to data needed by the visible core flow where practical. `RecipeManager` also starts its own recipe listener. |
| Dependencies | `@dnd-kit/core`, `sortable`, and `utilities` are declared but no imports appear in `src`; no router, AI SDK, speech package, or test runner | Drag-and-drop packages are candidates for later removal after confirming no planned use. `@tailwindcss/postcss` is v4 while configured PostCSS uses Tailwind v3; verify before dependency cleanup. |
| Seed/dev data | In-app starter pantry and demo recipe imports use `data/*.seed.json`; `scripts/seedQuickstock.js` is a separate client-SDK import | These are development/onboarding aids, not the freezer MVP. The CLI script initializes Firebase without signing in, so current member-only rules would likely reject its writes; verify before relying on it. |

The current docs describe a wider product than the requested direction. `docs/QUICKSTOCK_SPEC_V2.md` has a v3 title and includes shopping and weekly planning as core; `docs/QUICKSTOCK_CURRENT_STATE.MD` is dated June 2026. Treat the code and rules as evidence of implementation, and update product docs when the new behavior is approved. A historical note says Add Product was broken, but code inspection alone cannot confirm whether that bug is still present.

### Current screens and components

`App` handles auth, household selection, and mounting `Inventory`. `HouseholdBar` handles create/join, invite code, rename, and sign-out. `Inventory` is the page controller; it defaults to **Weekly Menu**, while inventory defaults to **Fridge View**. Its top-level panels are Weekly Menu, Shopping List, Inventory, Recipes, and Management. Management embeds inventory, shopping, recipes, and weekly menu again. `ProductModal`, `ProductCard`, and `FridgeProductCard` edit/display stock. `RecipeManager`, `RecipeModal`, and `RecipeOpenModal` manage saved recipes and step-by-step cooking. `WeeklyMenu` plans seven days, calculates readiness, generates missing shopping items, consumes stock on Done Cooking, and records undo data. `ShoppingListPanel` checks items and restocks inventory.

There are no URL routes or backend endpoints. `src/services/recipeHelper.js` can fetch random meals from TheMealDB or Spoonacular and calculate a name/quantity-based shopping delta, but nothing imports it into the app.

## 3. Firestore schema and behavioral dependencies

| Path | Observed fields / usage | Preserve during transition |
| --- | --- | --- |
| `households/{id}` | `name`, `inviteCode`, `createdBy`, timestamps | Yes. Household remains the ownership boundary. |
| `households/{id}/members/{uid}` | identity, `role`, `joinedAt`; rules use membership and role | Yes. |
| `users/{uid}/households/{id}` | membership summary for the household picker | Yes. |
| `householdInvites/{code}` | lookup document for joining | Yes. |
| `households/{id}/stockItems/{itemId}` | `name`, `emoji`, `unit`, `packSize`, `shelfLifeDays`, `freezer`, `autoAddWhenEmpty`, `isBase`, `depleteOnCook`, `labels`, `items[]`, sometimes legacy `quantity`/`state`, timestamps | Yes. IDs are referenced by recipe ingredients and shopping items. |
| `stockItems.items[]` | unit `id`, `state` (`full`, `opened`, `expired`, `empty`), `addedAt`, `expiresAt`; cooking may add `emptiedAt` | Yes. A legacy `quantity` is converted into synthetic units at read time when `items` is absent. |
| `households/{id}/recipes/{recipeId}` | `name`, `emoji`, `servings`, `steps[]`, `ingredients[]` with `stockItemId`, `nameSnapshot`, `quantity`, `unit` | Yes. Keep `stockItemId` identity even if recipe UI is simplified. |
| `households/{id}/weeklyPlans/{weekId}` | ISO week, `days.{weekday}` with `recipeId`, `notes`, `consumedAt`, `consumptionUndo` | Read and retain if the weekly UI is retired. It contains consumption history/undo data. |
| `households/{id}/shoppingList/{itemId}` | manual or generated item, `checked`/`checkedAt`, packs/quantity, recipe and week source IDs, linked stock IDs, timestamps | Read and retain until an explicit archive/removal decision. Checking an item can create or increment stock. |

`firestore.rules` allows household members to read all household collections. Admins and members can write stock, recipes, and weekly plans; **any** household member can write shopping items. A future shopping-only role is documented but not implemented. Rules do not validate the stock-item shape or the `freezer`/unit fields. Existing collection paths and membership checks are suitable for a freezer-first MVP; any new field or new collection needs a rules review.

### Existing stock rules that matter

- `freezer` is a **stock-item boolean**. All units of a product share one location. Mixed fridge/freezer storage currently requires two product documents, which can break recipe links and availability. `docs/BACKLOG.md` calls this out explicitly.
- New units get `expiresAt = now + shelfLifeDays`, whether or not the product is frozen. Toggling `freezer` does not adjust dates. Expiry is applied in memory when reading, rather than written back. A frozen product created from a short-lived fresh item may immediately look expired; freezer "use soon" needs an agreed date policy.
- Available means units in `full` or `opened` state after applying expiry. `countInStock` also counts expired units. The card's empty/stock indicators and auto-add-on-empty behavior can therefore differ from recipe readiness.
- Recipe readiness treats `pcs` as a count and any other unit as present/absent. Done Cooking consumes that many `pcs`, or one unit for other measures; `depleteOnCook: false` and legacy `isBase` protect pantry staples. The cooking path can consume `expired` units even though readiness excludes them. Exact grams/milliliters are not tracked.
- Shopping check is a Firestore transaction that restocks a linked item or creates a new non-frozen stock item. Unchecking does not reverse that stock addition; `checkedAt` prevents repeat restocking. Shopping is therefore a data writer, even if its UI becomes secondary.

## 4. Feature disposition

| Feature | Relevance and proposed priority | Proposed treatment |
| --- | --- | --- |
| Household sharing, Google sign-in, PWA | Essential | Reuse as-is initially; preserve iOS auth behavior. |
| Freezer filter, frozen badge/toggle, stock listeners, quick +/- | Essential | Reuse underlying logic and simplify the card for phone/iPad. Put freezer first by default. |
| Add/edit stock, unit states, dates | Essential with narrower UI | Keep the data model initially; expose name, count, optional date, and useful location controls first. Keep advanced fields accessible while migrating. |
| Saved recipes and `stockItemId` links | Directly useful for "what to cook" | Keep. Start with deterministic local matching and clear missing/unknown labels; no external provider or AI. |
| Cooking view and Done/Undo Cooking | Potentially useful | Keep existing functionality accessible. Decide whether a freezer action should consume manually or through a recipe; do not silently auto-consume. |
| Weekly menu, readiness/progress | Indirect | De-emphasize behind a secondary view in the first release; decide later whether to retain a lightweight meal plan. |
| Shopping list, Add Missing, auto-add, Mark Bought | Low given Oda | De-emphasize, then retire UI only after confirming any remaining restock workflow. Retain documents and linked metadata until migration/retention is decided. |
| Pantry staples, categories/labels, fridge/multi view | Secondary | Keep available during transition; simplify controls if real freezer usage shows they create friction. |
| Starter pantry, demo recipe import, bulk clear controls | Not a household daily task | Move away from primary navigation. Preserve developer access until replacements are agreed; bulk clear actions deserve extra care. |
| External recipe suggestion helper | Unused | Do not wire it in. Review for removal later because its name matching and numeric stock model differ from current `stockItemId`/unit-array model. |
| AI and speech recognition | Not implemented in active UI | No AI client, model call, speech recognition, microphone capture, OCR, or barcode flow was found. Voice and AI appear only as future ideas in docs. Defer until a specific user problem and privacy/cost model are defined. |

## 5. Proposed architecture

Stay with the current client-only React/Firebase application and household-scoped Firestore paths. Make `Inventory` a small screen coordinator instead of the owner of every feature. As each phase touches code, extract the existing Firestore subscriptions and stock operations into focused hooks/helpers, then extract the freezer list/card and recipe suggestions into components. Keep one shared stock-unit/availability helper so freezer cards, suggestions, and cooking use the same rule. No new collection or library is needed for the initial freezer screen.

Suggested screen hierarchy: **Freezer** (default: available count, add, use, use-soon if dates are trustworthy, cook ideas), **Recipes** (saved recipes and cooking), and **More** (legacy general inventory, weekly plan, shopping, household settings during transition). This is a navigation proposal, not a deletion plan. Avoid loading or displaying the full Management composition on the home screen. Keep the existing household switcher visible or one tap away.

For "what to cook," first score saved recipes on linked available stock items and highlight those using freezer stock; show exact reasons for missing or unlinked ingredients. Present suggestions as inspiration, because the present model does not reserve stock across recipes or know exact non-`pcs` quantities. Use no generated recipe text or external API for MVP.

## 6. Technical debt and risks to address in implementation

1. **Large coupled file and duplicated stock cards:** `ProductCard` and `FridgeProductCard` implement similar unit mutations separately; weekly, shopping, and stock behavior are tightly coupled in `App.jsx`. Extract shared stock rules before changing the UI behavior.
2. **Concurrent writes:** card updates replace the entire `items[]` array from a snapshot, and Done Cooking reads a plan then commits a batch. Two household members acting at once can overwrite unit changes or consume twice. Put high-impact consume/restock operations behind transactions or a single conflict-aware write path before relying on them for freezer counts.
3. **Unit-array growth and dual count:** empty units remain in `items[]` and some writes maintain `quantity` while others do not. Document size and count consistency can drift. Keep a compatibility reader and define one source of truth before migrating records.
4. **Location and expiry:** the item-level `freezer` flag and fresh shelf-life calculation do not support mixed storage or meaningful freezer dates. Do not infer a freezer-specific expiry from old records. Decide the desired storage/date model first.
5. **Cooking/readiness mismatch:** readiness excludes expired units, cooking may consume them; the recipe page and weekly menu use different interaction paths. Reconcile availability and consumption behavior before using recipes for freezer suggestions.
6. **Weak error visibility:** several snapshot errors replace data with an empty list, and some writes have no visible error handling. A permission or network failure may look like an empty freezer. The PWA shell caches offline, but Firestore offline persistence is not explicitly enabled.
7. **Auth diagnostics and PWA:** sign-in screen currently exposes debug state including email/UID; `index.html?debug=1` loads Eruda from a CDN. Keep useful errors but review diagnostics after the iOS installed-app flow is verified. The service worker cache version is fixed and uses cache-first for same-origin assets; review update behavior when changing the app shell.
8. **Rules and tooling:** current rules protect membership but permit any member to write shopping items and do not constrain new schema fields. The seed script's unauthenticated client SDK conflicts with member-only writes. Do not use production data or the seed script as a migration shortcut without a tested authorization path.
9. **Coverage:** no automated tests or test script are present. A small set of meaningful stock/recipe rule checks and manual multi-device household checks would reduce migration risk; avoid tests that only repeat UI implementation details.

## 7. Migration and rollout considerations

1. Inventory actual household data before schema work: count stock items/units, identify legacy `quantity` records, mixed-location duplicate names, recipes with missing `stockItemId`, expired freezer units, weekly plans, and shopping items. This analysis only inspected the repository; no live Firestore data was queried.
2. Back up/export household collections through an authorized process before data writes. Keep document IDs stable because recipes, shopping items, and undo records refer to them. Never reinterpret old `freezer: false` as a confirmed fridge location without a deliberate rule.
3. For the first release, **prefer a presentation change with compatibility reads**. Keep current `stockItems` documents and their fields. If per-unit location is approved, add optional `items[].location` (and an agreed date field), default legacy units from the parent `freezer` flag on read, then migrate idempotently per household only after validating counts and recipe links. Write both old and new representations only for a short, defined compatibility window if needed.
4. Do not delete shopping or weekly-plan documents merely because their tabs are hidden. Preserve access to legacy data during rollout. If those flows are later removed, decide export, archive, and retention rules separately.
5. Release in small slices. Compare counts and visible freezer products before/after for test households, test two simultaneous clients, then verify installed iOS PWA login and cache refresh. Have a rollback path by reverting UI code while retaining compatible data fields.

## 8. Phased implementation plan (after approval)

| Phase | Scope | Exit criteria |
| --- | --- | --- |
| 0. Baseline and decisions | Confirm the product decisions below, inspect representative household data, capture key flows and current lint/build status, and choose count/date semantics. | Agreed MVP and migration rules; no ambiguous treatment of old freezer data. |
| 1. Freezer home | Default to freezer, surface Add/Use actions, available count, and an empty state; keep existing screens reachable. Share stock helpers across card variants. | A household can add and use a frozen item quickly on phone/iPad; old stock remains visible and editable. |
| 2. Waste and cooking | Add agreed freezer date signals; rank local saved recipes using `stockItemId` and available freezer units; explain missing/unlinked ingredients. Resolve expired-unit consumption behavior. | Suggestions are deterministic and do not claim exact quantities; dated items use the agreed meaning. |
| 3. Data reliability | Make critical stock changes safe under concurrent household use; harmonize `items[]` and `quantity`; handle listener/write errors visibly. If approved, introduce per-unit location with compatibility migration. | Two-client add/use/cook checks preserve stock; old documents render correctly. |
| 4. Simplify secondary flows | Move weekly/shopping/management out of the main path, adjust onboarding and docs, remove unused code/dependencies only after confirming no needed workflow remains. | Core navigation is focused; historical data and approved legacy access remain available. |

## 9. Product decisions required before implementation

1. **Inventory scope:** Is Quick Stock strictly freezer-only, or should fridge/pantry stay as a secondary inventory? Recommendation: freezer-first, with general inventory retained during rollout.
2. **Storage granularity:** Must one product support simultaneous fridge and freezer portions? Recommendation: keep current item-level flag for the first UI release; approve per-unit location only if real household data makes the workaround painful.
3. **Quantity:** Should a frozen "unit" mean one package/portion, with +/- changing unit count, or should weight/servings be tracked? Recommendation: package/portion count; optional descriptive weight, no gram math.
4. **Date meaning:** Should "use soon" use best-before date, date frozen, or a manually chosen freezer-use-by date? What should old `expiresAt` values mean for already frozen items? Recommendation: ask for an optional explicit freezer-use-by date and avoid treating old fresh-food dates as reliable freezer warnings.
5. **Recipe promise:** Should "what to cook" mean saved recipes matching frozen ingredients, a simple list of freezer items to use, or AI-generated meal ideas? Recommendation: local saved recipes plus an explicit freezer-item prompt in MVP.
6. **Cooking stock behavior:** Should Done Cooking automatically consume linked freezer portions, ask which portions were used, or leave stock updates manual? Recommendation: keep a visible manual "use" action first; retain existing Done/Undo until its behavior is reconciled.
7. **Shopping and Oda boundary:** Is any in-app list still needed for top-up reminders, or should all shopping UI be archived? Is a manual handoff to Oda enough, with no integration? Recommendation: no Oda integration in MVP; keep legacy list accessible temporarily.
8. **Weekly menu:** Is planning meals by day still valuable, or should recipe suggestions replace the landing-page plan? Recommendation: keep it secondary until real use confirms it can be retired.
9. **Legacy data and access:** How long must shopping lists, weekly plans, and old general-inventory records remain visible/exportable? Recommendation: retain indefinitely until an explicit retention decision; no destructive migration in the MVP.

## Evidence reviewed

Primary code: `src/App.jsx` (navigation and hooks around lines 41–50 and 690–916; stock logic around 365–620; product UI around 1632–2234; shopping around 2235–2435; recipes around 2446–3024; weekly plan around 3026–3574; page controller around 3576–4177), `src/firebase.js`, `src/main.jsx`, `src/services/recipeHelper.js`, `firestore.rules`, `firebase.json`, `public/sw.js`, `public/manifest.webmanifest`, `package.json`, Vite/Tailwind/PostCSS configuration, seed files and script. Product context: `docs/QUICKSTOCK_SPEC_V2.md`, `docs/QUICKSTOCK_CURRENT_STATE.MD`, `docs/BACKLOG.md`, `docs/IOS_PWA_FIREBASE_AUTH.md`, and `README.md`. Findings are from static repository inspection; live data, deployed behavior, lint, build, and device behavior were not tested in this analysis phase.
