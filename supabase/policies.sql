-- ContentOS: RLS policies + auth bootstrap trigger.
-- Applied once via: npx prisma db execute --file=supabase/policies.sql
-- Idempotent: safe to re-run (drops/recreates policies and the trigger).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Auto-create a `profiles` row whenever a new Supabase Auth user signs up.
-- The very first user in the system becomes OWNER; everyone after is USER.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, role, "updatedAt")
  values (
    new.id,
    new.email,
    (case when (select count(*) from public.profiles) = 0 then 'OWNER' else 'USER' end)::"Role",
    now()
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Helper: is the current authenticated user OWNER or ADMIN?
-- ---------------------------------------------------------------------------

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('OWNER', 'ADMIN')
  );
$$;

-- ---------------------------------------------------------------------------
-- RLS disabled: single-user personal deployment, no login (see CLAUDE.md).
-- Every `create policy` statement below this point is now inert (a disabled
-- table ignores its policies entirely) — left in place as a historical record
-- rather than deleted, in case multi-user auth is ever reintroduced. The
-- on_auth_user_created trigger and is_admin() helper above are similarly
-- dormant: harmless, since no new auth.users rows will ever be created.
-- ---------------------------------------------------------------------------

alter table public.profiles disable row level security;
alter table public.projects disable row level security;
alter table public.videos disable row level security;
alter table public.processing_jobs disable row level security;
alter table public.transcripts disable row level security;
alter table public.translations disable row level security;
alter table public.narration_assets disable row level security;
alter table public.slide_decks disable row level security;
alter table public.study_video_assets disable row level security;
alter table public.glossaries disable row level security;
alter table public.quizzes disable row level security;
alter table public.quiz_questions disable row level security;
alter table public.flashcards disable row level security;
alter table public.channels disable row level security;
alter table public.playlists disable row level security;
alter table public.video_analyses disable row level security;
alter table public.video_transcripts disable row level security;
alter table public.transcript_segments disable row level security;
alter table public.timeline_segments disable row level security;
alter table public.narrative_analyses disable row level security;
alter table public.visual_scenes disable row level security;
alter table public.audio_metrics disable row level security;
alter table public.channel_analyses disable row level security;
alter table public.viral_dna_profiles disable row level security;
alter table public.viral_dna_scores disable row level security;
alter table public.viral_dna_hypotheses disable row level security;
alter table public.viral_dna_evidence disable row level security;
alter table public.viral_dna_validation_results disable row level security;
alter table public.content_builder_outputs disable row level security;
alter table public.knowledge_base_entries disable row level security;
alter table public.api_usage_logs disable row level security;
alter table public.audit_logs disable row level security;
alter table public.storage_assets disable row level security;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
  for select using (id = auth.uid() or public.is_admin());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (id = auth.uid());

-- ---------------------------------------------------------------------------
-- projects (owner or admin)
-- ---------------------------------------------------------------------------

