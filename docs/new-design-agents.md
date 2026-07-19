# New-design backlog — agent operating plan

How the "New design (redesign UI)" backlog section (BACKLOG.md, items A–G) gets
implemented with AI agents. The agent team lives in `.claude/agents/`, the
orchestration in `.claude/workflows/implement-backlog-feature.js`.

## Accepted product decisions (architects: do NOT reopen these)

1. **Style scope v1 = one global `CaptionStyle`** applied to all cues, kept in
   a persisted zustand `styleStore`. Per-segment overrides are a later,
   additive extension (`Subtitle.styleOverride?`) — design the model so that
   adding them doesn't break persisted state.
2. **Styling must be honest**: whatever the Player overlay previews must
   export faithfully to **ASS** (generated `[V4+ Styles]` section). SRT/TXT
   carry no styling and that's fine; VTT position mapping is optional/later.
3. **Animations v1 = karaoke + fade**, wired end-to-end (overlay preview and
   ASS `\k` / `\fad`). The other types (slide/pop/typewriter/blur) may ship
   preview-only behind the same model, clearly not-exported; the animation
   editor modal is deferred. Full animation export implies burned-in video
   rendering — a separate future epic, not part of A–G.
4. **Fonts**: bundle Outfit, Inter and JetBrains Mono as local `.woff2`
   (SIL OFL — attribution in README). No webfont CDNs (CSP stays closed).
5. **Word DnD (item G)** is reimplemented on **pointer events** so native
   Tauri file drop can come back (`dragDropEnabled: true`). Insertion zones
   and multi-select behavior must survive the port.

## Sequence (one item per run, one branch/PR per item)

| Order | Item | Depends on | Size |
|-------|------|-----------|------|
| 1 | **G** — file-drop regression / pointer DnD | — | M |
| 2 | **F1** — CaptionStyle model + styleStore + overlay binding + fonts | — | M |
| 3 | **F2** — ASS style serialization (Rust) | F1 | M |
| 4 | **A** — Inspector tab live (incl. color pickers) | F1 (F2 for honest export) | L |
| 5 | **B** — draggable caption box on the player | A | M |
| 6 | **D** — presets/effects tab | A | S/M |
| 7 | **C** — animations (karaoke + fade e2e) | A, F2 | L |
| 8 | **E** — export preview modal | — (anytime) | S |

G and F1 are independent — F1 may start while G's PR is in review, but never
run two workflow items against the same working tree at once (implementers
share the tree; parallel items = conflicts).

## How to run one item

```
Workflow { name: "implement-backlog-feature", args: { item: "G" } }
```

Preconditions per run: clean working tree, fresh branch off current `main`
(`git switch -c claude/new-design-<item>`), previous item in the sequence
merged. The workflow runs: architect spec → sequential work packages
(frontend / rust implementers) → QA gate (tsc + vitest + cargo, one repair
round) → 3-lens adversarial review → fix confirmed findings → final gate.

After a run: the result lists `manualQa` clicks — do them in `npm run tauri dev`
before opening the PR (runtime-only bugs are a proven blind spot in this repo:
Cmd+Q menu handling, word-DnD, dialog flows). Then commit, push, PR, and tick
the item's checkboxes in BACKLOG.md.

## Roles

- `feature-architect` — read-only; BACKLOG item → spec (work packages, data
  model, i18n keys en+pl, risks, manual QA list).
- `frontend-implementer` — React/TS in the redesign design system
  (`src/lib/ui.ts`, inline styles over `--c-*` vars, no Tailwind), i18n both
  locales, zustand patterns, IPC only via `src/lib/tauri-commands.ts`.
- `tauri-rust-implementer` — commands + `subtitle/` formats, serde camelCase
  contracts, ASS pitfalls (&HAABBGGRR, numpad alignment, `\k` centiseconds),
  exFAT-aware cargo verification.
- `qa-verifier` — the gate: runs tsc/vitest/cargo, audits the diff for the
  repo's recurring failure modes (i18n gaps, IPC shape drift, memo prop
  identity, theme coverage, removed behavior).
