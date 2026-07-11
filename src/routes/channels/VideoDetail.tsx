import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  BarChart,
  Bar,
  CartesianGrid,
} from 'recharts'
import { supabase } from '../../lib/supabaseClient'
import Tabs from '../../components/ui/Tabs'

interface VideoRow {
  id: string
  title: string | null
  thumbnailUrl: string | null
  durationSec: number | null
  status: string
  channelId: string | null
  views: number | null
  likes: number | null
  comments: number | null
  outlierScore: number | null
  outlierClass: string | null
}
interface VideoAnalysisRow {
  readyForViralDnaAt: string | null
  fileSizeBytes: number | null
  downloadDurationMs: number | null
}
interface TranscriptRow {
  rawText: string
  wordsPerMinute: number | null
  language: string | null
}
interface TimelineSegmentRow {
  id: string
  index: number
  type: string
  startSec: number
  endSec: number
  text: string
}
interface NarrativeRow {
  hookType: string | null
  hookDurationSec: number | null
  narrativePattern: string | null
  openLoopCount: number | null
  payoffCount: number | null
  evidence: string | null
}
interface VisualSceneRow {
  index: number
  startSec: number
  endSec: number
  category: string
  motion: string
  description: string | null
}
interface AudioMetricRow {
  averagePaceWpm: number | null
  pauseCount: number | null
  silenceRatio: number | null
  sceneSyncScore: number | null
  energyCurve: { t: number; meanVolumeDb: number }[] | null
}
interface ViralDnaProfileRow {
  id: string
  profileVersion: number
  status: string
  isCurrent: boolean
  generatedAt: string
  overallConfidenceScore: number | null
  overallRetentionScore: number | null
  primaryHookType: string | null
  primaryNarrativePattern: string | null
  hook: Record<string, unknown> | null
  narrative: Record<string, unknown> | null
  retention: Record<string, unknown> | null
  visual: Record<string, unknown> | null
  audio: Record<string, unknown> | null
  emotion: Record<string, unknown> | null
  informationDensity: Record<string, unknown> | null
  performance: Record<string, unknown> | null
  warnings: string[] | null
  limitations: string[] | null
  notes: string | null
}
interface ScoreRow {
  scoreName: string
  value: number
}
interface HypothesisRow {
  id: string
  statement: string
  hypothesisType: string
  confidence: number | null
  status: string
  supportingEvidence: string[] | null
}
interface EvidenceRow {
  id: string
  evidenceId: string
  sourceType: string
  timestampStart: number | null
  timestampEnd: number | null
  transcriptExcerpt: string | null
  explanation: string | null
}
interface ViralDnaJob {
  id: string
  stage: string
  status: string
  attempts: number
  lastError: string | null
  createdAt: string
}

type MainTab = 'overview' | 'viralDna'
type OverviewSubTab = 'transcript' | 'timeline' | 'narrative' | 'visual' | 'audio'
type VdnaSubTab = 'summary' | 'scorecard' | 'hypotheses' | 'evidence' | 'versions' | 'raw'

