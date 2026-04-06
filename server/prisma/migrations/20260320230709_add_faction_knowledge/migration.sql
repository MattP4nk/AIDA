-- CreateTable
CREATE TABLE "faction_knowledge" (
    "id" TEXT NOT NULL,
    "faction_id" TEXT NOT NULL,
    "asset_type" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "asset_meta" JSONB NOT NULL DEFAULT '{}',
    "source" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.8,
    "discovered_by" TEXT,
    "discovered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "faction_knowledge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "faction_knowledge_faction_id_asset_type_idx" ON "faction_knowledge"("faction_id", "asset_type");

-- CreateIndex
CREATE INDEX "faction_knowledge_faction_id_discovered_at_idx" ON "faction_knowledge"("faction_id", "discovered_at");

-- CreateIndex
CREATE INDEX "faction_knowledge_expires_at_idx" ON "faction_knowledge"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "faction_knowledge_faction_id_asset_type_asset_id_key" ON "faction_knowledge"("faction_id", "asset_type", "asset_id");

-- AddForeignKey
ALTER TABLE "faction_knowledge" ADD CONSTRAINT "faction_knowledge_faction_id_fkey" FOREIGN KEY ("faction_id") REFERENCES "factions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
