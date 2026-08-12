import { Command, CommandResult } from "../../../../shared/types";
import { CommandModule, CommandContext } from "./interface";
import { successResult, errorResult } from "./helpers";
import { ExpressionEngine } from "../../utils/expressionEngine";

export class MathCommandsModule implements CommandModule {
  public category = "math";
  public commands: Set<string> = new Set([
    "calc",
    "expr",
    "math",
    "vars",
    "set",
    "unset",
    "convert",
    "random",
    "decode",
    "subnet",
  ]);

  // Per-user expression engines to isolate variables
  private expressionEngines: Map<string, ExpressionEngine> = new Map();
  private static readonly MAX_ENGINES = 500;

  public async execute(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    try {
      switch (command.command) {
        case "calc":
        case "expr":
        case "math":
          return await this.handleCalculate(command, context);

        case "vars":
          return await this.handleListVariables(command, context);

        case "set":
          return await this.handleSetVariable(command, context);

        case "unset":
          return await this.handleUnsetVariable(command, context);

        case "convert":
          return await this.handleConvert(command, context);

        case "random":
          return await this.handleRandom(command, context);

        case "decode":
          return await this.handleDecode(command, context);

        case "subnet":
          return await this.handleSubnet(command, context);

        default:
          return errorResult(`Math command not implemented: ${command.command}`);
      }
    } catch (error) {
      return errorResult("Math command failed", error instanceof Error ? error.message : "Unknown error");
    }
  }

  public getCommandInfo(): import("./interface").CommandInfo[] {
    return [
      {
        command: "calc",
        category: "math",
        description: "Evaluate mathematical expressions",
        usage: "calc <expression>",
        examples: ["calc 2 + 3 * 4", "calc sqrt(16)", "calc pi * 2"],
      },
      {
        command: "expr",
        category: "math",
        description: "Alias for calc - evaluate expressions",
        usage: "expr <expression>",
        examples: ["expr (10 + 5) / 3"],
      },
      {
        command: "math",
        category: "math",
        description: "Alias for calc - evaluate expressions",
        usage: "math <expression>",
        examples: ["math sin(30) + cos(45)"],
      },
      {
        command: "vars",
        category: "math",
        description: "List defined mathematical variables",
        usage: "vars",
        examples: ["vars"],
      },
      {
        command: "set",
        category: "math",
        description: "Set a variable value",
        usage: "set <name> <value>",
        examples: ["set x 10", "set y x * 2"],
      },
      {
        command: "unset",
        category: "math",
        description: "Remove a variable",
        usage: "unset <name>",
        examples: ["unset x", "unset temp"],
      },
      {
        command: "convert",
        category: "math",
        description: "Convert between units",
        usage: "convert <value> <from> <to>",
        examples: ["convert 10 km mi", "convert 32 f c", "convert 1 gb mb"],
      },
      {
        command: "random",
        category: "math",
        description: "Generate random numbers",
        usage: "random [max] or random <min> <max>",
        examples: ["random", "random 100", "random 1 10"],
      },
      {
        command: "decode",
        category: "math",
        description: "Decode ciphers and encodings",
        usage: "decode <method> <text> [key]",
        examples: ["decode xor KHOOR 3", "decode caesar KHOOR 3", "decode rot13 URYYB", "decode base64 SEVFVA==", "decode ascii 72 69 76", "decode hex 48454C4C4F"],
      },
      {
        command: "subnet",
        category: "math",
        description: "Calculate network subnet information",
        usage: "subnet <ip/cidr>",
        examples: ["subnet 192.168.1.0/24", "subnet 172.16.1.137/24", "subnet 10.0.0.0/16"],
      },
    ];
  }

  /**
   * Get or create expression engine for user
   */
  private getEngine(userId: string): ExpressionEngine {
    if (!this.expressionEngines.has(userId)) {
      // Evict oldest entry when cap reached
      if (this.expressionEngines.size >= MathCommandsModule.MAX_ENGINES) {
        const oldestKey = this.expressionEngines.keys().next().value;
        if (oldestKey !== undefined) this.expressionEngines.delete(oldestKey);
      }
      this.expressionEngines.set(userId, new ExpressionEngine());
    }
    return this.expressionEngines.get(userId)!;
  }