async function authedFetch(path: string, init: RequestInit = {}) {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  return fetch(path, {
    ...init,
    headers: { ...init.headers, 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
  })
}

function formatDuration(sec: number | null): string {
  if (sec == null) return '—'
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}
function pct(n: number | null | undefined): string {
  return n == null ? '—' : `${Math.round(n * 100)}%`
}

export default function VideoDetail() {
  const { t } = useTranslation()
  const { channelId, videoId } = useParams<{ channelId: string; videoId: string }>()
  const navigate = useNavigate()

  const [video, setVideo] = useState<VideoRow | null>(null)
  const [videoAnalysis, setVideoAnalysis] = useState<VideoAnalysisRow | null>(null)
  const [transcript, setTranscript] = useState<TranscriptRow | null>(null)
  const [timelineSegments, setTimelineSegments] = useState<TimelineSegmentRow[]>([])
  const [narrative, setNarrative] = useState<NarrativeRow | null>(null)
  const [visualScenes, setVisualScenes] = useState<VisualSceneRow[]>([])
  const [audioMetric, setAudioMetric] = useState<AudioMetricRow | null>(null)

  const [profiles, setProfiles] = useState<ViralDnaProfileRow[]>([])
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null)
  const [scores, setScores] = useState<ScoreRow[]>([])
  const [hypotheses, setHypotheses] = useState<HypothesisRow[]>([])
  const [evidence, setEvidence] = useState<EvidenceRow[]>([])
  const [jobs, setJobs] = useState<ViralDnaJob[]>([])

  const [mainTab, setMainTab] = useState<MainTab>('overview')
  const [overviewTab, setOverviewTab] = useState<OverviewSubTab>('transcript')
  const [vdnaTab, setVdnaTab] = useState<VdnaSubTab>('summary')
  const [generating, setGenerating] = useState(false)
  const [rejectedIds, setRejectedIds] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    if (!videoId) return
    const [{ data: v }, { data: va }, { data: tr }, { data: ts }, { data: na }, { data: vs }, { data: am }, { data: vdp }] =
      await Promise.all([
        supabase.from('videos').select('id, title, thumbnailUrl, durationSec, status, channelId, views, likes, comments, outlierScore, outlierClass').eq('id', videoId).single(),
        supabase.from('video_analyses').select('readyForViralDnaAt, fileSizeBytes, downloadDurationMs').eq('videoId', videoId).maybeSingle(),
        supabase.from('video_transcripts').select('rawText, wordsPerMinute, language').eq('videoId', videoId).maybeSingle(),
        supabase.from('timeline_segments').select('id, index, type, startSec, endSec, text').eq('videoId', videoId).order('index'),
        supabase.from('narrative_analyses').select('hookType, hookDurationSec, narrativePattern, openLoopCount, payoffCount, evidence').eq('videoId', videoId).maybeSingle(),
        supabase.from('visual_scenes').select('index, startSec, endSec, category, motion, description').eq('videoId', videoId).order('index'),
        supabase.from('audio_metrics').select('averagePaceWpm, pauseCount, silenceRatio, sceneSyncScore, energyCurve').eq('videoId', videoId).maybeSingle(),
        supabase.from('viral_dna_profiles').select('id, profileVersion, status, isCurrent, generatedAt, overallConfidenceScore, overallRetentionScore, primaryHookType, primaryNarrativePattern, hook, narrative, retention, visual, audio, emotion, informationDensity, performance, warnings, limitations, notes').eq('videoId', videoId).order('profileVersion', { ascending: false }),
      ])
    setVideo(v as VideoRow)
    setVideoAnalysis(va as VideoAnalysisRow | null)
    setTranscript(tr as TranscriptRow | null)
    setTimelineSegments((ts as TimelineSegmentRow[]) ?? [])
    setNarrative(na as NarrativeRow | null)
    setVisualScenes((vs as VisualSceneRow[]) ?? [])
    setAudioMetric(am as AudioMetricRow | null)
    setProfiles((vdp as ViralDnaProfileRow[]) ?? [])
  }, [videoId])

  useEffect(() => {
    load()
    if (!videoId) return
    const ch = supabase
      .channel(`video-${videoId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'processing_jobs', filter: `videoId=eq.${videoId}` }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'viral_dna_profiles', filter: `videoId=eq.${videoId}` }, () => load())
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [videoId, load])

  const currentProfile = useMemo(() => {
    if (profiles.length === 0) return null
    if (selectedVersion !== null) return profiles.find((p) => p.profileVersion === selectedVersion) ?? profiles[0]
    return profiles.find((p) => p.isCurrent) ?? profiles[0]
  }, [profiles, selectedVersion])

  useEffect(() => {
    if (!currentProfile) {
      setScores([])
      setHypotheses([])
      setEvidence([])
      return
    }
    Promise.all([
      supabase.from('viral_dna_scores').select('scoreName, value').eq('profileId', currentProfile.id),
      supabase.from('viral_dna_hypotheses').select('id, statement, hypothesisType, confidence, status, supportingEvidence').eq('profileId', currentProfile.id),
      supabase.from('viral_dna_evidence').select('id, evidenceId, sourceType, timestampStart, timestampEnd, transcriptExcerpt, explanation').eq('profileId', currentProfile.id),
    ]).then(([{ data: sc }, { data: hy }, { data: ev }]) => {
      setScores((sc as ScoreRow[]) ?? [])
      setHypotheses((hy as HypothesisRow[]) ?? [])
      setEvidence((ev as EvidenceRow[]) ?? [])
    })
  }, [currentProfile])

  useEffect(() => {
    if (!videoId) return
    supabase
      .from('processing_jobs')
      .select('id, stage, status, attempts, lastError, createdAt')
      .eq('videoId', videoId)
      .eq('pipeline', 'VIRAL_DNA')
      .order('createdAt', { ascending: true })
      .then(({ data }) => setJobs((data as ViralDnaJob[]) ?? []))
  }, [videoId, currentProfile])

  const activeJob = jobs.find((j) => j.status === 'PENDING' || j.status === 'RUNNING')
  const failedJob = jobs.find((j) => j.status === 'FAILED')

  const runToCompletion = useCallback(
    async (jobId: string) => {
      setGenerating(true)
      let currentJobId: string | null = jobId
      for (let i = 0; i < 20 && currentJobId; i++) {
        const res = await authedFetch('/api/viralDna/worker', { method: 'POST', body: JSON.stringify({ jobId: currentJobId }) })
        const result = await res.json()
        if (result.outcome === 'failed' || !result.outcome) break
        const { data: next } = await supabase
          .from('processing_jobs')
          .select('id')
          .eq('videoId', videoId)
          .eq('pipeline', 'VIRAL_DNA')
          .eq('status', 'PENDING')
          .order('createdAt', { ascending: false })
          .maybeSingle()
        currentJobId = next?.id ?? null
      }
      setGenerating(false)
      await load()
    },
    [videoId, load],
  )

  async function generate() {
    setGenerating(true)
    const res = await authedFetch('/api/viralDna/select', { method: 'POST', body: JSON.stringify({ videoId }) })
    const data = await res.json()
    if (!res.ok) {
      alert(data.error ?? 'Failed to start generation')
      setGenerating(false)
      return
    }
    await runToCompletion(data.job.id)
  }

  async function retry() {
    if (!failedJob) return
    await authedFetch('/api/viralDna/retry', { method: 'POST', body: JSON.stringify({ jobId: failedJob.id }) })
    await runToCompletion(failedJob.id)
  }

  async function approve() {
    if (!currentProfile) return
    await authedFetch('/api/viralDna/approve', { method: 'POST', body: JSON.stringify({ profileId: currentProfile.id }) })
    await load()
  }

  async function saveEdit() {
    if (!currentProfile) return
    const res = await authedFetch('/api/viralDna/edit', {
      method: 'POST',
      body: JSON.stringify({ videoId, edits: { rejectedHypothesisIds: [...rejectedIds] } }),
    })
    if (res.ok) {
      setRejectedIds(new Set())
      setSelectedVersion(null)
      await load()
    }
  }

  async function exportJson() {
    if (!currentProfile) return
    const res = await authedFetch(`/api/viralDna/export?videoId=${videoId}&version=${currentProfile.profileVersion}`)
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `viral-dna-${videoId}-v${currentProfile.profileVersion}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (!video) return null

  const overviewTabs: { id: OverviewSubTab; label: string }[] = [
    { id: 'transcript', label: t('videoDetail.overview.transcript') },
    { id: 'timeline', label: t('videoDetail.overview.timeline') },
    { id: 'narrative', label: t('videoDetail.overview.narrative') },
    { id: 'visual', label: t('videoDetail.overview.visual') },
    { id: 'audio', label: t('videoDetail.overview.audio') },
  ]
  const vdnaTabs: { id: VdnaSubTab; label: string }[] = [
    { id: 'summary', label: t('videoDetail.viralDna.summary') },
    { id: 'scorecard', label: t('videoDetail.viralDna.scorecard') },
    { id: 'hypotheses', label: t('videoDetail.viralDna.hypotheses') },
    { id: 'evidence', label: t('videoDetail.viralDna.evidence') },
    { id: 'versions', label: t('videoDetail.viralDna.versions') },
    { id: 'raw', label: t('videoDetail.viralDna.raw') },
  ]

  const emotionCurve = (currentProfile?.emotion as { curve?: { normalizedPosition: number; intensity: number; dominantEmotion: string }[] } | null)?.curve ?? []

  return (
    <div>
      <button
        onClick={() => navigate(`/channels/${channelId}`)}
        className="mb-3 text-sm text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
      >
        ← {t('videoDetail.backToChannel')}
      </button>
      <div className="mb-1 flex items-center gap-3">
        {video.thumbnailUrl && <img src={video.thumbnailUrl} alt="" className="h-10 w-16 rounded object-cover" />}
        <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">{video.title ?? '—'}</h1>
      </div>
      <p className="mb-6 text-sm text-neutral-500 dark:text-neutral-400">
        {formatDuration(video.durationSec)} · {video.status}
        {video.outlierScore != null ? ` · outlier ${video.outlierScore.toFixed(2)} (${video.outlierClass})` : ''}
      </p>

      <Tabs tabs={[{ id: 'overview' as MainTab, label: t('videoDetail.tabs.overview') }, { id: 'viralDna' as MainTab, label: t('videoDetail.tabs.viralDna') }]} active={mainTab} onChange={setMainTab} />

      {mainTab === 'overview' && (
        <div>
          <Tabs tabs={overviewTabs} active={overviewTab} onChange={setOverviewTab} />
          {overviewTab === 'transcript' && (
            <div>
              <p className="mb-2 text-sm text-neutral-500 dark:text-neutral-400">
                {transcript?.wordsPerMinute ? `${Math.round(transcript.wordsPerMinute)} wpm` : '—'} · {transcript?.language ?? '—'}
              </p>
              <p className="max-h-96 overflow-y-auto whitespace-pre-wrap rounded-lg border border-neutral-200 p-4 text-sm text-neutral-700 dark:border-neutral-800 dark:text-neutral-300">
                {transcript?.rawText ?? t('videoDetail.notAvailable')}
              </p>
            </div>
          )}
          {overviewTab === 'timeline' && (
            <div className="flex flex-col gap-1">
              {timelineSegments.map((s) => (
                <div key={s.id} className="rounded-md border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800">
                  <span className="mr-2 font-mono text-xs text-neutral-500 dark:text-neutral-400">
                    {formatDuration(s.startSec)}-{formatDuration(s.endSec)}
                  </span>
                  <span className="mr-2 rounded bg-neutral-100 px-1.5 py-0.5 text-xs dark:bg-neutral-900">{s.type}</span>
                  <span className="text-neutral-700 dark:text-neutral-300">{s.text}</span>
                </div>
              ))}
              {timelineSegments.length === 0 && <p className="text-sm text-neutral-500 dark:text-neutral-400">{t('videoDetail.notAvailable')}</p>}
            </div>
          )}
          {overviewTab === 'narrative' && narrative && (
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><span className="text-neutral-500 dark:text-neutral-400">{t('videoDetail.overview.hookType')}: </span>{narrative.hookType ?? '—'}</div>
              <div><span className="text-neutral-500 dark:text-neutral-400">{t('videoDetail.overview.narrativePattern')}: </span>{narrative.narrativePattern ?? '—'}</div>
              <div><span className="text-neutral-500 dark:text-neutral-400">{t('videoDetail.overview.openLoops')}: </span>{narrative.openLoopCount ?? '—'}</div>
              <div><span className="text-neutral-500 dark:text-neutral-400">{t('videoDetail.overview.payoffs')}: </span>{narrative.payoffCount ?? '—'}</div>
              {narrative.evidence && <div className="col-span-2 text-neutral-600 dark:text-neutral-400">"{narrative.evidence}"</div>}
            </div>
          )}
          {overviewTab === 'visual' && (
            <div className="flex flex-col gap-1">
              {visualScenes.map((s) => (
                <div key={s.index} className="rounded-md border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800">
                  <span className="mr-2 font-mono text-xs text-neutral-500 dark:text-neutral-400">{formatDuration(s.startSec)}</span>
                  <span className="mr-2 rounded bg-neutral-100 px-1.5 py-0.5 text-xs dark:bg-neutral-900">{s.category}/{s.motion}</span>
                  <span className="text-neutral-700 dark:text-neutral-300">{s.description ?? ''}</span>
                </div>
              ))}
              {visualScenes.length === 0 && <p className="text-sm text-neutral-500 dark:text-neutral-400">{t('videoDetail.notAvailable')}</p>}
            </div>
          )}
          {overviewTab === 'audio' && audioMetric && (
            <div>
              <div className="mb-4 grid grid-cols-4 gap-4 text-sm">
                <div><span className="text-neutral-500 dark:text-neutral-400">{t('videoDetail.overview.pace')}: </span>{audioMetric.averagePaceWpm ? Math.round(audioMetric.averagePaceWpm) : '—'} wpm</div>
                <div><span className="text-neutral-500 dark:text-neutral-400">{t('videoDetail.overview.pauses')}: </span>{audioMetric.pauseCount ?? '—'}</div>
                <div><span className="text-neutral-500 dark:text-neutral-400">{t('videoDetail.overview.silenceRatio')}: </span>{pct(audioMetric.silenceRatio)}</div>
                <div><span className="text-neutral-500 dark:text-neutral-400">{t('videoDetail.overview.sceneSync')}: </span>{pct(audioMetric.sceneSyncScore)}</div>
              </div>
              {audioMetric.energyCurve && (
                <ResponsiveContainer width="100%" height={160}>
                  <LineChart data={audioMetric.energyCurve}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-neutral-200 dark:stroke-neutral-800" />
                    <XAxis dataKey="t" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Line type="monotone" dataKey="meanVolumeDb" stroke="#525252" dot={false} strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          )}
        </div>
      )}

      {mainTab === 'viralDna' && (
        <div>
          {!videoAnalysis?.readyForViralDnaAt && (
            <p className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
              {t('videoDetail.viralDna.needsAnalysis')}
            </p>
          )}
          {videoAnalysis?.readyForViralDnaAt && !currentProfile && (
            <button
              onClick={generate}
              disabled={generating || !!activeJob}
              className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
            >
              {generating || activeJob ? t('videoDetail.viralDna.generating') : t('videoDetail.viralDna.generate')}
            </button>
          )}
          {failedJob && (
            <div className="mt-3 flex items-center gap-2">
              <p className="text-sm text-red-600 dark:text-red-400">{failedJob.lastError}</p>
              <button onClick={retry} className="rounded-md border border-red-300 px-3 py-1 text-xs font-medium text-red-600 dark:border-red-700 dark:text-red-400">
                {t('videoDetail.viralDna.retry')}
              </button>
            </div>
          )}

          {currentProfile && (
            <div className="mt-4">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-3 text-sm">
                  <span className="rounded-full bg-neutral-100 px-2 py-1 text-xs font-medium dark:bg-neutral-900">
                    {t('videoDetail.viralDna.version')} {currentProfile.profileVersion}
                  </span>
                  <span className="rounded-full bg-neutral-100 px-2 py-1 text-xs font-medium dark:bg-neutral-900">{currentProfile.status}</span>
                  <span className="text-neutral-500 dark:text-neutral-400">
                    {t('videoDetail.viralDna.confidence')}: {pct(currentProfile.overallConfidenceScore)}
                  </span>
                </div>
                <div className="flex gap-2">
                  <button onClick={exportJson} className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 dark:border-neutral-700 dark:text-neutral-300">
                    {t('videoDetail.viralDna.export')}
                  </button>
                  {currentProfile.status === 'VALIDATED' && (
                    <button onClick={approve} className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white dark:bg-neutral-100 dark:text-neutral-900">
                      {t('videoDetail.viralDna.approve')}
                    </button>
                  )}
                </div>
              </div>

              {currentProfile.warnings && currentProfile.warnings.length > 0 && (
                <ul className="mb-4 list-inside list-disc rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
                  {currentProfile.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              )}

              <Tabs tabs={vdnaTabs} active={vdnaTab} onChange={setVdnaTab} />

              {vdnaTab === 'summary' && (
                <div className="flex flex-col gap-6">
                  <section>
                    <h3 className="mb-2 text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">{t('videoDetail.viralDna.hook')}</h3>
                    <p className="text-sm text-neutral-700 dark:text-neutral-300">
                      {(currentProfile.hook?.primaryType as string) ?? '—'} · {formatDuration(currentProfile.hook?.durationSeconds as number)} ({pct(currentProfile.hook?.durationPercentage as number)})
                    </p>
                    <p className="text-sm text-neutral-500 dark:text-neutral-400">{(currentProfile.hook?.centralPromise as string) ?? ''}</p>
                  </section>
                  <section>
                    <h3 className="mb-2 text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">{t('videoDetail.viralDna.narrative')}</h3>
                    <p className="text-sm text-neutral-700 dark:text-neutral-300">
                      {(currentProfile.narrative?.primaryNarrativePattern as string) ?? '—'} · {(currentProfile.narrative?.segmentCount as number) ?? 0} segments
                    </p>
                  </section>
                  <section>
                    <h3 className="mb-2 text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">{t('videoDetail.viralDna.retention')}</h3>
                    <p className="text-sm text-neutral-700 dark:text-neutral-300">
                      {t('videoDetail.viralDna.openLoopResolution')}: {pct(currentProfile.retention?.openLoopResolutionRate as number)}
                    </p>
                  </section>
                  <section>
                    <h3 className="mb-2 text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">{t('videoDetail.viralDna.visual')}</h3>
                    <p className="text-sm text-neutral-700 dark:text-neutral-300">{(currentProfile.visual?.representativeStyleSummary as string) ?? '—'}</p>
                  </section>
                  <section>
                    <h3 className="mb-2 text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">{t('videoDetail.viralDna.audio')}</h3>
                    <p className="text-sm text-neutral-700 dark:text-neutral-300">
                      {(currentProfile.audio?.narrationStyle as string) ?? '—'} · {(currentProfile.audio?.tone as string) ?? ''}
                    </p>
                  </section>
                  <section>
                    <h3 className="mb-2 text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">{t('videoDetail.viralDna.emotion')}</h3>
                    {emotionCurve.length > 0 && (
                      <ResponsiveContainer width="100%" height={160}>
                        <LineChart data={emotionCurve}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-neutral-200 dark:stroke-neutral-800" />
                          <XAxis dataKey="normalizedPosition" tickFormatter={(v) => `${Math.round(v * 100)}%`} tick={{ fontSize: 11 }} />
                          <YAxis domain={[0, 1]} tick={{ fontSize: 11 }} />
                          <Tooltip
                            formatter={(v) => Number(v).toFixed(2)}
                            labelFormatter={(v) => `${Math.round(Number(v) * 100)}%`}
                          />
                          <Line type="monotone" dataKey="intensity" stroke="#525252" dot={false} strokeWidth={2} />
                        </LineChart>
                      </ResponsiveContainer>
                    )}
                    <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                      {t('videoDetail.viralDna.emotionInferred')} — {(currentProfile.emotion?.emotionalArcType as string) ?? '—'}
                    </p>
                  </section>
                  <section>
                    <h3 className="mb-2 text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">{t('videoDetail.viralDna.performance')}</h3>
                    <p className="text-sm text-neutral-700 dark:text-neutral-300">
                      {(currentProfile.performance?.views as number)?.toLocaleString() ?? '—'} views · outlier {(currentProfile.performance?.outlierScore as number)?.toFixed(2) ?? '—'} ({(currentProfile.performance?.outlierClassification as string) ?? '—'})
                    </p>
                  </section>
                </div>
              )}

              {vdnaTab === 'scorecard' && (
                <ResponsiveContainer width="100%" height={420}>
                  <BarChart data={scores} layout="vertical" margin={{ left: 40 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-neutral-200 dark:stroke-neutral-800" />
                    <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="scoreName" width={200} tick={{ fontSize: 10 }} />
                    <Tooltip />
                    <Bar dataKey="value" fill="#525252" />
                  </BarChart>
                </ResponsiveContainer>
              )}

              {vdnaTab === 'hypotheses' && (
                <div className="flex flex-col gap-3">
                  {hypotheses.map((h) => (
                    <div key={h.id} className="rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-800">
                      <div className="mb-1 flex items-center justify-between">
                        <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs dark:bg-neutral-900">{h.hypothesisType}</span>
                        <label className="flex items-center gap-1 text-xs text-neutral-500 dark:text-neutral-400">
                          <input
                            type="checkbox"
                            checked={rejectedIds.has(h.id) || h.status === 'REJECTED'}
                            disabled={h.status === 'REJECTED'}
                            onChange={(e) => {
                              const next = new Set(rejectedIds)
                              if (e.target.checked) next.add(h.id)
                              else next.delete(h.id)
                              setRejectedIds(next)
                            }}
                          />
                          {t('videoDetail.viralDna.reject')}
                        </label>
                      </div>
                      <p className="text-neutral-700 dark:text-neutral-300">{h.statement}</p>
                      <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{t('videoDetail.viralDna.confidence')}: {pct(h.confidence)}</p>
                    </div>
                  ))}
                  {hypotheses.length === 0 && <p className="text-sm text-neutral-500 dark:text-neutral-400">{t('videoDetail.notAvailable')}</p>}
                  {rejectedIds.size > 0 && (
                    <button onClick={saveEdit} className="w-fit rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white dark:bg-neutral-100 dark:text-neutral-900">
                      {t('videoDetail.viralDna.saveEdit')}
                    </button>
                  )}
                </div>
              )}

              {vdnaTab === 'evidence' && (
                <div className="flex flex-col gap-2">
                  {evidence.map((e) => (
                    <div key={e.id} className="rounded-md border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800">
                      <div className="mb-1 flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
                        <span className="rounded bg-neutral-100 px-1.5 py-0.5 dark:bg-neutral-900">{e.sourceType}</span>
                        <span>{e.evidenceId}</span>
                        {e.timestampStart != null && (
                          <button
                            onClick={() => {
                              setMainTab('overview')
                              setOverviewTab('timeline')
                            }}
                            className="underline"
                          >
                            {formatDuration(e.timestampStart)}
                          </button>
                        )}
                      </div>
                      {e.transcriptExcerpt && <p className="italic text-neutral-600 dark:text-neutral-400">"{e.transcriptExcerpt}"</p>}
                      {e.explanation && <p className="text-neutral-700 dark:text-neutral-300">{e.explanation}</p>}
                    </div>
                  ))}
                  {evidence.length === 0 && <p className="text-sm text-neutral-500 dark:text-neutral-400">{t('videoDetail.notAvailable')}</p>}
                </div>
              )}

              {vdnaTab === 'versions' && (
                <div className="flex flex-col gap-1">
                  {profiles.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setSelectedVersion(p.profileVersion)}
                      className={`flex items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition ${
                        currentProfile.id === p.id
                          ? 'border-neutral-900 dark:border-neutral-100'
                          : 'border-neutral-200 dark:border-neutral-800'
                      }`}
                    >
                      <span>
                        {t('videoDetail.viralDna.version')} {p.profileVersion} {p.isCurrent ? `(${t('videoDetail.viralDna.currentVersion')})` : ''}
                      </span>
                      <span className="text-xs text-neutral-500 dark:text-neutral-400">
                        {p.status} · {new Date(p.generatedAt).toLocaleString()}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {vdnaTab === 'raw' && (
                <pre className="max-h-[600px] overflow-auto rounded-lg border border-neutral-200 p-4 text-xs text-neutral-700 dark:border-neutral-800 dark:text-neutral-300">
                  {JSON.stringify(currentProfile, null, 2)}
                </pre>
              )}
            </div>
          )}

          {jobs.length > 0 && (
            <div className="mt-6">
              <h3 className="mb-2 text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">{t('videoDetail.viralDna.logs')}</h3>
              <div className="flex flex-col gap-1">
                {jobs.map((job) => (
                  <div key={job.id} className="flex items-center justify-between rounded-md border border-neutral-200 px-3 py-2 text-xs dark:border-neutral-800">
                    <span className="text-neutral-700 dark:text-neutral-300">{job.stage}</span>
                    <span className="text-neutral-500 dark:text-neutral-400">
                      {job.status}
                      {job.attempts > 0 ? ` · attempt ${job.attempts}` : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
