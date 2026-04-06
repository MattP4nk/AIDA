-- AlterTable
ALTER TABLE "inventory_items" ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'shop',
ADD COLUMN     "source_id" TEXT;

-- AlterTable
ALTER TABLE "shop_items" ADD COLUMN     "effect" JSONB;

-- CreateTable
CREATE TABLE "narrative_epochs" (
    "id" TEXT NOT NULL,
    "epoch_num" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "world_state" JSONB NOT NULL DEFAULT '{}',
    "triggers" JSONB NOT NULL DEFAULT '[]',
    "decisions" JSONB NOT NULL DEFAULT '[]',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "narrative_epochs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "story_ledger" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "actor_type" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "detail" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "impact" JSONB NOT NULL DEFAULT '{}',
    "epoch_num" INTEGER,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "is_processed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "story_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "persona_messages" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "persona_id" TEXT NOT NULL,
    "token_item_id" TEXT,
    "direction" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "message_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "persona_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "narrative_epochs_epoch_num_key" ON "narrative_epochs"("epoch_num");

-- CreateIndex
CREATE INDEX "story_ledger_type_idx" ON "story_ledger"("type");

-- CreateIndex
CREATE INDEX "story_ledger_actor_id_idx" ON "story_ledger"("actor_id");

-- CreateIndex
CREATE INDEX "story_ledger_epoch_num_idx" ON "story_ledger"("epoch_num");

-- CreateIndex
CREATE INDEX "story_ledger_is_processed_created_at_idx" ON "story_ledger"("is_processed", "created_at");

-- CreateIndex
CREATE INDEX "story_ledger_category_idx" ON "story_ledger"("category");

-- CreateIndex
CREATE INDEX "persona_messages_user_id_persona_id_idx" ON "persona_messages"("user_id", "persona_id");

-- CreateIndex
CREATE INDEX "persona_messages_persona_id_idx" ON "persona_messages"("persona_id");

-- AddForeignKey
ALTER TABLE "persona_messages" ADD CONSTRAINT "persona_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "persona_messages" ADD CONSTRAINT "persona_messages_persona_id_fkey" FOREIGN KEY ("persona_id") REFERENCES "ai_personas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
