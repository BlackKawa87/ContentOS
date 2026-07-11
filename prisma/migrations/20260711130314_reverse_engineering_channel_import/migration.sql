-- CreateEnum
CREATE TYPE "JobPipeline" AS ENUM ('STUDY', 'REVERSE_CHANNEL_IMPORT');

-- CreateEnum
CREATE TYPE "ChannelStatus" AS ENUM ('PENDING', 'IMPORTING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "OutlierClass" AS ENUM ('NORMAL', 'ABOVE_AVERAGE', 'STRONG_OUTLIER', 'VIRAL_OUTLIER');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "JobStage" ADD VALUE 'CHANNEL_METADATA_FETCHED';
ALTER TYPE "JobStage" ADD VALUE 'VIDEOS_LISTED';
ALTER TYPE "JobStage" ADD VALUE 'VIDEOS_METADATA_FETCHED';
ALTER TYPE "JobStage" ADD VALUE 'STATS_CALCULATED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "VideoStatus" ADD VALUE 'NOT_IMPORTED';
ALTER TYPE "VideoStatus" ADD VALUE 'READY';

-- DropForeignKey
ALTER TABLE "processing_jobs" DROP CONSTRAINT "processing_jobs_videoId_fkey";

-- AlterTable
ALTER TABLE "processing_jobs" ADD COLUMN     "channelId" UUID,
ADD COLUMN     "pipeline" "JobPipeline" NOT NULL DEFAULT 'STUDY',
ALTER COLUMN "videoId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "profiles" ADD COLUMN     "outlierAboveAvgMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 2,
ADD COLUMN     "outlierStrongMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 5,
ADD COLUMN     "outlierViralMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 10,
ADD COLUMN     "reverseDefaultImportLimit" INTEGER NOT NULL DEFAULT 25,
ADD COLUMN     "reverseMaxPlaylists" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "reverseMaxVideos" INTEGER NOT NULL DEFAULT 100;

-- AlterTable
ALTER TABLE "videos" ADD COLUMN     "ageInDays" INTEGER,
ADD COLUMN     "channelId" UUID,
ADD COLUMN     "chapters" JSONB,
ADD COLUMN     "comments" INTEGER,
ADD COLUMN     "language" TEXT,
ADD COLUMN     "likes" INTEGER,
ADD COLUMN     "outlierClass" "OutlierClass",
ADD COLUMN     "outlierScore" DOUBLE PRECISION,
ADD COLUMN     "playlistId" UUID,
ADD COLUMN     "publishedAt" TIMESTAMP(3),
ADD COLUMN     "tags" JSONB,
ADD COLUMN     "thumbnailUrl" TEXT,
ADD COLUMN     "views" INTEGER,
ADD COLUMN     "viewsPerDay" DOUBLE PRECISION,
ADD COLUMN     "viewsPerHour" DOUBLE PRECISION,
ADD COLUMN     "youtubeVideoId" TEXT;

-- CreateTable
CREATE TABLE "channels" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "youtubeChannelId" TEXT,
    "handle" TEXT,
    "title" TEXT,
    "description" TEXT,
    "thumbnailUrl" TEXT,
    "bannerUrl" TEXT,
    "language" TEXT,
    "country" TEXT,
    "status" "ChannelStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "importedAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "playlists" (
    "id" UUID NOT NULL,
    "channelId" UUID NOT NULL,
    "youtubePlaylistId" TEXT NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "thumbnailUrl" TEXT,
    "videoCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "importedAt" TIMESTAMP(3),

    CONSTRAINT "playlists_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "channels_projectId_idx" ON "channels"("projectId");

-- CreateIndex
CREATE INDEX "playlists_channelId_idx" ON "playlists"("channelId");

-- CreateIndex
CREATE INDEX "processing_jobs_channelId_idx" ON "processing_jobs"("channelId");

-- CreateIndex
CREATE INDEX "videos_channelId_idx" ON "videos"("channelId");

-- CreateIndex
CREATE INDEX "videos_playlistId_idx" ON "videos"("playlistId");

-- CreateIndex
CREATE INDEX "videos_youtubeVideoId_idx" ON "videos"("youtubeVideoId");

-- AddForeignKey
ALTER TABLE "videos" ADD CONSTRAINT "videos_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "videos" ADD CONSTRAINT "videos_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "playlists"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channels" ADD CONSTRAINT "channels_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playlists" ADD CONSTRAINT "playlists_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "videos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE SET NULL ON UPDATE CASCADE;