drop policy if exists "projects_all" on public.projects;
create policy "projects_all" on public.projects
  for all
  using ("ownerId" = auth.uid() or public.is_admin())
  with check ("ownerId" = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------------
-- videos (via project ownership)
-- ---------------------------------------------------------------------------

drop policy if exists "videos_all" on public.videos;
create policy "videos_all" on public.videos
  for all
  using (exists (
    select 1 from public.projects p
    where p.id = videos."projectId" and (p."ownerId" = auth.uid() or public.is_admin())
  ))
  with check (exists (
    select 1 from public.projects p
    where p.id = videos."projectId" and (p."ownerId" = auth.uid() or public.is_admin())
  ));

-- ---------------------------------------------------------------------------
-- Tables scoped via videos.project (1:1 or 1:many child of Video)
-- ---------------------------------------------------------------------------

drop policy if exists "processing_jobs_all" on public.processing_jobs;
create policy "processing_jobs_all" on public.processing_jobs
  for all
  using (
    (processing_jobs."videoId" is not null and exists (
      select 1 from public.videos v join public.projects p on p.id = v."projectId"
      where v.id = processing_jobs."videoId" and (p."ownerId" = auth.uid() or public.is_admin())
    ))
    or
    (processing_jobs."channelId" is not null and exists (
      select 1 from public.channels c join public.projects p on p.id = c."projectId"
      where c.id = processing_jobs."channelId" and (p."ownerId" = auth.uid() or public.is_admin())
    ))
  )
  with check (
    (processing_jobs."videoId" is not null and exists (
      select 1 from public.videos v join public.projects p on p.id = v."projectId"
      where v.id = processing_jobs."videoId" and (p."ownerId" = auth.uid() or public.is_admin())
    ))
    or
    (processing_jobs."channelId" is not null and exists (
      select 1 from public.channels c join public.projects p on p.id = c."projectId"
      where c.id = processing_jobs."channelId" and (p."ownerId" = auth.uid() or public.is_admin())
    ))
  );

drop policy if exists "transcripts_all" on public.transcripts;
create policy "transcripts_all" on public.transcripts
  for all
  using (exists (
    select 1 from public.videos v join public.projects p on p.id = v."projectId"
    where v.id = transcripts."videoId" and (p."ownerId" = auth.uid() or public.is_admin())
  ))
  with check (exists (
    select 1 from public.videos v join public.projects p on p.id = v."projectId"
    where v.id = transcripts."videoId" and (p."ownerId" = auth.uid() or public.is_admin())
  ));

drop policy if exists "translations_all" on public.translations;
create policy "translations_all" on public.translations
  for all
  using (exists (
    select 1 from public.videos v join public.projects p on p.id = v."projectId"
    where v.id = translations."videoId" and (p."ownerId" = auth.uid() or public.is_admin())
  ))
  with check (exists (
    select 1 from public.videos v join public.projects p on p.id = v."projectId"
    where v.id = translations."videoId" and (p."ownerId" = auth.uid() or public.is_admin())
  ));

drop policy if exists "narration_assets_all" on public.narration_assets;
create policy "narration_assets_all" on public.narration_assets
  for all
  using (exists (
    select 1 from public.videos v join public.projects p on p.id = v."projectId"
    where v.id = narration_assets."videoId" and (p."ownerId" = auth.uid() or public.is_admin())
  ))
  with check (exists (
    select 1 from public.videos v join public.projects p on p.id = v."projectId"
    where v.id = narration_assets."videoId" and (p."ownerId" = auth.uid() or public.is_admin())
  ));

drop policy if exists "slide_decks_all" on public.slide_decks;
create policy "slide_decks_all" on public.slide_decks
  for all
  using (exists (
    select 1 from public.videos v join public.projects p on p.id = v."projectId"
    where v.id = slide_decks."videoId" and (p."ownerId" = auth.uid() or public.is_admin())
  ))
  with check (exists (
    select 1 from public.videos v join public.projects p on p.id = v."projectId"
    where v.id = slide_decks."videoId" and (p."ownerId" = auth.uid() or public.is_admin())
  ));

drop policy if exists "study_video_assets_all" on public.study_video_assets;
create policy "study_video_assets_all" on public.study_video_assets
  for all
  using (exists (
    select 1 from public.videos v join public.projects p on p.id = v."projectId"
    where v.id = study_video_assets."videoId" and (p."ownerId" = auth.uid() or public.is_admin())
  ))
  with check (exists (
    select 1 from public.videos v join public.projects p on p.id = v."projectId"
    where v.id = study_video_assets."videoId" and (p."ownerId" = auth.uid() or public.is_admin())
  ));

drop policy if exists "glossaries_all" on public.glossaries;
create policy "glossaries_all" on public.glossaries
  for all
  using (exists (
    select 1 from public.videos v join public.projects p on p.id = v."projectId"
    where v.id = glossaries."videoId" and (p."ownerId" = auth.uid() or public.is_admin())
  ))
  with check (exists (
    select 1 from public.videos v join public.projects p on p.id = v."projectId"
    where v.id = glossaries."videoId" and (p."ownerId" = auth.uid() or public.is_admin())
  ));

drop policy if exists "quizzes_all" on public.quizzes;
create policy "quizzes_all" on public.quizzes
  for all
  using (exists (
    select 1 from public.videos v join public.projects p on p.id = v."projectId"
    where v.id = quizzes."videoId" and (p."ownerId" = auth.uid() or public.is_admin())
  ))
  with check (exists (
    select 1 from public.videos v join public.projects p on p.id = v."projectId"
    where v.id = quizzes."videoId" and (p."ownerId" = auth.uid() or public.is_admin())
  ));

drop policy if exists "quiz_questions_all" on public.quiz_questions;
create policy "quiz_questions_all" on public.quiz_questions
  for all
  using (exists (
    select 1 from public.quizzes q
    join public.videos v on v.id = q."videoId"
    join public.projects p on p.id = v."projectId"
    where q.id = quiz_questions."quizId" and (p."ownerId" = auth.uid() or public.is_admin())
  ))
  with check (exists (
    select 1 from public.quizzes q
    join public.videos v on v.id = q."videoId"
    join public.projects p on p.id = v."projectId"
    where q.id = quiz_questions."quizId" and (p."ownerId" = auth.uid() or public.is_admin())
  ));

drop policy if exists "flashcards_all" on public.flashcards;
create policy "flashcards_all" on public.flashcards
  for all
  using (exists (
    select 1 from public.videos v join public.projects p on p.id = v."projectId"
    where v.id = flashcards."videoId" and (p."ownerId" = auth.uid() or public.is_admin())
  ))
  with check (exists (
    select 1 from public.videos v join public.projects p on p.id = v."projectId"
    where v.id = flashcards."videoId" and (p."ownerId" = auth.uid() or public.is_admin())
  ));

-- ---------------------------------------------------------------------------
-- Reverse Engineering / Content Builder / Knowledge Base (via project)
-- ---------------------------------------------------------------------------

drop policy if exists "channels_all" on public.channels;
create policy "channels_all" on public.channels
  for all
  using (exists (
    select 1 from public.projects p
    where p.id = channels."projectId" and (p."ownerId" = auth.uid() or public.is_admin())
  ))
  with check (exists (
    select 1 from public.projects p
    where p.id = channels."projectId" and (p."ownerId" = auth.uid() or public.is_admin())
  ));

drop policy if exists "playlists_all" on public.playlists;
create policy "playlists_all" on public.playlists
  for all
  using (exists (
    select 1 from public.channels c join public.projects p on p.id = c."projectId"
    where c.id = playlists."channelId" and (p."ownerId" = auth.uid() or public.is_admin())
  ))
  with check (exists (
    select 1 from public.channels c join public.projects p on p.id = c."projectId"
    where c.id = playlists."channelId" and (p."ownerId" = auth.uid() or public.is_admin())
  ));

-- ---------------------------------------------------------------------------
-- Video Reverse Engineering Engine (Phase 2) — all scoped via videos.project
-- ---------------------------------------------------------------------------

drop policy if exists "video_analyses_all" on public.video_analyses;
create policy "video_analyses_all" on public.video_analyses
  for all
  using (exists (
    select 1 from public.videos v join public.projects p on p.id = v."projectId"
    where v.id = video_analyses."videoId" and (p."ownerId" = auth.uid() or public.is_admin())
  ))
  with check (exists (
    select 1 from public.videos v join public.projects p on p.id = v."projectId"
    where v.id = video_analyses."videoId" and (p."ownerId" = auth.uid() or public.is_admin())
  ));

drop policy if exists "video_transcripts_all" on public.video_transcripts;
create policy "video_transcripts_all" on public.video_transcripts
  for all
  using (exists (
    select 1 from public.videos v join public.projects p on p.id = v."projectId"
    where v.id = video_transcripts."videoId" and (p."ownerId" = auth.uid() or public.is_admin())
  ))
  with check (exists (
    select 1 from public.videos v join public.projects p on p.id = v."projectId"
    where v.id = video_transcripts."videoId" and (p."ownerId" = auth.uid() or public.is_admin())
  ));

drop policy if exists "transcript_segments_all" on public.transcript_segments;
create policy "transcript_segments_all" on public.transcript_segments
  for all
  using (exists (
    select 1 from public.video_transcripts t
    join public.videos v on v.id = t."videoId"
    join public.projects p on p.id = v."projectId"
    where t.id = transcript_segments."transcriptId" and (p."ownerId" = auth.uid() or public.is_admin())
  ))
  with check (exists (
    select 1 from public.video_transcripts t
    join public.videos v on v.id = t."videoId"
    join public.projects p on p.id = v."projectId"
    where t.id = transcript_segments."transcriptId" and (p."ownerId" = auth.uid() or public.is_admin())
  ));

drop policy if exists "timeline_segments_all" on public.timeline_segments;
create policy "timeline_segments_all" on public.timeline_segments
  for all
  using (exists (
    select 1 from public.videos v join public.projects p on p.id = v."projectId"
    where v.id = timeline_segments."videoId" and (p."ownerId" = auth.uid() or public.is_admin())
  ))
  with check (exists (
    select 1 from public.videos v join public.projects p on p.id = v."projectId"
    where v.id = timeline_segments."videoId" and (p."ownerId" = auth.uid() or public.is_admin())
  ));

drop policy if exists "narrative_analyses_all" on public.narrative_analyses;
create policy "narrative_analyses_all" on public.narrative_analyses
  for all
  using (exists (
    select 1 from public.videos v join public.projects p on p.id = v."projectId"
    where v.id = narrative_analyses."videoId" and (p."ownerId" = auth.uid() or public.is_admin())
  ))
  with check (exists (
    select 1 from public.videos v join public.projects p on p.id = v."projectId"
    where v.id = narrative_analyses."videoId" and (p."ownerId" = auth.uid() or public.is_admin())
  ));

drop policy if exists "visual_scenes_all" on public.visual_scenes;
create policy "visual_scenes_all" on public.visual_scenes
  for all
  using (exists (
    select 1 from public.videos v join public.projects p on p.id = v."projectId"
    where v.id = visual_scenes."videoId" and (p."ownerId" = auth.uid() or public.is_admin())
  ))
  with check (exists (
    select 1 from public.videos v join public.projects p on p.id = v."projectId"
    where v.id = visual_scenes."videoId" and (p."ownerId" = auth.uid() or public.is_admin())
  ));

drop policy if exists "audio_metrics_all" on public.audio_metrics;
create policy "audio_metrics_all" on public.audio_metrics
  for all
  using (exists (
    select 1 from public.videos v join public.projects p on p.id = v."projectId"
    where v.id = audio_metrics."videoId" and (p."ownerId" = auth.uid() or public.is_admin())
  ))
  with check (exists (
    select 1 from public.videos v join public.projects p on p.id = v."projectId"
    where v.id = audio_metrics."videoId" and (p."ownerId" = auth.uid() or public.is_admin())
  ));

drop policy if exists "channel_analyses_all" on public.channel_analyses;
create policy "channel_analyses_all" on public.channel_analyses
  for all
  using (exists (
    select 1 from public.projects p
    where p.id = channel_analyses."projectId" and (p."ownerId" = auth.uid() or public.is_admin())
  ))
  with check (exists (
    select 1 from public.projects p
    where p.id = channel_analyses."projectId" and (p."ownerId" = auth.uid() or public.is_admin())
  ));

-- ---------------------------------------------------------------------------
-- Viral DNA Engine (Phase 3) — viral_dna_profiles scoped via videos.project;
-- the 4 child tables scoped through viral_dna_profiles.videoId in turn.
-- ---------------------------------------------------------------------------

drop policy if exists "viral_dna_profiles_all" on public.viral_dna_profiles;
create policy "viral_dna_profiles_all" on public.viral_dna_profiles
  for all
  using (exists (
    select 1 from public.videos v join public.projects p on p.id = v."projectId"
    where v.id = viral_dna_profiles."videoId" and (p."ownerId" = auth.uid() or public.is_admin())
  ))
  with check (exists (
    select 1 from public.videos v join public.projects p on p.id = v."projectId"
    where v.id = viral_dna_profiles."videoId" and (p."ownerId" = auth.uid() or public.is_admin())
  ));

drop policy if exists "viral_dna_scores_all" on public.viral_dna_scores;
create policy "viral_dna_scores_all" on public.viral_dna_scores
  for all
  using (exists (
    select 1 from public.viral_dna_profiles vdp
    join public.videos v on v.id = vdp."videoId"
    join public.projects p on p.id = v."projectId"
    where vdp.id = viral_dna_scores."profileId" and (p."ownerId" = auth.uid() or public.is_admin())
  ))
  with check (exists (
    select 1 from public.viral_dna_profiles vdp
    join public.videos v on v.id = vdp."videoId"
    join public.projects p on p.id = v."projectId"
    where vdp.id = viral_dna_scores."profileId" and (p."ownerId" = auth.uid() or public.is_admin())
  ));

drop policy if exists "viral_dna_hypotheses_all" on public.viral_dna_hypotheses;
create policy "viral_dna_hypotheses_all" on public.viral_dna_hypotheses
  for all
  using (exists (
    select 1 from public.viral_dna_profiles vdp
    join public.videos v on v.id = vdp."videoId"
    join public.projects p on p.id = v."projectId"
    where vdp.id = viral_dna_hypotheses."profileId" and (p."ownerId" = auth.uid() or public.is_admin())
  ))
  with check (exists (
    select 1 from public.viral_dna_profiles vdp
    join public.videos v on v.id = vdp."videoId"
    join public.projects p on p.id = v."projectId"
    where vdp.id = viral_dna_hypotheses."profileId" and (p."ownerId" = auth.uid() or public.is_admin())
  ));

drop policy if exists "viral_dna_evidence_all" on public.viral_dna_evidence;
create policy "viral_dna_evidence_all" on public.viral_dna_evidence
  for all
  using (exists (
    select 1 from public.viral_dna_profiles vdp
    join public.videos v on v.id = vdp."videoId"
    join public.projects p on p.id = v."projectId"
    where vdp.id = viral_dna_evidence."profileId" and (p."ownerId" = auth.uid() or public.is_admin())
  ))
  with check (exists (
    select 1 from public.viral_dna_profiles vdp
    join public.videos v on v.id = vdp."videoId"
    join public.projects p on p.id = v."projectId"
    where vdp.id = viral_dna_evidence."profileId" and (p."ownerId" = auth.uid() or public.is_admin())
  ));

drop policy if exists "viral_dna_validation_results_all" on public.viral_dna_validation_results;
create policy "viral_dna_validation_results_all" on public.viral_dna_validation_results
  for all
  using (exists (
    select 1 from public.viral_dna_profiles vdp
    join public.videos v on v.id = vdp."videoId"
    join public.projects p on p.id = v."projectId"
    where vdp.id = viral_dna_validation_results."profileId" and (p."ownerId" = auth.uid() or public.is_admin())
  ))
  with check (exists (
    select 1 from public.viral_dna_profiles vdp
    join public.videos v on v.id = vdp."videoId"
    join public.projects p on p.id = v."projectId"
    where vdp.id = viral_dna_validation_results."profileId" and (p."ownerId" = auth.uid() or public.is_admin())
  ));

drop policy if exists "content_builder_outputs_all" on public.content_builder_outputs;
create policy "content_builder_outputs_all" on public.content_builder_outputs
  for all
  using (exists (
    select 1 from public.projects p
    where p.id = content_builder_outputs."projectId" and (p."ownerId" = auth.uid() or public.is_admin())
  ))
  with check (exists (
    select 1 from public.projects p
    where p.id = content_builder_outputs."projectId" and (p."ownerId" = auth.uid() or public.is_admin())
  ));

drop policy if exists "knowledge_base_entries_all" on public.knowledge_base_entries;
create policy "knowledge_base_entries_all" on public.knowledge_base_entries
  for all
  using (exists (
    select 1 from public.projects p
    where p.id = knowledge_base_entries."projectId" and (p."ownerId" = auth.uid() or public.is_admin())
  ))
  with check (exists (
    select 1 from public.projects p
    where p.id = knowledge_base_entries."projectId" and (p."ownerId" = auth.uid() or public.is_admin())
  ));

-- ---------------------------------------------------------------------------
-- Observability / cost (own rows, or admin sees all)
-- ---------------------------------------------------------------------------

drop policy if exists "api_usage_logs_select" on public.api_usage_logs;
create policy "api_usage_logs_select" on public.api_usage_logs
  for select using ("profileId" = auth.uid() or public.is_admin());

drop policy if exists "audit_logs_select_admin" on public.audit_logs;
create policy "audit_logs_select_admin" on public.audit_logs
  for select using (public.is_admin());

drop policy if exists "storage_assets_all" on public.storage_assets;
create policy "storage_assets_all" on public.storage_assets
  for all
  using (
    public.is_admin()
    or ("projectId" is not null and exists (
      select 1 from public.projects p where p.id = storage_assets."projectId" and p."ownerId" = auth.uid()
    ))
    or ("videoId" is not null and exists (
      select 1 from public.videos v join public.projects p on p.id = v."projectId"
      where v.id = storage_assets."videoId" and p."ownerId" = auth.uid()
    ))
  )
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Storage: private buckets, owner-prefixed paths (`<uid>/...`)
-- ---------------------------------------------------------------------------

drop policy if exists "storage_owner_select" on storage.objects;
create policy "storage_owner_select" on storage.objects
  for select using (
    bucket_id in ('videos','audio','slides','exports','images','documents','generated','thumbnails')
    and (auth.uid()::text = (storage.foldername(name))[1] or public.is_admin())
  );

drop policy if exists "storage_owner_insert" on storage.objects;
create policy "storage_owner_insert" on storage.objects
  for insert with check (
    bucket_id in ('videos','audio','slides','exports','images','documents','generated','thumbnails')
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "storage_owner_update" on storage.objects;
create policy "storage_owner_update" on storage.objects
  for update using (
    bucket_id in ('videos','audio','slides','exports','images','documents','generated','thumbnails')
    and (auth.uid()::text = (storage.foldername(name))[1] or public.is_admin())
  );

drop policy if exists "storage_owner_delete" on storage.objects;
create policy "storage_owner_delete" on storage.objects
  for delete using (
    bucket_id in ('videos','audio','slides','exports','images','documents','generated','thumbnails')
    and (auth.uid()::text = (storage.foldername(name))[1] or public.is_admin())
  );
