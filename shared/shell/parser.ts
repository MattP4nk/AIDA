/**
 * AIDA Shell — Parser
 *
 * Tokens → AST. Grammar (POSIX-shaped, deliberately reduced):
 *
 *   list        := andOr ( ( ';' | '&' ) andOr )*
 *   andOr       := pipeline ( ( '&&' | '||' ) pipeline )*
 *   pipeline    := command ( '|' command )*
 *   command     := WORD+ redirect*
 *   redirect    := ( '>' | '>>' | '<' ) WORD
 *
 * Deliberately excluded for now: command substitution `$(…)`, subshells,
 * functions, control flow, here-docs. See SHELL_DESIGN.md §4.
 */

import { ShellParseError, type Token, type Word } from "./lexer";

export interface RedirectNode {
  kind: "redirect";
  op: ">" | ">>" | "<";
  target: Word;
}

export interface CommandNode {
  kind: "command";
  /** words[0] is the command name prior to expansion. */
  words: Word[];
  redirects: RedirectNode[];
}

export interface PipelineNode {
  kind: "pipeline";
  stages: CommandNode[];
}

export interface AndOrNode {
  kind: "andor";
  op: "&&" | "||";
  left: Node;
  right: Node;
}

export interface ListNode {
  kind: "list";
  items: { node: Node; background: boolean }[];
}

export type Node = ListNode | AndOrNode | PipelineNode | CommandNode;

/** Structural limits — see SHELL_DESIGN.md §9. */
export const MAX_PIPELINE_STAGES = 16;
export const MAX_AST_DEPTH = 32;

class Parser {
  private pos = 0;

  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    // tokenize() always appends EOF, so this is total.
    return this.tokens[this.pos] ?? this.tokens[this.tokens.length - 1]!;
  }

  private advance(): Token {
    const t = this.peek();
    if (t.type !== "EOF") this.pos++;
    return t;
  }

  private at(...types: Token["type"][]): boolean {
    return types.includes(this.peek().type);
  }

  parseList(depth = 0): Node {
    if (depth > MAX_AST_DEPTH) {
      throw new ShellParseError("Command nesting too deep", this.peek().start);
    }

    const items: { node: Node; background: boolean }[] = [];

    for (;;) {
      const node = this.parseAndOr(depth + 1);
      let background = false;

      if (this.at("AMP")) {
        this.advance();
        background = true;
      } else if (this.at("SEMI")) {
        this.advance();
      }

      items.push({ node, background });

      if (this.at("EOF")) break;
      // Anything else means another element follows.
    }

    // A single non-background element collapses — the overwhelmingly common
    // case stays a bare CommandNode, which keeps the executor's fast path flat.
    if (items.length === 1 && !items[0]!.background) {
      return items[0]!.node;
    }
    return { kind: "list", items };
  }

  private parseAndOr(depth: number): Node {
    if (depth > MAX_AST_DEPTH) {
      throw new ShellParseError("Command nesting too deep", this.peek().start);
    }

    let left: Node = this.parsePipeline(depth + 1);

    while (this.at("AND", "OR")) {
      const op = this.advance().type === "AND" ? "&&" : "||";
      const right = this.parsePipeline(depth + 1);
      left = { kind: "andor", op, left, right };
    }

    return left;
  }

  private parsePipeline(depth: number): Node {
    const stages: CommandNode[] = [this.parseCommand(depth + 1)];

    while (this.at("PIPE")) {
      this.advance();
      stages.push(this.parseCommand(depth + 1));
      if (stages.length > MAX_PIPELINE_STAGES) {
        throw new ShellParseError(
          `Pipeline too long (max ${MAX_PIPELINE_STAGES} stages)`,
          this.peek().start,
        );
      }
    }

    // Single-stage pipelines collapse to the command itself.
    if (stages.length === 1) return stages[0]!;
    return { kind: "pipeline", stages };
  }

  private parseCommand(_depth: number): CommandNode {
    const words: Word[] = [];
    const redirects: RedirectNode[] = [];

    for (;;) {
      const t = this.peek();

      if (t.type === "WORD") {
        this.advance();
        words.push(t.word!);
        continue;
      }

      if (t.type === "GT" || t.type === "GTGT" || t.type === "LT") {
        this.advance();
        const target = this.peek();
        if (target.type !== "WORD") {
          throw new ShellParseError(
            "Expected a filename after redirection",
            target.start,
          );
        }
        this.advance();
        const op = t.type === "GT" ? ">" : t.type === "GTGT" ? ">>" : "<";
        redirects.push({ kind: "redirect", op, target: target.word! });
        continue;
      }

      break;
    }

    if (words.length === 0) {
      const t = this.peek();
      throw new ShellParseError(
        t.type === "EOF" ? "Unexpected end of command" : "Expected a command",
        t.start,
      );
    }

    return { kind: "command", words, redirects };
  }
}

export function parse(tokens: Token[]): Node {
  return new Parser(tokens).parseList();
}

/**
 * True when the AST is a single plain command with no redirects — i.e. exactly
 * what the pre-shell command processor handled. This is the compatibility fast
 * path: any input without shell metacharacters lands here and behaves
 * identically to before.
 */
export function isSimpleCommand(node: Node): node is CommandNode {
  return node.kind === "command" && node.redirects.length === 0;
}
