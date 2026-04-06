-- CreateTable
CREATE TABLE "shop_items" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "item_type" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'general',
    "price" INTEGER NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "hacking_bonus" INTEGER NOT NULL DEFAULT 0,
    "stealth_bonus" INTEGER NOT NULL DEFAULT 0,
    "cryptography_bonus" INTEGER NOT NULL DEFAULT 0,
    "networking_bonus" INTEGER NOT NULL DEFAULT 0,
    "is_consumable" BOOLEAN NOT NULL DEFAULT false,
    "is_stackable" BOOLEAN NOT NULL DEFAULT false,
    "max_stack" INTEGER NOT NULL DEFAULT 1,
    "rarity" TEXT NOT NULL DEFAULT 'common',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "stock" INTEGER,
    "restock_time" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shop_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_items" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "shop_item_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "is_equipped" BOOLEAN NOT NULL DEFAULT false,
    "slot" TEXT,
    "acquired_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3),
    "uses_remaining" INTEGER,
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'general',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "data" JSONB NOT NULL DEFAULT '{}',
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "is_dismissed" BOOLEAN NOT NULL DEFAULT false,
    "read_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shop_items_item_type_idx" ON "shop_items"("item_type");

-- CreateIndex
CREATE INDEX "shop_items_category_idx" ON "shop_items"("category");

-- CreateIndex
CREATE INDEX "shop_items_is_active_idx" ON "shop_items"("is_active");

-- CreateIndex
CREATE INDEX "inventory_items_user_id_idx" ON "inventory_items"("user_id");

-- CreateIndex
CREATE INDEX "inventory_items_shop_item_id_idx" ON "inventory_items"("shop_item_id");

-- CreateIndex
CREATE INDEX "inventory_items_is_equipped_idx" ON "inventory_items"("is_equipped");

-- CreateIndex
CREATE INDEX "notifications_user_id_idx" ON "notifications"("user_id");

-- CreateIndex
CREATE INDEX "notifications_is_read_idx" ON "notifications"("is_read");

-- CreateIndex
CREATE INDEX "notifications_type_idx" ON "notifications"("type");

-- CreateIndex
CREATE INDEX "notifications_category_idx" ON "notifications"("category");

-- CreateIndex
CREATE INDEX "notifications_created_at_idx" ON "notifications"("created_at");

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_shop_item_id_fkey" FOREIGN KEY ("shop_item_id") REFERENCES "shop_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
