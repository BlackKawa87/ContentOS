# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project

ContentOS — AI-powered Content Operating System for private research, learning, content
intelligence, and content engineering. Two independent workflows share infrastructure but
never share business logic: **Study Engine** and **Reverse Engineering Engine**, plus a
**Content Builder** and a cross-cutting **Knowledge Base**.

## Commands

```bash
npm run dev        # Vite dev server (frontend only, HMR)
vercel dev          # Frontend + /api serverless functions locally (use this for full-stack work)
npm run build       # TypeScript check + Vite production build
npm run lint        # oxlint
npx prisma studio    # Browse the database
npx prisma migrate dev --name <name>   # Create + apply a migration
npx prisma generate  # Regenerate the Prisma client (server/generated/prisma)
```

No test framework is configured yet.

**Supabase Postgres connection**: use the Supavisor **session pooler** string (Project Settings >
Database > Connection String > "Session pooler", host `aws-0-<region>.pooler.supabase.com:5432`).
The direct connection (`db.<ref>.supabase.co:5432`) is IPv6-only and unreachable from most
sandboxed/local networks; the transaction pooler (`:6543`) hangs indefinitely on `prisma migrate`'s
advisory locks. Only the session pooler works reliably for migrations here.

**Video rendering (deviation from spec, confirmed with user)**: `VIDEO_RENDERED` uses plain
`ffmpeg-static`/`fluent-ffmpeg` (slide PNGs rasterized from SVG via `sharp`, concatenated with the
narration track) instead of Remotion. This sandbox has no system Chrome and Remotion's headless
Chromium download was judged too slow/fragile to justify given the session's cost. Revisit Remotion
later if richer slide animation is wanted — see `server/lib/ffmpeg.ts` / `server/studyPipeline/renderVideo.ts`.

**Relative imports in `api/`/`server/` need explicit `.js` extensions** (e.g.
`from '../lib/prisma.js'` even though the file is `prisma.ts`) — this is a pure-ESM
(`"type": "module"`) + NodeNext-resolution project, and Node's runtime ESM loader does not
auto-append extensions the way `bundler` resolution or CJS `require` do. Getting this wrong
doesn't fail locally (`tsx` resolves it fine either way) but crashes every `/api` function in
production with `ERR_MODULE_NOT_FOUND` — this happened on the first real deploy. `tsconfig.server.json`
uses `module`/`moduleResolution: "nodenext"` specifically so `tsc --noEmit` catches this locally
before it ever reaches Vercel.

**CJS default-export interop gotcha**: `import X from 'some-cjs-package'` under tsx/Node ESM
sometimes yields the real class, sometimes the whole module, sometimes a double-wrapped
`{ default: { default: Class } }` (hit this with both `yt-dlp-wrap` and `pptxgenjs`, each
wrapped differently). If a newly added CJS dependency throws "X is not a constructor" at
runtime despite type-checking fine, import it as `import * as XModule from '...'` and pass it
through `unwrapDefault<T>()` from `server/lib/interop.ts` rather than trusting the default import.

**yt-dlp binary**: `server/lib/ytdlp.ts` downloads the standalone `yt-dlp_macos`/`yt-dlp_linux`
binary directly (with a size check against `Content-Length` to catch truncated downloads) —
`yt-dlp-wrap`'s own `downloadFromGithub` fetches the generic Python-zipapp asset instead, which
needs Python 3.10+ and isn't reliably present in dev sandboxes or on Vercel's Linux runtime.

## Stack (do not change)

- Frontend: React + TypeScript + Vite + Tailwind CSS v4 (`@tailwindcss/vite`, no `tailwind.config.js`)
- Backend: Vercel Serverless Functions under `/api`
- Database: Supabase Postgres + Storage + Realtime (Auth/RLS present but disabled — see Architecture)
- ORM: Prisma (client generated to `server/generated/prisma`, gitignored)
- AI: OpenAI API (transcription, translation, quiz/flashcard generation)
- Voice: ElevenLabs API (PT narration)
- Media: yt-dlp (download) + ffmpeg (audio extraction) via npm wrappers with bundled static binaries
- Slides: PptxGenJS
- Video rendering: Remotion
- Hosting/repo: Vercel + GitHub. **This directory has its own isolated git repo** — do not assume
  it shares history with any parent directory.

## Architecture

- **No login (deliberate, confirmed with user)**: ContentOS is single-user personal software, not
  a multi-tenant product. `server/lib/auth.ts`'s `requireUser()` doesn't verify a Supabase
  session/JWT — it returns the one existing `profiles` row directly, so every `/api/*` route
  acts as that fixed user without a Bearer token. RLS is **disabled** on all 33 tables
  (`supabase/policies.sql`, applied to the live DB) since `auth.uid()` is always null with no one
  ever signing in — the old per-owner policies would otherwise deny everything. The policy/trigger
  SQL is left in the file as inert historical record rather than deleted, in case multi-user auth
  is ever reintroduced. There is no `/login` route, no `ProtectedRoute`, no sign-out.
