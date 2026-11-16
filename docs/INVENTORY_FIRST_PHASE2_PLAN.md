# Inventory-first phase 2: analysis and implementation plan

Status: approved and implemented on `feature/inventory-first`. A temporary Hosting preview was deployed; the live channel, Firestore data, and rules were not deployed or migrated. See [implementation notes](INVENTORY_FIRST_PHASE2_IMPLEMENTATION.md).

## Product direction

Freezer, fridge, and low-effort voice updates become the primary experience. Expiration and waste prevention follow; meal planning, shopping, and recipes remain available but receive no new work in this phase. Keep quantity as a count of items, packages, or portions. Weight is optional metadata, not a second quantity system.

## Current implementation

| Area | Current behavior | Consequence for phase 2 |
| --- | --- | --- |
| Stack | React 19, Vite 7, Tailwind, Firebase Auth and Firestore; no server or AI service. | Reuse the client and household Firestore subscriptions; no new dependency is needed. |
| Household stock | `households/{householdId}/stockItems/{stockItemId}` contains product details and `items[]` stock units. `quantity` is also stored on the product. | Keep this collection and product IDs so recipes, shopping links, and household data continue to work. Treat `items[]` as the inventory source of truth and recalculate the summary quantity on writes. |
| Freezer | `FreezerHome.jsx` reads household freezer documents and groups frozen units by freezer/compartment. `freezerStore.js` provides manual add, use, and move operations. | Reuse its compact cards, filters, location chooser, and transaction patterns. Keep freezer documents and compartment IDs. |
| Fridge | The `More → Inventory → Fridge View` UI is in the approximately 4,200-line `App.jsx`. `FridgeProductCard` has quick add/use, opened/full/expired states, and expiring badges. It filters products with `!product.freezer`; there is no fridge location on a unit. | Preserve expiry and state behavior, but move the fridge screen into a focused component and use the same stock subscription and shared controls as freezer. The current filter also includes pantry/other nonfrozen products. |
| Voice/text | Browser `SpeechRecognition` uses `nb-NO`; `VoiceInventoryDialog` reviews a bounded, rule-based Norwegian interpretation. `inventoryChanges.js` validates and applies a batch in one Firestore transaction. | Reuse transcription, review, validation, and transactional save. Generalize source/destination location and parsing; do not create a second fridge voice stack or add an AI service. |
| Dates | Existing fridge `genUnit()` creates `expiresAt` from `shelfLifeDays` (default 7). Freezer additions use optional `frozenAt` and do not infer an expiry. | Preserve existing dates and alerts. New voice entries must leave unknown expiry blank; whether to keep estimated dates for manual quick add needs a product decision. |
| Permissions | Firestore rules gate `stockItems` and `freezers` by household membership and role, without field-level schema validation. | Existing paths and access can remain. Validate optional fields in application code and review any rule changes against legacy writers before deployment. |

The current test suite covers freezer grouping, quantity changes, parser ambiguity, and browser transcription handoff. It has no fridge UI, expiry, weight, or cross-location transfer tests. Baseline on this branch: lint, 18 tests, and production build pass.

## Differences to retain

- Freezer: named freezers and ordered compartments, optional freezing date, no inferred expiry.
- Fridge: known expiry dates, expiring/expired signals, opened packages, leftovers, and prepared meals. A fridge can initially be one logical location; no new fridge hierarchy is required for this phase.
- Both: search, quick add/use, quantity, optional weight, selected-location context, and the same voice/text review and cancellation behavior.

## Proposed architecture and data model

1. Add a small shared inventory model and operation layer, extracted from `freezerModel.js`, `freezerStore.js`, and `inventoryChanges.js`. Keep thin freezer-specific adapters for compartments and frozen dates. Move only the fridge-specific code needed out of `App.jsx`; avoid a broad rewrite.
2. Keep `stockItems` and `items[]`. Add optional `weightGrams` to a stock unit or batch record, with a positive finite value when known. Existing records without it mean **unknown**, not zero. An `items[]` record can already carry `amount`; one record may represent a batch with `amount > 1` and a **total** weight, while individually weighed packages remain separate records. The reviewed proposal must explicitly distinguish `total` from `per-unit` weight. For “2 × 150 g each,” save two 150 g units and display 300 g total. For “2 packages, 600 g total,” retain a two-package batch with 600 g total rather than assuming each weighs 300 g.
3. Add an explicit per-unit storage kind (`fridge`, `freezer`, or `other/unassigned`) for new writes. Keep `freezerId` and `compartmentId` for frozen units. During reads, use explicit unit location first and legacy product `freezer` only as a fallback. Do not remove the product flag or rewrite existing documents automatically. Update all readers before permitting mixed-location products, because the current fridge and freezer screens use the product flag differently.
4. Keep product identity separate from location. A move should update the same stock unit in the same stock document, preserving ID, opened state, weight, dates, and other metadata unless the user explicitly changes a field. A whole-unit move is straightforward. A partial move/use of a batch with only total weight cannot safely assign weight to the pieces: require review and either user-supplied remaining weights or an explicit choice to mark the resulting weights unknown. Never copy a batch's full weight onto both pieces.
5. Give the shared interpreter a storage context (`selected fridge` or selected freezer/compartment). Extend its structured proposal with optional `weightGrams`, `weightScope`, expiry, and source/target location. Parse `g`, `gram`, `kg`, `kilo`, Norwegian decimal commas, `halvannen`, `et halvt`, `hver`, and `til sammen`. Parse weight separately from the food name and item count. Unknown or conflicting values remain unresolved in the review; no database writes occur before confirmation.
6. Let the shared review dialog render only relevant controls: fridge expiry/leftover details or freezer compartment/frozen date. Keep typed input, transcript correction, multiple rows, duplicate matching, cancel, and one confirmation. Use existing product `labels` for a simple Leftover/Prepared filter initially; avoid a new taxonomy unless needed.

