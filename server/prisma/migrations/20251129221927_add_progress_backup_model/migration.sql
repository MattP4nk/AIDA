-- AlterTable
ALTER TABLE "user_sessions" ALTER COLUMN "current_directory" DROP NOT NULL,
ALTER COLUMN "current_directory" DROP DEFAULT;

-- CreateTable
CREATE TABLE "progress_backups" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "checksum" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "progress_backups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "progress_backups_user_id_idx" ON "progress_backups"("user_id");

-- CreateIndex
CREATE INDEX "progress_backups_created_at_idx" ON "progress_backups"("created_at");

-- AddForeignKey
ALTER TABLE "progress_backups" ADD CONSTRAINT "progress_backups_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
