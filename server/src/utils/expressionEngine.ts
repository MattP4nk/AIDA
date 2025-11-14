/**
 * Expression Engine - Server-side mathematical and logical expression evaluator
 * Handles arithmetic, variables, comparisons, and mathematical functions
 */

export interface Variable {
  name: string;
  value: any;
  type: "number" | "string" | "boolean";
}

export interface ExpressionResult {
  success: boolean;
  result: any;
  error?: string;
  type: string;
}

export class ExpressionEngine {
  private variables: Map<string, Variable> = new Map();
  private readonly constants: Map<string, number> = new Map([
    ["PI", Math.PI],
    ["E", Math.E],
    ["PHI", 1.618033988749895], // Golden ratio
  ]);

  /**
   * Evaluate an expression and return the result
   */
  evaluate(expression: string): ExpressionResult {
    try {
      const cleanExpr = expression.trim();

      // Handle variable assignment
      if (cleanExpr.includes("=") && !this.isComparison(cleanExpr)) {
        return this.handleAssignment(cleanExpr);
      }

      // Handle special commands
      if (cleanExpr === "vars" || cleanExpr.startsWith("vars")) {
        return this.listVariables();
      }

      if (cleanExpr.startsWith("delete ")) {
        return this.deleteVariable(cleanExpr.substring(7).trim());
      }

      if (cleanExpr === "clear vars") {
        return this.clearVariables();
      }

      // Evaluate expression
      const result = this.evaluateExpression(cleanExpr);
      return {
        success: true,
        result: result.value,
        type: result.type,
      };
    } catch (error) {
      return {
        success: false,
        result: null,
        error: error instanceof Error ? error.message : "Unknown error",
        type: "error",
      };
    }
  }

  /**
   * Check if expression contains comparison operators
   */
  private isComparison(expr: string): boolean {
    const comparisonOps = ["==", "!=", "<=", ">=", "<", ">", "&&", "||"];
    return comparisonOps.some((op) => expr.includes(op));
  }

  /**
   * Handle variable assignment
   */
  private handleAssignment(expression: string): ExpressionResult {
    const parts = expression.split("=");
    if (parts.length !== 2) {
      throw new Error("Invalid assignment syntax. Use: variable = value");
    }

    const varName = (parts[0] || "").trim();
    const valueExpr = (parts[1] || "").trim();

    // Validate variable name
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(varName)) {
      throw new Error(
        "Invalid variable name. Use letters, numbers, and underscores only.",
      );
    }

    // Evaluate the value expression
    const result = this.evaluateExpression(valueExpr);

    // Store the variable
    this.variables.set(varName, {
      name: varName,
      value: result.value,
      type: result.type as "number" | "string" | "boolean",
    });

