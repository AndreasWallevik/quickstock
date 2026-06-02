# QuickStock Seed Data

Contains:
- `stockItems.seed.json`
- `recipes.seed.json`
- `seedQuickstock.js`

Recommended project placement:

```txt
data/
  stockItems.seed.json
  recipes.seed.json

scripts/
  seedQuickstock.js
```

Run:

```bash
node scripts/seedQuickstock.js YOUR_HOUSEHOLD_ID
```

The script:
- imports stock items first
- imports recipes after
- links recipe ingredients to stock items with `stockItemId`
- uses `setDoc(..., { merge: true })`
- does not delete existing data
