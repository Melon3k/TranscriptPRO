export const meta = {
  name: 'implement-backlog-feature',
  description: 'Spec → implement → verify → adversarial review for ONE new-design backlog item (A–G)',
  whenToUse: 'Run with args {item: "G"} (or A/B/C/D/E/F1/F2). Respect the sequence in docs/new-design-agents.md — one item per run, on a fresh branch, previous item merged first.',
  phases: [
    { title: 'Spec', detail: 'architect turns the BACKLOG item into work packages' },
    { title: 'Implement', detail: 'work packages executed sequentially (frontend/rust)' },
    { title: 'Verify', detail: 'tsc + vitest + cargo gate, one repair round' },
    { title: 'Review', detail: '3 finder lenses, adversarial verify, fix confirmed highs' },
  ],
}

// ── Input ─────────────────────────────────────────────────────────────────────
const ITEMS = {
  G: 'Item G — drag-and-drop regression: reimplement word drag & drop on pointer events, then re-enable native Tauri file drop (dragDropEnabled: true in tauri.conf.json; useFileDrop hook already exists).',
  F1: 'Item F (part 1) — caption style foundation: CaptionStyle type + persisted zustand styleStore (global style, per docs decisions), bind the Player subtitle overlay to it, bundle local woff2 fonts (Outfit/Inter/JetBrains Mono).',
  F2: 'Item F (part 2) — export styles: generate the ASS [V4+ Styles] section from the style model in src-tauri/src/subtitle/ass.rs (replaces the hardcoded Style: line); pass the style over IPC through export_ass.',
  A: 'Item A — make the Inspector tab of StylePanel real: bind every control (font, size, spacing, line-height, alignment, B/I/TT, outline/shadow/glow + strength, colors incl. new color pickers, 3x3 box position, width, bottom distance) to styleStore. Requires F1 (and F2 for faithful export).',
  B: 'Item B — draggable caption box on the video: drag handles on the Player overlay writing x%/bottom%/width% back to styleStore, synced with the Inspector 3x3 grid. Requires A.',
  D: 'Item D — presets/effects tab: preset cards (Neon, Hard shadow, Thick outline, Soft), New/Duplicate/Save/Delete, search, persistence. A preset is a named CaptionStyle snapshot. Requires A.',
  C: 'Item C — animations tab: per docs decisions, v1 = karaoke + fade wired end-to-end (preview in Player overlay + ASS \\k / \\fad on export); remaining types (slide/pop/typewriter/blur) preview-only behind the same model; animation editor modal deferred unless the spec says otherwise. Requires A (and F2).',
  E: 'Item E — export preview modal: SRT/VTT tabs with generated text preview + Download button in front of the native save dialog; include the inverted-timings warning already shown by the export guard.',
}

const item = args && args.item
if (!item || !ITEMS[item]) {
  throw new Error(`args.item must be one of: ${Object.keys(ITEMS).join(', ')}`)
}
const brief = ITEMS[item]
log(`Implementing backlog item ${item}`)

// ── Schemas ───────────────────────────────────────────────────────────────────
const SPEC_SCHEMA = {
  type: 'object',
  required: ['summary', 'workPackages', 'manualQa'],
  properties: {
    summary: { type: 'string' },
    dataModel: { type: 'string' },
    workPackages: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['title', 'area', 'files', 'instructions'],
        properties: {
          title: { type: 'string' },
          area: { type: 'string', enum: ['frontend', 'rust'] },
          files: { type: 'array', items: { type: 'string' } },
          instructions: { type: 'string' },
        },
      },
    },
    risks: { type: 'array', items: { type: 'string' } },
    manualQa: { type: 'array', items: { type: 'string' } },
  },
}

const VERIFY_SCHEMA = {
  type: 'object',
  required: ['ok', 'findings'],
  properties: {
    ok: { type: 'boolean' },
    commands: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['summary', 'severity'],
        properties: {
          file: { type: 'string' },
          line: { type: 'number' },
          summary: { type: 'string' },
          failureScenario: { type: 'string' },
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
      },
    },
    manualQaNeeded: { type: 'array', items: { type: 'string' } },
  },
}

