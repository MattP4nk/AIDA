-- CreateTable
CREATE TABLE "faction_wars" (
    "id" TEXT NOT NULL,
    "attacker_faction_id" TEXT NOT NULL,
    "defender_faction_id" TEXT NOT NULL,
    "declared_by" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "attacker_score" INTEGER NOT NULL DEFAULT 0,
    "defender_score" INTEGER NOT NULL DEFAULT 0,
    "reputation_multiplier" DOUBLE PRECISION NOT NULL DEFAULT 2.0,
    "terms" JSONB NOT NULL DEFAULT '{}',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),

    CONSTRAINT "faction_wars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_aliases" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "alias_name" TEXT NOT NULL,
    "alias_email" TEXT,
    "apparent_faction_id" TEXT,
    "cost" INTEGER NOT NULL DEFAULT 10000,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "revealed_by" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "player_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "darknet_discoveries" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "discovered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "darknet_discoveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "censorship_rules" (
    "id" TEXT NOT NULL,
    "faction_id" TEXT,
    "server_id" TEXT,
    "pattern" TEXT NOT NULL,
    "replacement" TEXT NOT NULL DEFAULT '[REDACTED]',
    "alert_target" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "censorship_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "faction_wars_status_idx" ON "faction_wars"("status");

-- CreateIndex
CREATE INDEX "faction_wars_attacker_faction_id_idx" ON "faction_wars"("attacker_faction_id");

-- CreateIndex
CREATE INDEX "faction_wars_defender_faction_id_idx" ON "faction_wars"("defender_faction_id");

-- CreateIndex
CREATE UNIQUE INDEX "player_aliases_user_id_key" ON "player_aliases"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "player_aliases_alias_name_key" ON "player_aliases"("alias_name");

-- CreateIndex
CREATE INDEX "player_aliases_alias_name_idx" ON "player_aliases"("alias_name");

-- CreateIndex
CREATE UNIQUE INDEX "darknet_discoveries_user_id_key" ON "darknet_discoveries"("user_id");

-- CreateIndex
CREATE INDEX "censorship_rules_faction_id_idx" ON "censorship_rules"("faction_id");

-- CreateIndex
CREATE INDEX "censorship_rules_is_active_idx" ON "censorship_rules"("is_active");

-- AddForeignKey
ALTER TABLE "faction_wars" ADD CONSTRAINT "faction_wars_attacker_faction_id_fkey" FOREIGN KEY ("attacker_faction_id") REFERENCES "factions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faction_wars" ADD CONSTRAINT "faction_wars_defender_faction_id_fkey" FOREIGN KEY ("defender_faction_id") REFERENCES "factions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_aliases" ADD CONSTRAINT "player_aliases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_aliases" ADD CONSTRAINT "player_aliases_apparent_faction_id_fkey" FOREIGN KEY ("apparent_faction_id") REFERENCES "factions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "darknet_discoveries" ADD CONSTRAINT "darknet_discoveries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "censorship_rules" ADD CONSTRAINT "censorship_rules_faction_id_fkey" FOREIGN KEY ("faction_id") REFERENCES "factions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "censorship_rules" ADD CONSTRAINT "censorship_rules_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "game_servers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
