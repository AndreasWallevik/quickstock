# QuickStock – Product Specification v2

## Vision

QuickStock is a shared household inventory and meal planning app optimized for:
- iPad kitchen usage
- fast touch interaction
- shared shopping workflows
- reducing mental load around groceries and dinner planning

Core concept:
Track stock → plan dinners → auto-generate shopping needs.

---

# Tech Stack

## Frontend
- React
- Vite
- TailwindCSS

## Backend
- Firebase Hosting
- Firestore
- Firebase Auth (Google Sign-In)

## App Type
PWA (Progressive Web App)

Supports:
- iPhone
- iPad
- Android
- Desktop

Installable via:
"Add to Home Screen"

---

# Existing Core Concepts

Already implemented or prototyped:
- Product cards
- Emoji-based inventory
- Stock states:
  - full
  - opened
  - expired
  - empty
- Shelf life
- Frozen items
- Shopping list
- Auto-add when empty
- Pack size logic
- Expiration tracking
- Soon-to-expire notifications

---

# Multi Household Architecture

IMPORTANT:
All data belongs to a household.

NOT directly to users.

This allows:
- couples
- families
- roommates
- maid/helper accounts

---

# Authentication

## Sign In
- Google Sign-In only initially

---

# Household Flow

## First Launch

If user has no household:
- Create household
- Join household

---

# Household Roles

## admin
Can:
- manage members
- manage recipes
- manage stock
- manage settings

## member
Can:
- manage stock
- use meal planner
- use shopping list

## shopping-only
Can:
- view shopping list
- check items
- add shopping items

Cannot:
- modify inventory
- modify recipes

---

# Household Invites

Initial implementation:
- invite code

Example:
HOUSE-7KQ2P

Flow:
- user signs in
- enters invite code
- joins household

---

# Core Systems

The app consists of separate but connected systems.

---

# 1. Inventory System

Tracks:
- stock
- expiration
- opened/full state
- frozen state

## Product Structure

```js
stockItem = {
  id,
  name,
  emoji,
  unit,
  packSize,
  shelfLifeDays,
  freezer,
  autoAddWhenEmpty
}
```

---

# 2. Shopping List System

Supports:
- manual items
- auto-generated items
- check/uncheck
- multi-user collaboration

---

# 3. Recipe Management System

IMPORTANT:
Recipe management is separate from weekly planning.

Recipes are reusable objects.

---

# Recipe Goals

Recipes should support:
- dinner planning
- ingredient calculations
- cooking mode
- shopping generation

NOT full food-blog complexity.

---

# Recipe Structure

```js
recipe = {
  id,
  name,
  emoji,
  servings,
  ingredients: [],
  steps: []
}
```

---

# Ingredient Structure

IMPORTANT:
Recipe ingredients should preferably reference real stock items.

Main approach:

```js
ingredient = {
  stockItemId,
  nameSnapshot,
  quantity,
  unit
}
```

Example:

```js
{
  stockItemId: "abc123",
  nameSnapshot: "Kjøttdeig",
  quantity: 400,
  unit: "g"
}
```

---

# Why Use stockItemId

Benefits:
- reliable stock calculations
- avoids fuzzy matching
- prevents duplicates
- cleaner shopping generation

---

# Fallback / Unlinked Ingredients

Recipe ingredients MAY temporarily exist without stockItemId.

This allows:
- quick recipe creation
- importing/pasting ingredients
- incomplete recipes

Unlinked ingredients:
- can still appear on shopping list
- but inventory calculations may not work fully

---

# Recipe Creation UX

Recipe creation must be FAST.

Avoid:
- huge forms
- tedious ingredient setup

---

# Preferred Recipe Creation Flow

## Quick Ingredient Paste

User can paste:

```txt
400 g kjøttdeig
1 pk tortilla
1 glass salsa
```

App attempts:
- quantity parsing
- unit parsing
- stock item matching

---

# Ingredient Matching Flow

For each ingredient:

1. Try matching existing stock item
2. If no match:
   - show "Create item"
   - or leave unlinked

---

# IMPORTANT UX FEATURE

Recipe creation view should support:

## "Create Item"

directly inside ingredient editor.

This avoids:
- leaving recipe flow
- annoying setup loops

---

# Weekly Dinner Planner

Separate system from recipes.

Uses:
- reusable recipes

---

# Weekly Planner Structure

```js
weeklyPlan = {
  monday: recipeId,
  tuesday: recipeId,
  ...
}
```

---

# Weekly Planner Goals

Selecting recipes should:
- calculate missing ingredients
- compare against inventory
- auto-generate shopping items

---

# Shopping Calculation Logic

Core formula:

```txt
required ingredients
-
current inventory
=
missing items
```

---

# Example

## Planned Recipes

Tacos:
- 400g minced meat
- 1 tortilla pack

Pasta:
- 500g pasta
- 1 tomato sauce

---

## Current Inventory

```txt
200g minced meat
500g pasta
```

---

## Generated Shopping

```txt
200g minced meat
1 tortilla pack
1 tomato sauce
```

---

# Unit Handling

IMPORTANT:
Do NOT over-engineer units initially.

MVP support:
- pcs
- g
- kg
- ml
- l
- pack

Only calculate automatically when units match.

Otherwise:
- mark as "needs review"

---

# Cooking Mode

Suggested feature from household feedback.

Recipes should support:
- step-by-step cooking mode

---

# Recipe Steps Structure

```js
steps: [
  "Cut onion",
  "Cook meat",
  "Add salsa"
]
```

---

# Cooking Mode UX

Kitchen/iPad optimized.

Features:
- large readable text
- one step at a time
- next/previous buttons

Future ideas:
- timers
- voice navigation
- hands-free mode

---

# Firestore Structure

## households

```js
households/{householdId}
```

---

## members

```js
households/{householdId}/members/{userId}
```

---

## stockItems

```js
households/{householdId}/stockItems/{itemId}
```

---

## shoppingList

```js
households/{householdId}/shoppingList/{itemId}
```

---

## recipes

```js
households/{householdId}/recipes/{recipeId}
```

---

## weeklyPlans

```js
households/{householdId}/weeklyPlans/{weekId}
```

---

# Security Rules

Firestore rules MUST ensure:
- user belongs to household
- role permissions enforced

Users must NEVER access other households.

---

# PWA Requirements

App should support:
- install to home screen
- app icon
- splash screen
- offline cache basics

Use:
- vite-plugin-pwa

---

# Firebase Expectations

Free tier should be enough for MVP.

Expected usage:
- very low user count
- low Firestore load
- no image uploads initially

---

# IMPORTANT NON-MVP FEATURES

Avoid implementing initially:
- AI ingredient recognition
- OCR receipts
- barcode sync
- recipe APIs
- Cloud Functions
- nutrition tracking

---

# Future Features

Potential future additions:
- barcode scanning
- Open Food Facts integration
- expiration predictions
- recipe suggestions
- low stock warnings
- voice input
- analytics
- recurring purchases
- shopping mode sorting
- AI meal planning

---

# Suggested Development Order

## Phase 1
- Google auth
- household system
- inventory system
- shopping list

## Phase 2
- recipe management
- ingredient linking
- create item from recipe

## Phase 3
- weekly dinner planner
- automatic shopping generation

## Phase 4
- cooking mode
- recipe steps
- polish

## Phase 5
- barcode scanning
- external integrations