const FINDINGS_SCHEMA = {
  type: 'object',
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['file', 'summary', 'failureScenario'],
        properties: {
          file: { type: 'string' },
          line: { type: 'number' },
          summary: { type: 'string' },
          failureScenario: { type: 'string' },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  required: ['verdict'],
  properties: {
    verdict: { type: 'string', enum: ['CONFIRMED', 'PLAUSIBLE', 'REFUTED'] },
    reason: { type: 'string' },
  },
}

// ── Phase 1: Spec ─────────────────────────────────────────────────────────────
phase('Spec')
const spec = await agent(
  `Produce the implementation spec for this TranscriptPRO backlog item.\n\n${brief}\n\nFollow your standing instructions: read BACKLOG.md ("New design" section), docs/new-design-agents.md (accepted decisions — do not reopen them), and the code you build on, then return the spec.`,
  { agentType: 'feature-architect', label: `spec:${item}`, schema: SPEC_SCHEMA }
)
if (!spec) throw new Error('Architect returned nothing')
log(`Spec ready: ${spec.workPackages.length} work package(s)`)

// ── Phase 2: Implement (sequential — packages share one working tree) ────────
phase('Implement')
const implemented = []
for (let i = 0; i < spec.workPackages.length; i++) {
  const wp = spec.workPackages[i]
  const agentType = wp.area === 'rust' ? 'tauri-rust-implementer' : 'frontend-implementer'
  const result = await agent(
    `Implement this work package (${i + 1}/${spec.workPackages.length}) for backlog item ${item}.\n\nFeature summary: ${spec.summary}\n\nData model: ${spec.dataModel || 'n/a'}\n\nPackage: ${wp.title}\nFiles: ${wp.files.join(', ')}\nInstructions:\n${wp.instructions}\n\nEarlier packages already applied to the working tree: ${implemented.map((r) => r.title).join('; ') || 'none'}.`,
    { agentType, label: `impl:${wp.title.slice(0, 30)}` }
  )
  implemented.push({ title: wp.title, result })
}

// ── Phase 3: Verify (gate + one repair round) ─────────────────────────────────
phase('Verify')
// Route repairs to the implementer whose files are failing.
const repairAgentFor = (findings) =>
  (findings || []).some((f) => (f.file || '').endsWith('.rs') || (f.file || '').includes('src-tauri'))
    ? 'tauri-rust-implementer'
    : 'frontend-implementer'
const verifyPrompt = () =>
  `Verify the just-implemented backlog item ${item} ("${spec.summary}"). The diff to audit is the uncommitted working tree (git diff HEAD). Follow your standing checklist and return the verdict object.`
let verdict = await agent(verifyPrompt(), { agentType: 'qa-verifier', label: 'verify', schema: VERIFY_SCHEMA })

if (verdict && !verdict.ok) {
  const highs = verdict.findings.filter((f) => f.severity === 'high')
  log(`Verify failed (${highs.length} high) — one repair round`)
  await agent(
    `Repair round for backlog item ${item}. The QA gate failed. Fix ONLY these problems, nothing else:\n\n${JSON.stringify(verdict.findings, null, 2)}\n\nCommand output excerpts:\n${verdict.commands || 'n/a'}`,
    { agentType: repairAgentFor(verdict.findings), label: 'repair' }
  )
  verdict = await agent(verifyPrompt(), { agentType: 'qa-verifier', label: 're-verify', schema: VERIFY_SCHEMA })
}

// ── Phase 4: Review (3 lenses → adversarial verify → fix confirmed highs) ────
phase('Review')
const LENSES = [
  { key: 'correctness', prompt: 'line-by-line correctness: wrong conditions, null/undefined, missing await, stale state, event-handler races' },
  { key: 'contract', prompt: 'cross-boundary contracts: IPC TS↔Rust serde shapes, i18n keys in BOTH en and pl (Polish plurals complete), store persistence/migrations' },
  { key: 'regression', prompt: 'regressions: behavior the diff removed or bypassed, React.memo prop-identity breakage in the segment list, theme (light/dark) coverage' },
]
const found = (
  await parallel(
    LENSES.map((l) => () =>
      agent(
        `Review the uncommitted working-tree diff (git diff HEAD) of TranscriptPRO backlog item ${item}. Lens: ${l.prompt}. Read the enclosing code of every hunk. Return up to 5 findings with concrete failure scenarios; return an empty list if clean.`,
        { agentType: 'qa-verifier', label: `find:${l.key}`, phase: 'Review', schema: FINDINGS_SCHEMA }
      )
    )
  )
)
  .filter(Boolean)
  .flatMap((r) => r.findings)

const seen = new Set()
const unique = found.filter((f) => {
  const k = `${f.file}:${f.line || 0}:${f.summary.slice(0, 40)}`
  if (seen.has(k)) return false
  seen.add(k)
  return true
})
log(`${unique.length} unique finding(s) to verify`)

const judged = await parallel(
  unique.map((f) => () =>
    agent(
      `Adversarially verify this code-review finding against the actual code (try to REFUTE it; quote lines):\n${JSON.stringify(f)}`,
      { agentType: 'qa-verifier', label: `judge:${(f.file || '').split('/').pop()}`, phase: 'Review', schema: VERDICT_SCHEMA }
    ).then((v) => ({ ...f, verdict: v ? v.verdict : 'PLAUSIBLE' }))
  )
)
const confirmed = judged.filter(Boolean).filter((f) => f.verdict === 'CONFIRMED')

if (confirmed.length > 0) {
  log(`Fixing ${confirmed.length} confirmed finding(s)`)
  await agent(
    `Fix ONLY these confirmed review findings for backlog item ${item}, nothing else:\n\n${JSON.stringify(confirmed, null, 2)}`,
    { agentType: repairAgentFor(confirmed), label: 'fix-findings', phase: 'Review' }
  )
  verdict = await agent(verifyPrompt(), { agentType: 'qa-verifier', label: 'final-verify', phase: 'Review', schema: VERIFY_SCHEMA })
}

return {
  item,
  summary: spec.summary,
  workPackages: implemented.map((r) => r.title),
  gate: verdict ? { ok: verdict.ok, findings: verdict.findings } : null,
  reviewFindings: judged.filter(Boolean).map((f) => ({ summary: f.summary, verdict: f.verdict })),
  manualQa: [...(spec.manualQa || []), ...((verdict && verdict.manualQaNeeded) || [])],
}
