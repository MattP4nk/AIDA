import { PrismaClient } from "@prisma/client";
import { config } from "../config/environment";

// Custom Prisma client with logging and error handling
class DatabaseClient {
  private static instance: DatabaseClient;
  private prisma: PrismaClient;

  private constructor() {
    this.prisma = new PrismaClient({
      datasources: {
        db: {
          url: config.DATABASE_URL,
        },
      },
      log:
        config.NODE_ENV === "development"
          ? ["query", "info", "warn", "error"]
          : ["error"],
      errorFormat: "pretty",
    });

    // Handle graceful shutdown
    process.on("SIGINT", this.disconnect.bind(this));
    process.on("SIGTERM", this.disconnect.bind(this));
  }

  static getInstance(): DatabaseClient {
    if (!DatabaseClient.instance) {
      DatabaseClient.instance = new DatabaseClient();
    }
    return DatabaseClient.instance;
  }

  get client(): PrismaClient {
    return this.prisma;
  }

  async connect(): Promise<void> {
    try {
      await this.prisma.$connect();
      console.log("🗄️  Database connected successfully");
    } catch (error) {
      console.error("❌ Database connection failed:", error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    try {
      await this.prisma.$disconnect();
      console.log("🗄️  Database disconnected");
    } catch (error) {
      console.error("❌ Error disconnecting from database:", error);
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      console.error("❌ Database health check failed:", error);
      return false;
    }
  }

  async executeTransaction<T>(
    fn: (
      tx: Omit<
        PrismaClient,
        | "$connect"
        | "$disconnect"
        | "$on"
        | "$transaction"
        | "$use"
        | "$extends"
      >,
    ) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(fn, {
      maxWait: 5000, // 5 seconds
      timeout: 10000, // 10 seconds
    }) as Promise<T>;
  }

  // Helper method for safe queries with error handling
  async safeQuery<T>(
    queryFn: () => Promise<T>,
    defaultValue?: T,
  ): Promise<T | null> {
    try {
      return await queryFn();
    } catch (error) {
      console.error("Database query error:", error);
      return defaultValue || null;
    }
  }
}

// Export singleton instance
export const db = DatabaseClient.getInstance();
export const prisma = db.client;

// Export types for convenience
export type { PrismaClient } from "@prisma/client";
export * from "@prisma/client";
