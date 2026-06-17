# QuickStock Project Status (June 2026)

## Current Branch

Current working branch:

pwa-app-install

---

## Project Vision

QuickStock has evolved from a simple inventory tracker into a household meal-planning assistant.

Primary value proposition:

* Plan meals for the week
* See what is missing
* Generate shopping lists automatically
* Reduce food-related decisions
* Keep household planning simple

Important design principle:

> The app should reduce decisions, not create chores.

---

## Core Features Implemented

### Households

* Multiple households supported
* Household switching works
* Household invites implemented
* Management view added
* Household rename/manage functionality added

### Inventory

* Fridge View is default inventory view
* Multi-View available
* Add Product
* Clear Inventory
* Add Starter Pantry Items
* Stock item quantities
* Expiry tracking exists but is currently de-prioritized

### Shopping List

* Shopping list functionality working
* Bought items can be added to stock
* Manual stock → shopping workflow exists
* "Clear Shopping List" added

### Recipes

* Recipe library
* Recipe editor
* Recipe ingredients linked to stock items
* Demo recipe import
* Clear All Recipes button

### Weekly Menu

* Weekly planning implemented
* Recipes assigned to weekdays
* Start Cooking
* Done Cooking
* Undo Cooking
* Today's meal shown in Menu stat card
* Menu stat card opens Weekly Menu
* Menu stat card opens today's recipe modal

---

## PWA Status

### Completed

* manifest.webmanifest
* service worker
* installable on iOS
* installable on Android
* home screen icons
* splash screen metadata
* standalone mode

### Firebase Auth Fix

Issue:

Installed iOS PWA returned to login screen.

Root cause:

Google Cloud OAuth client missing:

https://quickstock-b04b2.web.app/__/auth/handler

Added:

https://quickstock-b04b2.firebaseapp.com/__/auth/handler
https://quickstock-b04b2.web.app/__/auth/handler

Result:

* Browser login works
* Safari login works
* Installed iOS PWA login works

Important:

Temporary auth diagnostics should be removed if still present.

Remove:

* window.__quickStockAuthDebug
* sessionStorage auth debug data
* temporary auth logging
* temporary auth diagnostic wrappers

Keep:

* working PWA auth behavior

---

## Seed Data

Current sources:

data/stockItems.seed.json

data/recipes.seed.json

Goal:

Single source of truth.

Current direction:

* Starter pantry import uses stockItems.seed.json
* Demo recipes import uses recipes.seed.json
* Browser should not execute seedQuickstock.js
* seedQuickstock.js remains a developer/admin tool

---

## Known Problems

### Highest Priority

Shopping List → Stock synchronization.

Current symptoms:

* Add Missing Ingredients logic recently refactored.
* Idempotency logic added.
* Shopping item identity still inconsistent.
* Some generated shopping items become disconnected from stock items.
* Previously observed:

  * 500 ml milk became 500 stock units.
  * Generated items sometimes created new stock items instead of linking.

Current status:

Needs manual inspection before more major Codex changes.

Focus chain:

Weekly Menu
→ Add Missing
→ Shopping List
→ Bought
→ Stock Item

The identity of an ingredient must survive that entire flow.

---

## Recently Completed Slice

### Shopping List Idempotency

Intent:

* Clicking Add Missing multiple times should not create duplicates.

Current implementation:

Generated shopping items now contain:

* sourceType
* weekId
* dayKey
* recipeId
* ingredientStockItemId
* stockItemId

However:

Needs validation.

Regression observed:

Add Missing may currently add nothing.

Must verify before further development.

---

## Next Planned Slice

### Recipe Readiness

Goal:

Show whether each planned meal can actually be cooked.

Per weekday:

* Ready
* Missing X items
* Needs review

Example:

Monday
🟢 Ready

Tuesday
🟡 Missing 2 items

Wednesday
🟢 Ready

Thursday
🔴 Missing 5 items

---

## Weekly Progress

Goal:

Gamify planning.

Examples:

4 / 5 meals ready

80% ready

Visual progress bar.

Only count planned meals.

This is currently considered the next major UX improvement.

---

## Future Features

### Recipe Suggestions (High Priority)

Generate recipe suggestions based on stock.

Version 1:

Simple scoring.

Example:

* Lasagna (8/10 ingredients available)
* Taco (10/10 ingredients available)
* Pasta (6/10 ingredients available)

No AI required.

---

### Weekly Plan Generator

Generate next week's menu automatically.

Optimize for:

* existing stock
* ingredient reuse
* recipe variety

---

### Leftovers

Current idea:

After meal completion:

Leftovers = true/false

Example:

Monday:
Taco

Tuesday:
Taco leftovers

Possible future behavior:

Prompt:

"You marked leftovers. Push remaining meals forward one day?"

Important:

Do NOT create temporary recipes.

Preferred model:

Weekly menu entry references:

* sourceRecipeId
* sourceDay

Example:

Tuesday:
type = leftover
sourceRecipeId = taco
sourceDay = monday

No recipe duplication.

---

## Development Philosophy

Priorities:

1. Correctness
2. Simplicity
3. UX polish

Avoid:

* over-automation
* invisible logic
* excessive inventory micromanagement

Whenever a feature adds maintenance work for the user, reconsider the design.

QuickStock should feel like a helpful household assistant, not an ERP system.
