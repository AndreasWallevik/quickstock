# Inventory-first phase 2 implementation

Implemented on `feature/inventory-first` after approval of the [phase 2 plan](INVENTORY_FIRST_PHASE2_PLAN.md). The temporary [Firebase Hosting preview](https://quickstock-b04b2--inventory-first-0f6arz9g.web.app) expires on 23 November 2026 at 14:39 Oslo time. The live Hosting channel was not changed, and no branch merge was made.

## User experience

- Freezer remains the default screen. Fridge is a primary tab with search, expiring, opened, and leftovers filters. Both screens have manual Add, quick Use, and a prominent Speak inventory action. The fridge screen also offers Open, Discard, per-unit details, and Move to freezer.
- Manual additions can include a count, unit type, optional grams or kilograms, opened state, and a known expiry or freezing date. A fridge item with an existing shelf-life setting can opt into an **estimated** expiry. Voice additions never infer a date.
- Voice and typed text share the same Norwegian parser and reviewed operation form. Supported commands include add, use, use up, open, discard, move, set remaining count, and set remaining weight. A transcript may contain multiple additions. Ambiguous quantities, names, destinations, and batch weight scopes block confirmation until corrected.
- Whole-unit transfers preserve the same stock item and unit IDs, weight, opened state, and dates. Partial changes to a batch with a known total weight require explicit acceptance that the resulting weight is unknown.

## Data and compatibility

The existing `households/{householdId}/stockItems` collection and `items[]` array remain authoritative. There is no new collection, server, dependency, or Firestore rule. New units carry `storageKind: "fridge" | "freezer"`. Frozen units also retain `freezerId` and `compartmentId`. Optional `weightGrams` is an integer on each unit or batch record. `amount` is the count represented by that record; an absent value means one. For `2 x 150 g each`, two units are stored. For `2 packages, 600 g total`, one batch with `amount: 2` and `weightGrams: 600` is stored. Missing weight means unknown, never zero.

Explicit fridge dates use `expiresAt` and `expiryEstimated: false`. Opted-in shelf-life estimates use `expiryEstimated: true`. Legacy dates without this flag are displayed as estimated, since the older fridge add path calculated them from `shelfLifeDays`. `frozenAt` stays an optional `YYYY-MM-DD` date. No expiry is inferred from a freezing date.

Existing stock is read without a bulk migration. Legacy frozen units derive their location from the product flag and stay in the Unassigned freezer group until moved. Legacy nonfrozen units appear in Fridge with a "location not set" marker and can be assigned to Fridge in one tap. A transaction materializes per-unit locations only when that stock item is edited. Existing product IDs, recipe references, shopping links, and historical empty units remain intact.

The old Inventory view remains under More. For products with explicit unit locations it presents a safe summary and links to the new screens, preventing the old product-level freezer toggle or add controls from overwriting mixed-location stock. Untouched legacy products keep their existing controls.

Shopping restocks of a location-aware product add units with location unset until a user assigns them. Recipe consumption preserves per-unit storage metadata and skips a partial change to a weighed batch, reporting that it needs a manual update rather than leaving a misleading weight.

## Validation and release notes

Interpretation, validation, and Firestore mutation remain separate. Reviewed changes are bounded to 20 per transaction. Transactions re-read affected stock and freezer documents, check that destination compartments still exist, recalculate summary quantity, and commit the batch atomically. The Firestore rules still use the existing household role checks on the same paths.

`npm run lint`, `npm run test` (34 tests), and `npm run build` pass locally. The preview uses the same Firebase project and Firestore database as the live app, so inventory edits there affect real household data; use a test household for acceptance. Before production release, test the preview with household owner/member roles, legacy stock, multiple freezers, and actual iPhone Norwegian dictation. Browser recognition availability and Norwegian accuracy depend on the device. Raw audio and transcripts are not stored by the app, but the browser may send audio to its recognition provider; see [voice workflow](VOICE_WORKFLOW.md). The app has no transcription or AI usage bill.

Known limits: a batch with total weight cannot be divided into known per-unit weights without new information; a reviewed partial change marks its resulting weight unknown. Fridge has one logical location in this phase. The existing stock document array may need a later storage redesign if households accumulate very large unit histories. No automatic data rewrite or production deployment has been performed.