  /**
   * Release expression engine for a user (call on session cleanup)
   */
  public releaseEngine(userId: string): void {
    this.expressionEngines.delete(userId);
  }

  private async handleCalculate(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const args = command.args || [];
    if (args.length === 0) {
      return successResult(ExpressionEngine.getHelp());
    }

    const expression = args.join(" ");
    const engine = this.getEngine(context.userId);
    const result = engine.evaluate(expression);

    if (!result.success) {
      return errorResult(`Error: ${result.error}`);
    }

    return successResult(result.result);
  }

  private async handleListVariables(
    _command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const engine = this.getEngine(context.userId);
    const variables = engine.getAllVariables();

    if (variables.size === 0) {
      return successResult("No variables defined");
    }

    let output = "📊 Variables:\n\n";
    const vars: string[] = [];
    for (const [name, variable] of variables) {
      const formattedValue =
        variable.type === "string"
          ? `"${variable.value}"`
          : String(variable.value);
      vars.push(`${name} = ${formattedValue} (${variable.type})`);
    }

    output += vars.join("\n");

    return successResult(output);
  }

  private async handleSetVariable(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const args = command.args || [];
    if (args.length < 2) {
      return errorResult("Usage: set <variable> <value>\nExample: set x 10");
    }

    const varName = args[0];
    const valueStr = args.slice(1).join(" ");

    // Validate variable name
    if (!varName || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(varName)) {
      return errorResult("Invalid variable name. Use letters, numbers, and underscores only.");
    }

    const engine = this.getEngine(context.userId);

    // Try to parse as number first
    const numValue = parseFloat(valueStr);
    if (!isNaN(numValue) && valueStr.trim() === numValue.toString()) {
      engine.setVariable(varName, numValue, "number");
      return successResult(`Set ${varName} = ${numValue}`);
    }

    // Check for boolean
    if (valueStr === "true" || valueStr === "false") {
      const boolValue = valueStr === "true";
      engine.setVariable(varName, boolValue, "boolean");
      return successResult(`Set ${varName} = ${boolValue}`);
    }

    // Treat as string
    engine.setVariable(varName, valueStr, "string");
    return successResult(`Set ${varName} = "${valueStr}"`);
  }

  private async handleUnsetVariable(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const args = command.args || [];
    if (args.length === 0) {
      return errorResult("Usage: unset <variable>\nExample: unset x");
    }

    const varName = args[0];
    const engine = this.getEngine(context.userId);

    if (!engine.hasVariable(varName || "")) {
      return errorResult(`Variable '${varName}' not found`);
    }

    const result = engine.evaluate(`delete ${varName}`);
    return result.success
      ? successResult(result.result)
      : errorResult(result.error || "Failed to delete variable");
  }

  private async handleConvert(
    command: Command,
    _context: CommandContext,
  ): Promise<CommandResult> {
    const args = command.args || [];
    if (args.length < 3) {
      return errorResult("Usage: convert <value> <from> <to>\nExamples:\n  convert 255 dec hex    → 0xFF\n  convert 0xFF hex dec   → 255\n  convert 10 km mi       → 6.21371\n  convert 11111111 bin dec → 255\n  convert 255 dec bin    → 11111111\n  convert 255 dec oct    → 377");
    }

    const rawValue = args[0] || "";
    const fromUnit = args[1]?.toLowerCase() || "";
    const toUnit = args[2]?.toLowerCase() || "";

    // ── Base/number system conversions ──
    const bases = ["hex", "dec", "bin", "oct"];
    if (bases.includes(fromUnit) && bases.includes(toUnit)) {
      return this.convertBase(rawValue, fromUnit, toUnit);
    }

    // ── Physical unit conversions ──
    const value = parseFloat(rawValue);
    if (isNaN(value)) {
      return errorResult(`Invalid value: ${rawValue}`);
    }

    const result = this.performConversion(value, fromUnit, toUnit);
    if (result === null) {
      return errorResult(`Conversion not supported: ${fromUnit} → ${toUnit}`);
    }

    return successResult(`${value} ${fromUnit} = ${result.toFixed(6).replace(/\.?0+$/, "")} ${toUnit}`);
  }

