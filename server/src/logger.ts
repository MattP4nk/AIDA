import pino from "pino";

const isDev = (process.env.NODE_ENV || "development") !== "production";
const level = process.env.LOG_LEVEL || (isDev ? "debug" : "info");

const devTransport: pino.TransportSingleOptions = {
  target: "pino-pretty",
  options: {
    colorize: true,
    translateTime: "HH:MM:ss.l",
    ignore: "pid,hostname",
    singleLine: true,
    levelFirst: true,
  },
};

const logger = pino({
  level,
  ...(isDev ? { transport: devTransport } : {}),
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  serializers: {
    err: pino.stdSerializers.err,
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
  },
});

/**
 * Create a child logger scoped to a service or subsystem.
 *
 * Usage:
 *   const log = createChildLogger("HackService");
 *   log.info("Session started");
 *   // => INFO [14:23:01.337] [HackService] Session started
 */
export function createChildLogger(name: string) {
  return logger.child({}, { msgPrefix: `[${name}] ` });
}

export default logger;
