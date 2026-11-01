/**
 * Migration script – reads /db/schema.sql and executes it against Neon.
 * Run with: npm run db:migrate
 */

import { neon } from "@neondatabase/serverless";
import { readFileSync } from "fs";
import { join } from "path";

export function splitSqlStatements(source: string): string[] {
  const statements: string[] = [];
  let start = 0;
  let index = 0;
  let state: "single" | "double" | "line" | "block" | "dollar" | null = null;
  let dollarTag = "";

  while (index < source.length) {
    const current = source[index];
    const next = source[index + 1];
    if (state === "single") {
      if (current === "'" && next === "'") index += 2;
      else {
        if (current === "'") state = null;
        index += 1;
      }
      continue;
    }
    if (state === "double") {
      if (current === '"' && next === '"') index += 2;
      else {
        if (current === '"') state = null;
        index += 1;
      }
      continue;
    }
    if (state === "line") {
      if (current === "\n") state = null;
      index += 1;
      continue;
    }
    if (state === "block") {
      if (current === "*" && next === "/") {
        state = null;
        index += 2;
      } else index += 1;
      continue;
    }
    if (state === "dollar") {
      if (source.startsWith(dollarTag, index)) {
        index += dollarTag.length;
        state = null;
      } else index += 1;
      continue;
    }

    if (current === "'" ) state = "single";
    else if (current === '"') state = "double";
    else if (current === "-" && next === "-") {
      state = "line";
      index += 2;
      continue;
    } else if (current === "/" && next === "*") {
      state = "block";
      index += 2;
      continue;
    } else if (current === "$") {
      const tag = source.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/)?.[0];
      if (tag) {
        dollarTag = tag;
        state = "dollar";
        index += tag.length;
        continue;
      }
    } else if (current === ";") {
      const statement = source.slice(start, index).trim();
      if (statement) statements.push(statement);
      start = index + 1;
    }
    index += 1;
  }

  const trailing = source.slice(start).trim();
  if (trailing) statements.push(trailing);
  return statements;
}

async function main() {
  // Use the direct (unpooled) connection for DDL — PgBouncer in transaction
  // mode cannot run multi-statement schema scripts reliably.
  const databaseUrl = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("❌  DATABASE_URL / DATABASE_URL_UNPOOLED is not set. Add it to .env.local and retry.");
    process.exit(1);
  }

  const schemaPath = join(process.cwd(), "db", "schema.sql");
  const sql = neon(databaseUrl);

  console.info("📂  Reading schema from", schemaPath);
  const schemaSql = readFileSync(schemaPath, "utf-8");

  const statements = splitSqlStatements(schemaSql);

  console.info(`🚀  Running ${statements.length} statement(s) against Neon …`);
  for (const statement of statements) {
    await sql.query(statement);
  }

  console.info("✅  Migration complete.");
}

main().catch((err) => {
  console.error("❌  Migration failed:", err);
  process.exit(1);
});
