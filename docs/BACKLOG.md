## Product Model Limitation: Mixed fridge/freezer stock

Current issue:

Frozen/freezer state currently exists at stock item level.

Example current model:

```js
stockItem = {
  name: "Kjøttdeig",
  freezer: true,
  items: [...]
}

This works when all units of a product are in the same place.

But real household stock can be mixed:

Kjøttdeig
- 1 pack in fridge
- 1 pack in freezer

Current MVP workaround:

Create separate stock items:

Kjøttdeig
Kjøttdeig (frys)

This is acceptable for MVP, but not ideal.

Potential problems:

Recipe may be linked to only one of the two stock items.
Recipe readiness may say missing even if the item exists in freezer.
Freezer view is useful, but the model is not fully accurate for mixed storage.
Duplicate product names may create friction over time.

Future model:

Move freezer/location from stock item level to unit level.

Example future model:

stockItem = {
  name: "Kjøttdeig",
  emoji: "🥩",
  packSize: 1,
  items: [
    {
      id: "1",
      state: "full",
      location: "fridge",
      expiresAt: ...
    },
    {
      id: "2",
      state: "full",
      location: "freezer",
      frozenAt: ...
    }
  ]
}

Future behavior:

One stock item can contain both fridge and freezer units.
Card can show 1 fridge · 1 freezer.
Freezer view shows products with at least one freezer unit.
Fridge view shows products with at least one fridge unit.
Done Cooking consumes from available units based on sensible priority.
Add Missing/readiness can consider all available units, including freezer.

Do not implement this now.

Priority:
Medium/Future.

Reason:
This is a real domain-model issue, but solving it properly requires changes across inventory cards, freezer filtering, readiness, Add Missing, Done Cooking, and UI for individual units.

Current recommendation:
Use the MVP workaround for a few weeks and observe whether this becomes a real pain point.