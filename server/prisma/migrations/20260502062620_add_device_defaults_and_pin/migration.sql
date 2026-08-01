-- AlterTable
ALTER TABLE "devices" ADD COLUMN     "defaults" JSONB,
ADD COLUMN     "pinnedModel" TEXT;
