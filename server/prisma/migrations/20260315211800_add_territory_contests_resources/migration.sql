-- AlterTable
ALTER TABLE "game_servers" ADD COLUMN     "is_contested" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "resource_output" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "resource_type" TEXT;

-- CreateTable
CREATE TABLE "server_contests" (
    "id" TEXT NOT NULL,
    "server_id" TEXT NOT NULL,
    "attacking_faction_id" TEXT NOT NULL,
    "defending_faction_id" TEXT,
    "initiated_by" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "decryption_progress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "layers" JSONB NOT NULL DEFAULT '[]',
    "resource_cost" JSONB NOT NULL DEFAULT '{}',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "winner_id" TEXT,

    CONSTRAINT "server_contests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contest_participants" (
    "id" TEXT NOT NULL,
    "contest_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "faction_id" TEXT,
    "contribution" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "side" TEXT NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contest_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "faction_resource_ticks" (
    "id" TEXT NOT NULL,
    "faction_id" TEXT NOT NULL,
    "credits" INTEGER NOT NULL DEFAULT 0,
    "intel" INTEGER NOT NULL DEFAULT 0,
    "compute" INTEGER NOT NULL DEFAULT 0,
    "ticked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "faction_resource_ticks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "server_contests_server_id_idx" ON "server_contests"("server_id");

-- CreateIndex
CREATE INDEX "server_contests_status_idx" ON "server_contests"("status");

-- CreateIndex
CREATE INDEX "contest_participants_contest_id_idx" ON "contest_participants"("contest_id");

-- CreateIndex
CREATE INDEX "contest_participants_user_id_idx" ON "contest_participants"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "contest_participants_contest_id_user_id_key" ON "contest_participants"("contest_id", "user_id");

-- CreateIndex
CREATE INDEX "faction_resource_ticks_faction_id_idx" ON "faction_resource_ticks"("faction_id");

-- CreateIndex
CREATE INDEX "faction_resource_ticks_ticked_at_idx" ON "faction_resource_ticks"("ticked_at");

-- AddForeignKey
ALTER TABLE "server_contests" ADD CONSTRAINT "server_contests_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "game_servers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "server_contests" ADD CONSTRAINT "server_contests_attacking_faction_id_fkey" FOREIGN KEY ("attacking_faction_id") REFERENCES "factions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "server_contests" ADD CONSTRAINT "server_contests_defending_faction_id_fkey" FOREIGN KEY ("defending_faction_id") REFERENCES "factions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_participants" ADD CONSTRAINT "contest_participants_contest_id_fkey" FOREIGN KEY ("contest_id") REFERENCES "server_contests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faction_resource_ticks" ADD CONSTRAINT "faction_resource_ticks_faction_id_fkey" FOREIGN KEY ("faction_id") REFERENCES "factions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
