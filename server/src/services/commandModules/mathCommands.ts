import { Command, CommandResult } from "../../../../shared/types";
import { CommandModule, CommandContext } from "./interface";
import { ExpressionEngine } from "../../utils/expressionEngine";

export class MathCommandsModule implements CommandModule {
  public commands: Set<string> = new Set([
    "calc",
    "expr",
    "math",
    "vars",
    "set",
    "unset",
    "convert",
    "random",
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

        default:
          return {
            success: false,
            output: `Math command not implemented: ${command.command}`,
            timestamp: new Date(),
          };
      }
    } catch (error) {
      return {
        success: false,
        output: "Math command failed",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date(),
      };
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
      return {
        success: true,
        output: ExpressionEngine.getHelp(),
        timestamp: new Date(),
      };
    }

    const expression = args.join(" ");
    const engine = this.getEngine(context.userId);
    const result = engine.evaluate(expression);

    if (!result.success) {
      return {
        success: false,
        output: `Error: ${result.error}`,
        timestamp: new Date(),
      };
    }

    let output = `🧮 Result: ${result.result}`;
    if (result.type && result.type !== "info") {
      output += ` (${result.type})`;
    }

    return {
      success: true,
      output: result.result,
      timestamp: new Date(),
    };
  }

  private async handleListVariables(
    _command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const engine = this.getEngine(context.userId);
    const variables = engine.getAllVariables();

    if (variables.size === 0) {
      return {
        success: true,
        output: "No variables defined",
        timestamp: new Date(),
      };
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

    return {
      success: true,
      output,
      timestamp: new Date(),
    };
  }

  private async handleSetVariable(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const args = command.args || [];
    if (args.length < 2) {
      return {
        success: false,
        output: "Usage: set <variable> <value>\nExample: set x 10",
        timestamp: new Date(),
      };
    }

    const varName = args[0];
    const valueStr = args.slice(1).join(" ");

    // Validate variable name
    if (!varName || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(varName)) {
      return {
        success: false,
        output:
          "Invalid variable name. Use letters, numbers, and underscores only.",
        timestamp: new Date(),
      };
    }

    const engine = this.getEngine(context.userId);

    // Try to parse as number first
    const numValue = parseFloat(valueStr);
    if (!isNaN(numValue) && valueStr.trim() === numValue.toString()) {
      engine.setVariable(varName, numValue, "number");
      return {
        success: true,
        output: `Set ${varName} = ${numValue}`,
        timestamp: new Date(),
      };
    }

    // Check for boolean
    if (valueStr === "true" || valueStr === "false") {
      const boolValue = valueStr === "true";
      engine.setVariable(varName, boolValue, "boolean");
      return {
        success: true,
        output: `Set ${varName} = ${boolValue}`,
        timestamp: new Date(),
      };
    }

    // Treat as string
    engine.setVariable(varName, valueStr, "string");
    return {
      success: true,
      output: `Set ${varName} = "${valueStr}"`,
      timestamp: new Date(),
    };
  }

  private async handleUnsetVariable(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const args = command.args || [];
    if (args.length === 0) {
      return {
        success: false,
        output: "Usage: unset <variable>\nExample: unset x",
        timestamp: new Date(),
      };
    }

    const varName = args[0];
    const engine = this.getEngine(context.userId);

    if (!engine.hasVariable(varName || "")) {
      return {
        success: false,
        output: `Variable '${varName}' not found`,
        timestamp: new Date(),
      };
    }

    const result = engine.evaluate(`delete ${varName}`);
    return {
      success: result.success,
      output: result.success
        ? result.result
        : result.error || "Failed to delete variable",
      timestamp: new Date(),
    };
  }

  private async handleConvert(
    command: Command,
    _context: CommandContext,
  ): Promise<CommandResult> {
    const args = command.args || [];
    if (args.length < 3) {
      return {
        success: false,
        output:
          "Usage: convert <value> <from_unit> <to_unit>\nExample: convert 10 km mi",
        timestamp: new Date(),
      };
    }

    const value = parseFloat(args[0] || "");
    const fromUnit = args[1]?.toLowerCase();
    const toUnit = args[2]?.toLowerCase();

    if (isNaN(value)) {
      return {
        success: false,
        output: `Invalid value: ${args[0]}`,
        timestamp: new Date(),
      };
    }

    const result = this.performConversion(value, fromUnit || "", toUnit || "");

    if (result === null) {
      return {
        success: false,
        output: `Conversion not supported: ${fromUnit} → ${toUnit}`,
        timestamp: new Date(),
      };
    }

    return {
      success: true,
      output: `${value} ${fromUnit} = ${result.toFixed(6).replace(/\\.?0+$/, "")} ${toUnit}`,
      timestamp: new Date(),
    };
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
      return {
        success: true,
        output: value.toFixed(6).replace(/\\.?0+$/, ""),
        timestamp: new Date(),
      };
    }

    // One arg: random int 0 to max
    if (args.length === 1) {
      const max = parseInt(args[0] || "", 10);
      if (isNaN(max)) {
        return {
          success: false,
          output: `Invalid number: ${args[0]}`,
          timestamp: new Date(),
        };
      }
      const value = Math.floor(Math.random() * (max + 1));
      return {
        success: true,
        output: value.toString(),
        timestamp: new Date(),
      };
    }

    // Two args: random int min to max
    const min = parseInt(args[0] || "", 10);
    const max = parseInt(args[1] || "", 10);

    if (isNaN(min) || isNaN(max)) {
      return {
        success: false,
        output: "Usage: random [max] or random <min> <max>",
        timestamp: new Date(),
      };
    }

    const value = Math.floor(Math.random() * (max - min + 1)) + min;
    return {
      success: true,
      output: value.toString(),
      timestamp: new Date(),
    };
  }
}
