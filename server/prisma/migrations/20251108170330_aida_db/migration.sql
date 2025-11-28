-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "home_ip" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_login" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_online" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "ip_address" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_progress" (
    "user_id" TEXT NOT NULL,
    "discovery_level" INTEGER NOT NULL DEFAULT 0,
    "credits" INTEGER NOT NULL DEFAULT 1000,
    "level" INTEGER NOT NULL DEFAULT 1,
    "experience" INTEGER NOT NULL DEFAULT 0,
    "hacking" INTEGER NOT NULL DEFAULT 10,
    "networking" INTEGER NOT NULL DEFAULT 10,
    "cryptography" INTEGER NOT NULL DEFAULT 5,
    "stealth" INTEGER NOT NULL DEFAULT 10,
    "social_engineering" INTEGER NOT NULL DEFAULT 5,
    "forensics" INTEGER NOT NULL DEFAULT 5,
    "rep_military" INTEGER NOT NULL DEFAULT 0,
    "rep_sword_corp" INTEGER NOT NULL DEFAULT 0,
    "rep_anons" INTEGER NOT NULL DEFAULT 0,
    "rep_neutral" INTEGER NOT NULL DEFAULT 0,
    "mission_progress" JSONB NOT NULL DEFAULT '{}',
    "achievements" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "player_progress_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "game_servers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ip_address" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "owner_id" TEXT,
    "encryption_level" INTEGER NOT NULL DEFAULT 0,
    "access_rules" JSONB NOT NULL DEFAULT '[]',
    "is_online" BOOLEAN NOT NULL DEFAULT true,
    "max_connections" INTEGER NOT NULL DEFAULT 10,
    "current_connections" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "game_servers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_system_nodes" (
    "id" TEXT NOT NULL,
    "server_id" TEXT NOT NULL,
    "parent_id" TEXT,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "content" TEXT,
    "permissions" JSONB NOT NULL DEFAULT '{}',
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMP(3) NOT NULL,
    "size" INTEGER NOT NULL DEFAULT 0,
    "is_encrypted" BOOLEAN NOT NULL DEFAULT false,
    "encryption_key" TEXT,
    "is_hidden" BOOLEAN NOT NULL DEFAULT false,
    "is_protected" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "file_system_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "server_connections" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "server_id" TEXT NOT NULL,
    "connected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disconnected_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "session_data" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "server_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "sender_id" TEXT NOT NULL,
    "recipient_id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "is_encrypted" BOOLEAN NOT NULL DEFAULT false,
    "encryption_level" INTEGER,
    "message_type" TEXT NOT NULL DEFAULT 'private',
    "required_skill" JSONB,
    "trigger_event" TEXT,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "contact_user_id" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'unknown',
    "last_seen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "encryption_level" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "faction" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forum_posts" (
    "id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "forum_section" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_honeypot" BOOLEAN NOT NULL DEFAULT false,
    "faction_alignment" TEXT,
    "votes" INTEGER NOT NULL DEFAULT 0,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_sticky" BOOLEAN NOT NULL DEFAULT false,
    "is_locked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "forum_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forum_replies" (
    "id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "votes" INTEGER NOT NULL DEFAULT 0,
    "is_hidden" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "forum_replies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "missions" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "difficulty" INTEGER NOT NULL DEFAULT 1,
    "required_skills" JSONB NOT NULL DEFAULT '{}',
    "reward" JSONB NOT NULL DEFAULT '{}',
    "time_limit" INTEGER,
    "target_server_id" TEXT,
    "target_user_id" TEXT,
    "objectives" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'available',
    "assigned_to" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "missions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_events" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "affected_users" TEXT[],
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "is_global" BOOLEAN NOT NULL DEFAULT false,
    "severity" TEXT NOT NULL DEFAULT 'info',

    CONSTRAINT "game_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hack_logs" (
    "id" TEXT NOT NULL,
    "attacker_id" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "target_server_id" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "tools" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "stealth_level" INTEGER NOT NULL,
    "success" BOOLEAN NOT NULL,
    "detected" BOOLEAN NOT NULL,
    "access_level" INTEGER NOT NULL,
    "evidence_left" INTEGER NOT NULL,
    "counter_measures" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "hack_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "action" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "resource_id" TEXT,
    "old_values" JSONB,
    "new_values" JSONB,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_config" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "game_config_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "factions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "hostility_level" INTEGER NOT NULL DEFAULT 0,
    "resources" INTEGER NOT NULL DEFAULT 50,
    "known_servers" TEXT[],
    "active_members" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "factions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_home_ip_key" ON "users"("home_ip");

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_token_key" ON "user_sessions"("token");

-- CreateIndex
CREATE UNIQUE INDEX "game_servers_ip_address_key" ON "game_servers"("ip_address");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_user_id_contact_user_id_key" ON "contacts"("user_id", "contact_user_id");

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_progress" ADD CONSTRAINT "player_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_servers" ADD CONSTRAINT "game_servers_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_system_nodes" ADD CONSTRAINT "file_system_nodes_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "game_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_system_nodes" ADD CONSTRAINT "file_system_nodes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_system_nodes" ADD CONSTRAINT "file_system_nodes_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "file_system_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "server_connections" ADD CONSTRAINT "server_connections_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "game_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_contact_user_id_fkey" FOREIGN KEY ("contact_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_posts" ADD CONSTRAINT "forum_posts_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_replies" ADD CONSTRAINT "forum_replies_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "forum_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_replies" ADD CONSTRAINT "forum_replies_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "missions" ADD CONSTRAINT "missions_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "missions" ADD CONSTRAINT "missions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hack_logs" ADD CONSTRAINT "hack_logs_attacker_id_fkey" FOREIGN KEY ("attacker_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hack_logs" ADD CONSTRAINT "hack_logs_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hack_logs" ADD CONSTRAINT "hack_logs_target_server_id_fkey" FOREIGN KEY ("target_server_id") REFERENCES "game_servers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
