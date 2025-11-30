import { db } from "../database/client";
import type {
  IPRange,
  IPOwner,
  DiscoveryResult,
  TraceRouteResult,
  TraceRouteHop,
} from "../types/game";
import { IPZone } from "../types/game";
import { injectable } from "tsyringe";

@injectable()
class IPService {
  private allocatedIPs: Set<string>;
  private ipRanges: Map<IPZone, IPRange>;
  private initialized: boolean;

  constructor() {
    this.allocatedIPs = new Set();
    this.ipRanges = new Map();
    this.initialized = false;
    this.initializeIPRanges();
  }

  // ==================== INITIALIZATION ====================

  private initializeIPRanges(): void {
    // Player home networks (10.0.0.0/16)
    this.ipRanges.set(IPZone.PLAYER, {
      start: process.env.PLAYER_IP_RANGE_START || "10.0.0.1",
      end: process.env.PLAYER_IP_RANGE_END || "10.0.255.254",
      zone: IPZone.PLAYER,
      description: "Player home networks",
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

    console.log("📡 IP ranges initialized:", Array.from(this.ipRanges.keys()));
  }

  public async loadAllocatedIPs(): Promise<void> {
    console.log("📡 Loading allocated IPs from database...");

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
      console.log(`✅ Loaded ${this.allocatedIPs.size} allocated IPs`);
    } catch (error) {
      console.error("❌ Error loading allocated IPs:", error);
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

      if (await this.isIPAvailable(ip)) {
        // Reserve the IP immediately
        this.allocatedIPs.add(ip);
        console.log(`✅ Generated unique IP: ${ip} in zone ${zone}`);
        return ip;
      }

      attempts++;
    }

    throw new Error(
      `Failed to generate unique IP in zone ${zone} after ${maxAttempts} attempts`,
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

    // Double-check database (authoritative)
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
      console.error("❌ Error checking IP availability:", error);
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
        console.log(`⚠️  User ${userId} already has IP: ${user.homeIp}`);
        return user.homeIp;
      }

      // Generate new unique IP
      const ip = await this.generateUniqueIP(zone);

      // Assign to user in database
      await db.client.user.update({
        where: { id: userId },
        data: { homeIp: ip },
      });

      console.log(`✅ Assigned IP ${ip} to user ${userId}`);
      return ip;
    } catch (error) {
      console.error(`❌ Error assigning IP to user ${userId}:`, error);
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
        console.log(
          `⚠️  Server ${serverId} already has IP: ${server.ipAddress}`,
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

      console.log(`✅ Assigned IP ${ip} to server ${serverId}`);
      return ip;
    } catch (error) {
      console.error(`❌ Error assigning IP to server ${serverId}:`, error);
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
      console.error(`❌ Error getting IP owner for ${ip}:`, error);
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
      console.error(`❌ Error discovering IP ${targetIP}:`, error);
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
      console.error(`❌ Error tracing route from ${fromIP} to ${toIP}:`, error);
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
        console.log(
          `⚠️  Scan range too large: ${rangeSize} IPs (max: ${maxRange})`,
        );
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

      console.log(
        `📡 Scan from ${rangeStart} to ${rangeEnd}: found ${discovered.length} systems`,
      );
      return discovered;
    } catch (error) {
      console.error("❌ Error scanning IP range:", error);
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
    console.log("🔄 Refreshing allocated IPs...");
    this.allocatedIPs.clear();
    await this.loadAllocatedIPs();
  }

  public async cleanupOrphanedIPs(): Promise<number> {
    console.log("🧹 Checking for orphaned IPs...");

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

      console.log(`✅ Cleaned up ${cleaned} orphaned IP allocations`);
      return cleaned;
    } catch (error) {
      console.error("❌ Error cleaning up orphaned IPs:", error);
      return 0;
    }
  }
}

export default IPService;

// Backward compatibility - lazy singleton that resolves from DI
import { container } from "../di/container";
import { IP_SERVICE } from "../di/tokens";
export const ipService = new Proxy({} as IPService, {
  get(_target, prop) {
    const instance = container.resolve(IP_SERVICE as any);
    return (instance as any)[prop];
  }
});
