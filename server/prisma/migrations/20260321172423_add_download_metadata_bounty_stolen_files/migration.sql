-- AlterTable
ALTER TABLE "bounties" ADD COLUMN     "stolen_file_ids" JSONB;

-- AlterTable
ALTER TABLE "file_system_nodes" ADD COLUMN     "metadata" JSONB;

-- AlterTable
ALTER TABLE "server_access_keys" ADD COLUMN     "source_file_id" TEXT;
