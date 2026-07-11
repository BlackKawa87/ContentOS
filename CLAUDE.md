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

## Stack (do not change)

- Frontend: React + TypeScript + Vite + Tailwind CSS v4 (`@tailwindcss/vite`, no `tailwind.config.js`)
- Backend: Vercel Serverless Functions under `/api`
- Database: Supabase Postgres + Storage + Auth + Realtime + RLS
- ORM: Prisma (client generated to `server/generated/prisma`, gitignored)
- AI: OpenAI API (transcription, translation, quiz/flashcard generation)
- Voice: ElevenLabs API (PT narration)
- Media: yt-dlp (download) + ffmpeg (audio extraction) via npm wrappers with bundled static binaries
- Slides: PptxGenJS
- Video rendering: Remotion
- Hosting/repo: Vercel + GitHub. **This directory has its own isolated git repo** — do not assume
  it shares history with any parent directory.

## Architecture

- **Frontend reads / realtime** → `supabase-js` (anon key) directly from `src/`, protected by RLS
  (`auth.uid()` + role claim in `profiles`).
- **Mutations & pipeline work** → `/api/*` Vercel functions using Prisma + the service role key
  (bypasses RLS), with role checks done in code from the verified Supabase JWT.
- **Processing queue, not long-running functions**: `yt-dlp`/`ffmpeg`/OpenAI/ElevenLabs/Remotion
  work is split into discrete `ProcessingJob` stages (see `JobStage` enum in
  `prisma/schema.prisma`). Each `/api/study/worker` invocation advances exactly one job by one
  stage and returns — never chain multiple stages in a single serverless invocation, since Vercel
  functions have bounded `maxDuration` and ephemeral `/tmp`.
- Per-user OpenAI/ElevenLabs keys entered in Settings are stored **encrypted** (`pgcrypto`) and
  take precedence over the platform-default env vars for that user's jobs.

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
