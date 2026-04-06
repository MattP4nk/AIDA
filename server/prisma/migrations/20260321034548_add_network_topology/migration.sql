-- AlterTable
ALTER TABLE "game_servers" ADD COLUMN     "network_id" TEXT,
ADD COLUMN     "role" TEXT NOT NULL DEFAULT 'general';

-- CreateTable
CREATE TABLE "networks" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "faction_id" TEXT,
    "zone" TEXT NOT NULL,
    "is_hidden" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "networks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "server_links" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "network_id" TEXT,
    "linkType" TEXT NOT NULL DEFAULT 'lan',
    "bandwidth" INTEGER NOT NULL DEFAULT 100,
    "latency" INTEGER NOT NULL DEFAULT 10,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "required_access" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "server_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discovered_links" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "link_id" TEXT NOT NULL,
    "discovered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,

    CONSTRAINT "discovered_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "networks_name_key" ON "networks"("name");

-- CreateIndex
CREATE INDEX "networks_faction_id_idx" ON "networks"("faction_id");

-- CreateIndex
CREATE INDEX "server_links_source_id_idx" ON "server_links"("source_id");

-- CreateIndex
CREATE INDEX "server_links_target_id_idx" ON "server_links"("target_id");

-- CreateIndex
CREATE INDEX "server_links_network_id_idx" ON "server_links"("network_id");

-- CreateIndex
CREATE UNIQUE INDEX "server_links_source_id_target_id_key" ON "server_links"("source_id", "target_id");

-- CreateIndex
CREATE INDEX "discovered_links_user_id_idx" ON "discovered_links"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "discovered_links_user_id_link_id_key" ON "discovered_links"("user_id", "link_id");

-- CreateIndex
CREATE INDEX "game_servers_network_id_idx" ON "game_servers"("network_id");

-- AddForeignKey
ALTER TABLE "game_servers" ADD CONSTRAINT "game_servers_network_id_fkey" FOREIGN KEY ("network_id") REFERENCES "networks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "networks" ADD CONSTRAINT "networks_faction_id_fkey" FOREIGN KEY ("faction_id") REFERENCES "factions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "server_links" ADD CONSTRAINT "server_links_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "game_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "server_links" ADD CONSTRAINT "server_links_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "game_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "server_links" ADD CONSTRAINT "server_links_network_id_fkey" FOREIGN KEY ("network_id") REFERENCES "networks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovered_links" ADD CONSTRAINT "discovered_links_link_id_fkey" FOREIGN KEY ("link_id") REFERENCES "server_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;
