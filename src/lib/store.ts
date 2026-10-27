import "server-only";
import { promises as fs } from "fs";
import path from "path";
import { calc, fmt, normalize } from "./calc";
import type { Problem } from "./types";

// Problems live in a CSV on disk (same layout as the original sheet: no.,Problem,Solution).
// PROBLEMS_CSV points at a persistent location in production (e.g. a Docker volume). On first run
// it is filled from the bundled starter list in data/problems.csv.
const SEED = path.join(process.cwd(), "data", "problems.csv");
const FILE = process.env.PROBLEMS_CSV ?? SEED;
const HEADER = "no.,Problem,Solution";
const MAX_PROBLEMS = 1000;
const MAX_EXPR = 120;

export async function readProblems(): Promise<Problem[]> {
  let text: string;
  try {
    text = await fs.readFile(FILE, "utf8");
  } catch {
    if (FILE === SEED) return [];
    try {
      text = await fs.readFile(SEED, "utf8");
      await fs.mkdir(path.dirname(FILE), { recursive: true });
      await fs.writeFile(FILE, text, "utf8");
    } catch {
      return [];
    }
  }
  return text
    .split(/\r?\n/)
    .slice(1)
    .filter((line) => line.trim())
    .map((line, idx) => {
      const [, expr = ""] = line.split(",");
      const clean = normalize(expr);
      let answer = NaN;
      try { answer = calc(clean); } catch {}
      return { no: idx + 1, expr: clean, answer };
    })
    .filter((p) => p.expr);
}

export function toCsv(problems: Problem[]): string {
  return [HEADER, ...problems.map((p, i) => `${i + 1},${p.expr},${fmt(p.answer)}`)].join("\n") + "\n";
}

async function writeProblems(problems: Problem[]): Promise<Problem[]> {
  const renumbered = problems.map((p, i) => ({ ...p, no: i + 1 }));
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  const tmp = FILE + ".tmp";
  await fs.writeFile(tmp, toCsv(renumbered), "utf8");
  await fs.rename(tmp, FILE);
  return renumbered;
}

// Serialize writes so two quick edits can't clobber each other.
let queue: Promise<unknown> = Promise.resolve();
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

function check(expr: string) {
  const clean = normalize(expr);
  if (clean.length > MAX_EXPR) throw new Error(`Keep problems under ${MAX_EXPR} characters.`);
  return { clean, answer: calc(clean) };
}

export function addProblem(expr: string) {
  return locked(async () => {
    const { clean, answer } = check(expr);
    const list = await readProblems();
    if (list.length >= MAX_PROBLEMS) throw new Error(`The list is full (${MAX_PROBLEMS} problems). Delete some first.`);
    return writeProblems([...list, { no: list.length + 1, expr: clean, answer }]);
  });
}

export function updateProblem(no: number, expr: string) {
  return locked(async () => {
    const { clean, answer } = check(expr);
    const list = await readProblems();
    if (!list.some((p) => p.no === no)) throw new NotFound();
    return writeProblems(list.map((p) => (p.no === no ? { ...p, expr: clean, answer } : p)));
  });
}

export function deleteProblem(no: number) {
  return locked(async () => {
    const list = await readProblems();
    if (!list.some((p) => p.no === no)) throw new NotFound();
    return writeProblems(list.filter((p) => p.no !== no));
  });
}

/** Replaces the list, or adds to the end of it, with problems from an uploaded CSV. */
export function importProblems(exprs: string[], mode: "replace" | "append") {
  return locked(async () => {
    const added = exprs.map((expr, i) => {
      try {
        const { clean, answer } = check(expr);
        return { no: 0, expr: clean, answer };
      } catch (e) {
        throw new Error(`Problem ${i + 1} (“${expr}”): ${(e as Error).message}`);
      }
    });
    if (!added.length) throw new Error("The file has no problems in it.");
    const list = mode === "append" ? [...(await readProblems()), ...added] : added;
    if (list.length > MAX_PROBLEMS) throw new Error(`That would make ${list.length} problems. The limit is ${MAX_PROBLEMS}.`);
    return writeProblems(list);
  });
}

export class NotFound extends Error {
  constructor() { super("That problem no longer exists. Reload the list."); }
}
