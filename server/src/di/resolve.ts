import { container } from "tsyringe";

/**
 * Resolve a service from the DI container.
 *
 * A LEAF module on purpose — it imports only tsyringe. A5/A4: services used to
 * import `getService` from `di/container`, which imports every service, so
 * each such service closed an import cycle through the hub (one cyclic
 * component of 14 modules). This is the same function on the same global
 * container; `di/container` re-exports it for everything else.
 */
export function getService<T>(token: string | symbol): T {
  return container.resolve<T>(token as any);
}
