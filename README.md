# QuickStock

QuickStock is a shared household inventory app focused on fast fridge and freezer updates. Recipes, shopping lists, and weekly planning remain available under **More**.

## Stack

- React
- Vite
- TailwindCSS
- Firebase
- Firestore
- Firebase Auth

---

## Features

- Fridge and freezer screens with search, filters, and quick add/use controls
- Multiple household freezers and ordered compartments
- Optional per-item or batch weight, fridge expiry, and freezer date
- Norwegian voice or typed updates with transcript and per-item review (where browser speech recognition is available)
- Fridge-to-freezer and freezer-to-fridge transfers that preserve item details
- One-tap plain-text inventory copying for Fridge, Freezer, or both, with optional native sharing
- Shared household inventory
- Emoji-based stock tracking
- Shopping lists
- Expiration tracking
- Recipe management
- Weekly dinner planner
- Auto-generated shopping suggestions

### Freezer data model

Freezers are stored at `households/{householdId}/freezers/{freezerId}`. Each freezer document has an ordered `compartments` array. Frozen stock still uses the existing `stockItems` collection; individual `items[]` units can now carry `freezerId`, `compartmentId`, and optional `frozenAt` (`YYYY-MM-DD`). Existing frozen units without these fields appear as **Unassigned freezer items** and can be moved from the freezer screen. New frozen units do not receive an inferred expiry date. A compartment or freezer must be emptied before it can be removed, so moving locations never deletes food.

The freezer screen remains the default; Fridge and Recipes are also primary views. Voice updates use browser speech recognition when available, with typed commands as a fallback. Each update requires confirmation. See [Voice workflow](docs/VOICE_WORKFLOW.md) for supported phrasing, privacy, and limitations, [inventory sharing](docs/INVENTORY_SHARING.md) for export behavior, and [phase 2 implementation notes](docs/INVENTORY_FIRST_PHASE2_IMPLEMENTATION.md) for storage and migration details.

---

## Development

Install dependencies:

```bash
npm install
```

Run locally:

```bash
npm run dev
```

Build production bundle:

```bash
npm run build
```

Run inventory model tests:

```bash
npm run test
```

### Starter pantry vs demo seed data

The in-app `Add default pantry items` action only adds a small starter set of stock items to the current household. It does not import recipes and does not call `scripts/seedQuickstock.js`.

`scripts/seedQuickstock.js` is a developer/demo import tool. It can import both stock items and recipes from `data/` when run manually from the command line.

---

## Documentation

See `/docs` for:
- architecture
- specifications
- roadmap
- feature planning

Main spec:

```txt
docs/QUICKSTOCK_SPEC_V2.md
```

---

## Deployment

Hosted with Firebase Hosting.

---

## Status

Early active development / prototype stage.
