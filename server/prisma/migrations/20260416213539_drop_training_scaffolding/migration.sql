-- DropForeignKey
ALTER TABLE "training_jobs" DROP CONSTRAINT "training_jobs_userId_fkey";

-- DropIndex
DROP INDEX "books_markedForTraining_idx";

-- DropIndex
DROP INDEX "starred_notes_markedForTraining_idx";

-- AlterTable
ALTER TABLE "books" DROP COLUMN "markedForTraining";

-- AlterTable
ALTER TABLE "starred_notes" DROP COLUMN "markedForTraining";

-- DropTable
DROP TABLE "training_jobs";

-- DropEnum
DROP TYPE "TrainingStatus";

