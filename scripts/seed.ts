/** Creates the database (if needed) and imports the CSV question bank. Usage: npm run db:seed */
import { dbPath, openDatabase } from "../src/lib/db";

const db = openDatabase();
const rows = db.prepare(`SELECT role, COUNT(*) AS n FROM questions GROUP BY role ORDER BY MIN(id)`).all() as { role: string; n: number }[];
console.log(`Database: ${dbPath()}`);
for (const r of rows) console.log(`  ${r.role.padEnd(32)} ${r.n}`);
console.log(`Imported ${rows.reduce((a, r) => a + r.n, 0)} questions across ${rows.length} roles.`);