  private convertBase(rawValue: string, from: string, to: string): CommandResult {
    let decimal: number;

    // Parse input to decimal
    try {
      switch (from) {
        case "hex":
          decimal = parseInt(rawValue.replace(/^0x/i, ""), 16);
          break;
        case "bin":
          decimal = parseInt(rawValue.replace(/^0b/i, ""), 2);
          break;
        case "oct":
          decimal = parseInt(rawValue.replace(/^0o/i, ""), 8);
          break;
        case "dec":
        default:
          decimal = parseInt(rawValue, 10);
          break;
      }
    } catch {
      return errorResult(`Invalid ${from} value: ${rawValue}`);
    }

    if (isNaN(decimal)) {
      return errorResult(`Invalid ${from} value: ${rawValue}`);
    }

    // Convert decimal to target base
    let result: string;
    switch (to) {
      case "hex":
        result = `0x${decimal.toString(16).toUpperCase()}`;
        break;
      case "bin":
        result = decimal.toString(2);
        break;
      case "oct":
        result = `0o${decimal.toString(8)}`;
        break;
      case "dec":
      default:
        result = decimal.toString(10);
        break;
    }

    return successResult(`${rawValue} (${from}) = ${result} (${to})`);
  }

  private performConversion(
    value: number,
    from: string,
    to: string,
  ): number | null {
    // Temperature units (special handling)
    const tempUnits = ["c", "f", "k"];

    // Conversion factors to base units
    const conversions: Record<string, Record<string, number>> = {
      // Distance (base: meters)
      distance: {
        m: 1,
        km: 1000,
        cm: 0.01,
        mm: 0.001,
        mi: 1609.34,
        yd: 0.9144,
        ft: 0.3048,
        in: 0.0254,
      },
      // Weight (base: grams)
      weight: {
        g: 1,
        kg: 1000,
        mg: 0.001,
        lb: 453.592,
        oz: 28.3495,
        ton: 1000000,
      },
    };

    // Check if it's a temperature conversion
    if (tempUnits.includes(from) && tempUnits.includes(to)) {
      return this.convertTemperature(value, from, to);
    }

    // Find the category
    for (const [_, units] of Object.entries(conversions)) {
      if (from in units && to in units) {
        // Convert to base unit, then to target unit
        const baseValue = value * (units[from] || 1);
        return baseValue / (units[to] || 1);
      }
    }

    return null;
  }

  private convertTemperature(value: number, from: string, to: string): number {
    // Convert to Celsius first
    let celsius: number;
    if (from === "c") celsius = value;
    else if (from === "f") celsius = ((value - 32) * 5) / 9;
    else if (from === "k") celsius = value - 273.15;
    else celsius = value;

    // Convert from Celsius to target
    if (to === "c") return celsius;
    else if (to === "f") return (celsius * 9) / 5 + 32;
    else if (to === "k") return celsius + 273.15;
    else return celsius;
  }

  private async handleRandom(
    command: Command,
    _context: CommandContext,
  ): Promise<CommandResult> {
    const args = command.args || [];

    // Default: random float 0-1
    if (args.length === 0) {
      const value = Math.random();
      return successResult(value.toFixed(6).replace(/\\.?0+$/, ""));
    }

    // One arg: random int 0 to max
    if (args.length === 1) {
      const max = parseInt(args[0] || "", 10);
      if (isNaN(max)) {
        return errorResult(`Invalid number: ${args[0]}`);
      }
      const value = Math.floor(Math.random() * (max + 1));
      return successResult(value.toString());
    }

    // Two args: random int min to max
    const min = parseInt(args[0] || "", 10);
    const max = parseInt(args[1] || "", 10);

    if (isNaN(min) || isNaN(max)) {
      return errorResult("Usage: random [max] or random <min> <max>");
    }

    const value = Math.floor(Math.random() * (max - min + 1)) + min;
    return successResult(value.toString());
  }

