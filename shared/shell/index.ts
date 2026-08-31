/**
 * AIDA Shell — public surface.
 *
 * See SHELL_DESIGN.md for the full architecture. Currently implemented:
 * lexer (quoting/escaping), parser (grammar → AST), and argv parsing.
 * Expansion and the pipeline executor are later rollout steps.
 */

export {
  tokenize,
  wordText,
  wordIsQuoted,
  ShellParseError,
  type Token,
  type TokenType,
  type Word,
  type Segment,
} from "./lexer";

export {
  parse,
  isSimpleCommand,
  MAX_PIPELINE_STAGES,
  MAX_AST_DEPTH,
  type Node,
  type CommandNode,
  type PipelineNode,
  type AndOrNode,
  type ListNode,
  type RedirectNode,
} from "./parser";

export { parseArgs, hasFlag, type ParsedArgs, type ArgSpec } from "./args";
