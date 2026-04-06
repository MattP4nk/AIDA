-- AlterTable
ALTER TABLE "game_servers" ADD COLUMN     "access_key" TEXT,
ADD COLUMN     "access_method" TEXT NOT NULL DEFAULT 'hackable',
ADD COLUMN     "is_public" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "server_access_keys" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "server_id" TEXT NOT NULL,
    "key_value" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "source_detail" TEXT,
    "discovered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "server_access_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "server_access_keys_user_id_idx" ON "server_access_keys"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "server_access_keys_user_id_server_id_key" ON "server_access_keys"("user_id", "server_id");

-- AddForeignKey
ALTER TABLE "server_access_keys" ADD CONSTRAINT "server_access_keys_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "game_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
