-- AlterTable
ALTER TABLE "player_progress" ADD COLUMN     "home_firewall" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "home_honeypot" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "home_ids" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "home_vault" INTEGER NOT NULL DEFAULT 0;
