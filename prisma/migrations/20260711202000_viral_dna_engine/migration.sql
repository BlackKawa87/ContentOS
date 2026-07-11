-- NOTE: see git history / commit message for why this file was trimmed down from the
-- originally-generated script — the CREATE TYPE/ALTER TYPE ADD VALUE statements and the
-- DROP POLICY/DROP CONSTRAINT/DROP INDEX statements already applied in earlier partial
-- attempts against this session-pooler connection (each DDL statement commits individually
-- rather than the whole script being one transaction). Confirmed via direct DB inspection.
-- What remains below is exactly the not-yet-applied remainder.

-- AlterTable
ALTER TABLE "viral_dna_profiles" DROP COLUMN "avgSceneDurationSec",
DROP COLUMN "channelAnalysisId",
DROP COLUMN "ctaStyle",
DROP COLUMN "emotionalCurve",
DROP COLUMN "hookDurationSec",
DROP COLUMN "imageCount",
DROP COLUMN "narrativePattern",
DROP COLUMN "retentionPattern",
DROP COLUMN "visualRhythm",
DROP COLUMN "voiceSpeedWpm",
ADD COLUMN     "audio" JSONB,
ADD COLUMN     "averageSceneDurationSec" DOUBLE PRECISION,
ADD COLUMN     "averageWordsPerMinute" DOUBLE PRECISION,
ADD COLUMN     "createdById" UUID,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "dominantMotion" "VisualSceneMotion",
ADD COLUMN     "dominantTransition" TEXT,
ADD COLUMN     "emotion" JSONB,
ADD COLUMN     "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "hook" JSONB,
ADD COLUMN     "informationDensity" JSONB,
ADD COLUMN     "isCurrent" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "limitations" JSONB,
ADD COLUMN     "narrative" JSONB,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "openLoopCount" INTEGER,
ADD COLUMN     "outlierScoreSnapshot" DOUBLE PRECISION,
ADD COLUMN     "overallConfidenceScore" DOUBLE PRECISION,
ADD COLUMN     "overallRetentionScore" DOUBLE PRECISION,
ADD COLUMN     "patternInterruptsPerMinute" DOUBLE PRECISION,
ADD COLUMN     "performance" JSONB,
ADD COLUMN     "primaryHookType" "HookType",
ADD COLUMN     "primaryNarrativePattern" "NarrativePattern",
ADD COLUMN     "profileVersion" INTEGER NOT NULL,
ADD COLUMN     "retention" JSONB,
ADD COLUMN     "revealFrequency" DOUBLE PRECISION,
ADD COLUMN     "sceneChangesPerMinute" DOUBLE PRECISION,
ADD COLUMN     "schemaVersion" TEXT NOT NULL DEFAULT '1.0.0',
ADD COLUMN     "sourceSnapshot" JSONB,
ADD COLUMN     "status" "ViralDnaProfileStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "textOverlayRate" DOUBLE PRECISION,
ADD COLUMN     "videoId" UUID NOT NULL,
ADD COLUMN     "visual" JSONB,
ADD COLUMN     "warnings" JSONB;

-- CreateTable
CREATE TABLE IF NOT EXISTS "viral_dna_scores" (
    "id" UUID NOT NULL,
    "profileId" UUID NOT NULL,
    "scoreName" "ViralDnaScoreName" NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "formulaVersion" TEXT NOT NULL DEFAULT '1.0.0',
    "inputs" JSONB,
    "evidence" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "viral_dna_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "viral_dna_hypotheses" (
    "id" UUID NOT NULL,
    "profileId" UUID NOT NULL,
    "statement" TEXT NOT NULL,
    "supportingEvidence" JSONB,
    "contradictingEvidence" JSONB,
    "confidence" DOUBLE PRECISION,
    "hypothesisType" "HypothesisType" NOT NULL,
    "testability" TEXT,
    "recommendedValidation" TEXT,
    "status" "HypothesisStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "viral_dna_hypotheses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "viral_dna_evidence" (
    "id" UUID NOT NULL,
    "profileId" UUID NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "sourceType" "EvidenceSourceType" NOT NULL,
    "sourceId" TEXT,
    "timestampStart" DOUBLE PRECISION,
    "timestampEnd" DOUBLE PRECISION,
    "transcriptExcerpt" TEXT,
    "metricName" TEXT,
    "metricValue" DOUBLE PRECISION,
    "explanation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "viral_dna_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "viral_dna_validation_results" (
    "id" UUID NOT NULL,
    "profileId" UUID NOT NULL,
    "valid" BOOLEAN NOT NULL,
    "errors" JSONB,
    "warnings" JSONB,
    "unsupportedClaims" JSONB,
    "missingEvidence" JSONB,
    "confidenceSummary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "viral_dna_validation_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "viral_dna_scores_profileId_idx" ON "viral_dna_scores"("profileId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "viral_dna_scores_profileId_scoreName_key" ON "viral_dna_scores"("profileId", "scoreName");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "viral_dna_hypotheses_profileId_idx" ON "viral_dna_hypotheses"("profileId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "viral_dna_evidence_profileId_idx" ON "viral_dna_evidence"("profileId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "viral_dna_evidence_profileId_evidenceId_idx" ON "viral_dna_evidence"("profileId", "evidenceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "viral_dna_validation_results_profileId_idx" ON "viral_dna_validation_results"("profileId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "viral_dna_profiles_videoId_idx" ON "viral_dna_profiles"("videoId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "viral_dna_profiles_videoId_isCurrent_idx" ON "viral_dna_profiles"("videoId", "isCurrent");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "viral_dna_profiles_videoId_profileVersion_key" ON "viral_dna_profiles"("videoId", "profileVersion");

-- AddForeignKey
ALTER TABLE "viral_dna_profiles" ADD CONSTRAINT "viral_dna_profiles_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "videos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "viral_dna_profiles" ADD CONSTRAINT "viral_dna_profiles_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "viral_dna_scores" ADD CONSTRAINT "viral_dna_scores_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "viral_dna_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "viral_dna_hypotheses" ADD CONSTRAINT "viral_dna_hypotheses_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "viral_dna_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "viral_dna_evidence" ADD CONSTRAINT "viral_dna_evidence_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "viral_dna_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "viral_dna_validation_results" ADD CONSTRAINT "viral_dna_validation_results_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "viral_dna_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
