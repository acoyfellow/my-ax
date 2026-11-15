import { readdirSync, readFileSync } from "node:fs";
import { sqliteD1 } from "../fsm/sqlite-d1";

const MIGRATIONS = new URL("../../migrations/", import.meta.url);

function migrationSchema(): string {
  return readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => readFileSync(new URL(name, MIGRATIONS), "utf8"))
    .join("\n");
}

let cachedSchema: string | null = null;

export type TestDb = ReturnType<typeof sqliteD1> & {
  writes: string[];
  rows<T>(sql: string, ...params: Array<string | number | null>): T[];
  exec(sql: string): void;
};

const WRITE_RE = /^\s*(INSERT|UPDATE|DELETE)\b/i;

function label(sql: string): string {
  return sql.trim().split(/\s+/).slice(0, 3).join(" ");
}

export function testDb(): TestDb {
  cachedSchema ??= migrationSchema();
  const base = sqliteD1(cachedSchema);
  const writes: string[] = [];
  const prepare = (sql: string) => {
    const statement = base.prepare(sql);
    return {
      bind(...values: unknown[]) {
        const bound = statement.bind(...values);
        return {
          ...bound,
          async run() {
            if (WRITE_RE.test(sql)) writes.push(label(sql));
            return bound.run();
          },
          async first<T>() {
            if (WRITE_RE.test(sql)) writes.push(label(sql));
            return bound.first<T>();
          },
        };
      },
    };
  };
  return {
    ...base,
    prepare,
    writes,
    rows: <T>(sql: string, ...params: Array<string | number | null>) => base.raw.prepare(sql).all(...params) as T[],
    exec: (sql: string) => base.raw.exec(sql),
  };
}
