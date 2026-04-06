import { db } from "../database/client";
import type {
  IPRange,
  IPOwner,
  DiscoveryResult,
  TraceRouteResult,
  TraceRouteHop,
} from "../types/game";
import { IPZone } from "../types/game";
import { injectable, inject } from "tsyringe";
import { LOGGER } from "../di/tokens";
import type { Logger } from "pino";

@injectable()
class IPService {
  private allocatedIPs: Set<string>;
  private ipRanges: Map<IPZone, IPRange>;
  private initialized: boolean;

  constructor(@inject(LOGGER) private logger: Logger) {
    this.allocatedIPs = new Set();
    this.ipRanges = new Map();
    this.initialized = false;
    this.initializeIPRanges();
  }

  // ==================== INITIALIZATION ====================

  private initializeIPRanges(): void {
    // Player home networks (10.1.0.1 – 10.254.255.254)
    // Each player gets a unique /16 subnet via the second octet (10.X.x.x)
    // so players cannot discover each other by scanning from home.
    this.ipRanges.set(IPZone.PLAYER, {
      start: process.env.PLAYER_IP_RANGE_START || "10.1.0.1",
      end: process.env.PLAYER_IP_RANGE_END || "10.254.255.254",
      zone: IPZone.PLAYER,
      description: "Player home networks (isolated /16 subnets)",
    });

    // Corporate servers (172.16.0.0/12)
    this.ipRanges.set(IPZone.CORPORATE, {
      start: process.env.CORPORATE_IP_RANGE_START || "172.16.0.1",
      end: process.env.CORPORATE_IP_RANGE_END || "172.31.255.254",
      zone: IPZone.CORPORATE,
      description: "Corporate servers",
    });

    // Government servers (192.168.0.0/16)
    this.ipRanges.set(IPZone.GOVERNMENT, {
      start: process.env.GOVERNMENT_IP_RANGE_START || "192.168.0.1",
      end: process.env.GOVERNMENT_IP_RANGE_END || "192.168.255.254",
      zone: IPZone.GOVERNMENT,
      description: "Government servers",
    });

    // Underground networks (169.254.0.0/16)
    this.ipRanges.set(IPZone.UNDERGROUND, {
      start: process.env.UNDERGROUND_IP_RANGE_START || "169.254.0.1",
      end: process.env.UNDERGROUND_IP_RANGE_END || "169.254.255.254",
      zone: IPZone.UNDERGROUND,
      description: "Underground networks",
    });

    this.logger.info(
      { zones: Array.from(this.ipRanges.keys()) },
      "IP ranges initialized",
    );
  }

  public async loadAllocatedIPs(): Promise<void> {
    this.logger.info("Loading allocated IPs from database");

    try {
      // Load user IPs
      const users = await db.client.user.findMany({
        select: { homeIp: true },
      });

      users.forEach((user) => {
        if (user.homeIp) {
          this.allocatedIPs.add(user.homeIp);
        }
      });

      // Load server IPs
      const servers = await db.client.gameServer.findMany({
        select: { ipAddress: true },
      });

      servers.forEach((server) => {
        this.allocatedIPs.add(server.ipAddress);
      });

      this.initialized = true;
      this.logger.info(
        { count: this.allocatedIPs.size },
        "Loaded allocated IPs",
      );
    } catch (error) {
      this.logger.error({ err: error }, "Error loading allocated IPs");
      throw error;
    }
  }

  // ==================== IP GENERATION ====================

  public async generateUniqueIP(zone: IPZone = IPZone.PLAYER): Promise<string> {
    const range = this.ipRanges.get(zone);
    if (!range) {
      throw new Error(`Invalid IP zone: ${zone}`);
    }

    let attempts = 0;
    const maxAttempts = 1000;

    while (attempts < maxAttempts) {
      const ip = this.generateRandomIPInRange(range);

      // Reserve in-memory immediately to prevent concurrent generation of same IP
      if (this.allocatedIPs.has(ip)) {
        attempts++;
        continue;
      }
      this.allocatedIPs.add(ip);

      // Verify against database (authoritative check)
      if (await this.isIPAvailableInDB(ip)) {
        this.logger.info({ ip, zone }, "Generated unique IP");
        return ip;
      }

      // DB says it's taken — already added to cache by isIPAvailableInDB, move on
      attempts++;
    }

    throw new Error(
      `Failed to generate unique IP in zone ${zone} after ${maxAttempts} attempts`,
    );
  }

