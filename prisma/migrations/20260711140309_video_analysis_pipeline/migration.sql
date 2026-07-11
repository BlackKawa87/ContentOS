-- CreateEnum
CREATE TYPE "TimelineSegmentType" AS ENUM ('HOOK', 'SETUP', 'CONTEXT', 'PROBLEM', 'OPEN_LOOP', 'ESCALATION', 'EVIDENCE', 'STORY_DEVELOPMENT', 'TRANSITION', 'PATTERN_INTERRUPT', 'REVEAL', 'PAYOFF', 'SUMMARY', 'CTA', 'OUTRO');

-- CreateEnum
CREATE TYPE "HookType" AS ENUM ('UNEXPECTED_FACT', 'QUESTION', 'CONTRARIAN', 'MYSTERY', 'STORY_OPENING', 'AUTHORITY', 'PROBLEM_FIRST', 'FUTURE_PROMISE', 'EMOTIONAL');

-- CreateEnum
CREATE TYPE "NarrativePattern" AS ENUM ('DOCUMENTARY', 'MYSTERY_REVEAL', 'CHRONOLOGICAL', 'EDUCATIONAL', 'TRANSFORMATION', 'INVESTIGATION', 'CONFLICT', 'BIOGRAPHY', 'TIMELINE');

-- CreateEnum
CREATE TYPE "VisualSceneCategory" AS ENUM ('ARCHIVAL_PHOTO', 'PORTRAIT', 'LANDSCAPE', 'MAP', 'DOCUMENT', 'CHART', 'SCREENSHOT', 'ILLUSTRATION', 'GENERATED_IMAGE', 'TEXT_CARD', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "VisualSceneMotion" AS ENUM ('SLOW_ZOOM', 'ZOOM_OUT', 'PAN', 'STATIC', 'CROP', 'UNKNOWN');

-- AlterEnum
ALTER TYPE "JobPipeline" ADD VALUE 'VIDEO_ANALYSIS';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "JobStage" ADD VALUE 'VIDEO_SELECTED';
ALTER TYPE "JobStage" ADD VALUE 'VIDEO_DOWNLOADED';
ALTER TYPE "JobStage" ADD VALUE 'AUDIO_EXTRACTED';
ALTER TYPE "JobStage" ADD VALUE 'TIMELINE_SEGMENTED';
ALTER TYPE "JobStage" ADD VALUE 'NARRATIVE_ANALYZED';
ALTER TYPE "JobStage" ADD VALUE 'VISUAL_ANALYZED';
ALTER TYPE "JobStage" ADD VALUE 'AUDIO_ANALYZED';
ALTER TYPE "JobStage" ADD VALUE 'READY_FOR_VIRAL_DNA';

-- CreateTable
CREATE TABLE "video_analyses" (
    "id" UUID NOT NULL,
    "videoId" UUID NOT NULL,
    "videoStoragePath" TEXT,
    "audioStoragePath" TEXT,
    "thumbnailStoragePath" TEXT,
    "subtitlesStoragePath" TEXT,
    "fileSizeBytes" INTEGER,
    "downloadDurationMs" INTEGER,
    "downloadFormat" TEXT,
    "audioDurationMs" INTEGER,
    "readyForViralDnaAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "video_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_transcripts" (
    "id" UUID NOT NULL,
    "videoId" UUID NOT NULL,
    "rawText" TEXT NOT NULL,
    "reviewedText" TEXT,
    "language" TEXT,
    "model" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "audioMinutes" DOUBLE PRECISION,
    "estimatedCostUsd" DOUBLE PRECISION,
    "wordsPerMinute" DOUBLE PRECISION,
    "confidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "video_transcripts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transcript_segments" (
    "id" UUID NOT NULL,
    "transcriptId" UUID NOT NULL,
    "index" INTEGER NOT NULL,
    "startSec" DOUBLE PRECISION NOT NULL,
    "endSec" DOUBLE PRECISION NOT NULL,
    "text" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,

    CONSTRAINT "transcript_segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timeline_segments" (
    "id" UUID NOT NULL,
    "videoId" UUID NOT NULL,
    "index" INTEGER NOT NULL,
    "type" "TimelineSegmentType" NOT NULL,
    "startSec" DOUBLE PRECISION NOT NULL,
    "endSec" DOUBLE PRECISION NOT NULL,
    "durationSec" DOUBLE PRECISION NOT NULL,
    "text" TEXT NOT NULL,
    "purpose" TEXT,
    "emotion" TEXT,
    "intensity" DOUBLE PRECISION,
    "confidence" DOUBLE PRECISION,
    "evidence" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "timeline_segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "narrative_analyses" (
    "id" UUID NOT NULL,
    "videoId" UUID NOT NULL,
    "hookType" "HookType",
    "hookDurationSec" DOUBLE PRECISION,
    "promise" TEXT,
    "openLoopCount" INTEGER,
    "payoffCount" INTEGER,
    "revealFrequency" DOUBLE PRECISION,
    "storyStructure" TEXT,
    "informationDensity" DOUBLE PRECISION,
    "curiosityScore" DOUBLE PRECISION,
    "narrativeStyle" TEXT,
    "narrativePattern" "NarrativePattern",
    "retentionMechanisms" TEXT,
    "evidence" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "narrative_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visual_scenes" (
    "id" UUID NOT NULL,
    "videoId" UUID NOT NULL,
    "index" INTEGER NOT NULL,
    "startSec" DOUBLE PRECISION NOT NULL,
    "endSec" DOUBLE PRECISION NOT NULL,
    "durationSec" DOUBLE PRECISION NOT NULL,
    "frameStoragePath" TEXT,
    "category" "VisualSceneCategory" NOT NULL,
    "motion" "VisualSceneMotion" NOT NULL,
    "transition" TEXT,
    "sceneScore" DOUBLE PRECISION,
    "description" TEXT,
    "confidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visual_scenes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audio_metrics" (
    "id" UUID NOT NULL,
    "videoId" UUID NOT NULL,
    "wordsPerMinute" DOUBLE PRECISION,
    "averagePaceWpm" DOUBLE PRECISION,
    "medianPaceWpm" DOUBLE PRECISION,
    "pauseCount" INTEGER,
    "avgPauseDurationSec" DOUBLE PRECISION,
    "speechDensity" DOUBLE PRECISION,
    "energyCurve" JSONB,
    "volumeVariation" DOUBLE PRECISION,
    "silenceRatio" DOUBLE PRECISION,
    "narrationSpeed" DOUBLE PRECISION,
    "sceneSyncScore" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "audio_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "video_analyses_videoId_key" ON "video_analyses"("videoId");

-- CreateIndex
CREATE UNIQUE INDEX "video_transcripts_videoId_key" ON "video_transcripts"("videoId");

-- CreateIndex
CREATE INDEX "transcript_segments_transcriptId_idx" ON "transcript_segments"("transcriptId");

-- CreateIndex
CREATE INDEX "timeline_segments_videoId_idx" ON "timeline_segments"("videoId");

-- CreateIndex
CREATE UNIQUE INDEX "narrative_analyses_videoId_key" ON "narrative_analyses"("videoId");

-- CreateIndex
CREATE INDEX "visual_scenes_videoId_idx" ON "visual_scenes"("videoId");

-- CreateIndex
CREATE UNIQUE INDEX "audio_metrics_videoId_key" ON "audio_metrics"("videoId");

-- AddForeignKey
ALTER TABLE "video_analyses" ADD CONSTRAINT "video_analyses_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "videos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_transcripts" ADD CONSTRAINT "video_transcripts_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "videos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transcript_segments" ADD CONSTRAINT "transcript_segments_transcriptId_fkey" FOREIGN KEY ("transcriptId") REFERENCES "video_transcripts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timeline_segments" ADD CONSTRAINT "timeline_segments_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "videos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "narrative_analyses" ADD CONSTRAINT "narrative_analyses_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "videos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visual_scenes" ADD CONSTRAINT "visual_scenes_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "videos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audio_metrics" ADD CONSTRAINT "audio_metrics_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "videos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
