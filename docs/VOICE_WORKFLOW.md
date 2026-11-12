# Voice inventory workflow

Implemented as a first vertical slice on 12 November 2026. The app does not send audio or text to an app-owned AI service, and it does not save raw audio or transcripts to Firestore.

## Chosen approach

1. **Transcription:** `src/freezer/browserTranscription.js` uses browser `SpeechRecognition` (including the prefixed variant) with `lang = "nb-NO"`. The Freezer screen starts recognition on the microphone tap. If the API is missing or recognition fails, the same dialog accepts typed text.
2. **Interpretation:** `src/freezer/inventoryInterpretation.js` parses a bounded set of Norwegian inventory phrases into proposed `add`, `remove`, `move`, and `set_quantity` operations. It recognizes multiple comma/“og” items, Norwegian numbers up to ten, numeric quantities, halves, opened packages, and a few explicit food aliases. It does not call an AI model or perform writes.
3. **Review and correction:** `VoiceInventoryDialog.jsx` shows the transcript, source compartment, each proposed action, item, quantity, unit type, opened state, and destination. Users can correct transcript text and reinterpret it, edit individual rows, select an existing item, discard a row, add a correction row, retry recording, or cancel. Any missing quantity, item match, or move destination blocks confirmation.
4. **Validation and persistence:** `prepareInventoryOperations` and `validateInventoryOperation` check the structured proposal. Only after the user confirms does `src/freezer/inventoryChanges.js` run a Firestore transaction. It reads the affected freezer and stock documents, checks that locations still exist, then writes all changes together. A failed transaction saves none of the proposed batch.

The reviewed operation shape is:

```js
{
  kind: "add" | "remove" | "move" | "set_quantity",
  name: string,                  // required, max 120 characters
  quantity: number,              // 0 only for set_quantity, max 99, up to 2 decimals
  stockItemId: string,           // required for changes to existing stock
  sourceLocationKey: string,     // selected freezer/compartment
  targetLocationKey: string,     // required for move
  unitLabel: "item" | "package",
  opened: boolean,               // applies to add
  sourcePhrase: string,          // review display only; not persisted
  issues: string[]               // must be empty before confirm
}
```

`items[].amount` stores fractional portions; an absent `amount` means one whole item, preserving older records. Opened packages use the existing `opened` state. Removal marks a fully consumed unit `empty`; partial removal reduces its amount and marks it opened. Setting remaining quantity to zero empties units rather than deleting the stock item, preserving recipe links. Repeated additions of the same parsed item are merged, and a unique existing stock product is reused. Ambiguous existing matches require an explicit user choice. Concurrent edits can cause the transaction to reject and ask for another review.

## What the first slice understands

| Utterance | Proposed result |
| --- | --- |
| `Øverste skuff: to pakker bacon, en åpnet pakke tacolefser, en laksefilet og en halv baguette` | Four additions in the selected compartment: 2 Bacon packages, 1 opened Tortillas package, 1 Salmon fillet, 0.5 Baguette. |
| `Legg til to pakker bacon` | Add 2 packages. |
| `Vi brukte laksen` | Propose remove Salmon, but require a quantity before confirmation. |
| `Flytt kyllingen til kjellerfryseren` | Propose move Chicken; require a quantity. A freezer with one compartment can resolve the destination; otherwise choose a compartment. |
| `Det er bare én pakke igjen` | Propose setting remaining quantity to 1; require the user to choose which item. |

The parser is intentionally conservative. It does not infer an amount from a definite noun, select one of several matching products, or assume a destination compartment when a freezer has several. Unrecognized language yields a blocked correction row. The selected compartment is authoritative; a spoken compartment prefix is shown for review and does not silently override it. This first slice does not handle arbitrary Norwegian phrasing, all number words, dates, or multi-command stories in one recording. Those can be added based on real transcripts and tests.

## Browser-native versus server-side transcription

| Consideration | Browser-native Web Speech API (chosen) | Server-side speech-to-text (future option) |
| --- | --- | --- |
| Norwegian | Sets `nb-NO`, but actual recognition quality and availability depend on the browser and its engine; must be tested on household devices. | A provider can document Norwegian model support; for example, Google Cloud Speech-to-Text V2 lists Norwegian Bokmål `no-NO`. |
| Compatibility | `SpeechRecognition` has [limited browser availability](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/lang); feature detection and typed fallback are required. | Can work across browsers with microphone recording/upload, but needs a server or function, upload handling, and authentication. |
| Privacy | The app keeps no audio or transcript, but browser recognition [may send audio to a browser-vendor service](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API/Using_the_Web_Speech_API). The app cannot promise on-device processing. | Audio would be sent to the selected provider through an app-controlled endpoint; retention, region, and consent would need review. API keys must stay server-side. |
| Reliability | Good for short dictation where supported; can fail offline or on unsupported devices. Users can edit text and every proposed change. | More control over model choice and language support, but network failures and transcription mistakes still require review. |
| Cost | No app-owned transcription bill or new dependency. Browser-vendor processing is outside the app's billing. | Usage-based charges plus infrastructure. As an example, [Google Cloud's published Speech-to-Text V2 standard rate](https://cloud.google.com/speech-to-text/pricing) starts at USD 0.016 per minute; rates can change. A language model for broader interpretation would add separate cost. |

Google's [supported-language list](https://docs.cloud.google.com/speech-to-text/docs/speech-to-text-supported-languages) supports the server-side comparison. Browser on-device recognition exists in newer implementations, but [language-pack availability must be checked per language/device](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API/Using_the_Web_Speech_API); this app does not request it or assume Norwegian on-device support.

## Operational limits and next checks

- Firestore rules for the `freezers` collection must be deployed with the app. No cloud deployment is performed by this implementation.
- Test actual Norwegian dictation quality on the household's iPhone/iPad and Android browsers. Browser support cannot be proven by unit tests or a Vite build.
- Legacy inventory screens and recipes still treat stock largely as countable units. `items[].amount` enables fractional freezer quantities; recipe consumption and older card actions should be reviewed if fractional items become common.
- No external AI service is connected. If open-ended language interpretation is added later, send only transcription text to an authenticated backend, require a structured response matching the operation schema, validate it again locally, and keep the same user confirmation and Firestore transaction boundary.
