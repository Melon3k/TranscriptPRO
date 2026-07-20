export const meta = {
  name: 'implement-task',
  description: 'Spec → implement → verify → adversarial review for one free-form TranscriptPRO task',
  whenToUse: 'Run with args {name: "...", brief: "..."} for work outside the fixed A–G backlog items (new features, bug clusters).',
  phases: [
    { title: 'Spec', detail: 'architect turns the brief into work packages' },
    { title: 'Implement', detail: 'work packages executed sequentially (frontend/rust)' },
    { title: 'Verify', detail: 'tsc + vitest + cargo gate, one repair round' },
    { title: 'Review', detail: '3 finder lenses, adversarial verify, fix confirmed' },
  ],
}

// ── Input ─────────────────────────────────────────────────────────────────────
let input = args
if (typeof input === 'string') {
  try { input = JSON.parse(input) } catch { input = { brief: input } }
}
const brief = input && input.brief
const name = (input && input.name) || 'task'
if (!brief) throw new Error(`args.brief is required (got: ${JSON.stringify(args)})`)
log(`Implementing task: ${name}`)

const role = (n) =>
  `First, Read the file .claude/agents/${n}.md and adopt everything after its frontmatter as your operating instructions for this task. Then proceed:\n\n`

// ── Schemas (same contracts as implement-backlog-feature) ─────────────────────
const SPEC_SCHEMA = {
  type: 'object', required: ['summary', 'workPackages', 'manualQa'],
  properties: {
    summary: { type: 'string' }, dataModel: { type: 'string' },
    workPackages: {
      type: 'array', minItems: 1,
      items: {
        type: 'object', required: ['title', 'area', 'files', 'instructions'],
        properties: {
          title: { type: 'string' }, area: { type: 'string', enum: ['frontend', 'rust'] },
          files: { type: 'array', items: { type: 'string' } }, instructions: { type: 'string' },
        },
      },
    },
    risks: { type: 'array', items: { type: 'string' } },
    manualQa: { type: 'array', items: { type: 'string' } },
  },
}
const VERIFY_SCHEMA = {
  type: 'object', required: ['ok', 'findings'],
  properties: {
    ok: { type: 'boolean' }, commands: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object', required: ['summary', 'severity'],
        properties: {
          file: { type: 'string' }, line: { type: 'number' }, summary: { type: 'string' },
          failureScenario: { type: 'string' }, severity: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
      },
    },
    manualQaNeeded: { type: 'array', items: { type: 'string' } },
  },
}
const FINDINGS_SCHEMA = {
  type: 'object', required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object', required: ['file', 'summary', 'failureScenario'],
        properties: { file: { type: 'string' }, line: { type: 'number' }, summary: { type: 'string' }, failureScenario: { type: 'string' } },
      },
    },
  },
}
const VERDICT_SCHEMA = {
  type: 'object', required: ['verdict'],
  properties: { verdict: { type: 'string', enum: ['CONFIRMED', 'PLAUSIBLE', 'REFUTED'] }, reason: { type: 'string' } },
}

// ── Phase 1: Spec ─────────────────────────────────────────────────────────────
phase('Spec')
const spec = await agent(
  role('feature-architect') +
    `Produce the implementation spec for this TranscriptPRO task.\n\n${brief}\n\nFollow your role instructions: read docs/new-design-agents.md (accepted decisions — do not reopen them) and the code you build on, then return the spec. Split work packages by area (frontend vs rust) so each goes to the right implementer.`,
  { label: `spec:${name}`, schema: SPEC_SCHEMA }
)
if (!spec) throw new Error('Architect returned nothing')
log(`Spec ready: ${spec.workPackages.length} work package(s)`)

// ── Phase 2: Implement (sequential — packages share one working tree) ─────────
phase('Implement')
const implemented = []
for (let i = 0; i < spec.workPackages.length; i++) {
  const wp = spec.workPackages[i]
  const roleName = wp.area === 'rust' ? 'tauri-rust-implementer' : 'frontend-implementer'
  const result = await agent(
    role(roleName) +
      `Implement this work package (${i + 1}/${spec.workPackages.length}) for task "${name}".\n\nFeature summary: ${spec.summary}\n\nData model: ${spec.dataModel || 'n/a'}\n\nPackage: ${wp.title}\nFiles: ${wp.files.join(', ')}\nInstructions:\n${wp.instructions}\n\nEarlier packages already applied to the working tree: ${implemented.map((r) => r.title).join('; ') || 'none'}.`,
    { label: `impl:${wp.title.slice(0, 30)}` }
  )
  implemented.push({ title: wp.title, result })
}

