# Enhanced Chat Importer — Development Specification

## 0) Executive summary

Add a pre-import “Chat Management” modal that:

* Loads a ChatGPT export (or other supported export format), lists all chats in a fast, sortable, filterable table.
* Lets users **select** or **ignore** chats via checkboxes (including “Select all in current view”).
* Remembers ignores and imports by **unique chat identifier** across runs.
* Supports **saved import profiles** (named selections + filter presets + target folder mapping), with per-profile ignore/include state.
* On subsequent imports, **diffs existing vault files** to decide “new vs update”, shows a progress bar, and can continue in the background.

All storage is **local**, deterministic, and reversible. No network calls.

---

## 1) Goals & non-goals

### 1.1 Goals

1. Provide a first-run (and on-demand) modal for **chat filtering, selection, and management** before import.
2. Implement **saved profiles** that bundle selection rules and folder targets (e.g., “Psychology”, “Quantum Mechanics”).
3. **Persist** ignore/import decisions by chat **UID** and remember them on subsequent runs.
4. On import, **walk the destination folder(s)** to determine **new vs update**, avoiding duplicates and unnecessary rewrites.
5. Offer **fast** sorting/filtering on large exports (10k+ chats), with virtualised UI.
6. Provide **safe, reversible** operations with clear progress UX and cancellation.

### 1.2 Non-goals

* Cloud sync or multi-user coordination (out of scope).
* Editing ChatGPT exports in place (we read; we don’t modify the source file).
* Full-text indexing of all chat content for global vault search (we index enough to filter quickly inside the modal).

---

## 2) Primary user stories

1. **First import**: “On installing the plugin and choosing an export file, I want a modal that shows all chats in a table. I can sort by Title/Created/Updated, filter by date or keyword, tick what to import, and tick what to ignore. The plugin remembers my choices next time.”
2. **Profiles for topics**: “I can save my current selection + filters as a profile (e.g., ‘Psychology’) and map it to a vault folder. Later, I can load that profile and the modal pre-marks the same chats as include/ignore and re-applies filters.”
3. **Subsequent import**: “When I import using a profile, the plugin scans the folder and marks chats as ‘new’ or ‘update’ based on content hash / last updated. I get a progress bar, and I can let it run while I keep working.”
4. **Reversibility**: “If I previously ignored a set (e.g., recipes), I can un-ignore them later and import them into a dedicated folder.”
5. **Bulk ops**: “I can ‘Select all in current view’ after filtering (e.g., keyword=‘recipe’), then ‘Ignore’. The ignore list updates and persists.”

---

## 3) UX & flows

### 3.1 Entry points

* **First run**: After selecting an export file (Settings → “Select export”), open **Chat Management Modal** automatically before any import.
* **Commands** (Command Palette):

  * “Open Chat Management”
  * “Import with Current Profile”
  * “Switch Import Profile”
  * “Rescan Destination Folders”
* **Ribbon icon** (optional) → opens modal.

### 3.2 Chat Management Modal (core)

* **Header**: Profile selector (dropdown), buttons: Save Profile, Save As…, Delete Profile, Reset View.
* **Filters**:

  * Date range (Created, Updated)
  * Keyword search (Title + lightweight content index)
  * Status chips (All / New / Updated / Imported / Ignored)
  * Model (optional), Source file (if multiple)
