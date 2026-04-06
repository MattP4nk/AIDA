-- DropForeignKey
ALTER TABLE "censorship_rules" DROP CONSTRAINT "censorship_rules_server_id_fkey";

-- DropForeignKey
ALTER TABLE "faction_wars" DROP CONSTRAINT "faction_wars_attacker_faction_id_fkey";

-- DropForeignKey
ALTER TABLE "faction_wars" DROP CONSTRAINT "faction_wars_defender_faction_id_fkey";

-- DropForeignKey
ALTER TABLE "file_system_nodes" DROP CONSTRAINT "file_system_nodes_created_by_fkey";

-- DropForeignKey
ALTER TABLE "file_system_nodes" DROP CONSTRAINT "file_system_nodes_parent_id_fkey";

-- DropForeignKey
ALTER TABLE "forum_posts" DROP CONSTRAINT "forum_posts_author_id_fkey";

-- DropForeignKey
ALTER TABLE "forum_replies" DROP CONSTRAINT "forum_replies_author_id_fkey";

-- DropForeignKey
ALTER TABLE "forums" DROP CONSTRAINT "forums_faction_id_fkey";

-- DropForeignKey
ALTER TABLE "messages" DROP CONSTRAINT "messages_recipient_id_fkey";

-- DropForeignKey
ALTER TABLE "messages" DROP CONSTRAINT "messages_sender_id_fkey";

-- DropForeignKey
ALTER TABLE "server_contests" DROP CONSTRAINT "server_contests_attacking_faction_id_fkey";

-- DropForeignKey
ALTER TABLE "server_contests" DROP CONSTRAINT "server_contests_server_id_fkey";

-- AlterTable
ALTER TABLE "file_system_nodes" ALTER COLUMN "created_by" DROP NOT NULL;

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "encryption_key" TEXT;

-- AddForeignKey
ALTER TABLE "file_system_nodes" ADD CONSTRAINT "file_system_nodes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_system_nodes" ADD CONSTRAINT "file_system_nodes_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "file_system_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_posts" ADD CONSTRAINT "forum_posts_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_replies" ADD CONSTRAINT "forum_replies_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forums" ADD CONSTRAINT "forums_faction_id_fkey" FOREIGN KEY ("faction_id") REFERENCES "factions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "server_contests" ADD CONSTRAINT "server_contests_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "game_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "server_contests" ADD CONSTRAINT "server_contests_attacking_faction_id_fkey" FOREIGN KEY ("attacking_faction_id") REFERENCES "factions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faction_wars" ADD CONSTRAINT "faction_wars_attacker_faction_id_fkey" FOREIGN KEY ("attacker_faction_id") REFERENCES "factions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faction_wars" ADD CONSTRAINT "faction_wars_defender_faction_id_fkey" FOREIGN KEY ("defender_faction_id") REFERENCES "factions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "censorship_rules" ADD CONSTRAINT "censorship_rules_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "game_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
