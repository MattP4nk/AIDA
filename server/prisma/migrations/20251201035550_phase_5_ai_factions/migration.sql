/*
  Warnings:

  - A unique constraint covering the columns `[ai_persona_id]` on the table `factions` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "missions" DROP CONSTRAINT "missions_created_by_fkey";

-- AlterTable
ALTER TABLE "factions" ADD COLUMN     "ai_persona_id" TEXT,
ADD COLUMN     "color" TEXT NOT NULL DEFAULT '#00ff00',
ALTER COLUMN "full_name" DROP NOT NULL;

-- AlterTable
ALTER TABLE "forum_posts" ADD COLUMN     "factionId" TEXT;

-- AlterTable
ALTER TABLE "game_servers" ADD COLUMN     "faction_id" TEXT,
ADD COLUMN     "is_aida_home_server" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "missions" ADD COLUMN     "faction_id" TEXT,
ADD COLUMN     "issued_by" TEXT,
ALTER COLUMN "created_by" DROP NOT NULL;

-- CreateTable
CREATE TABLE "faction_members" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "faction_id" TEXT NOT NULL,
    "rank" TEXT NOT NULL DEFAULT 'recruit',
    "reputation" INTEGER NOT NULL DEFAULT 0,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "faction_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_personas" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "personality" TEXT NOT NULL,
    "system_prompt" TEXT NOT NULL,
    "model" TEXT NOT NULL DEFAULT 'llama3.1:8b',
    "last_action_at" TIMESTAMP(3),
    "actions_today" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_personas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_knowledge" (
    "id" TEXT NOT NULL,
    "persona_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "ai_knowledge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_actions" (
    "id" TEXT NOT NULL,
    "persona_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "input" JSONB NOT NULL,
    "output" JSONB,
    "triggered_by" TEXT NOT NULL,
    "executed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aida_clues" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "server_id" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "required_clues" TEXT[],
    "difficulty" INTEGER NOT NULL,
    "discovered" BOOLEAN NOT NULL DEFAULT false,
    "discovered_by" TEXT,
    "discovered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aida_clues_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "faction_members_user_id_faction_id_key" ON "faction_members"("user_id", "faction_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_personas_name_key" ON "ai_personas"("name");

-- CreateIndex
CREATE INDEX "ai_knowledge_persona_id_type_idx" ON "ai_knowledge"("persona_id", "type");

-- CreateIndex
CREATE INDEX "ai_actions_persona_id_status_idx" ON "ai_actions"("persona_id", "status");

-- CreateIndex
CREATE INDEX "ai_actions_status_created_at_idx" ON "ai_actions"("status", "created_at");

-- CreateIndex
CREATE INDEX "aida_clues_server_id_idx" ON "aida_clues"("server_id");

-- CreateIndex
CREATE INDEX "aida_clues_discovered_idx" ON "aida_clues"("discovered");

-- CreateIndex
CREATE UNIQUE INDEX "factions_ai_persona_id_key" ON "factions"("ai_persona_id");

-- AddForeignKey
ALTER TABLE "game_servers" ADD CONSTRAINT "game_servers_faction_id_fkey" FOREIGN KEY ("faction_id") REFERENCES "factions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_posts" ADD CONSTRAINT "forum_posts_factionId_fkey" FOREIGN KEY ("factionId") REFERENCES "factions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "missions" ADD CONSTRAINT "missions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "missions" ADD CONSTRAINT "missions_issued_by_fkey" FOREIGN KEY ("issued_by") REFERENCES "ai_personas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "missions" ADD CONSTRAINT "missions_faction_id_fkey" FOREIGN KEY ("faction_id") REFERENCES "factions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factions" ADD CONSTRAINT "factions_ai_persona_id_fkey" FOREIGN KEY ("ai_persona_id") REFERENCES "ai_personas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faction_members" ADD CONSTRAINT "faction_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faction_members" ADD CONSTRAINT "faction_members_faction_id_fkey" FOREIGN KEY ("faction_id") REFERENCES "factions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_knowledge" ADD CONSTRAINT "ai_knowledge_persona_id_fkey" FOREIGN KEY ("persona_id") REFERENCES "ai_personas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_actions" ADD CONSTRAINT "ai_actions_persona_id_fkey" FOREIGN KEY ("persona_id") REFERENCES "ai_personas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