  /**
   * Generate a home IP for a new player on an isolated /16 subnet.
   *
   * Picks a random second octet (1–254) that no other player is using,
   * producing an IP like 10.{unique}.{rand}.{rand}.  This ensures that
   * scanning from home (which matches on the first two octets) will never
   * reveal another player's home server.
   *
   * Falls back to generateUniqueIP(PLAYER) if all /16 subnets are taken
   * (extremely unlikely — 254 subnets).
   */
  public async generatePlayerHomeIP(): Promise<string> {
    // Collect second octets already in use by player home servers
    const existingHomes = await db.client.gameServer.findMany({
      where: { isPlayerHome: true },
      select: { ipAddress: true },
    });

    const usedOctets = new Set<number>();
    for (const srv of existingHomes) {
      const parts = srv.ipAddress.split(".");
      if (parts[0] === "10") {
        usedOctets.add(Number(parts[1]));
      }
    }

    // Also check user homeIps that may not yet have a GameServer row
    const existingUsers = await db.client.user.findMany({
      where: { homeIp: { startsWith: "10." } },
      select: { homeIp: true },
    });
    for (const u of existingUsers) {
      if (u.homeIp) {
        const parts = u.homeIp.split(".");
        usedOctets.add(Number(parts[1]));
      }
    }

    // Build pool of available second octets (1–254)
    const available: number[] = [];
    for (let o = 1; o <= 254; o++) {
      if (!usedOctets.has(o)) {
        available.push(o);
      }
    }

    if (available.length === 0) {
      // All 254 subnets taken — fall back to generic generation (players may share)
      this.logger.warn(
        "All player /16 subnets exhausted, falling back to shared range",
      );
      return this.generateUniqueIP(IPZone.PLAYER);
    }

    // Pick a random available second octet
    const secondOctet =
      available[Math.floor(Math.random() * available.length)]!;

    // Generate a random IP within 10.{secondOctet}.0.1 – 10.{secondOctet}.255.254
    let attempts = 0;
    const maxAttempts = 100;

    while (attempts < maxAttempts) {
      const thirdOctet = Math.floor(Math.random() * 256); // 0–255
      const fourthOctet = Math.floor(Math.random() * 254) + 1; // 1–254
      const ip = `10.${secondOctet}.${thirdOctet}.${fourthOctet}`;

      if (this.allocatedIPs.has(ip)) {
        attempts++;
        continue;
      }
      this.allocatedIPs.add(ip);

      if (await this.isIPAvailableInDB(ip)) {
        this.logger.info(
          { ip, subnet: `10.${secondOctet}` },
          "Generated isolated player home IP",
        );
        return ip;
      }
      attempts++;
    }

    // Shouldn't happen on a fresh subnet, but handle gracefully
    throw new Error(
      `Failed to generate player home IP in subnet 10.${secondOctet}.x.x`,
    );
  }

  private generateRandomIPInRange(range: IPRange): string {
    const startOctets = range.start.split(".").map(Number);
    const endOctets = range.end.split(".").map(Number);

    const octets: number[] = [];

    for (let i = 0; i < 4; i++) {
      const min = startOctets[i] ?? 0;
      const max = endOctets[i] ?? 255;
      const octet = Math.floor(Math.random() * (max - min + 1)) + min;
      octets.push(octet);
    }

    return octets.join(".");
  }

  public async isIPAvailable(ip: string): Promise<boolean> {
    // Check in-memory cache first (fast)
    if (this.allocatedIPs.has(ip)) {
      return false;
    }

    return this.isIPAvailableInDB(ip);
  }

