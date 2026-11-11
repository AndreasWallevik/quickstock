# QuickStock – Current State / Latest Notes

*Last updated: June 2026*

## Current Branch

Primary active branch:

```txt
pwa-app-install
```

This is the current canonical development branch.

`main` may be behind.

---

# Current Product State

QuickStock is now usable as a household inventory and meal-planning MVP.

Primary flows implemented:

```txt
Inventory
→ Recipes
→ Weekly Menu
→ Add Missing Items
→ Shopping List
→ Mark Bought
→ Stock
→ Done Cooking
```

The app has moved beyond prototype-only status and should now be tested in real household use.

Current recommendation:

> Stop adding major features for now. Use the app for 1–2 weeks and collect real friction points.

---

# Recently Completed Work

## Inventory / Frozen UX

Completed:

* frozen badge on inventory cards
* visible frozen styling
* frozen toggle shortcut on cards
* freezer/frozen view/filter added
* freezer is now treated as an important planning view

Purpose:

Freezer overview is one of the app’s most useful real-life use cases.

---

## Pantry Staple UX

Completed:

* `depleteOnCook` support
* “Used up when cooking” checkbox
* pantry staple badge
* legacy `isBase` items default to not depleting

Purpose:

Pantry staples like oil, spices, salt, etc. should not be automatically consumed by Done Cooking unless the user wants that.

---

## Cooking Quantity Rules

Important rules now established:

### pcs

Used for individual countable units.

Example:

```txt
2 eggs needed
pack size 12
empty inventory
shopping adds 1 pack
bought adds 12 units
Done Cooking consumes 2 units
```

### non-pcs

Examples:

```txt
g
kg
ml
l
tbsp
400-500g
```

Non-pcs quantities are display/planning only.

If linked stock item has at least one available unit, ingredient is considered available.

If none exist, shopping adds one pack/item.

Done Cooking consumes one unit unless `depleteOnCook === false`.

This is intentional to avoid turning the app into a precise weight-based ERP system.

---

## Recipe Ingredient Search / Linking

Completed:

* search stock item from recipe ingredient row
* selecting stock item fills ingredient name
* internal stock link is kept mostly hidden from user
* create new stock item from recipe editor restored
* quantity ranges preserved as text

---

## Weekly Readiness / Progress

Completed:

* Ready
* Missing X items
* Needs review
* Completed
* weekly progress count
* completed meals count as ready

Example:

```txt
4/5 meals ready
80% ready
```

---

## Shopping / Add Missing Fixes

Completed or improved:

* generated shopping items store source metadata
* generated items avoid simple duplicates
* `recipeQuantity` / `recipeUnit` used for display
* `packs` used for shopping/restocking
* Mark Bought uses pack size properly
* pcs vs non-pcs behavior corrected

Important remaining testing:

The full identity chain should still be tested in real use:

```txt
Recipe ingredient
→ Weekly plan
→ Add Missing
→ Shopping item
→ Bought
→ Stock item
→ Done Cooking
```

---

## PWA / Deploy

Completed:

* Vite build works
* Firebase deploy works
* app hosted on Firebase Hosting
* app installable as PWA
* service worker / manifest present

Hosting URL:

```txt
https://quickstock-b04b2.web.app
```

---

# Auth Status

Google Auth works in browser.

Installed iOS PWA auth had issues earlier.

Temporary auth diagnostics currently exist or may still exist.

Current recommendation:

* do not remove auth debug until app has been tested more on iPhone/PWA
* later hide/remove debug UI
* keep useful auth error messages

Future branch:

```txt
auth-cleanup-remove-debug
```

---

# Known Local Git Notes

Do not commit Firebase hosting cache noise.

Common noisy file:

```txt
.firebase/hosting.ZGlzdA.cache
```

If it appears modified after build/deploy:

```bash
git restore .firebase/hosting.ZGlzdA.cache
```

Avoid:

```bash
git add .
```

Prefer:

```bash
git add src/App.jsx
```

or specific files only.

---

# Current Recommended Mode

Use the app in real life before building more.

Track:

```txt
- bugs
- confusing UX
- missing features
- things that feel like chores
- places where the app helps
- places where manual handling is fine
```

