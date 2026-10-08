/**
 * An IP address no server and no player home is using — for harness fixtures.
 *
 * Harnesses used to build fixture IPs from the process id
 * (`10.45.${n}.${process.pid % 250}`), assuming those ranges were empty. They
 * are not: the player-home allocator gives each player an isolated /16 —
 * only 254 exist — and the dev DB's harness accounts exhausted them long ago,
 * so every new home now lands at a random address in a shared range. A fixed
 * fixture address then collides by luck (verify-war-scoring, 2026-10-08:
 * P2002 on `ip_address`). This picks a random address and proves it free.
 */
import type { PrismaClient } from "@prisma/client";

const issued = new Set<string>();
const rand = (n: number) => Math.floor(Math.random() * n);

export async function freeIp(prisma: PrismaClient): Promise<string> {
  for (let i = 0; i < 200; i++) {
    const ip = `10.${200 + rand(50)}.${rand(256)}.${1 + rand(254)}`;
    if (issued.has(ip)) continue; // this run already handed it out
    const server = await prisma.gameServer.findUnique({ where: { ipAddress: ip }, select: { id: true } });
    const home = server ? null : await prisma.user.findFirst({ where: { homeIp: ip }, select: { id: true } });
    if (!server && !home) {
      issued.add(ip);
      return ip;
    }
  }
  throw new Error("freeIp: no free address after 200 tries");
}