  /**
   * DB-only availability check — used by generateUniqueIP after in-memory reservation.
   */
  private async isIPAvailableInDB(ip: string): Promise<boolean> {
    try {
      const userWithIP = await db.client.user.findUnique({
        where: { homeIp: ip },
      });

      if (userWithIP) {
        this.allocatedIPs.add(ip);
        return false;
      }

      const serverWithIP = await db.client.gameServer.findUnique({
        where: { ipAddress: ip },
      });

      if (serverWithIP) {
        this.allocatedIPs.add(ip);
        return false;
      }

      return true;
    } catch (error) {
      this.logger.error({ err: error }, "Error checking IP availability");
      // Assume not available on error (safer)
      return false;
    }
  }

  // ==================== IP ALLOCATION ====================

  public async assignIPToUser(
    userId: string,
    zone: IPZone = IPZone.PLAYER,
  ): Promise<string> {
    try {
      // Check if user already has an IP
      const user = await db.client.user.findUnique({
        where: { id: userId },
        select: { homeIp: true },
      });

      if (user?.homeIp) {
        this.logger.warn({ userId, ip: user.homeIp }, "User already has IP");
        return user.homeIp;
      }

      // For PLAYER zone, use the isolated-subnet generator so each
      // player gets their own /16.  Other zones use the generic path.
      const ip =
        zone === IPZone.PLAYER
          ? await this.generatePlayerHomeIP()
          : await this.generateUniqueIP(zone);

      // Assign to user in database
      await db.client.user.update({
        where: { id: userId },
        data: { homeIp: ip },
      });

      this.logger.info({ ip, userId }, "Assigned IP to user");
      return ip;
    } catch (error) {
      this.logger.error({ err: error, userId }, "Error assigning IP to user");
      throw error;
    }
  }

  public async assignIPToServer(
    serverId: string,
    zone: IPZone = IPZone.CORPORATE,
  ): Promise<string> {
    try {
      // Check if server already has an IP
      const server = await db.client.gameServer.findUnique({
        where: { id: serverId },
        select: { ipAddress: true },
      });

      if (server?.ipAddress) {
        this.logger.warn(
          { serverId, ip: server.ipAddress },
          "Server already has IP",
        );
        return server.ipAddress;
      }

      // Generate new unique IP
      const ip = await this.generateUniqueIP(zone);

      // Assign to server in database
      await db.client.gameServer.update({
        where: { id: serverId },
        data: { ipAddress: ip },
      });

      this.logger.info({ ip, serverId }, "Assigned IP to server");
      return ip;
    } catch (error) {
      this.logger.error(
        { err: error, serverId },
        "Error assigning IP to server",
      );
      throw error;
    }
  }

  // ==================== IP DISCOVERY ====================

  public async getIPOwner(ip: string): Promise<IPOwner | null> {
    try {
      // Check if it's a user
      const user = await db.client.user.findUnique({
        where: { homeIp: ip },
        select: {
          id: true,
          username: true,
          homeIp: true,
          isOnline: true,
        },
      });

      if (user) {
        const zone = this.getIPZone(ip);
        return {
          type: "user",
          id: user.id,
          name: user.username,
          ip: user.homeIp,
          isOnline: user.isOnline,
          zone: zone || IPZone.PLAYER,
          metadata: {
            username: user.username,
          },
        };
      }

      // Check if it's a server
      const server = await db.client.gameServer.findUnique({
        where: { ipAddress: ip },
        select: {
          id: true,
          name: true,
          ipAddress: true,
          type: true,
          isOnline: true,
          ownerId: true,
          encryptionLevel: true,
        },
      });

      if (server) {
        const zone = this.getIPZone(ip);
        return {
          type: "server",
          id: server.id,
          name: server.name,
          ip: server.ipAddress,
          isOnline: server.isOnline,
          zone: zone || IPZone.CORPORATE,
          metadata: {
            serverType: server.type,
            ownerId: server.ownerId,
            encryptionLevel: server.encryptionLevel,
          },
        };
      }

      // IP not found
      return null;
    } catch (error) {
      this.logger.error({ err: error, ip }, "Error getting IP owner");
      return null;
    }
  }