    return {
      success: true,
      result: `${varName} = ${this.formatValue(result.value, result.type)}`,
      type: "assignment",
    };
  }

  /**
   * Evaluate a mathematical or logical expression
   */
  private evaluateExpression(expression: string): {
    value: any;
    type: string;
  } {
    const cleanExpr = this.preprocessExpression(expression);

    // Handle string literals
    if (
      (cleanExpr.startsWith('"') && cleanExpr.endsWith('"')) ||
      (cleanExpr.startsWith("'") && cleanExpr.endsWith("'"))
    ) {
      return { value: cleanExpr.slice(1, -1), type: "string" };
    }

    // Handle boolean literals
    if (cleanExpr === "true") return { value: true, type: "boolean" };
    if (cleanExpr === "false") return { value: false, type: "boolean" };

    // Handle comparison operations
    if (this.isComparison(cleanExpr)) {
      return this.evaluateComparison(cleanExpr);
    }

    // Handle mathematical expressions
    return this.evaluateMath(cleanExpr);
  }

  /**
   * Preprocess expression by substituting variables and constants
   */
  private preprocessExpression(expression: string): string {
    let result = expression;

    // Substitute variables
    for (const [name, variable] of this.variables) {
      const regex = new RegExp(`\\b${name}\\b`, "g");
      const value =
        typeof variable.value === "string"
          ? `"${variable.value}"`
          : String(variable.value);
      result = result.replace(regex, value);
    }

    // Substitute constants
    for (const [name, value] of this.constants) {
      const regex = new RegExp(`\\b${name}\\b`, "g");
      result = result.replace(regex, String(value));
    }

    return result;
  }

  /**
   * Evaluate comparison expressions
   */
  private evaluateComparison(expression: string): {
    value: any;
    type: string;
  } {
    // Handle logical operators (&&, ||)
    if (expression.includes("&&")) {
      const parts = expression.split("&&").map((p) => p.trim());
      const results = parts.map((p) => this.evaluateExpression(p));
      const value = results.every((r) => this.isTruthy(r.value));
      return { value, type: "boolean" };
    }

    if (expression.includes("||")) {
      const parts = expression.split("||").map((p) => p.trim());
      const results = parts.map((p) => this.evaluateExpression(p));
      const value = results.some((r) => this.isTruthy(r.value));
      return { value, type: "boolean" };
    }

    // Handle comparison operators (check longer operators first to avoid partial matches)
    const operators = ["==", "!=", "<=", ">=", "<", ">"];
    for (const op of operators) {
      if (expression.includes(op)) {
        // Split only on the first occurrence to handle strings properly
        const index = expression.indexOf(op);
        const left = expression.substring(0, index).trim();
        const right = expression.substring(index + op.length).trim();

        if (left && right) {
          const leftResult = this.evaluateExpression(left);
          const rightResult = this.evaluateExpression(right);
          const value = this.compare(leftResult.value, op, rightResult.value);
          return { value, type: "boolean" };
        }
      }
    }

    throw new Error("Invalid comparison expression");
  }

  /**
   * Compare two values with an operator
   */
  private compare(left: any, operator: string, right: any): boolean {
    switch (operator) {
      case "==":
        return left == right;
      case "!=":
        return left != right;
      case "<":
        return left < right;
      case ">":
        return left > right;
      case "<=":
        return left <= right;
      case ">=":
        return left >= right;
      default:
        throw new Error(`Unknown operator: ${operator}`);
    }
  }

  /**
   * Check if value is truthy
   */
  private isTruthy(value: any): boolean {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") return value.length > 0;
    return !!value;
  }

  /**
   * Evaluate mathematical expressions
   */
  private evaluateMath(expression: string): {
    value: any;
    type: string;
  } {
    // Handle string concatenation
    if (expression.includes("+") && this.hasStringOperands(expression)) {
      return this.evaluateStringConcatenation(expression);
    }

    try {
      // For mathematical expressions, use a safe evaluation
      const result = this.safeMathEval(expression);
      return {
        value: typeof result === "number" ? result : parseFloat(result),
        type: "number",
      };
    } catch (error) {
      // If math evaluation fails, try as a single value
      const trimmed = expression.trim();

      // Check if it's a number
      if (/^-?\d+\.?\d*$/.test(trimmed)) {
        return { value: parseFloat(trimmed), type: "number" };
      }

      throw new Error(`Cannot evaluate expression: ${expression}`);
    }
  }

  /**
   * Check if expression has string operands
   */
  private hasStringOperands(expression: string): boolean {
    return /["']/.test(expression);
  }

  /**
   * Evaluate string concatenation
   */
  private evaluateStringConcatenation(expression: string): {
    value: any;
    type: string;
  } {
    const parts = expression.split("+").map((p) => p.trim());
    let result = "";

    for (const part of parts) {
      const evaluated = this.evaluateExpression(part);
      result += String(evaluated.value);
    }

    return { value: result, type: "string" };
  }

  /**
   * Safe mathematical evaluation using Function constructor
   */
  private safeMathEval(expression: string): number {
    // Replace mathematical functions
    let safeExpr = expression
      .replace(/\bsin\b/g, "Math.sin")
      .replace(/\bcos\b/g, "Math.cos")
      .replace(/\btan\b/g, "Math.tan")
      .replace(/\basin\b/g, "Math.asin")
      .replace(/\bacos\b/g, "Math.acos")
      .replace(/\batan\b/g, "Math.atan")
      .replace(/\batan2\b/g, "Math.atan2")
      .replace(/\bsqrt\b/g, "Math.sqrt")
      .replace(/\babs\b/g, "Math.abs")
      .replace(/\bfloor\b/g, "Math.floor")
      .replace(/\bceil\b/g, "Math.ceil")
      .replace(/\bround\b/g, "Math.round")
      .replace(/\blog\b/g, "Math.log")
      .replace(/\blog10\b/g, "Math.log10")
      .replace(/\blog2\b/g, "Math.log2")
      .replace(/\bexp\b/g, "Math.exp")
      .replace(/\bpow\b/g, "Math.pow")
      .replace(/\bmin\b/g, "Math.min")
      .replace(/\bmax\b/g, "Math.max")
      .replace(/\brandom\b/g, "Math.random");

    // Validate expression contains only safe characters
    if (!/^[0-9+\-*/().\s,Math\w]+$/.test(safeExpr)) {
      throw new Error("Invalid mathematical expression");
    }

    try {
      return Function(`"use strict"; return (${safeExpr})`)();
    } catch (error) {
      throw new Error("Mathematical evaluation failed");
    }
  }

  /**
   * List all variables
   */
  private listVariables(): ExpressionResult {
    if (this.variables.size === 0) {
      return {
        success: true,
        result: "No variables defined",
        type: "info",
      };
    }

    const vars: string[] = [];
    for (const [name, variable] of this.variables) {
      vars.push(
        `${name} = ${this.formatValue(variable.value, variable.type)} (${variable.type})`,
      );
    }

    return {
      success: true,
      result: vars.join("\n"),
      type: "info",
    };
  }

  /**
   * Clear all variables
   */
  private clearVariables(): ExpressionResult {
    const count = this.variables.size;
    this.variables.clear();
    return {
      success: true,
      result: `Cleared ${count} variable(s)`,
      type: "info",
    };
  }

  /**
   * Delete a specific variable
   */
  private deleteVariable(name: string): ExpressionResult {
    if (this.variables.has(name)) {
      this.variables.delete(name);
      return {
        success: true,
        result: `Deleted variable '${name}'`,
        type: "info",
      };
    } else {
      return {
        success: false,
        result: null,
        error: `Variable '${name}' not found`,
        type: "error",
      };
    }
  }

  /**
   * Format value for display
   */
  private formatValue(value: any, type: string): string {
    switch (type) {
      case "string":
        return `"${value}"`;
      case "boolean":
        return value ? "true" : "false";
      case "number":
        return Number.isInteger(value)
          ? value.toString()
          : value.toFixed(6).replace(/\.?0+$/, "");
      default:
        return String(value);
    }
  }

  /**
   * Get variable value by name
   */
  getVariable(name: string): Variable | undefined {
    return this.variables.get(name);
  }

  /**
   * Set variable programmatically
   */
  setVariable(name: string, value: any, type?: string): void {
    const inferredType = type || typeof value;
    this.variables.set(name, {
      name,
      value,
      type: inferredType as "number" | "string" | "boolean",
    });
  }

  /**
   * Check if variable exists
   */
  hasVariable(name: string): boolean {
    return this.variables.has(name);
  }

  /**
   * Get all variables
   */
  getAllVariables(): Map<string, Variable> {
    return new Map(this.variables);
  }

  /**
   * Get help text for the expression engine
   */
  static getHelp(): string {
    return `Expression Engine Help:

Mathematical Operations:
  2 + 3 * 4          → 14
  sqrt(16)           → 4
  sin(PI/2)          → 1
  pow(2, 3)          → 8

Variables:
  x = 10             → Set variable
  y = x * 2          → Use variables
  vars               → List all variables
  delete x           → Delete variable
  clear vars         → Clear all variables

Strings:
  name = "Alice"     → String variable
  greeting = "Hello " + name → Concatenation

Comparisons:
  x > 5              → Boolean result
  x == 10 && y < 20  → Logical operations
  5 <= 10            → true
  "hello" == "world" → false

Built-in Constants:
  PI   → 3.14159... (π)
  E    → 2.71828... (e)
  PHI  → 1.61803... (φ, Golden ratio)

Mathematical Functions:
  Trigonometric:
    sin(x), cos(x), tan(x)
    asin(x), acos(x), atan(x), atan2(y,x)

  Basic:
    sqrt(x), abs(x), pow(x,y)
    floor(x), ceil(x), round(x)

  Logarithmic:
    log(x), log10(x), log2(x), exp(x)

  Utility:
    min(x,y), max(x,y), random()

Examples:
  calc 2 + 3 * 4              → 14
  calc x = 10                 → x = 10
  calc y = x * 2              → y = 20
  calc sqrt(16) + pow(2,3)    → 12
  calc PI * 2                 → 6.283185...
  calc x > 5 && y < 30        → true
  calc random() * 100         → Random 0-100`;
  }
}
