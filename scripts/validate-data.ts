/**
 * Validates the three client-supplied files before deployment:
 * JSON structure, CSV bank, their agreement, and the agent prompt.
 * Usage: npm run validate-data
 */
import fs from "node:fs";
import { CATEGORIES, CONFIG_PATH, CSV_PATH, checkConfigConsistency, getAgentPrompt, parseConfig } from "../src/lib/config";
import { buildBank, parseQuestionCsv } from "../src/lib/questionBank";

const cfg = parseConfig(JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")));
const problems = checkConfigConsistency(cfg);
const { bank, problems: bankProblems } = buildBank(parseQuestionCsv(fs.readFileSync(CSV_PATH, "utf8")), cfg);
problems.push(...bankProblems);
if (getAgentPrompt() !== cfg.agent_system_prompt.trim()) problems.push("agent_prompt.txt differs from agent_system_prompt in the JSON");

console.log(`${cfg.product} v${cfg.version}`);
console.log(`Roles: ${cfg.roles.length} · questions in CSV: ${bank.length} · in JSON: ${cfg.questions.length}`);
for (const role of cfg.roles) {
  const counts = CATEGORIES.map((c) => bank.filter((q) => q.role === role && q.category === c).length);
  console.log(`  ${role.padEnd(32)} ${counts.join(" / ")}  (total ${counts.reduce((a, b) => a + b, 0)})`);
}
if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log("\nAll checks passed.");
