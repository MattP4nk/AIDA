import dotenv from "dotenv";
import path from "path";

// Load environment variables
dotenv.config();

interface EnvironmentConfig {
  NODE_ENV: string;
  PORT: number;
  HOST: string;

  // Database
  DATABASE_URL: string;

  // Security
  JWT_SECRET: string;
  JWT_EXPIRES_IN: string;
  BCRYPT_ROUNDS: number;

  // Redis (for sessions and caching)
  REDIS_URL?: string;

  // Rate limiting
  RATE_LIMIT_WINDOW_MS: number;
  RATE_LIMIT_MAX_REQUESTS: number;

  // Game settings
  MAX_CONCURRENT_PLAYERS: number;
  SESSION_TIMEOUT_MINUTES: number;
  HACK_COOLDOWN_SECONDS: number;

  // Multiplayer settings
  AUTO_SAVE_INTERVAL_SECONDS: number;

  // Security settings
  SCRIPT_EXECUTION_TIMEOUT_MS: number;
  SCRIPT_MEMORY_LIMIT_MB: number;

  // File upload limits
  MAX_FILE_SIZE_MB: number;
  MAX_FILES_PER_USER: number;

  // Logging
  LOG_LEVEL: string;
  LOG_FILE_PATH: string;
}

const getEnvVar = (key: string, defaultValue?: string): string => {
  const value = process.env[key];
  if (!value && !defaultValue) {
    throw new Error(`Environment variable ${key} is required`);
  }
  return value || defaultValue!;
};

const getEnvNumber = (key: string, defaultValue?: number): number => {
  const value = process.env[key];
  if (!value && defaultValue === undefined) {
    throw new Error(`Environment variable ${key} is required`);
  }
  return value ? parseInt(value, 10) : defaultValue!;
};

export const config: EnvironmentConfig = {
  NODE_ENV: getEnvVar("NODE_ENV", "development"),
  PORT: getEnvNumber("PORT", 3001),
  HOST: getEnvVar("HOST", "0.0.0.0"),

  // Database
  DATABASE_URL: getEnvVar("DATABASE_URL"),

  // Security
  JWT_SECRET: getEnvVar("JWT_SECRET"),
  JWT_EXPIRES_IN: getEnvVar("JWT_EXPIRES_IN", "24h"),
  BCRYPT_ROUNDS: getEnvNumber("BCRYPT_ROUNDS", 12),

  // Redis
  ...(process.env.REDIS_URL ? { REDIS_URL: process.env.REDIS_URL } : {}),

  // Rate limiting
  RATE_LIMIT_WINDOW_MS: getEnvNumber("RATE_LIMIT_WINDOW_MS", 15 * 60 * 1000), // 15 minutes
  RATE_LIMIT_MAX_REQUESTS: getEnvNumber("RATE_LIMIT_MAX_REQUESTS", 100),

  // Game settings
  MAX_CONCURRENT_PLAYERS: getEnvNumber("MAX_CONCURRENT_PLAYERS", 100),
  SESSION_TIMEOUT_MINUTES: getEnvNumber("SESSION_TIMEOUT_MINUTES", 60),
  HACK_COOLDOWN_SECONDS: getEnvNumber("HACK_COOLDOWN_SECONDS", 30),

  // Multiplayer settings
  AUTO_SAVE_INTERVAL_SECONDS: getEnvNumber("AUTO_SAVE_INTERVAL_SECONDS", 60),

  // Security settings
  SCRIPT_EXECUTION_TIMEOUT_MS: getEnvNumber(
    "SCRIPT_EXECUTION_TIMEOUT_MS",
    5000,
  ),
  SCRIPT_MEMORY_LIMIT_MB: getEnvNumber("SCRIPT_MEMORY_LIMIT_MB", 10),

  // File upload limits
  MAX_FILE_SIZE_MB: getEnvNumber("MAX_FILE_SIZE_MB", 1),
  MAX_FILES_PER_USER: getEnvNumber("MAX_FILES_PER_USER", 1000),

  // Logging
  LOG_LEVEL: getEnvVar("LOG_LEVEL", "info"),
  LOG_FILE_PATH: getEnvVar(
    "LOG_FILE_PATH",
    path.join(process.cwd(), "logs", "app.log"),
  ),
};

export const isDevelopment = config.NODE_ENV === "development";
export const isProduction = config.NODE_ENV === "production";
export const isTest = config.NODE_ENV === "test";

/** Single source of truth for allowed CORS origins */
const ORIGIN_REGEX = /^https?:\/\/[a-zA-Z0-9._-]+(:\d+)?$/;
export const CORS_ORIGINS: string[] = (() => {
  const defaults = ["http://localhost:8080", "http://localhost:8081", "http://localhost:5173"];
  if (!process.env.CORS_ORIGIN) return defaults;
  const origins = process.env.CORS_ORIGIN.split(",").map(s => s.trim()).filter(Boolean);
  // Validate all origins are proper URLs (reject wildcards, attacker domains with paths, etc.)
  for (const origin of origins) {
    if (!ORIGIN_REGEX.test(origin)) {
      throw new Error(`Invalid CORS origin: "${origin}" — must be http(s)://hostname(:port) with no path`);
    }
  }
  return origins.length > 0 ? origins : defaults;
})();

// Validation
export const validateConfig = (): void => {
  const required = ["DATABASE_URL", "JWT_SECRET"];

  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`Environment variable ${key} is required`);
    }
  }

  // Validate database URL format
  if (!config.DATABASE_URL.startsWith("postgresql://")) {
    throw new Error(
      "DATABASE_URL must be a valid PostgreSQL connection string",
    );
  }

  // Validate JWT secret length
  if (config.JWT_SECRET.length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters long");
  }

  // Validate numeric ranges
  if (config.PORT < 1000 || config.PORT > 65535) {
    throw new Error("PORT must be between 1000 and 65535");
  }

  if (config.BCRYPT_ROUNDS < 8 || config.BCRYPT_ROUNDS > 15) {
    throw new Error("BCRYPT_ROUNDS must be between 8 and 15");
  }

  if (config.MAX_CONCURRENT_PLAYERS < 1) {
    throw new Error("MAX_CONCURRENT_PLAYERS must be at least 1");
  }
};

export default config;
