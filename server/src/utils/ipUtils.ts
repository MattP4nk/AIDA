/**
 * IP Utility Functions
 * Handles IP address parsing, validation, and range calculations
 */

/**
 * Parse IP range string into start and end IPs
 * Supports CIDR notation, ranges, and single IPs
 *
 * @param rangeStr - IP range string (CIDR, range, or single IP)
 * @returns Tuple of [startIP, endIP]
 *
 * @example
 * parseIPRange("10.0.0.0/24") => ["10.0.0.0", "10.0.0.255"]
 * parseIPRange("10.0.0.1-10.0.0.50") => ["10.0.0.1", "10.0.0.50"]
 * parseIPRange("10.0.0.1") => ["10.0.0.1", "10.0.0.1"]
 */
export function parseIPRange(rangeStr: string): [string, string] {
  const trimmed = rangeStr.trim();

  // Handle CIDR notation: "10.0.0.0/24"
  if (trimmed.includes("/")) {
    const splitResult = trimmed.split("/");
    const baseIP = splitResult[0];
    const cidr = splitResult[1];

    if (!baseIP || !cidr) {
      return [trimmed, trimmed];
    }

    const subnet = parseInt(cidr, 10);
    const parts = baseIP.split(".");

    if (parts.length !== 4) {
      // Invalid IP, return as-is
      return [trimmed, trimmed];
    }

    // Calculate range based on common CIDR blocks
    if (subnet === 24) {
      // /24 = 256 addresses (x.x.x.0 to x.x.x.255)
      return [
        `${parts[0]}.${parts[1]}.${parts[2]}.0`,
        `${parts[0]}.${parts[1]}.${parts[2]}.255`,
      ];
    } else if (subnet === 16) {
      // /16 = 65,536 addresses (x.x.0.0 to x.x.255.255)
      return [`${parts[0]}.${parts[1]}.0.0`, `${parts[0]}.${parts[1]}.255.255`];
    } else if (subnet === 8) {
      // /8 = 16,777,216 addresses (x.0.0.0 to x.255.255.255)
      return [`${parts[0]}.0.0.0`, `${parts[0]}.255.255.255`];
    } else if (subnet === 32) {
      // /32 = single host
      return [baseIP, baseIP];
    } else {
      // Default to /24 for other subnets
      const p0 = parts[0] || "0";
      const p1 = parts[1] || "0";
      const p2 = parts[2] || "0";
      return [`${p0}.${p1}.${p2}.0`, `${p0}.${p1}.${p2}.255`];
    }
  }

  // Handle range: "10.0.0.1-10.0.0.100"
  if (trimmed.includes("-")) {
    const splitResult = trimmed.split("-");
    const start = splitResult[0];
    const end = splitResult[1];

    if (!start || !end) {
      return [trimmed, trimmed];
    }

    return [start.trim(), end.trim()];
  }

  // Single IP: return same IP as start and end
  return [trimmed, trimmed];
}

/**
 * Validate IP address format
 *
 * @param ip - IP address string
 * @returns true if valid IPv4 address
 */
export function validateIPFormat(ip: string): boolean {
  const parts = ip.split(".");

  if (parts.length !== 4) {
    return false;
  }

  return parts.every((part) => {
    const num = parseInt(part, 10);
    // Check if it's a valid number between 0-255
    // and that there's no leading zeros (except for "0" itself)
    return !isNaN(num) && num >= 0 && num <= 255 && part === num.toString();
  });
}

/**
 * Convert IP address to number for comparison
 *
 * @param ip - IP address string
 * @returns Number representation of IP
 */
export function ipToNumber(ip: string): number {
  const parts = ip.split(".").map((p) => parseInt(p, 10));
  return (
    (parts[0] || 0) * 16777216 + // 256^3
    (parts[1] || 0) * 65536 + // 256^2
    (parts[2] || 0) * 256 + // 256^1
    (parts[3] || 0) // 256^0
  );
}

/**
 * Convert number to IP address
 *
 * @param num - Number representation of IP
 * @returns IP address string
 */
export function numberToIP(num: number): string {
  return [
    (num >>> 24) & 255,
    (num >>> 16) & 255,
    (num >>> 8) & 255,
    num & 255,
  ].join(".");
}

/**
 * Check if IP is in range
 *
 * @param ip - IP to check
 * @param rangeStart - Start of range
 * @param rangeEnd - End of range
 * @returns true if IP is within range
 */
export function isIPInRange(
  ip: string,
  rangeStart: string,
  rangeEnd: string,
): boolean {
  if (
    !validateIPFormat(ip) ||
    !validateIPFormat(rangeStart) ||
    !validateIPFormat(rangeEnd)
  ) {
    return false;
  }

  const ipNum = ipToNumber(ip);
  const startNum = ipToNumber(rangeStart);
  const endNum = ipToNumber(rangeEnd);

  return ipNum >= startNum && ipNum <= endNum;
}

/**
 * Calculate the number of IPs in a range
 *
 * @param rangeStart - Start of range
 * @param rangeEnd - End of range
 * @returns Number of IPs in range
 */
export function calculateRangeSize(
  rangeStart: string,
  rangeEnd: string,
): number {
  if (!validateIPFormat(rangeStart) || !validateIPFormat(rangeEnd)) {
    return 0;
  }

  const startNum = ipToNumber(rangeStart);
  const endNum = ipToNumber(rangeEnd);

  return Math.max(0, endNum - startNum + 1);
}