Do not over-automate too early.

---

# Backlog

## 1. Auth Cleanup

Branch:

```txt
auth-cleanup-remove-debug
```

Goal:

* remove or hide temporary auth debug UI
* keep useful login error messages
* keep working PWA behavior

Priority:

Medium, after testing PWA login again.

---

## 2. Inventory Grouped Sorting Polish

Branch:

```txt
inventory-group-sort-empty-last
```

Goal:

When grouping by:

```txt
Category
Label
Basisvare
```

sort in-stock items first and empty/out-of-stock items last.

Currently this behavior exists mainly for Group: None.

Priority:

Low/Medium.

Safe polish.

---

## 3. Weekly Missing Overview

Branch:

```txt
weekly-missing-overview
```

Goal:

Show one collected “Missing this week” list.

Could be:

```txt
Missing this week:
- Avocado
- Rømme
- Passata
```

or grouped by day/recipe.

Priority:

Low for now because Add Missing Items already exists.

Reconsider after real use.

---

## 4. Global Search

Branch:

```txt
global-search
```

Goal:

Search across:

* inventory item names
* recipe names

MVP:

* one search input
* grouped results
* click result to open inventory/recipe context

Priority:

Maybe useful, but should wait until real usage proves need.

Potential complexity:

* recipe ingredient search
* labels/categories
* fuzzy matching
* mobile UX
* result navigation

---

## 5. Freestyle Cooking Mode

Future idea.

Goal:

Support meals like:

```txt
Noodles teriyaki + whatever vegetables we have
Wok
Use what we have
```

Preferred model:

* one-time extras during cooking
* does not modify original recipe
* selected extras can optionally be consumed on Done Cooking

Do NOT implement as “edit recipe while cooking”.

Current MVP workaround:

* use base recipe
* manually remove freestyle-used items from stock

Priority:

Future only.

---

## 6. Weekly Plan Generator

Future idea.

Goal:

Generate a weekly menu based on:

* existing stock
* ingredient reuse
* recipe variety
* low waste

Priority:

Future.

---

## 7. Recipe Suggestions

Future idea.

Goal:

Suggest recipes based on what is in stock.

Initial version should probably use local saved recipes before external APIs.

Priority:

Future.

---

## 8. Leftovers

Future idea.

Goal:

Support leftover meals without duplicating recipes.

Possible model:

```js
{
  type: "leftover",
  sourceRecipeId,
  sourceDay
}
```

Priority:

Future.

---

# Things To Avoid For Now

Avoid:

* precise gram/ml inventory accounting
* automatic unit conversion
* AI meal planning
* OCR receipts
* barcode scanning
* recipe API imports
* nutrition tracking
* Cloud Functions
* big rewrites
* large Codex patches

---

# Codex Usage Notes

Codex is still useful, but should be used narrowly.

Recommended workflow:

```txt
1. Define rule/design first
2. Create small slice
3. Only edit specific files
4. Run lint/build
5. Review diff
6. Commit
```

Avoid broad prompts like:

```txt
Make inventory better
Improve cooking logic
Refactor app
```

Better:

```txt
Only edit Inventory filter logic.
Add Freezer View.
Do not change stock math.
Run lint/build.
```

Current issue observed:

Codex patching against `App.jsx` may fail in Windows sandbox.

If this happens:

* stop Codex
* ask for manual edits by function name
* do not approve repeated outside-sandbox patch helper requests

---

# Development Philosophy

Priorities:

1. Correctness
2. Simplicity
3. Real use
4. UX polish

The app should support household life without becoming a chore.

Whenever a feature adds complexity, ask:

```txt
Does this remove work for the user, or create more work?
```


## Bug: Add Product broken

Observed after latest frozen/pantry/freezer changes.

Symptoms:
- Add Product button does not work, or product modal does not open/save.
- Needs investigation before more feature work.

Likely areas to check:
- `setModalOpen(true)`
- `ProductModal`
- `saveProduct`
- recent `depleteOnCook` / freezer changes
- browser console errors when clicking Add Product

Priority:
High.

Reason:
Blocks normal inventory usage.