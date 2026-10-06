/**
 * Guards the pairing that M13 broke.
 *
 * `PROVISIONED_OBJECTIVE_TYPES` is the GATE that decides whether
 * `provisionMissionInfrastructure` runs at all; the `switch (obj.type)` inside
 * that method is the WORK that patches metadata. They had drifted — the switch
 * had `case` arms for three types the gate excluded, so those arms were dead and
 * any mission made only of those types got no infrastructure.
 *
 * A comment cannot enforce that. This does, by reading the source.
 */
import "reflect-metadata";
import { readFileSync } from "fs";
import { join } from "path";
import { PROVISIONED_OBJECTIVE_TYPES } from "../src/services/serverContentService";
import { MISSION_TEMPLATES } from "../src/services/missionTemplatePool";
import { OBJECTIVE_TYPES } from "../src/services/missionObjectiveTypes";

const rows: Array<[string, boolean, string]> = [];

// ── 1. Gate vs switch coverage ──
const src = readFileSync(
  join(__dirname, "..", "src", "services", "serverContentService.ts"),
  "utf8",
);
// Isolate the patch switch inside provisionMissionInfrastructure.
//
// Brace-matched, not heuristic. A first attempt used indexOf("\n      }") for
// the end, which matched far too early and yielded an EMPTY body — making the
// "every arm is gated" check pass vacuously with 0 arms. Checks 1 and 2 are each
// other's control, which is the only reason that was visible.
const provisionStart = src.indexOf("public async provisionMissionInfrastructure");
if (provisionStart < 0) throw new Error("provisionMissionInfrastructure not found");
// Anchor on the brace: a comment in the same method mentions `switch (obj.type)`
// in backticks, and matching that instead sent the brace-matcher into prose.
const switchStart = src.indexOf("switch (obj.type) {", provisionStart);
if (switchStart < 0) throw new Error("patch switch not found");
const openBrace = src.indexOf("{", switchStart);
let depth = 0;
let switchEnd = -1;
for (let i = openBrace; i < src.length; i++) {
  if (src[i] === "{") depth++;
  else if (src[i] === "}") {
    depth--;
    if (depth === 0) { switchEnd = i; break; }
  }
}
if (switchEnd < 0) throw new Error("could not brace-match the patch switch");
const switchBody = src.slice(openBrace, switchEnd);
const switchTypes = new Set(
  [...switchBody.matchAll(/case\s+"([a-z_]+)"/g)].map((m) => m[1]!),
);
if (switchTypes.size === 0) {
  throw new Error("extracted 0 case arms — the extraction is broken, not the code");
}

const gate = new Set(PROVISIONED_OBJECTIVE_TYPES);
const inSwitchNotGate = [...switchTypes].filter((t) => !gate.has(t));
const inGateNotSwitch = [...gate].filter((t) => !switchTypes.has(t));

rows.push([
  "every switch arm is reachable via the gate",
  inSwitchNotGate.length === 0,
  inSwitchNotGate.length ? `unreachable arms: ${inSwitchNotGate.join(", ")}` : `${switchTypes.size} arms all gated`,
]);
rows.push([
  "gate has no types the switch ignores",
  inGateNotSwitch.length === 0,
  inGateNotSwitch.length ? `gated but unpatched: ${inGateNotSwitch.join(", ")}` : "gate matches switch",
]);

// ── 2. Every gated/switched type is a real registered type ──
const unknown = [...new Set([...gate, ...switchTypes])].filter((t) => !OBJECTIVE_TYPES.has(t));
rows.push([
  "all provisioned types exist in the registry",
  unknown.length === 0,
  unknown.length ? `unknown: ${unknown.join(", ")}` : "all known",
]);

// ── 3. No template is left with zero provisionable objectives while still
//       requiring id metadata — that is the deep_extraction shape.
const idKeys = new Set(["serverId", "fileId", "networkId"]);
const stranded: string[] = [];
for (const [id, t] of MISSION_TEMPLATES) {
  const anyGated = t.objectives.some((o) => gate.has(o.type));
  if (anyGated) continue;
  const needsId = t.objectives.some((o) => {
    const d = OBJECTIVE_TYPES.get(o.type);
    return !!d && d.requiredMetadata.some((k) => idKeys.has(k));
  });
  if (needsId) stranded.push(id);
}
rows.push([
  "no template needs ids but skips provisioning",
  stranded.length === 0,
  stranded.length ? `stranded: ${stranded.join(", ")}` : `checked ${MISSION_TEMPLATES.size} templates`,
]);

// ── 4. Target type matches progressType for every authored objective (M14) ──
const mismatched: string[] = [];
for (const [id, t] of MISSION_TEMPLATES) {
  for (const o of t.objectives) {
    const d = OBJECTIVE_TYPES.get(o.type);
    if (!d) { mismatched.push(`${id}:${o.type}(unknown)`); continue; }
    const wantsNumber = d.progressType === "count";
    const kind = typeof o.target;
    if ((wantsNumber && kind !== "number") || (!wantsNumber && kind !== "boolean")) {
      mismatched.push(`${id}:${o.type}(${d.progressType} vs ${kind})`);
    }
  }
}
rows.push([
  "all authored targets match progressType",
  mismatched.length === 0,
  mismatched.length ? mismatched.join(", ") : "134/134 objectives consistent",
]);

console.log("\n===== MISSION PROVISIONING CONTRACT =====");
for (const [n, ok, why] of rows) console.log(`${ok ? "PASS" : "FAIL"}  ${n.padEnd(44)} ${why}`);
const failed = rows.filter(([, ok]) => !ok).length;
console.log(`\n${rows.length - failed}/${rows.length} passed`);
console.log("=========================================");
if (failed) process.exitCode = 1;
