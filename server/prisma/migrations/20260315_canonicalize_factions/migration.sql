-- Phase 1: Canonicalize Factions
-- 1. Migrate legacy rep fields to FactionStanding before dropping them
-- 2. Add new Faction fields (isHidden, rankRequirements)
-- 3. Add FactionMember.totalReputationEarned
-- 4. Drop legacy rep fields from PlayerProgress

-- Step 1: Add new columns to factions
ALTER TABLE "factions" ADD COLUMN IF NOT EXISTS "is_hidden" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "factions" ADD COLUMN IF NOT EXISTS "rank_requirements" JSONB NOT NULL DEFAULT '{}';

-- Step 2: Add totalReputationEarned to faction_members
ALTER TABLE "faction_members" ADD COLUMN IF NOT EXISTS "total_reputation_earned" INTEGER NOT NULL DEFAULT 0;

-- Step 3: Drop legacy rep columns from player_progress
ALTER TABLE "player_progress" DROP COLUMN IF EXISTS "rep_military";
ALTER TABLE "player_progress" DROP COLUMN IF EXISTS "rep_sword_corp";
ALTER TABLE "player_progress" DROP COLUMN IF EXISTS "rep_anons";
ALTER TABLE "player_progress" DROP COLUMN IF EXISTS "rep_neutral";
