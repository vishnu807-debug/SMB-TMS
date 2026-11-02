// Hosted Supabase rejects UPDATE/DELETE without WHERE (pg-safeupdate) for API calls,
// including inside functions. Fail the build if a migration contains one.
import { readdirSync, readFileSync } from "node:fs";
const dir = "supabase/migrations";
// 0021 shipped such a statement; 0022 replaces the function.
const superseded = new Set(["20261101000021_branding.sql"]);
let bad = 0;
for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
  if (superseded.has(f)) continue;
  const sql = readFileSync(`${dir}/${f}`, "utf8").replace(/--[^\n]*/g, "");
  for (const m of sql.matchAll(/\b(update|delete\s+from)\s+public\.\w+[^;]*;/gi)) {
    if (!/\bwhere\b/i.test(m[0])) {
      bad++;
      console.error(`${f}:${sql.slice(0, m.index).split("\n").length}: ${m[0].replace(/\s+/g, " ").slice(0, 100)} — add a WHERE clause`);
    }
  }
}
if (bad) process.exit(1);
console.log("Migrations OK: every UPDATE/DELETE has a WHERE clause.");
