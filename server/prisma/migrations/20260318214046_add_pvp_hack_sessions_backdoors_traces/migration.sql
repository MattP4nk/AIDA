-- DropForeignKey
ALTER TABLE "contacts" DROP CONSTRAINT "contacts_contact_user_id_fkey";

-- DropForeignKey
ALTER TABLE "hack_logs" DROP CONSTRAINT "hack_logs_attacker_id_fkey";

-- DropForeignKey
ALTER TABLE "hack_logs" DROP CONSTRAINT "hack_logs_target_id_fkey";

-- DropForeignKey
ALTER TABLE "hack_logs" DROP CONSTRAINT "hack_logs_target_server_id_fkey";

-- DropIndex
DROP INDEX "contacts_user_id_idx";

-- DropIndex
DROP INDEX "file_system_nodes_parent_id_idx";

-- DropIndex
DROP INDEX "file_system_nodes_server_id_idx";

-- DropIndex
DROP INDEX "hack_logs_attacker_id_idx";

-- DropIndex
DROP INDEX "hack_logs_target_id_idx";

-- DropIndex
DROP INDEX "hack_logs_timestamp_idx";

-- DropIndex
DROP INDEX "user_sessions_expires_at_idx";

-- DropIndex
DROP INDEX "user_sessions_user_id_idx";

-- AlterTable
ALTER TABLE "player_progress" ADD COLUMN     "rep_anons" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "rep_military" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "rep_neutral" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "rep_sword_corp" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "hack_sessions" (
    "id" TEXT NOT NULL,
    "attacker_id" TEXT NOT NULL,
    "target_owner_id" TEXT NOT NULL,
    "target_server_id" TEXT NOT NULL,
    "target_ip" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "tools" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "current_layer" INTEGER NOT NULL DEFAULT 0,
    "total_layers" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "layers_data" JSONB NOT NULL,
    "layer_results" JSONB NOT NULL DEFAULT '[]',
    "detection_accumulator" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "started_at" BIGINT NOT NULL,
    "expires_at" BIGINT NOT NULL,
    "layer_started_at" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hack_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backdoors" (
    "id" TEXT NOT NULL,
    "installer_id" TEXT NOT NULL,
    "server_id" TEXT NOT NULL,
    "access_level" INTEGER NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'standard',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_used" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "detection_risk" INTEGER NOT NULL DEFAULT 10,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "backdoors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "active_traces" (
    "id" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "initiated_by" TEXT NOT NULL,
    "server_id" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "evidence_level" INTEGER NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "active_traces_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hack_sessions_attacker_id_idx" ON "hack_sessions"("attacker_id");

-- CreateIndex
CREATE INDEX "hack_sessions_status_idx" ON "hack_sessions"("status");

-- CreateIndex
CREATE INDEX "backdoors_server_id_idx" ON "backdoors"("server_id");

-- CreateIndex
CREATE UNIQUE INDEX "backdoors_installer_id_server_id_key" ON "backdoors"("installer_id", "server_id");

-- CreateIndex
CREATE INDEX "active_traces_target_id_idx" ON "active_traces"("target_id");

-- CreateIndex
CREATE INDEX "active_traces_status_idx" ON "active_traces"("status");

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_contact_user_id_fkey" FOREIGN KEY ("contact_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hack_logs" ADD CONSTRAINT "hack_logs_attacker_id_fkey" FOREIGN KEY ("attacker_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hack_logs" ADD CONSTRAINT "hack_logs_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hack_logs" ADD CONSTRAINT "hack_logs_target_server_id_fkey" FOREIGN KEY ("target_server_id") REFERENCES "game_servers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hack_sessions" ADD CONSTRAINT "hack_sessions_attacker_id_fkey" FOREIGN KEY ("attacker_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hack_sessions" ADD CONSTRAINT "hack_sessions_target_owner_id_fkey" FOREIGN KEY ("target_owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hack_sessions" ADD CONSTRAINT "hack_sessions_target_server_id_fkey" FOREIGN KEY ("target_server_id") REFERENCES "game_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backdoors" ADD CONSTRAINT "backdoors_installer_id_fkey" FOREIGN KEY ("installer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backdoors" ADD CONSTRAINT "backdoors_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "game_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "active_traces" ADD CONSTRAINT "active_traces_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "active_traces" ADD CONSTRAINT "active_traces_initiated_by_fkey" FOREIGN KEY ("initiated_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "active_traces" ADD CONSTRAINT "active_traces_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "game_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
