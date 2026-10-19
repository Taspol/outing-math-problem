import { NextResponse } from "next/server";
import { deleteProblem, NotFound, updateProblem } from "@/lib/store";

type Ctx = { params: Promise<{ no: string }> };

function fail(e: unknown) {
  return NextResponse.json({ error: (e as Error).message }, { status: e instanceof NotFound ? 404 : 400 });
}

export async function PUT(req: Request, { params }: Ctx) {
  const no = Number((await params).no);
  const { expr } = (await req.json().catch(() => ({}))) as { expr?: string };
  try {
    return NextResponse.json(await updateProblem(no, String(expr ?? "")));
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const no = Number((await params).no);
  try {
    return NextResponse.json(await deleteProblem(no));
  } catch (e) {
    return fail(e);
  }
}