  // ══════════════════════════════════════════════════════════════════
  // DECODE — XOR, Caesar, Base64, ROT13, reverse
  // Used by players to crack encrypted files and solve cipher puzzles
  // ══════════════════════════════════════════════════════════════════

  private async handleDecode(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const args = command.args || [];
    const method = args[0]?.toLowerCase();

    if (!method || args.length < 2) {
      return successResult([
        "Usage: decode <method> <args...>",
        "",
        "Methods:",
        "  decode xor <text> <key>       — XOR decode with numeric key",
        "  decode caesar <text> <shift>   — Caesar cipher shift",
        "  decode rot13 <text>            — ROT13 decode",
        "  decode base64 <encoded>        — Base64 decode",
        "  decode reverse <text>          — Reverse string",
        "  decode ascii <numbers...>      — ASCII codes to text",
        "  decode hex <hexstring>         — Hex string to text",
        "",
        "Examples:",
        "  decode xor KHOOR 3             → HELLO",
        "  decode caesar KHOOR 3          → HELLO",
        "  decode rot13 URYYB             → HELLO",
        "  decode base64 SEVFVA==         → FRIVIN",
        "  decode ascii 72 69 76 76 79    → HELLO",
        "  decode hex 48454C4C4F          → HELLO",
      ]);
    }

    const text = args.slice(1).join(" ");
    let decoded: string | null = null;

    switch (method) {
      case "xor": {
        const parts = this.splitLastArg(args.slice(1));
        const key = parseInt(parts.last, 10);
        if (isNaN(key)) return errorResult("XOR key must be a number. Usage: decode xor <text> <key>");
        decoded = parts.rest.split("").map(c => String.fromCharCode(c.charCodeAt(0) ^ key)).join("");
        break;
      }
      case "caesar": {
        const parts = this.splitLastArg(args.slice(1));
        const shift = parseInt(parts.last, 10);
        if (isNaN(shift)) return errorResult("Shift must be a number. Usage: decode caesar <text> <shift>");
        decoded = parts.rest.split("").map(c => {
          if (c >= "A" && c <= "Z") return String.fromCharCode(((c.charCodeAt(0) - 65 - shift + 260) % 26) + 65);
          if (c >= "a" && c <= "z") return String.fromCharCode(((c.charCodeAt(0) - 97 - shift + 260) % 26) + 97);
          return c;
        }).join("");
        break;
      }
      case "rot13": {
        decoded = text.split("").map(c => {
          if (c >= "A" && c <= "Z") return String.fromCharCode(((c.charCodeAt(0) - 65 + 13) % 26) + 65);
          if (c >= "a" && c <= "z") return String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97);
          return c;
        }).join("");
        break;
      }
      case "base64": {
        try {
          decoded = Buffer.from(args[1] || "", "base64").toString("utf8");
        } catch {
          return errorResult("Invalid base64 input.");
        }
        break;
      }
      case "reverse": {
        decoded = text.split("").reverse().join("");
        break;
      }
      case "ascii": {
        const codes = args.slice(1).map(a => parseInt(a, 10)).filter(n => !isNaN(n));
        if (codes.length === 0) return errorResult("Provide ASCII codes. Usage: decode ascii 72 69 76 76 79");
        decoded = codes.map(c => String.fromCharCode(c)).join("");
        break;
      }
      case "hex": {
        const hexStr = (args[1] || "").replace(/\s+/g, "");
        if (hexStr.length % 2 !== 0) return errorResult("Hex string must have even length.");
        decoded = "";
        for (let i = 0; i < hexStr.length; i += 2) {
          decoded += String.fromCharCode(parseInt(hexStr.substring(i, i + 2), 16));
        }
        break;
      }
      default:
        return errorResult(`Unknown decode method: ${method}. Use: xor, caesar, rot13, base64, reverse, ascii, hex`);
    }