// ── Phase 3: Verify ───────────────────────────────────────────────────────────
phase('Verify')
const repairRoleFor = (findings) =>
  role((findings || []).some((f) => (f.file || '').endsWith('.rs') || (f.file || '').includes('src-tauri')) ? 'tauri-rust-implementer' : 'frontend-implementer')
const verifyPrompt = () =>
  role('qa-verifier') +
  `Verify the just-implemented task "${name}" ("${spec.summary}"). The diff to audit is the uncommitted working tree (git diff HEAD). Follow your role checklist and return the verdict object.`
let verdict = await agent(verifyPrompt(), { label: 'verify', schema: VERIFY_SCHEMA })

if (verdict && !verdict.ok) {
  const highs = verdict.findings.filter((f) => f.severity === 'high')
  log(`Verify failed (${highs.length} high) — one repair round`)
  await agent(
    repairRoleFor(verdict.findings) +
      `Repair round for task "${name}". The QA gate failed. Fix ONLY these problems, nothing else:\n\n${JSON.stringify(verdict.findings, null, 2)}\n\nCommand output excerpts:\n${verdict.commands || 'n/a'}`,
    { label: 'repair' }
  )
  verdict = await agent(verifyPrompt(), { label: 're-verify', schema: VERIFY_SCHEMA })
}

// ── Phase 4: Review ───────────────────────────────────────────────────────────
phase('Review')
const LENSES = [
  { key: 'correctness', prompt: 'line-by-line correctness: wrong conditions, null/undefined, missing await, stale state, event-handler races, ffmpeg/child-process handling, temp-file cleanup, cancellation' },
  { key: 'contract', prompt: 'cross-boundary contracts: IPC TS↔Rust serde shapes, Channel progress, i18n keys in BOTH en and pl (Polish plurals complete), filtergraph/path escaping for ffmpeg' },
  { key: 'regression', prompt: 'regressions: behavior the diff removed or bypassed, React.memo prop-identity breakage in the segment list, theme (light/dark) coverage, existing export/transcription flows still intact' },
]
const found = (
  await parallel(
    LENSES.map((l) => () =>
      agent(
        role('qa-verifier') +
          `Review the uncommitted working-tree diff (git diff HEAD) of TranscriptPRO task "${name}". Lens: ${l.prompt}. Read the enclosing code of every hunk. Do NOT run the build/test commands (a separate gate does that) — audit only. Return up to 5 findings with concrete failure scenarios; empty list if clean.`,
        { label: `find:${l.key}`, phase: 'Review', schema: FINDINGS_SCHEMA }
      )
    )
  )
).filter(Boolean).flatMap((r) => r.findings)

const seen = new Set()
const unique = found.filter((f) => {
  const k = `${f.file}:${f.line || 0}:${f.summary.slice(0, 40)}`
  if (seen.has(k)) return false
  seen.add(k); return true
})
log(`${unique.length} unique finding(s) to verify`)

const judged = await parallel(
  unique.map((f) => () =>
    agent(
      `Adversarially verify this code-review finding against the actual code in this repo (try to REFUTE it; quote lines):\n${JSON.stringify(f)}`,
      { label: `judge:${(f.file || '').split('/').pop()}`, phase: 'Review', schema: VERDICT_SCHEMA }
    ).then((v) => ({ ...f, verdict: v ? v.verdict : 'PLAUSIBLE' }))
  )
)
const confirmed = judged.filter(Boolean).filter((f) => f.verdict === 'CONFIRMED')

if (confirmed.length > 0) {
  log(`Fixing ${confirmed.length} confirmed finding(s)`)
  await agent(
    repairRoleFor(confirmed) +
      `Fix ONLY these confirmed review findings for task "${name}", nothing else:\n\n${JSON.stringify(confirmed, null, 2)}`,
    { label: 'fix-findings', phase: 'Review' }
  )
  verdict = await agent(verifyPrompt(), { label: 'final-verify', phase: 'Review', schema: VERIFY_SCHEMA })
}

return {
  name,
  summary: spec.summary,
  workPackages: implemented.map((r) => r.title),
  risks: spec.risks || [],
  gate: verdict ? { ok: verdict.ok, findings: verdict.findings } : null,
  reviewFindings: judged.filter(Boolean).map((f) => ({ summary: f.summary, verdict: f.verdict })),
  manualQa: [...(spec.manualQa || []), ...((verdict && verdict.manualQaNeeded) || [])],
}
