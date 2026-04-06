/**
 * ContentEncoder — Utility for encoding/wrapping content in various formats.
 *
 * Used by:
 * - ServerContentService: generate files with encoded secrets (base64 passwords, caesar keys, hex IPs)
 * - DynamicContentService: optionally encode injected content
 * - Mission generation: create decode-based objectives
 *
 * Players use the `decode` command (mathCommands.ts) to reverse these encodings.
 *
 * This is a pure utility — no DI, no state, fully testable.
 */

export type EncodingType =
  | "base64"
  | "caesar"
  | "rot13"
  | "xor"
  | "hex"
  | "reverse"
  | "ascii";

export interface EncodedContent {
  /** The encoded string */
  encoded: string;
  /** The encoding method used */
  encoding: EncodingType;
  /** Key or shift value (for caesar, xor) */
  key?: number;
  /** Human-readable hint for the player */
  hint: string;
  /** The decode command the player would use */
  decodeCommand: string;
}

export class ContentEncoder {
  // ── Encode ──

  static encode(text: string, encoding: EncodingType, key?: number): string {
    switch (encoding) {
      case "base64":
        return Buffer.from(text).toString("base64");

      case "caesar": {
        const shift = key ?? 3;
        return text.split("").map(c => {
          if (c >= "A" && c <= "Z") return String.fromCharCode(((c.charCodeAt(0) - 65 + shift) % 26) + 65);
          if (c >= "a" && c <= "z") return String.fromCharCode(((c.charCodeAt(0) - 97 + shift) % 26) + 97);
          return c;
        }).join("");
      }

      case "rot13":
        return text.split("").map(c => {
          if (c >= "A" && c <= "Z") return String.fromCharCode(((c.charCodeAt(0) - 65 + 13) % 26) + 65);
          if (c >= "a" && c <= "z") return String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97);
          return c;
        }).join("");

      case "xor": {
        const xorKey = key ?? 42;
        return text.split("").map(c => String.fromCharCode(c.charCodeAt(0) ^ xorKey)).join("");
      }

      case "hex":
        return text.split("").map(c => c.charCodeAt(0).toString(16).padStart(2, "0")).join("").toUpperCase();

      case "reverse":
        return text.split("").reverse().join("");

      case "ascii":
        return text.split("").map(c => c.charCodeAt(0).toString()).join(" ");

      default:
        return text;
    }
  }

  // ── Generate encoded content with metadata ──

  /** Encode a secret value and return metadata for embedding in a file */
  static encodeWithMetadata(secret: string, encoding: EncodingType, key?: number): EncodedContent {
    const encoded = ContentEncoder.encode(secret, encoding, key);

    const hints: Record<EncodingType, string> = {
      base64: "Encoded in base64 format",
      caesar: `Caesar cipher (shift: ${key ?? 3})`,
      rot13: "ROT13 encoded",
      xor: `XOR encoded (key: ${key ?? 42})`,
      hex: "Hex-encoded ASCII",
      reverse: "Reversed string",
      ascii: "ASCII decimal codes",
    };

    const commands: Record<EncodingType, string> = {
      base64: `decode base64 ${encoded}`,
      caesar: `decode caesar ${encoded} ${key ?? 3}`,
      rot13: `decode rot13 ${encoded}`,
      xor: `decode xor ${encoded} ${key ?? 42}`,
      hex: `decode hex ${encoded}`,
      reverse: `decode reverse ${encoded}`,
      ascii: `decode ascii ${encoded}`,
    };

    return {
      encoded,
      encoding,
      ...(key !== undefined ? { key } : {}),
      hint: hints[encoding],
      decodeCommand: commands[encoding],
    };
  }

  // ── Template Wrappers ──
  // These generate file content fragments with embedded encoded secrets.
  // ServerContentService and AI generation can use these to build realistic files.

  /** Generate a credentials file with an encoded password */
  static credentialFile(username: string, password: string, encoding: EncodingType, key?: number): string {
    const enc = ContentEncoder.encodeWithMetadata(password, encoding, key);
    return [
      `# Credentials File`,
      `# WARNING: Authorized personnel only`,
      ``,
      `username: ${username}`,
      `password: ${enc.encoded}`,
      ``,
      `# ${enc.hint}`,
    ].join("\n");
  }

  /** Generate an access key file with encoded server IP/key */
  static accessKeyFile(serverName: string, accessKey: string, encoding: EncodingType, key?: number): string {
    const enc = ContentEncoder.encodeWithMetadata(accessKey, encoding, key);
    return [
      `# Access Configuration`,
      `# Server: ${serverName}`,
      ``,
      `access_token: ${enc.encoded}`,
      ``,
      `# Note: ${enc.hint}`,
      `# Decode to obtain access credentials`,
    ].join("\n");
  }

  /** Generate a log file with an encoded IP address */
  static logWithEncodedIP(ip: string, encoding: EncodingType, key?: number): string {
    const enc = ContentEncoder.encodeWithMetadata(ip, encoding, key);
    const timestamp = new Date().toISOString();
    return [
      `[${timestamp}] Connection from external host`,
      `[${timestamp}] Source: ${enc.encoded}`,
      `[${timestamp}] Protocol: SSH/22`,
      `[${timestamp}] Status: ACTIVE`,
      ``,
      `# Traffic analysis note: source address ${enc.hint}`,
    ].join("\n");
  }

  /** Generate a memo file with encoded secret text */
  static memoWithSecret(subject: string, secret: string, encoding: EncodingType, key?: number): string {
    const enc = ContentEncoder.encodeWithMetadata(secret, encoding, key);
    return [
      `FROM: Operations`,
      `TO: Field Agents`,
      `SUBJECT: ${subject}`,
      `CLASSIFICATION: RESTRICTED`,
      ``,
      `The following information is time-sensitive:`,
      ``,
      `  ${enc.encoded}`,
      ``,
      `Standard field protocol applies.`,
      `${enc.hint}.`,
    ].join("\n");
  }

  // ── Random encoding selection ──

  /** Pick a random encoding appropriate for the difficulty level */
  static randomEncoding(difficulty: number): { encoding: EncodingType; key?: number } {
    if (difficulty <= 3) {
      // Easy: base64, rot13, reverse
      const easy: EncodingType[] = ["base64", "rot13", "reverse"];
      return { encoding: easy[Math.floor(Math.random() * easy.length)]! };
    } else if (difficulty <= 6) {
      // Medium: caesar with small shift, hex
      const medium: Array<{ encoding: EncodingType; key?: number }> = [
        { encoding: "caesar", key: 1 + Math.floor(Math.random() * 5) },
        { encoding: "hex" },
        { encoding: "ascii" },
      ];
      return medium[Math.floor(Math.random() * medium.length)]!;
    } else {
      // Hard: caesar with large shift, xor
      const hard: Array<{ encoding: EncodingType; key?: number }> = [
        { encoding: "caesar", key: 7 + Math.floor(Math.random() * 18) },
        { encoding: "xor", key: 10 + Math.floor(Math.random() * 200) },
      ];
      return hard[Math.floor(Math.random() * hard.length)]!;
    }
  }
}
