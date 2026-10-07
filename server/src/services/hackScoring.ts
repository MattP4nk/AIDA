/**
 * Hack scoring: success/detection parameters, tool bonuses, evidence, stealth,
 * and result messages. Pure functions over constants.
 *
 * A8: split out of hackService.ts (2,739 lines). Code moved verbatim; the only
 * rewrites are the call paths between the pieces — see the commit.
 */
import { DETECTION_FLOOR, MAX_TOOL_STEALTH_BONUS, MAX_TOOL_SUCCESS_BONUS, SKILL_PENALTY } from "../config/gameBalance";
import { HackMethod } from "../types/game";
import type { HackCalculation } from "../types/game";

export const BASE_DETECTION_RATE = 0.3;

export const BASE_SUCCESS_RATE = 0.5;

// Hack method difficulty multipliers
export const METHOD_DIFFICULTY: Record<HackMethod, number> = {
  [HackMethod.BRUTEFORCE]: 1.0,
  [HackMethod.EXPLOIT]: 1.5,
  [HackMethod.SOCIAL]: 1.2,
  [HackMethod.BACKDOOR]: 2.0,
  [HackMethod.SQL_INJECTION]: 1.3,
  [HackMethod.PHISHING]: 1.1,
  [HackMethod.ROOTKIT]: 2.5,
};

// Tool effectiveness ratings
export const TOOL_EFFECTIVENESS: Record<string, number> = {
  // Basic tools
  scanner: 0.1,
  portscanner: 0.15,
  passwordcracker: 0.2,
  keylogger: 0.25,

  // Intermediate tools
  exploitkit: 0.35,
  rootkit: 0.4,
  proxychains: 0.3,
  vpn: 0.25,

  // Advanced tools
  zero_day: 0.5,
  custom_backdoor: 0.45,
  advanced_stealth: 0.4,
  encryption_breaker: 0.35,

  // Stealth tools
  anonymizer: 0.2,
  trace_remover: 0.3,
  log_cleaner: 0.25,
};

export function generateMinigameResultMessage(
  level: string,
  detected: boolean,
  accessLevel: number,
  layersSolved: number,
  totalLayers: number,
  traceInitiated: boolean,
): string {
  const detectedSuffix = detected
    ? ` You were detected!${traceInitiated ? " TRACE INITIATED!" : ""}`
    : " No traces detected.";

  switch (level) {
    case "full":
      return `Full breach! ${layersSolved}/${totalLayers} layers cracked. Access level ${accessLevel}/10.${detectedSuffix}`;
    case "partial":
      return `Partial breach. ${layersSolved}/${totalLayers} layers cracked. Access level ${accessLevel}/10.${detectedSuffix}`;
    case "minimal":
      return `Minimal breach. ${layersSolved}/${totalLayers} layers cracked. Access level ${accessLevel}/10.${detectedSuffix}`;
    default:
      return `Hack failed. 0/${totalLayers} layers cracked.${detectedSuffix}`;
  }
}

/**
 * Calculate all hack parameters (success rate, detection rate, etc.)
 */
export async function calculateHackParameters(
  attackerProgress: any,
  targetProgress: any,
  targetServer: any,
  method: HackMethod,
  tools: string[],
  /**
   * Skill shortfall severity (0..1) for an under-skilled attempt. See the Soft
   * Skill Gates section of gameBalance.ts: requirements are a baseline, and
   * falling short costs success rate and stealth rather than blocking outright.
   */
  skillPenaltySeverity: number = 0,
): Promise<HackCalculation> {
  // 1. Get base rates
  let successRate = BASE_SUCCESS_RATE;
  let detectionRate = BASE_DETECTION_RATE;

  // 2. Apply attacker skill bonuses
  const hackingSkill = attackerProgress.hacking / 100; // 0-1
  const stealthSkill = attackerProgress.stealth / 100;

  successRate += hackingSkill * 0.3; // Up to +30%
  detectionRate -= stealthSkill * 0.2; // Up to -20%

  // 3. Apply target defense
  const targetSecurity = targetProgress.forensics / 100;
  successRate -= targetSecurity * 0.2; // Up to -20%
  detectionRate += targetSecurity * 0.15; // Up to +15%

  // 4. Apply server security level (clamp to 0-1 range)
  const serverSecurity = Math.max(
    0,
    Math.min(1, targetServer.securityLevel / 10),
  );
  successRate -= serverSecurity * 0.15;
  detectionRate += serverSecurity * 0.1;

  // 5. Apply method difficulty
  const methodDifficulty = METHOD_DIFFICULTY[method] || 1.0;
  successRate /= methodDifficulty;

  // 6. Apply tool bonuses
  const toolBonus = calculateToolBonus(tools);
  successRate += toolBonus.successBonus;
  detectionRate -= toolBonus.stealthBonus;

  // 7. Apply encryption factor
  const encryptionLevel = targetServer.encryptionLevel || 0;
  successRate -= encryptionLevel * 0.05;

  // 7b. Apply the soft-gate penalty for attempting this under-skilled.
  // Multiplicative on success (a shortfall scales down whatever edge you had,
  // rather than subtracting a flat amount that could invert a strong build)
  // and additive on detection (fumbling is loud in absolute terms).
  const severity = Math.max(0, Math.min(1, skillPenaltySeverity));
  if (severity > 0) {
    successRate *= 1 - severity * SKILL_PENALTY.maxSuccessPenalty;
    detectionRate += severity * SKILL_PENALTY.maxDetectionPenalty;
  }

  // 8. Calculate access level (how deep into system)
  // Clamp successRate to 0-1 before combining with hackingSkill (also 0-1)
  const clampedSuccess = Math.max(0, Math.min(1, successRate));
  let accessLevel = Math.floor((clampedSuccess + hackingSkill) * 5); // 0-10 scale
  accessLevel = Math.max(1, Math.min(10, accessLevel));

  // 9. Calculate base time (for future time-based mechanics)
  const baseTime = 10 + methodDifficulty * 5; // seconds

  // 10. Calculate evidence amount (base, before modifiers)
  // Clamp detectionRate to 0-1 before combining with stealthSkill (also 0-1)
  const clampedDetection = Math.max(0, Math.min(1, detectionRate));
  const evidenceAmount = Math.floor(
    (clampedDetection + (1 - stealthSkill)) * 50,
  );

  // 11. Clamp values to valid ranges
  successRate = Math.max(0.05, Math.min(0.95, successRate));
  detectionRate = Math.max(DETECTION_FLOOR, Math.min(0.95, detectionRate));

  return {
    successRate,
    detectionRate,
    evidenceAmount,
    accessLevel,
    baseTime,
  };
}

