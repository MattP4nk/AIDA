-- AlterTable
ALTER TABLE "posts" ADD COLUMN     "is_locked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "votes" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "post_replies" (
    "id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "author_handle" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "votes" INTEGER NOT NULL DEFAULT 0,
    "is_hidden" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "post_replies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_votes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "post_id" TEXT,
    "reply_id" TEXT,
    "value" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_votes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_reports" (
    "id" TEXT NOT NULL,
    "reporter_id" TEXT NOT NULL,
    "post_id" TEXT,
    "reply_id" TEXT,
    "forum_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "resolved_by" TEXT,

    CONSTRAINT "post_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "post_replies_post_id_idx" ON "post_replies"("post_id");

-- CreateIndex
CREATE INDEX "post_replies_author_id_idx" ON "post_replies"("author_id");

-- CreateIndex
CREATE INDEX "post_votes_post_id_idx" ON "post_votes"("post_id");

-- CreateIndex
CREATE INDEX "post_votes_reply_id_idx" ON "post_votes"("reply_id");

-- CreateIndex
CREATE UNIQUE INDEX "post_votes_user_id_post_id_key" ON "post_votes"("user_id", "post_id");

-- CreateIndex
CREATE UNIQUE INDEX "post_votes_user_id_reply_id_key" ON "post_votes"("user_id", "reply_id");

-- CreateIndex
CREATE INDEX "post_reports_forum_id_idx" ON "post_reports"("forum_id");

-- CreateIndex
CREATE INDEX "post_reports_status_idx" ON "post_reports"("status");

-- AddForeignKey
ALTER TABLE "post_replies" ADD CONSTRAINT "post_replies_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_replies" ADD CONSTRAINT "post_replies_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_votes" ADD CONSTRAINT "post_votes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_votes" ADD CONSTRAINT "post_votes_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_votes" ADD CONSTRAINT "post_votes_reply_id_fkey" FOREIGN KEY ("reply_id") REFERENCES "post_replies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_reports" ADD CONSTRAINT "post_reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_reports" ADD CONSTRAINT "post_reports_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_reports" ADD CONSTRAINT "post_reports_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_reports" ADD CONSTRAINT "post_reports_reply_id_fkey" FOREIGN KEY ("reply_id") REFERENCES "post_replies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_reports" ADD CONSTRAINT "post_reports_forum_id_fkey" FOREIGN KEY ("forum_id") REFERENCES "forums"("id") ON DELETE CASCADE ON UPDATE CASCADE;