  public async discoverIP(
    fromUserId: string,
    targetIP: string,
  ): Promise<DiscoveryResult> {
    try {
      // Validate IP format
      if (!this.validateIPFormat(targetIP)) {
        return {
          success: false,
          discovered: false,
          message: "Invalid IP address format",
        };
      }

      // Get attacker's skills
      const user = await db.client.user.findUnique({
        where: { id: fromUserId },
        include: { progress: true },
      });

      if (!user || !user.progress) {
        return {
          success: false,
          discovered: false,
          message: "User not found",
        };
      }

      // Try to find the target
      const owner = await this.getIPOwner(targetIP);

      if (!owner) {
        return {
          success: true,
          discovered: false,
          message: "No active system found at this IP address",
        };
      }

      // Calculate discovery chance based on networking skill
      // Base 50% + (networking skill * 0.5%) = max 100%
      const baseChance = 50;
      const skillBonus = user.progress.networking * 0.5;
      const discoveryChance = Math.min(baseChance + skillBonus, 95);

      const roll = Math.random() * 100;

      if (roll < discoveryChance) {
        // Full discovery
        return {
          success: true,
          discovered: true,
          target: owner,
          message: `Discovered ${owner.type}: ${owner.name} at ${targetIP}`,
          partialInfo: false,
        };
      } else if (roll < discoveryChance + 20) {
        // Partial discovery (only type and zone)
        return {
          success: true,
          discovered: true,
          target: {
            ...owner,
            name: "???",
            id: "unknown",
          },
          message: `Detected ${owner.type} at ${targetIP} but couldn't identify it`,
          partialInfo: true,
        };
      } else {
        // Failed discovery
        return {
          success: true,
          discovered: false,
          message: "Unable to identify system at this address",
        };
      }
    } catch (error) {
      this.logger.error({ err: error, targetIP }, "Error discovering IP");
      return {
        success: false,
        discovered: false,
        message: "Discovery failed due to an error",
      };
    }
  }

  // ==================== TRACEROUTE ====================

  public async traceRoute(
    fromIP: string,
    toIP: string,
  ): Promise<TraceRouteResult> {
    try {
      // Validate IPs
      if (!this.validateIPFormat(fromIP) || !this.validateIPFormat(toIP)) {
        return {
          success: false,
          route: [],
          totalHops: 0,
          reachable: false,
        };
      }

      // Check if target exists
      const target = await this.getIPOwner(toIP);
      const reachable = target !== null && target.isOnline;

      // Generate route hops
      const route: TraceRouteHop[] = [];
      const minHops = 3;
      const maxHops = 8;
      const numHops =
        Math.floor(Math.random() * (maxHops - minHops + 1)) + minHops;

      // Add starting hop (from IP)
      route.push({
        hopNumber: 1,
        ip: fromIP,
        name: "origin",
        latency: 1,
        hidden: false,
      });

      // Add intermediate hops
      for (let i = 2; i < numHops; i++) {
        const isHidden = Math.random() < 0.2; // 20% chance of hidden hop
        const latency = Math.floor(Math.random() * 50) + 10 + i * 5;

        route.push({
          hopNumber: i,
          ip: isHidden
            ? "?.?.?.?"
            : this.generateRandomIPInRange(
                this.ipRanges.get(IPZone.CORPORATE)!,
              ),
          name: isHidden ? "hidden" : `router-${i}`,
          latency,
          hidden: isHidden,
        });
      }

      // Add final hop (destination)
      if (reachable) {
        route.push({
          hopNumber: numHops,
          ip: toIP,
          name: target!.name,
          latency: Math.floor(Math.random() * 50) + 100,
          hidden: false,
        });
      }

      return {
        success: true,
        route,
        totalHops: route.length,
        reachable,
      };
    } catch (error) {
      this.logger.error({ err: error, fromIP, toIP }, "Error tracing route");
      return {
        success: false,
        route: [],
        totalHops: 0,
        reachable: false,
      };
    }
  }

  // ==================== IP VALIDATION ====================

  public validateIPFormat(ip: string): boolean {
    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;

    if (!ipRegex.test(ip)) {
      return false;
    }

    const octets = ip.split(".").map(Number);
    return octets.every((octet) => octet >= 0 && octet <= 255);
  }

  public getIPZone(ip: string): IPZone | null {
    if (!this.validateIPFormat(ip)) {
      return null;
    }

    for (const [zone, range] of this.ipRanges.entries()) {
      if (this.isIPInRange(ip, range)) {
        return zone;
      }
    }

    return null;
  }