- **Frontend reads / realtime** → `supabase-js` (anon key) directly from `src/`, open access (RLS
  disabled, see above).
- **Mutations & pipeline work** → `/api/*` Vercel functions using Prisma + the service role key.
- **Processing queue, not long-running functions**: `yt-dlp`/`ffmpeg`/OpenAI/ElevenLabs/Remotion
  work is split into discrete `ProcessingJob` stages (see `JobStage` enum in
  `prisma/schema.prisma`). Each `/api/study/worker` invocation advances exactly one job by one
  stage and returns — never chain multiple stages in a single serverless invocation, since Vercel
  functions have bounded `maxDuration` and ephemeral `/tmp`.
- The one profile's OpenAI/ElevenLabs keys entered in Settings are stored **encrypted**
  (`pgcrypto`) and take precedence over the platform-default env vars for that profile's jobs.

## Data model

Full schema lives in `prisma/schema.prisma` — it already models every module (Study Engine,
Reverse Engineering, Content Builder, Knowledge Base, cost/audit logging) even though only the
Study Engine has business logic implemented so far. Add new modules by extending this schema and
the `server/studyPipeline`-equivalent folder for that module; do not restructure existing tables.

Conventions: UUID primary keys, `createdAt`/`updatedAt` on every table, soft delete via
`deletedAt` where the spec calls for it, FK and status columns indexed.

## Study Engine rules (must hold for any code touching translation/narration)

- Never summarize, never change facts, dates, or names.
- Preserve 100% of the source educational content's meaning in translation.
- When a source-language institution/proper noun appears, keep both forms, translated form first:
  `Câmara dos Comuns (House of Commons)`.

## Folder structure

```
api/                 Vercel serverless functions (thin: parse request, call server/, respond)
server/lib/          Shared server-only clients (prisma, openai, elevenlabs, ytdlp, ffmpeg, storage)
server/studyPipeline/  One file per JobStage handler
server/remotion/     Remotion compositions for the rendered study video
prisma/schema.prisma  Full data model
src/                 React app (routes, components, contexts, i18n)
```

## i18n

Default UI language is English; Portuguese and Spanish are also available (`src/lib/i18n`).
This is independent from the Study Engine's translation target language (default Portuguese,
user-configurable), which is a data concern, not a UI-copy concern.

## Design

Premium SaaS look: clean, minimal, fast. Light theme by default, dark theme available via a
`.dark` class toggle (Tailwind `dark:` variant), persisted client-side.

## Phase 3 — Viral DNA Engine

Consumes Phase 2's per-video outputs and synthesizes a measurable, evidence-based, versioned
profile per video. Entry gate is `VideoAnalysis.readyForViralDnaAt IS NOT NULL` (not a
`VideoStatus` value — the spec's "READY_FOR_VIRAL_DNA video status" doesn't exist as one;
Phase 2 sets `Video.status = 'COMPLETED'` generically on finishing, so this timestamp is the
precise signal). Terminal `VideoStatus` is `VIRAL_DNA_COMPLETED`.

**Pipeline** (`server/viralDnaPipeline/`, one file per stage, same convention as
`studyPipeline`/`reverseEnginePipeline`/`videoAnalysisPipeline` — no service-class layer):
`VIRAL_DNA_QUEUED` (entry, no handler) → `INPUTS_VALIDATED` → `METRICS_NORMALIZED` →
`HOOK_PROFILE_GENERATED` → `NARRATIVE_PROFILE_GENERATED` → `RETENTION_PROFILE_GENERATED` →
`VISUAL_PROFILE_GENERATED` → `AUDIO_PROFILE_GENERATED` → `EMOTION_PROFILE_GENERATED` →
`PERFORMANCE_PROFILE_GENERATED` → `VIRAL_DNA_SYNTHESIZED` → `VIRAL_DNA_VALIDATED` →
`VIRAL_DNA_COMPLETED`. `server/lib/queue.ts` dispatches on `JobPipeline.VIRAL_DNA` alongside
STUDY/REVERSE_CHANNEL_IMPORT/VIDEO_ANALYSIS — all three video-scoped pipelines share the same
`entityUpdate` branch, but each gets its own terminal `VideoStatus` via `videoTerminalStatus()`.

~7 OpenAI (`gpt-4o-mini`) calls per video total — hook, narrative (+ info-density), retention,
visual (light, text-only — no frames re-sent), audio (light, text sample), emotion, hypotheses.
Everything else (metric normalization, the 19-score scorecard, performance profile) is
deterministic code, per the spec's own cost-control rule ("use AI only for semantic
interpretation"). Each AI-calling stage validates enum returns against the allowed set before
writing to Postgres — `narrativeAnalyzedStage` in Phase 2 hit a real bug here (the model
returned a `HookType` value in a `NarrativePattern` field since both were listed in one
prompt); every Phase 3 stage guards against the same failure mode from the start.

