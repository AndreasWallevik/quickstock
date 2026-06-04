# QuickStock

QuickStock is a shared household inventory and meal planning app focused on:
- kitchen-friendly UX
- shared shopping lists
- inventory tracking
- weekly dinner planning
- automatic shopping generation

## Stack

- React
- Vite
- TailwindCSS
- Firebase
- Firestore
- Firebase Auth

---

## Features

- Shared household inventory
- Emoji-based stock tracking
- Shopping lists
- Expiration tracking
- Recipe management
- Weekly dinner planner
- Auto-generated shopping suggestions

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