  private isIPInRange(ip: string, range: IPRange): boolean {
    const ipNum = this.ipToNumber(ip);
    const startNum = this.ipToNumber(range.start);
    const endNum = this.ipToNumber(range.end);

    return ipNum >= startNum && ipNum <= endNum;
  }

  private ipToNumber(ip: string): number {
    const octets = ip.split(".").map(Number);
    return (
      (((octets[0] ?? 0) << 24) |
        ((octets[1] ?? 0) << 16) |
        ((octets[2] ?? 0) << 8) |
        (octets[3] ?? 0)) >>>
      0
    );
  }

  // ==================== NETWORK SCANNING ====================

  public async scanIPRange(
    fromUserId: string,
    rangeStart: string,
    rangeEnd: string,
  ): Promise<IPOwner[]> {
    try {
      // Get user's networking skill
      const user = await db.client.user.findUnique({
        where: { id: fromUserId },
        include: { progress: true },
      });

      if (!user || !user.progress) {
        return [];
      }

      // Validate IP range
      if (
        !this.validateIPFormat(rangeStart) ||
        !this.validateIPFormat(rangeEnd)
      ) {
        return [];
      }

      const startNum = this.ipToNumber(rangeStart);
      const endNum = this.ipToNumber(rangeEnd);

      // Limit scan range to prevent abuse
      const maxRange = 256;
      const rangeSize = endNum - startNum + 1;

      if (rangeSize > maxRange) {
        this.logger.warn({ rangeSize, maxRange }, "Scan range too large");
        return [];
      }

      // Calculate scan success rate based on networking skill
      const baseSuccessRate = 40;
      const skillBonus = user.progress.networking * 0.5;
      const successRate = Math.min(baseSuccessRate + skillBonus, 90);

      const discovered: IPOwner[] = [];

      // Scan each IP in range
      for (let i = startNum; i <= endNum && i <= startNum + maxRange - 1; i++) {
        const ip = this.numberToIP(i);

        // Random chance to discover each IP
        if (Math.random() * 100 < successRate) {
          const owner = await this.getIPOwner(ip);
          if (owner && owner.isOnline) {
            discovered.push(owner);
          }
        }
      }

      this.logger.info(
        { rangeStart, rangeEnd, found: discovered.length },
        "IP range scan complete",
      );
      return discovered;
    } catch (error) {
      this.logger.error({ err: error }, "Error scanning IP range");
      return [];
    }
  }

  private numberToIP(num: number): string {
    const octet1 = (num >>> 24) & 0xff;
    const octet2 = (num >>> 16) & 0xff;
    const octet3 = (num >>> 8) & 0xff;
    const octet4 = num & 0xff;

    return `${octet1}.${octet2}.${octet3}.${octet4}`;
  }

  // ==================== UTILITY METHODS ====================

  public getIPRanges(): Map<IPZone, IPRange> {
    return this.ipRanges;
  }

  public getAllocatedIPsCount(): number {
    return this.allocatedIPs.size;
  }

  public isInitialized(): boolean {
    return this.initialized;
  }

  public getStats() {
    return {
      allocatedIPs: this.allocatedIPs.size,
      zones: Array.from(this.ipRanges.keys()),
      initialized: this.initialized,
    };
  }

  // ==================== MAINTENANCE ====================

  public async refreshAllocatedIPs(): Promise<void> {
    this.logger.info("Refreshing allocated IPs");
    this.allocatedIPs.clear();
    await this.loadAllocatedIPs();
  }

  public async cleanupOrphanedIPs(): Promise<number> {
    this.logger.info("Checking for orphaned IPs");

    try {
      let cleaned = 0;

      // Check for users without IPs
      const usersWithoutIP = await db.client.user.findMany({
        where: {
          homeIp: "",
        },
        select: { id: true },
      });

      for (const user of usersWithoutIP) {
        await this.assignIPToUser(user.id);
        cleaned++;
      }

      this.logger.info(
        { count: cleaned },
        "Cleaned up orphaned IP allocations",
      );
      return cleaned;
    } catch (error) {
      this.logger.error({ err: error }, "Error cleaning up orphaned IPs");
      return 0;
    }
  }
}

export default IPService;
