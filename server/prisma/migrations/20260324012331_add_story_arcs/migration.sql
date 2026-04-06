-- AlterTable
ALTER TABLE "missions" ADD COLUMN     "story_arc_id" TEXT,
ADD COLUMN     "story_step" INTEGER;

-- CreateTable
CREATE TABLE "story_arcs" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "faction_id" TEXT NOT NULL,
    "issued_by" TEXT NOT NULL,
    "assigned_to" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "current_step" INTEGER NOT NULL DEFAULT 0,
    "total_steps" INTEGER NOT NULL,
    "steps" JSONB NOT NULL DEFAULT '[]',
    "narrative_context" JSONB NOT NULL DEFAULT '{}',
    "difficulty" INTEGER NOT NULL DEFAULT 3,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "story_arcs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "story_arcs_assigned_to_status_idx" ON "story_arcs"("assigned_to", "status");

-- CreateIndex
CREATE INDEX "story_arcs_faction_id_idx" ON "story_arcs"("faction_id");

-- CreateIndex
CREATE INDEX "missions_story_arc_id_idx" ON "missions"("story_arc_id");

-- AddForeignKey
ALTER TABLE "missions" ADD CONSTRAINT "missions_story_arc_id_fkey" FOREIGN KEY ("story_arc_id") REFERENCES "story_arcs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_arcs" ADD CONSTRAINT "story_arcs_faction_id_fkey" FOREIGN KEY ("faction_id") REFERENCES "factions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_arcs" ADD CONSTRAINT "story_arcs_issued_by_fkey" FOREIGN KEY ("issued_by") REFERENCES "ai_personas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_arcs" ADD CONSTRAINT "story_arcs_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