* **Table** (virtualised):

  * Columns: \[✓] (checkbox), Title, Created, Updated, Messages (#), Model, Status, Folder (resolved target), UID (hidden by default—toggleable)
  * Sorting: multi-column (shift-click)
  * Row context menu: Include, Ignore, Open Preview, Reveal in Source
* **Bulk actions**:

  * “Select all in current view”
  * “Include selected”
  * “Ignore selected”
  * “Clear selection”
* **Footer**:

  * Counts: Showing X of Y (Filtered), Included N, Ignored M, New K, Updates L
  * Buttons: “Import N Chats” (primary), “Close”
  * Progress bar appears in place during import; a status-bar item mirrors progress for background mode.

### 3.3 Settings (Plugin tab)

* Default export file path
* Default destination folder
* Filename template (e.g., `{{date}} — {{title}} [{{uid_short}}].md`)
* Front matter template (YAML, supports variables)
* Update policy: Overwrite | Merge (preserve manual edits) | Keep both (suffix)
* Background import: allow running heavy tasks in a Web Worker
* Safety: Confirm before overwriting; auto-backup updated files (toggle)
* Advanced: Index size limits, memory cap, virtualisation thresholds

---

## 4) Data & persistence

### 4.1 Entities

```ts
type ChatUID = string; // stable, from export. If absent, derive (see 4.2)

interface ChatSummary {
  uid: ChatUID;
  title: string;
  createdAt: number;  // epoch ms
  updatedAt: number;  // epoch ms
  model?: string;
  messageCount: number;
  // for filtering/search
  keywordsSample?: string;   // small sampled text for lightweight search index
  sourceRef: {
    exportPath: string;      // absolute path to export file
    offset?: number | string;// pointer for lazy load (implementation-specific)
  };
}

interface FileMaterialisedMeta {
  uid: ChatUID;
  contentHash: string;       // hash of canonicalised transcript
  updatedAt: number;         // as in export when last written
  filePath: string;          // vault-relative
  lastImportedAt: number;
  profileName?: string;      // provenance
}

type IncludeState = "include" | "ignore" | "unset";
```

### 4.2 UID strategy

* Prefer export’s official `id`/`conversation_id`.
* If missing, derive deterministic UID:

  * `uid = sha1(sourceRef.exportPath + createdAt + title + firstMessageHash)`
* Store UID in YAML front matter of the note: `chat_uid: <UID>`

### 4.3 Plugin storage (Obsidian `this.app.vault.adapter`)

* `data/state.json`

  ```json
  {
    "lastExportPath": "...",
    "profiles": ["Default","Psychology","Quantum Mechanics"],
    "activeProfile": "Default",
    "globalIgnores": { "uid1": true, "uid2": true }
  }
  ```
* `data/profiles/<name>.json`

  ```json
  {
    "name": "Psychology",
    "targetFolder": "Research/Psychology",
    "include": { "uidA": true, "uidB": true },
    "ignore": { "uidX": true },
    "filters": {
      "dateField": "updatedAt",
      "from": 1704067200000,
      "to": null,
      "keyword": "therapy OR coaching",
      "status": ["new","updated"]
    },
    "filenameTemplate": "{{date}} — {{title}} [{{uid_short}}].md",
    "frontMatterTemplate": "…"
  }
  ```
* `data/materialised/<uid>.json` (cache per imported chat)

  ```json
  {
    "uid":"…",
    "contentHash":"…",
    "updatedAt": 1712345678901,
    "filePath":"Research/Psychology/2025-08-31 — Title [abcd123].md",
    "lastImportedAt": 1725062400123,
    "profileName":"Psychology"
  }
  ```

### 4.4 In-file metadata (YAML front matter)

```yaml
chat_uid: abcd1234…
chat_updated_at: 2025-08-30T12:34:56Z
chat_content_hash: 4a5f…   # hash before write
export_source: path/to/export.zip::conversations.json
import_profile: Psychology
```

---

## 5) Import/update algorithm

1. **Load export index** (stream if zip): build `ChatSummary[]` with minimal memory.
2. **Resolve selection**:

   * Active profile’s `include/ignore` + `globalIgnores` + current filters → effective set.
   * “Select all in current view” toggles `include` for visible UIDs.
3. **Destination mapping**:

   * For each included chat, resolve target folder:

     * `profile.targetFolder || plugin.defaultFolder`
     * Ensure folder exists (create if missing).
4. **Diff existing files**:

   * For each included chat:

     * Lookup `data/materialised/<uid>.json` OR scan folder by `chat_uid` in YAML (fallback).
     * Build current transcript (normalised).
     * Compute `contentHash`.
     * If no record → **NEW**.
     * If record && `contentHash` differs OR `updatedAt` increased → **UPDATE**.
     * Else **SKIP**.
5. **Write**:

   * Use filename template with stable suffix `[uid_short]` (first 7 chars).
   * If UPDATE:

     * Policy: Overwrite | Merge | Keep both.
     * If Merge: preserve sections marked `## Notes` or between `<!-- USER-NOTES START/END -->`.
   * Write/update YAML with `chat_*` fields.
6. **Record**:

   * Update `materialised/<uid>.json`.
   * Update profile `include/ignore` maps as needed.
7. **Progress**:

   * Emit granular events: `SCAN_START`, `SCAN_PROGRESS`, `IMPORT_START`, `FILE_WRITTEN`, `IMPORT_DONE`.
   * Allow cancel; on cancel, flush completed writes and leave state consistent.

---

## 6) Filtering & search

* **Keyword**: OR/AND support with simple parser:

  * `birds AND (recipe OR "sour dough")`
  * Search fields: title + `keywordsSample` (first N tokens of transcript).
  * (Optional) Build a small inverted index with \[MiniSearch] approach in memory; cap tokens to keep RAM bounded.
* **Date filters**:

  * Field picker: Created or Updated.
  * Range: absolute pickers + shortcuts (Last 7d, 30d, Year).
* **Status filters** (computed live):

  * New (no materialised record)
  * Updated (hash changed or export updatedAt newer)
  * Imported (has record)
  * Ignored (profile or global)

---

## 7) UI implementation details

* **Framework**: TypeScript + Obsidian API (Modal, SettingTab, Component).
* **Table**: virtualised list (e.g., simple custom virtual scroller) to avoid heavyweight libraries.

  * Row height fixed; measure once.
  * Handle 10k–50k rows smoothly.
* **Accessibility**:

  * Full keyboard navigation (arrow keys, space to toggle selection).
  * ARIA roles for table, checkboxes, buttons.
  * Respect Obsidian theme (light/dark).
* **Internationalisation**: text via i18n map; date formats via system locale (with ISO fallback).

---

## 8) File generation

### 8.1 Filename template variables

* `{{date}}` (from updatedAt, `YYYY-MM-DD`)
* `{{created}}`
* `{{title}}` (slugified, length-limited)
* `{{uid}}`, `{{uid_short}}`
* `{{profile}}`
* `{{model}}`

Default:
`{{date}} — {{title}} [{{uid_short}}].md`

### 8.2 Front matter template variables

All above plus:

* `{{message_count}}`
* `{{export_path}}`
* `{{export_updated_iso}}`

Example default:

```yaml
---
title: "{{title}}"
chat_uid: "{{uid}}"
chat_updated_at: "{{export_updated_iso}}"
chat_content_hash: "{{content_hash}}"
import_profile: "{{profile}}"
model: "{{model}}"
messages: {{message_count}}
---
```

### 8.3 Body layout

```
# {{title}}

> Imported: {{now_iso}} • Profile: {{profile}} • Model: {{model}}

---

{{transcript_markdown}}

---

## Notes
<!-- USER-NOTES START -->
<!-- USER-NOTES END -->
```

* **Merge policy** keeps `USER-NOTES` block intact on updates.

---

## 9) Profiles & ignore logic

* **Profile maps**: Each profile owns `include` & `ignore` sets by UID.
* **Global ignores**: Always excluded unless a profile explicitly includes (profile inclusion overrides global ignore with a warning).
* **Saved filters**: Stored with profile for quick rehydration of the view, but **effective selection** is from the include/ignore sets (filters don’t auto-toggle state; they help you bulk-toggle).
* **Profile folders**: If absent, create on import; if later changed, new imports go to the new folder; existing files remain where they are (offer “Relocate existing files” command as a separate utility).

---

## 10) Background execution & performance

* Use a **Web Worker** for heavy parsing, hashing, and writing orchestration to keep UI responsive.
* Stream export parsing (if zip): avoid loading full JSON into memory.
* Hashing:

  * Compute `contentHash` on a **canonicalised transcript** (strip volatile fields; normalise whitespace).
  * Use fast 64-bit hash (xxhash) or SHA-1 (acceptable here since it’s not a security boundary).
* Batching writes to filesystem (e.g., 10–20 ops per batch) with throttled progress events.

---

## 11) Error handling & recovery

* **Malformed export**: show row-level warnings; skip corrupt chats; continue.
* **Missing UID**: derive UID; mark source as “derived”.
* **Write failures** (permissions, path too long, invalid characters):

  * Retry with safe fallback filename.
  * Log to “Import Report.md” in a plugin log folder with details.
* **Cancellation**:

  * Button in modal; background status-bar item.
  * On cancel, current file write completes; queue aborted; state saved for completed items only.
* **Conflicts**:

  * If two profiles try to write same UID to different folders, allow (they’re still the same UID) but warn; the materialised record stores latest file path per profile. Provide a “Reveal duplicates for UID” tool.

---

## 12) Security & privacy

* No outbound network requests.
* Paths, hashes, and summaries stored locally in plugin data.
* Optional: “Secure mode” that avoids writing `export_path` into front matter.

---

## 13) Extensibility

* **Multiple sources**: support multiple export files; table shows `Source` column; per-profile filters can target a source.
* **Pluggable normalisers**: keep a “format adapter” interface so non-ChatGPT exports can be supported later.
* **Hooks** (internal events):

  * `onBeforeList(chats)`, `onAfterList(viewState)`
  * `onBeforeWrite(fileCtx)`, `onAfterWrite(fileCtx)`
  * `onImportComplete(report)`

---

## 14) Public (internal) APIs

```ts
// Data access
interface ChatIndex {
  listSummaries(filters: ViewFilters): Promise<ChatSummary[]>;
  loadTranscript(uid: ChatUID): Promise<Transcript>;
}

interface ProfileStore {
  getActive(): ImportProfile;
  save(profile: ImportProfile): Promise<void>;
  setActive(name: string): Promise<void>;
  list(): Promise<string[]>;
}

interface MaterialisedStore {
  get(uid: ChatUID): Promise<FileMaterialisedMeta | null>;
  put(meta: FileMaterialisedMeta): Promise<void>;
}

// Import orchestration
interface ImportPlanner {
  plan(profile: ImportProfile, summaries: ChatSummary[]): Promise<Plan>;
}

interface ImportRunner {
  run(plan: Plan, opts: RunOptions): Promise<Report>;
  onProgress(cb: (ev: ProgressEvent) => void): Unsub;
  cancel(): void;
}
```

---

## 15) TypeScript models (key)

```ts
interface ImportProfile {
  name: string;
  targetFolder?: string;
  include: Record<ChatUID, true>;
  ignore: Record<ChatUID, true>;
  filters?: ViewFilters;
  filenameTemplate?: string;
  frontMatterTemplate?: string;
}

interface ViewFilters {
  dateField: "createdAt" | "updatedAt";
  from?: number;
  to?: number;
  keyword?: string;
  status?: Array<"new"|"updated"|"imported"|"ignored">;
  source?: string;
}

interface PlanItem {
  uid: ChatUID;
  action: "NEW" | "UPDATE" | "SKIP";
  targetPath: string;
  reason?: string; // e.g., "hash equal"
}

interface Plan {
  items: PlanItem[];
  counts: { new: number; update: number; skip: number; };
}

interface ProgressEvent {
  phase: "SCAN"|"PLAN"|"WRITE";
  current: number;
  total: number;
  uid?: ChatUID;
  message?: string;
}

interface Report {
  startedAt: number;
  finishedAt: number;
  items: Array<{
    uid: ChatUID;
    action: "NEW"|"UPDATE"|"SKIP";
    path?: string;
    error?: string;
  }>;
}
```

---

## 16) Migration (from existing plugin behaviour)

* On first version launch:

  * Detect notes with `chat_uid` in YAML; populate `materialised/*.json` cache.
  * Build `globalIgnores` empty; create “Default” profile, auto-set `targetFolder` to current plugin setting.
  * Do **not** re-import existing files; they appear as `Imported` status.

---

## 17) Testing strategy

### 17.1 Unit tests

* UID derivation (with/without export id).
* Hash stability across normalisation changes.
* Filter parser (AND/OR, quotes).
* Plan generation (new/update/skip) across edge cases.

### 17.2 Integration tests (Obsidian sandbox vault)

* First-run flow with 50, 5k, 25k chats (synthetic exports).
* Profiles: save, switch, delete; folder creation; include/ignore persistence.
* Bulk operations with “Select all in view” after filters.
* Update policy behaviours (Overwrite/Merge/Keep both).
* Cancellation mid-import; resume later (idempotency).

### 17.3 Performance targets

* Load + render 10k chat table in < 1.5s on mid-range laptop.
* Scroll at 60fps via virtualisation.
* Import throughput: ≥ 20 files/sec for small notes; hashing not to exceed 30% CPU on 4-core machine (worker).

---

## 18) Edge cases to handle

* Chats with identical titles and timestamps (UID resolves uniqueness).
* Title changes between exports (filename stable due to `[uid_short]`).
* Extremely long titles → truncate slug; keep UID suffix.
* Non-ASCII, RTL scripts → normalise safely.
* Very large single chats (thousands of messages) → stream transcript build.
* Corrupt YAML on legacy files → rewrite YAML safely while preserving body; or create sidecar meta under `materialised/`.

---

## 19) Developer notes & roadmap

* Start with **Chat Management Modal** + **ProfileStore** + **MaterialisedStore** + **ImportPlanner/Runner**.
* Keep adapters isolated:

  * `exportAdapters/chatgpt-v1.ts` (parse, enumerate, loadTranscript)
  * `writers/markdown.ts` (filename/front matter/body templates, merge policy)
* Future ideas:

  * Saved **filter presets** separate from profiles.
  * **Relocate existing files** when a profile’s folder changes.
  * Optional **tagging**: add `tags: [profile, "chatgpt"]`.
  * Export an **Import Report** at the end with summary and links.

---

## 20) Minimal backlog (MVP → V1)

**MVP**

* Modal with table (virtualised), sort by Title/Created/Updated.
* Filters: keyword, date range, status.
* Checkboxes + “Select all in view”, Include/Ignore.
* Profiles (save/load), single target folder per profile.
* Import planner (new/update/skip) + writer (overwrite only).
* Progress bar + background worker.
* Persistence: global ignores, per-profile include/ignore, materialised cache.

**V1 polish**

* Merge policy with `USER-NOTES` preservation.
* Multiple sources (column + filter).
* Conflict warnings (same UID in multiple folders).
* Error report file and robust recovery.

---

This spec keeps the philosophy simple: **stable UIDs, explicit profiles, deterministic writes**. You get frictionless bulk triage (“show me ‘recipes’, ignore them all”), and repeatable imports aligned to topical folders without re-doing the selections every time.

Next natural step is to sketch the data adapter for your current export format and wire up the virtualised table; shout when you want me to draft the adapter interfaces or a first pass at the Modal skeleton in TypeScript.
