import { config } from "./environment";

export const SESSION_TIMEOUT_MS = config.SESSION_TIMEOUT_MINUTES * 60 * 1000;