## Implementation sequence and verification gates

1. **Model/weight:** Add optional unit/batch weight and shared read helpers without changing existing behavior. Test missing weight, two unequal weights, total versus per-unit, and old documents. Run lint, tests, build.
2. **Voice interpretation:** Parse the requested Norwegian weight examples and storage phrases into reviewed operations. Validate numeric range, decimal notation, scope, and unknown values. Test ambiguous text, multiple items, and incorrect transcripts. Run lint, tests, build.
3. **Fridge screen:** Extract the current fridge view from `App.jsx`; reuse compact inventory cards and shared add/use controls while retaining expiry, opened state, leftovers, search, and filtering. Add manual weight/expiry edits and test the fast paths. Run lint, tests, build.
4. **Voice in fridge:** Open the existing dialog with fridge context. Add batch registration, used/discarded/opened phrases, and editable review. Test cancellation and confirmation with a fridge location. Run lint, tests, build.
5. **Cross-location moves:** Update all stock readers/writers for per-unit storage, then enable fridge↔freezer transfers in one transaction. Preserve whole-unit metadata and make partial-weight ambiguity explicit. Test mixed-location products, duplicate prevention, deleted destinations, concurrent changes, and freezer regression. Run lint, tests, build.
6. **Documentation and release review:** Update README, voice examples, and feature priorities. Verify household roles and legacy records in a Firebase emulator or isolated test project; exercise mobile/iPhone flows. Publish to a preview channel for acceptance. Production deployment requires separate explicit approval.

## Risks and migration considerations

- **Product-level `freezer` is insufficient for transfers.** Existing cards, filters, recipe/shopping actions, and voice matching must use a shared per-unit location adapter before mixed-location writes are enabled. Legacy unassigned frozen units remain visible.
- **Legacy nonfrozen stock may be pantry, not fridge.** No bulk conversion or destructive migration. Keep it accessible and provide a way to assign a location when the user chooses.
- **Expiry defaults can mislead.** Existing generated `expiresAt` values should remain; new unknown dates must not be invented. Show known versus estimated expiry clearly if estimates remain supported.
- **Mixed weights and partial actions require care.** A known total is not a known per-unit weight. A partial use/transfer can make remaining weight unknown. Review must say so before saving.
- **Firestore arrays and transactions have practical limits.** Existing stock units live inside product documents; batch updates rewrite those arrays and concurrent edits can conflict. Keep operation batches bounded, use transactions, and watch document growth rather than adding a new collection now.
- **Rules currently check roles, not shapes.** Any tighter field rules must allow older clients/records during rollout. No automatic data rewrite or security-rule deployment is part of this plan.

## Product decisions before implementation

1. **Legacy nonfrozen items:** Should the new fridge view initially show all legacy `freezer: false` stock as it does today, or show items without an explicit location in an “Unassigned/other” section? Recommendation: keep them visible, clearly marked as location not yet set, and let users assign them gradually.
2. **Fridge layout:** Is one household fridge sufficient for this phase? Recommendation: one logical fridge, with no compartments until there is a real need.
3. **Expiry estimates:** Should manual quick-add continue to derive expiry from `shelfLifeDays`, clearly labeled estimated, while voice leaves unknown dates blank? Recommendation: preserve existing estimates but distinguish them from explicit dates.
4. **Batch total after a partial use/move:** When a two-package batch has only a total weight, should the UI ask for the remaining weight or allow “unknown”? Recommendation: allow unknown after an explicit review warning; never divide total weight automatically.
5. **Leftovers/prepared meals:** Are product labels and an optional expiry sufficient, or is a separate meal record needed? Recommendation: start with labels and ordinary stock units.

Approval of this plan authorizes implementation on the feature branch only. It does not authorize a production deployment or branch merge.
