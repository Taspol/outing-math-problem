import { normalize, tryCalc } from "./calc";

export type ParsedCsv = {
  exprs: string[];
  skipped: { line: number; text: string }[];
};

/**
 * Reads problems from a CSV. Accepts the exported layout (no.,Problem,Solution), a sheet with a
 * "Problem" column anywhere, or a plain list with one problem per line. Rows that aren't valid
 * problems are skipped and reported.
 */
export function parseProblemsCsv(text: string): ParsedCsv {
  const rows = text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .map((line, i) => ({ line: i + 1, cells: splitRow(line) }))
    .filter((r) => r.cells.some((c) => c.trim()));
  if (!rows.length) return { exprs: [], skipped: [] };

  const header = rows[0].cells.map((c) => c.trim().toLowerCase());
  let col = header.findIndex((c) => c === "problem" || c === "expr" || c === "expression");
  const hasHeader = col >= 0 || header.some((c) => c === "no." || c === "no" || c === "solution");
  if (col < 0) col = rows[0].cells.length >= 2 && /^\d+$/.test(rows[hasHeader ? 1 : 0]?.cells[0]?.trim() ?? "") ? 1 : 0;

  const exprs: string[] = [];
  const skipped: ParsedCsv["skipped"] = [];
  for (const r of hasHeader ? rows.slice(1) : rows) {
    const expr = normalize(r.cells[col] ?? "");
    if (expr && tryCalc(expr) !== null) exprs.push(expr);
    else skipped.push({ line: r.line, text: r.cells.join(",").trim() });
  }
  return { exprs, skipped };
}

/** Splits one CSV line, honouring "quoted, cells". */
function splitRow(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { cells.push(cur); cur = ""; }
    else cur += ch;
  }
  cells.push(cur);
  return cells;
}
