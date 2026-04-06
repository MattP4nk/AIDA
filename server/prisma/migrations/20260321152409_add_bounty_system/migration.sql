-- CreateTable
CREATE TABLE "bounties" (
    "id" TEXT NOT NULL,
    "target_user_id" TEXT NOT NULL,
    "target_username" TEXT NOT NULL,
    "issued_by_faction_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "reward_credits" INTEGER NOT NULL,
    "reward_reputation" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "claimed_by_user_id" TEXT,
    "completed_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "server_id" TEXT,
    "evidence_level" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bounties_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bounties_status_idx" ON "bounties"("status");

-- CreateIndex
CREATE INDEX "bounties_target_user_id_idx" ON "bounties"("target_user_id");

-- CreateIndex
CREATE INDEX "bounties_issued_by_faction_id_idx" ON "bounties"("issued_by_faction_id");

-- CreateIndex
CREATE INDEX "bounties_expires_at_idx" ON "bounties"("expires_at");
