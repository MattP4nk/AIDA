/*
  Warnings:

  - The `resources` column on the `factions` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - A unique constraint covering the columns `[name]` on the table `factions` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[short_name]` on the table `factions` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "factions" ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "ideology" TEXT,
ADD COLUMN     "short_name" TEXT,
ALTER COLUMN "objective" DROP NOT NULL,
DROP COLUMN "resources",
ADD COLUMN     "resources" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "forums" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "securityLevel" INTEGER NOT NULL,
    "is_honeypot" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "faction_id" TEXT,
    "requires_proxy" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "forums_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posts" (
    "id" TEXT NOT NULL,
    "forum_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "author_handle" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "is_sticky" BOOLEAN NOT NULL DEFAULT false,
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,
    "is_encrypted" BOOLEAN NOT NULL DEFAULT false,
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "reply_count" INTEGER NOT NULL DEFAULT 0,
    "story_relevant" BOOLEAN NOT NULL DEFAULT false,
    "key_fragment_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forum_members" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "forum_id" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "reputation" INTEGER NOT NULL DEFAULT 0,
    "post_count" INTEGER NOT NULL DEFAULT 0,
    "is_admin" BOOLEAN NOT NULL DEFAULT false,
    "is_banned" BOOLEAN NOT NULL DEFAULT false,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "forum_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forum_discoveries" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "forum_id" TEXT NOT NULL,
    "discovered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "method" TEXT NOT NULL,

    CONSTRAINT "forum_discoveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proxy_connections" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "proxy_server" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "connected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "proxy_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "story_progress" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "discovery_level" INTEGER NOT NULL DEFAULT 0,
    "signal_key" INTEGER NOT NULL DEFAULT 0,
    "location_key" INTEGER NOT NULL DEFAULT 0,
    "cipher_key" INTEGER NOT NULL DEFAULT 0,
    "fragments" JSONB NOT NULL DEFAULT '[]',
    "has_contacted_aida" BOOLEAN NOT NULL DEFAULT false,
    "aida_contact_count" INTEGER NOT NULL DEFAULT 0,
    "aida_trust_level" INTEGER NOT NULL DEFAULT 0,
    "endgame_unlocked" BOOLEAN NOT NULL DEFAULT false,
    "endgame_choice" TEXT,
    "game_completed" BOOLEAN NOT NULL DEFAULT false,
    "last_discovery_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "story_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intelligence_reports" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "importance" INTEGER NOT NULL,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "related_faction" TEXT,
    "triggers_event" BOOLEAN NOT NULL DEFAULT false,
    "event_type" TEXT,
    "discovered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "intelligence_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "key_fragments" (
    "id" TEXT NOT NULL,
    "key_type" TEXT NOT NULL,
    "fragment_num" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "hint" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,

    CONSTRAINT "key_fragments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "key_fragment_discoveries" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "fragment_id" TEXT NOT NULL,
    "discovered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "method" TEXT NOT NULL,

    CONSTRAINT "key_fragment_discoveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "faction_standings" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "faction_id" TEXT NOT NULL,
    "reputation" INTEGER NOT NULL DEFAULT 0,
    "is_hostile" BOOLEAN NOT NULL DEFAULT false,
    "is_allied" BOOLEAN NOT NULL DEFAULT false,
    "is_neutral" BOOLEAN NOT NULL DEFAULT true,
    "last_action" TEXT,
    "last_change" INTEGER,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "faction_standings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "faction_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "faction_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "impact" TEXT NOT NULL,
    "reputation_change" INTEGER,
    "resource_change" JSONB,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "triggered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "faction_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "forums_name_key" ON "forums"("name");

-- CreateIndex
CREATE UNIQUE INDEX "forums_url_key" ON "forums"("url");

-- CreateIndex
CREATE INDEX "forums_category_idx" ON "forums"("category");

-- CreateIndex
CREATE INDEX "forums_faction_id_idx" ON "forums"("faction_id");

-- CreateIndex
CREATE INDEX "posts_forum_id_idx" ON "posts"("forum_id");

-- CreateIndex
CREATE INDEX "posts_author_id_idx" ON "posts"("author_id");

-- CreateIndex
CREATE INDEX "posts_story_relevant_idx" ON "posts"("story_relevant");

-- CreateIndex
CREATE INDEX "forum_members_user_id_idx" ON "forum_members"("user_id");

-- CreateIndex
CREATE INDEX "forum_members_forum_id_idx" ON "forum_members"("forum_id");

-- CreateIndex
CREATE UNIQUE INDEX "forum_members_user_id_forum_id_key" ON "forum_members"("user_id", "forum_id");

-- CreateIndex
CREATE INDEX "forum_discoveries_user_id_idx" ON "forum_discoveries"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "forum_discoveries_user_id_forum_id_key" ON "forum_discoveries"("user_id", "forum_id");

-- CreateIndex
CREATE UNIQUE INDEX "proxy_connections_user_id_key" ON "proxy_connections"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "story_progress_user_id_key" ON "story_progress"("user_id");

-- CreateIndex
CREATE INDEX "intelligence_reports_user_id_idx" ON "intelligence_reports"("user_id");

-- CreateIndex
CREATE INDEX "intelligence_reports_category_idx" ON "intelligence_reports"("category");

-- CreateIndex
CREATE INDEX "intelligence_reports_is_read_idx" ON "intelligence_reports"("is_read");

-- CreateIndex
CREATE UNIQUE INDEX "key_fragments_key_type_fragment_num_key" ON "key_fragments"("key_type", "fragment_num");

-- CreateIndex
CREATE INDEX "key_fragment_discoveries_user_id_idx" ON "key_fragment_discoveries"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "key_fragment_discoveries_user_id_fragment_id_key" ON "key_fragment_discoveries"("user_id", "fragment_id");

-- CreateIndex
CREATE INDEX "faction_standings_user_id_idx" ON "faction_standings"("user_id");

-- CreateIndex
CREATE INDEX "faction_standings_faction_id_idx" ON "faction_standings"("faction_id");

-- CreateIndex
CREATE INDEX "faction_standings_reputation_idx" ON "faction_standings"("reputation");

-- CreateIndex
CREATE UNIQUE INDEX "faction_standings_user_id_faction_id_key" ON "faction_standings"("user_id", "faction_id");

-- CreateIndex
CREATE INDEX "faction_events_user_id_idx" ON "faction_events"("user_id");

-- CreateIndex
CREATE INDEX "faction_events_faction_id_idx" ON "faction_events"("faction_id");

-- CreateIndex
CREATE INDEX "faction_events_event_type_idx" ON "faction_events"("event_type");

-- CreateIndex
CREATE UNIQUE INDEX "factions_name_key" ON "factions"("name");

-- CreateIndex
CREATE UNIQUE INDEX "factions_short_name_key" ON "factions"("short_name");

-- AddForeignKey
ALTER TABLE "forums" ADD CONSTRAINT "forums_faction_id_fkey" FOREIGN KEY ("faction_id") REFERENCES "factions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_forum_id_fkey" FOREIGN KEY ("forum_id") REFERENCES "forums"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_members" ADD CONSTRAINT "forum_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_members" ADD CONSTRAINT "forum_members_forum_id_fkey" FOREIGN KEY ("forum_id") REFERENCES "forums"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_discoveries" ADD CONSTRAINT "forum_discoveries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_discoveries" ADD CONSTRAINT "forum_discoveries_forum_id_fkey" FOREIGN KEY ("forum_id") REFERENCES "forums"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proxy_connections" ADD CONSTRAINT "proxy_connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_progress" ADD CONSTRAINT "story_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intelligence_reports" ADD CONSTRAINT "intelligence_reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "key_fragment_discoveries" ADD CONSTRAINT "key_fragment_discoveries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "key_fragment_discoveries" ADD CONSTRAINT "key_fragment_discoveries_fragment_id_fkey" FOREIGN KEY ("fragment_id") REFERENCES "key_fragments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faction_standings" ADD CONSTRAINT "faction_standings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faction_standings" ADD CONSTRAINT "faction_standings_faction_id_fkey" FOREIGN KEY ("faction_id") REFERENCES "factions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faction_events" ADD CONSTRAINT "faction_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faction_events" ADD CONSTRAINT "faction_events_faction_id_fkey" FOREIGN KEY ("faction_id") REFERENCES "factions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
