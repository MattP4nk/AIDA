-- AlterTable
ALTER TABLE "file_system_nodes" ADD COLUMN     "last_accessed_at" TIMESTAMP(3),
ADD COLUMN     "last_accessed_by" TEXT;

-- AlterTable
ALTER TABLE "game_servers" ADD COLUMN     "discovery_level" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "firewall_level" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "is_player_home" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "security_level" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "player_progress" ADD COLUMN     "inventory" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "skills" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "server_connections" ADD COLUMN     "access_level" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "working_directory" TEXT NOT NULL DEFAULT '/';

-- AlterTable
ALTER TABLE "user_sessions" ADD COLUMN     "current_directory" TEXT NOT NULL DEFAULT '/home/user',
ADD COLUMN     "last_server_id" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "home_server_id" TEXT;