**Schema**: `ViralDnaProfile` is one row **per version** (`videoId + profileVersion` unique,
`isCurrent` marks the active one) — not the 1:1-with-`ChannelAnalysis` placeholder it started
as; that FK was repurposed to `videoId` since the whole workflow is per-video. Flat columns
hold Module 19's comparison-ready fields (primaryHookType, averageWordsPerMinute, etc.); deep
sections (`hook`, `narrative`, `retention`, `visual`, `audio`, `emotion`,
`informationDensity`, `performance`, `metrics`) are JSONB. Child tables: `ViralDnaScore` (19
rows per profile — 15 named + 4 overall, each with `formulaVersion` + the raw `inputs` that
fed it), `ViralDnaHypothesis`, `ViralDnaEvidence` (evidenceId keys referenced from the JSON
sections), `ViralDnaValidationResult`. `sourceSnapshot` stores Phase 2 tables' `updatedAt` at
generation time — stands in for the spec's `sourceVersions` since Phase 2 doesn't version its
own outputs.

**Scoring** (`server/viralDnaPipeline/viralDnaSynthesized.ts`, `FORMULA_VERSION = '1.0.0'`):
every score is a documented, code-computed weighted formula over already-generated metrics/
confidences — AI never invents a score, only feeds inputs into it via the sub-profile stages.
Ideal-value targets (e.g. hook duration ~10% of runtime, ~155 wpm pacing) are first-pass
estimates meant to be tuned once real comparative data exists across many videos, not
empirically derived yet.

**Evidence & confidence**: every AI-generated section carries its own `confidence` (0-1) and,
where applicable, an `evidence` string with a quoted/paraphrased source line; `ViralDnaEvidence`
rows additionally back specific claims with `sourceType`/`sourceId`/timestamps for the UI's
click-to-jump. Emotion is explicitly flagged `inferred: true` and never treated as measured
fact. Performance correlations are stated as co-occurrence ("this pattern appears in a video
with outlier score 4.2"), never causation — enforced via the hypotheses-stage system prompt.

**Validation** (`viralDnaValidatedStage`, Module 15): checks all 8 mandatory sections exist,
all 19 scores are in range and current-formula-version, timestamps/percentages are sane,
evidence rows exist and belong to the right profile. Blocking errors **throw** — the job fails
with the specific error list rather than silently completing an incomplete profile. Non-blocking
issues land in `ViralDnaValidationResult.warnings`/`unsupportedClaims`/`missingEvidence`.

**Versioning/editing**: `edit.ts` clones the current version (+ its scores/hypotheses/evidence)
into `profileVersion + 1` with corrections applied, flips `isCurrent`, and audit-logs the diff —
the original version is never mutated. `regenerateStage.ts` (partial regeneration) instead
patches one JSON section of the *current* draft in place without bumping the version, then
re-runs the validator.

**API** (`api/viralDna/`): 7 endpoints — `select` (start, enforces a max-3-concurrent-jobs
safeguard + returns a cost estimate), `worker`/`retry` (pipeline-agnostic, reused verbatim from
`api/videoAnalysis/`), `regenerateStage`, `approve`, `edit`, `export`. Status/pause/resume/
list-versions/compare-versions need no dedicated endpoint — status is a direct `supabase-js`
read (same pattern `ChannelDetail.tsx` already uses), pause/resume are inherent to the
one-stage-per-invocation queue design, versions are listed/diffed client-side.

**UI**: `src/routes/channels/VideoDetail.tsx` (`/channels/:channelId/videos/:videoId`) — a page
that didn't exist before Phase 3 (Phase 2 shipped backend-only). Overview tab shows raw Phase 2
data (transcript/timeline/narrative/visual/audio); Viral DNA tab has the real work (summary,
scorecard chart, hypotheses with reject-and-save, evidence, versions, raw JSON). Uses
`recharts` (first chart library in the repo) for the emotion curve and scorecard.

**Known limitations**: `AudioMetric` only persists aggregate pause stats, not individual pause
durations, so `audio.longestPause` in the Viral DNA profile is an approximation (the average),
not a true max — re-running silence detection just for that one field wasn't worth
re-downloading the audio. Background-music/sound-effect presence is inferred from transcript
text only (no actual audio classification), always at low confidence. Evidence "click to jump"
scrolls to the Overview tab's timeline rather than seeking an embedded video player, since no
player exists in the UI yet.

## Next phase

Phase 4 — Channel Blueprint Engine (not started). `ViralDnaProfile`'s flat comparison columns
(primaryHookType, averageWordsPerMinute, sceneChangesPerMinute, outlierScoreSnapshot, etc.) are
already queryable without parsing the JSON sections, per Module 19's comparison-readiness
requirement.