    // Fire mission integration hook on successful decode
    if (decoded !== null && context.services.missionIntegrationService) {
      context.services.missionIntegrationService.onDecodeSuccess(context.userId, method, decoded).catch(() => {});
    }

    return successResult(`Decoded: ${decoded}`);
  }

  /** Split args so that the last word is separate from the rest */
  private splitLastArg(args: string[]): { rest: string; last: string } {
    if (args.length <= 1) return { rest: args[0] || "", last: "" };
    return { rest: args.slice(0, -1).join(" "), last: args[args.length - 1]! };
  }

  // ══════════════════════════════════════════════════════════════════
  // SUBNET — Network calculations for hacking gameplay
  // Players use this to calculate ranges, find hidden servers, etc.
  // ══════════════════════════════════════════════════════════════════

  private async handleSubnet(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const args = command.args || [];
    if (args.length === 0) {
      return successResult([
        "Usage: subnet <ip/cidr>",
        "",
        "Examples:",
        "  subnet 192.168.1.0/24     → Network info for /24",
        "  subnet 172.16.1.137/24    → Find network containing IP",
        "  subnet 10.0.0.0/16        → Large subnet info",
        "",
        "Shows: network address, broadcast, host range, total hosts",
      ]);
    }

    const input = args[0]!;
    const cidrMatch = input.match(/^(\d+\.\d+\.\d+\.\d+)\/(\d+)$/);

    if (!cidrMatch) {
      return errorResult("Invalid format. Use: subnet <ip>/<cidr>\nExample: subnet 192.168.1.0/24");
    }

    const ip = cidrMatch[1]!;
    const cidr = parseInt(cidrMatch[2]!, 10);

    if (cidr < 0 || cidr > 32) {
      return errorResult("CIDR must be between 0 and 32.");
    }

    // Parse IP to 32-bit number
    const ipParts = ip.split(".").map(Number);
    if (ipParts.length !== 4 || ipParts.some(p => isNaN(p) || p < 0 || p > 255)) {
      return errorResult(`Invalid IP address: ${ip}`);
    }
    const ipNum = ((ipParts[0]! << 24) | (ipParts[1]! << 16) | (ipParts[2]! << 8) | ipParts[3]!) >>> 0;

    // Calculate mask
    const mask = cidr === 0 ? 0 : (~0 << (32 - cidr)) >>> 0;
    const networkNum = (ipNum & mask) >>> 0;
    const broadcastNum = (networkNum | (~mask >>> 0)) >>> 0;
    const firstHost = cidr >= 31 ? networkNum : (networkNum + 1) >>> 0;
    const lastHost = cidr >= 31 ? broadcastNum : (broadcastNum - 1) >>> 0;
    const totalHosts = cidr >= 31 ? (cidr === 32 ? 1 : 2) : Math.pow(2, 32 - cidr) - 2;

    const numToIp = (n: number) => `${(n >>> 24) & 0xFF}.${(n >>> 16) & 0xFF}.${(n >>> 8) & 0xFF}.${n & 0xFF}`;

    const lines = [
      `Subnet: ${input}`,
      ``,
      `  Network:    ${numToIp(networkNum)}`,
      `  Broadcast:  ${numToIp(broadcastNum)}`,
      `  Mask:       ${numToIp(mask)}`,
      `  Host Range: ${numToIp(firstHost)} - ${numToIp(lastHost)}`,
      `  Total Hosts: ${totalHosts.toLocaleString()}`,
      ``,
      `  Binary Mask: ${mask.toString(2).padStart(32, "0").replace(/(.{8})/g, "$1.").slice(0, -1)}`,
    ];

    // Fire mission integration hook
    if (context.services.missionIntegrationService) {
      context.services.missionIntegrationService.onSubnetUsed(context.userId).catch(() => {});
    }

    return successResult(lines.join("\n"));
  }
}
