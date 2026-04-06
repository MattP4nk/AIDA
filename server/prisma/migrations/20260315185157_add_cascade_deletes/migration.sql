-- DropForeignKey
ALTER TABLE "contacts" DROP CONSTRAINT "contacts_contact_user_id_fkey";

-- DropForeignKey
ALTER TABLE "hack_logs" DROP CONSTRAINT "hack_logs_attacker_id_fkey";

-- DropForeignKey
ALTER TABLE "hack_logs" DROP CONSTRAINT "hack_logs_target_id_fkey";

-- DropForeignKey
ALTER TABLE "hack_logs" DROP CONSTRAINT "hack_logs_target_server_id_fkey";

-- CreateIndex
CREATE INDEX "contacts_user_id_idx" ON "contacts"("user_id");

-- CreateIndex
CREATE INDEX "file_system_nodes_parent_id_idx" ON "file_system_nodes"("parent_id");

-- CreateIndex
CREATE INDEX "file_system_nodes_server_id_idx" ON "file_system_nodes"("server_id");

-- CreateIndex
CREATE INDEX "game_servers_owner_id_idx" ON "game_servers"("owner_id");

-- CreateIndex
CREATE INDEX "hack_logs_attacker_id_idx" ON "hack_logs"("attacker_id");

-- CreateIndex
CREATE INDEX "hack_logs_target_id_idx" ON "hack_logs"("target_id");

-- CreateIndex
CREATE INDEX "hack_logs_timestamp_idx" ON "hack_logs"("timestamp");

-- CreateIndex
CREATE INDEX "user_sessions_expires_at_idx" ON "user_sessions"("expires_at");

-- CreateIndex
CREATE INDEX "user_sessions_user_id_idx" ON "user_sessions"("user_id");

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_contact_user_id_fkey" FOREIGN KEY ("contact_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hack_logs" ADD CONSTRAINT "hack_logs_attacker_id_fkey" FOREIGN KEY ("attacker_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hack_logs" ADD CONSTRAINT "hack_logs_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hack_logs" ADD CONSTRAINT "hack_logs_target_server_id_fkey" FOREIGN KEY ("target_server_id") REFERENCES "game_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
