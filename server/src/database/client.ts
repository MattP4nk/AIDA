import { PrismaClient } from "@prisma/client";
import logger from "../logger";
import { config } from "../config/environment";

// Custom Prisma client with logging and error handling
class DatabaseClient {
  private static instance: DatabaseClient;
  private prisma: PrismaClient;

  private constructor() {
    this.prisma = new PrismaClient({
      datasources: {
        db: {
          url: this.buildConnectionUrl(),
        },
      },
      // Suppress "info" noise; lifecycle.ts handles shutdown logging
      log: config.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
      errorFormat: "pretty",
    });

    // Development only: log slow writes without dumping args (args may contain secrets)
    if (config.NODE_ENV === "development") {
      this.prisma.$use(async (params, next) => {
        const start = Date.now();
        const result = await next(params);
        const duration = Date.now() - start;
        if (
          (params.action === "create" ||
            params.action === "update" ||
            params.action === "delete") &&
          duration > 100
        ) {
          logger.info({ model: params.model, action: params.action, duration }, "Slow Prisma query");
        }
        return result;
      });
    }
    // Note: SIGINT/SIGTERM are handled by lifecycle.ts — do NOT register them here
  }

  // Append connection pool params to DATABASE_URL if not already configured
  private buildConnectionUrl(): string {
    const url = config.DATABASE_URL;
    if (url.includes("connection_limit")) return url;
    const poolSize = process.env.DATABASE_POOL_SIZE ?? "20";
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}connection_limit=${poolSize}&pool_timeout=20`;
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
      logger.info("Database connected successfully");
    } catch (error) {
      logger.error({ err: error }, "Database connection failed");
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    try {
      await this.prisma.$disconnect();
      logger.info("Database disconnected");
    } catch (error) {
      logger.error({ err: error }, "Error disconnecting from database");
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      logger.error({ err: error }, "Database health check failed");
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
      logger.error({ err: error }, "Database query error");
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
