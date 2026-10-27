import { NextResponse } from "next/server";
import { addProblem, importProblems, readProblems, toCsv } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const problems = await readProblems();
  if (new URL(req.url).searchParams.get("format") === "csv") {
    return new NextResponse(toCsv(problems), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="outing_math_problem.csv"',
      },
    });
  }
  return NextResponse.json(problems);
}

export async function POST(req: Request) {
  const { expr } = (await req.json().catch(() => ({}))) as { expr?: string };
  try {
    return NextResponse.json(await addProblem(String(expr ?? "")), { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

// Upload: the whole list from a CSV, either replacing the current one or added to the end.
export async function PUT(req: Request) {
  const { exprs, mode } = (await req.json().catch(() => ({}))) as { exprs?: unknown; mode?: string };
  if (!Array.isArray(exprs)) return NextResponse.json({ error: "Send a list of problems." }, { status: 400 });
  try {
    return NextResponse.json(await importProblems(exprs.map(String), mode === "append" ? "append" : "replace"));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