/**
 * Calculate tool effectiveness bonus
 */
export function calculateToolBonus(tools: string[]): {
  successBonus: number;
  stealthBonus: number;
} {
  let successBonus = 0;
  let stealthBonus = 0;

  // De-duplicate here too. The command layer already does, but this method is
  // the one that actually accumulates, and it must not depend on its callers
  // behaving.
  const uniqueTools = [...new Set(tools.map((t) => t.toLowerCase()))];

  for (const tool of uniqueTools) {
    const effectiveness = TOOL_EFFECTIVENESS[tool.toLowerCase()] || 0;
    successBonus += effectiveness * 0.5; // Tools help success

    // Stealth tools specifically help detection
    if (
      tool.toLowerCase().includes("stealth") ||
      tool.toLowerCase().includes("anon") ||
      tool.toLowerCase().includes("proxy") ||
      tool.toLowerCase().includes("vpn")
    ) {
      stealthBonus += effectiveness;
    }
  }

  // Ceiling on the aggregate. Ownership filtering (gameBalance.HACK_TOOL_ITEMS)
  // is the primary control, but a player who legitimately owns every tool
  // should not be able to pin successRate to its 0.95 clamp on tool bonuses
  // alone — skill has to keep mattering.
  return {
    successBonus: Math.min(successBonus, MAX_TOOL_SUCCESS_BONUS),
    stealthBonus: Math.min(stealthBonus, MAX_TOOL_STEALTH_BONUS),
  };
}

/**
 * Calculate evidence left behind
 */
export function calculateEvidence(
  calculation: HackCalculation,
  success: boolean,
  detected: boolean,
  tools: string[],
): number {
  let evidence = calculation.evidenceAmount;

  // Successful hacks leave less evidence (cleaner)
  if (success) {
    evidence *= 0.7;
  }

  // Failed hacks leave more traces (sloppy)
  if (!success) {
    evidence *= 1.3;
  }

  // Detection means more evidence was found
  if (detected) {
    evidence *= 1.5;
  }

  // Stealth tools reduce evidence
  const stealthTools = tools.filter(
    (t) =>
      t.toLowerCase().includes("stealth") ||
      t.toLowerCase().includes("clean") ||
      t.toLowerCase().includes("trace"),
  );
  evidence *= Math.max(0.3, 1 - stealthTools.length * 0.2);

  // Clamp to 0-100 range
  return Math.floor(Math.max(0, Math.min(100, evidence)));
}

/**
 * Calculate stealth level from tools
 */
export function calculateStealthLevel(tools: string[]): number {
  let stealthLevel = 50; // Base stealth

  for (const tool of tools) {
    if (
      tool.toLowerCase().includes("stealth") ||
      tool.toLowerCase().includes("anon")
    ) {
      stealthLevel += 10;
    }
    if (
      tool.toLowerCase().includes("proxy") ||
      tool.toLowerCase().includes("vpn")
    ) {
      stealthLevel += 5;
    }
  }

  return Math.min(100, stealthLevel);
}

// ==================== FILE DISCOVERY ====================

/**
 * Generate result message based on outcome
 */
export function generateResultMessage(
  success: boolean,
  detected: boolean,
  accessLevel: number,
  traceInitiated: boolean,
): string {
  if (success && !detected) {
    return `Hack successful! Gained ${accessLevel}/10 access. No traces detected.`;
  }

  if (success && detected) {
    return `Hack successful with ${accessLevel}/10 access, but you were detected!${traceInitiated ? " TRACE INITIATED!" : ""}`;
  }

  if (!success && detected) {
    return `Hack failed and you were detected!${traceInitiated ? " TRACE INITIATED!" : ""}`;
  }

  return "Hack failed. Try different tools or methods.";
}
