/**
 * AIDA Shell — Argument parsing
 *
 * Splits an expanded argv into flags, options, and positionals.
 *
 * This is the root fix for the bug class where commands detected flags with
 * `args.includes("-l")` but still took the path from `args[0]`, so `ls -l`
 * resolved the path "/-l" and failed with "Directory not found".
 */

export interface ParsedArgs {
  /** Short and long flags present, without leading dashes: `-la` → {"l","a"}. */
  flags: Set<string>;
  /** `--key=value` and `--key value` pairs. */
  options: Map<string, string>;
  /** Everything that is not a flag or an option value. */
  positionals: string[];
}

export interface ArgSpec {
  /** Long options that consume the following argument (`--out FILE`). */
  valueOptions?: string[];
}

/**
 * Parse argv POSIX-style.
 *
 * Conventions:
 *   `--`            end of options; everything after is positional
 *   `--long`        long flag
 *   `--long=value`  long option with value
 *   `-abc`          three short flags: a, b, c
 *   `-`             positional (conventional stdin placeholder)
 *   `-123`          POSITIONAL, not flags — see note below
 *
 * NOTE on negative numbers: a token matching `-<digits>` is deliberately
 * treated as a positional. Commands like `renice -5` rely on it, and — more
 * importantly — we must NOT let flag parsing silently swallow `buy item -1000`.
 * That input needs to reach the shop's explicit `Number.isInteger(q) && q >= 1`
 * guard (plan item S2) and be rejected there. Neutralising the credit-mint
 * exploit as an accident of tokenisation would leave it one refactor away from
 * coming back.
 */
export function parseArgs(argv: string[], spec: ArgSpec = {}): ParsedArgs {
  const flags = new Set<string>();
  const options = new Map<string, string>();
  const positionals: string[] = [];
  const valueOptions = new Set(spec.valueOptions ?? []);

  let endOfOptions = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;

    if (endOfOptions) {
      positionals.push(arg);
      continue;
    }

    if (arg === "--") {
      endOfOptions = true;
      continue;
    }

    // Long form
    if (arg.startsWith("--") && arg.length > 2) {
      const body = arg.slice(2);
      const eq = body.indexOf("=");
      if (eq !== -1) {
        options.set(body.slice(0, eq), body.slice(eq + 1));
      } else if (valueOptions.has(body)) {
        const next = argv[i + 1];
        if (next !== undefined) {
          options.set(body, next);
          i++;
        } else {
          flags.add(body);
        }
      } else {
        flags.add(body);
      }
      continue;
    }

    // Short form — but not "-", and not a negative number.
    if (arg.startsWith("-") && arg.length > 1 && !/^-\d+$/.test(arg)) {
      for (const ch of arg.slice(1)) flags.add(ch);
      continue;
    }

    positionals.push(arg);
  }

  return { flags, options, positionals };
}

/** Convenience: true if any of the given flag names is present. */
export function hasFlag(parsed: ParsedArgs, ...names: string[]): boolean {
  return names.some((n) => parsed.flags.has(n));
}
