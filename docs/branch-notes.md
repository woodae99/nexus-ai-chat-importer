# Branch Notes: filter_and_select

Status as of this pivot:

- Pre‑import selection modal is in place: loads conversations from ChatGPT/Claude exports, supports keyword filter, sorting (Updated/Created/Title), bulk selection, and imports only selected chats.
- Robust archive parsing: handles nested `conversations.json`, array/wrapped/JSONL structures, and single-object fallbacks.
- Status tags: rows can show new/imported/updated based on existing files in the vault; excluded items are de‑selected by default.
- Global Exclude: add selected UIDs to a global ignore set, clear the list, or manage existing excluded UIDs. Stored in `data/state.json` under `globalIgnores`.

Why we changed tack:

- The full “profile” concept (saved include/ignore sets, saved filters, apply/merge, folder mapping) needs a clearer user model and UX flows. Rather than continue to iterate in circles, we’re pausing profile work and shipping the simpler, broadly useful filter‑and‑select workflow with a single global exclude list.

What’s deferred (kept in prior work):

- Profile builder and actions (Save/Save As/Add to/Apply/Delete).
- Profile‑scoped include/ignore persistence across runs.
- Profile relocation and “move existing files” utilities.

What’s in this branch:

- Provider selection → Pre‑import selection modal.
- Global exclude actions integrated into the pre‑import modal.
- No profile UI or persistence (beyond the global exclude list).

Next steps (when we revisit profiles):

- A clear profile model (include‑only vs include+ignore semantics), global vs profile precedence rules, and UI for managing profile contents.
- A compact “Actions” control for Import/Save/Apply/Add/Delete with SuggestModal pickers.
- Status chips and filters (All/New/Updated/Imported/Ignored), date ranges, and optional profile folder mapping.

