import { DatabaseSync } from "node:sqlite";

export function sqliteD1(schema: string) {
  const database = new DatabaseSync(":memory:");
  database.exec(schema);
  const d1 = {
    raw: database,
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      database.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          const params = values as (string | number | null)[];
          return {
            async run() {
              const result = database.prepare(sql).run(...params);
              return { meta: { changes: Number(result.changes) } };
            },
            async first<T>() {
              return (database.prepare(sql).get(...params) ?? null) as T | null;
            },
            async all<T>() {
              return { results: database.prepare(sql).all(...params) as T[] };
            },
          };
        },
      };
    },
  };
  return d1;
}
