/**
 * Remove comments from TypeScript source — correctly.
 *
 * The idiom used across these harnesses,
 *   src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
 * is not string-aware. A string literal containing `/*` — playerInfoCommands
 * has "/*\/proof.log" — opens a fake block comment that runs to the next
 * `*\/` anywhere in the file: there, 322 lines of real code, two database
 * writes among them, vanished from a check that was counting writes.
 *
 * A bare ts.createScanner is not enough either: it cannot tell where a
 * `${...}` inside a template literal ends (only the parser drives that), so
 * after the first interpolated template it mis-tokenizes the rest of the file.
 * This PARSES the file, collects the comment ranges attached to every real
 * token, and blanks exactly those ranges — keeping newlines, so line-based
 * checks still line up, and keeping every byte of code as written.
 */
import ts from "typescript";

export function stripComments(source: string, fileName = "x.ts"): string {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, /*setParentNodes*/ false, ts.ScriptKind.TS);
  const ranges = new Map<number, number>(); // pos -> end
  const collect = (pos: number) => {
    for (const r of ts.getLeadingCommentRanges(source, pos) ?? []) ranges.set(r.pos, r.end);
    for (const r of ts.getTrailingCommentRanges(source, pos) ?? []) ranges.set(r.pos, r.end);
  };
  const visit = (node: ts.Node) => {
    collect(node.pos);
    collect(node.end);
    for (const child of node.getChildren(sf)) visit(child);
  };
  visit(sf);
  collect(sf.endOfFileToken.pos);
  let out = "";
  let at = 0;
  for (const [pos, end] of [...ranges].sort((a, b) => a[0] - b[0])) {
    if (pos < at) continue; // nested/overlapping report of the same comment
    out += source.slice(at, pos) + source.slice(pos, end).replace(/[^\n]/g, "");
    at = end;
  }
  return out + source.slice(at);
}
