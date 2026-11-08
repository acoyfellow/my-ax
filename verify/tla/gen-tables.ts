import { writeFileSync } from "node:fs";
import { SESSION_TRANSITIONS } from "../../src/fsm/session-status";

type Table = Readonly<Record<string, { from: readonly string[]; to: string }>>;

const tlaString = (value: string) => `"${value}"`;

const tlaSet = (values: readonly string[]) => `{${values.map(tlaString).join(", ")}}`;

function caseOver(table: Table, pick: (event: string) => string): string {
  return Object.keys(table)
    .map((event, index) => `${index === 0 ? "CASE" : "  []"} e = ${tlaString(event)} -> ${pick(event)}`)
    .join("\n");
}

function tableModule(name: string, table: Table): string {
  return [
    `---- MODULE ${name} ----`,
    `Events == ${tlaSet(Object.keys(table))}`,
    "",
    `From(e) ==`,
    caseOver(table, (event) => tlaSet(table[event].from)),
    "",
    `To(e) ==`,
    caseOver(table, (event) => tlaString(table[event].to)),
    "",
    `Apply(s, e) == IF s \\in From(e) THEN To(e) ELSE s`,
    "====",
    "",
  ].join("\n");
}

const here = new URL(".", import.meta.url);

writeFileSync(new URL("SessionTable.tla", here), tableModule("SessionTable", SESSION_TRANSITIONS));
