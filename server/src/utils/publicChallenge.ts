/**
 * The part of a minigame challenge the PLAYER may see.
 *
 * Challenges are generated with their answer on board — `solution`, and for
 * some types answer-bearing `metadata` (crack's `bestStrategy`, sweep's hidden
 * file ids). Every command that started one sent the whole object to the
 * client, so the answer sat in the network tab (found 2026-10-09). The client
 * reads only type, displayText, hints and timeLimit. This is a WHITELIST:
 * a field added to a challenge later stays server-side until added here.
 */
export interface PublicChallenge {
  type: string;
  difficulty: number;
  displayText: string[];
  hints: string[];
  timeLimit: number;
  maxAttempts: number;
}

export function publicChallenge(c: PublicChallenge): PublicChallenge {
  return {
    type: c.type,
    difficulty: c.difficulty,
    displayText: c.displayText,
    hints: c.hints,
    timeLimit: c.timeLimit,
    maxAttempts: c.maxAttempts,
  };
}
