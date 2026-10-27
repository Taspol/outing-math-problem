"use client";

import { useEffect, useRef, useState } from "react";
import { calc, fmt, normalize, pretty, tryCalc } from "@/lib/calc";
import { parseProblemsCsv, type ParsedCsv } from "@/lib/csv";
import type { Problem } from "@/lib/types";

type Upload = ParsedCsv & { name: string };

const pillButton =
  "cursor-pointer rounded-full border-2 border-line px-[22px] py-3 font-semibold text-on-felt transition hover:bg-white/10";

async function api(url: string, method: string, body?: unknown): Promise<Problem[]> {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({ error: "The server didn't answer. Try again." }));
  if (!res.ok) throw new Error(data.error ?? "Couldn't save. Try again.");
  return data;
}

export default function ProblemTable({
  problems,
  onChange,
}: {
  problems: Problem[];
  onChange: (p: Problem[]) => void;
}) {
  const [toast, setToast] = useState("");
  const [upload, setUpload] = useState<Upload | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const flash = (t: string) => {
    setToast(t);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(""), 2500);
  };

  return (
    <section className="flex w-full flex-col items-center gap-[22px]">
      <div className="flex w-full flex-wrap items-center justify-between gap-3">
        <p className="m-0 text-[.95rem] text-on-felt-soft">
          Type a problem with + − × ÷ and brackets. The answer is worked out for you and saved to the CSV.
        </p>
        <div className="flex gap-2">
          <UploadButton onPick={setUpload} flash={flash} />
          {/* A file download, not a page navigation, so a plain <a> is right here. */}
          <a href="/api/problems?format=csv" download className={pillButton}>
            Download CSV
          </a>
        </div>
      </div>

      {upload && (
        <UploadPanel
          upload={upload}
          hasProblems={problems.length > 0}
          onDone={(list, msg) => { if (list) onChange(list); setUpload(null); if (msg) flash(msg); }}
        />
      )}

      <div className="w-full overflow-x-auto rounded-[14px] bg-card text-ink shadow-[0_14px_34px_rgba(0,0,0,.3)]">
        <table className="w-full border-collapse tabular-nums">
          <thead>
            <tr className="text-left text-[.72rem] tracking-[.08em] text-muted uppercase">
              <th className="border-b-2 border-ink px-2.5 py-3 font-semibold">No.</th>
              <th className="border-b-2 border-ink px-2.5 py-3 font-semibold">Problem</th>
              <th className="border-b-2 border-ink px-2.5 py-3 text-right font-semibold">Answer</th>
              <th className="border-b-2 border-ink px-2.5 py-3" />
            </tr>
          </thead>
          <tbody>
            {!problems.length && (
              <tr>
                <td colSpan={4} className="p-7 text-center text-muted">
                  No problems yet. Add the first one in the row below.
                </td>
              </tr>
            )}
            {problems.map((p) => (
              <Row key={`${p.no}:${p.expr}`} problem={p} onChange={onChange} flash={flash} />
            ))}
            <NewRow nextNo={problems.length + 1} onChange={onChange} flash={flash} />
          </tbody>
        </table>
      </div>
      <div className="min-h-[1.2em] text-sm text-on-felt-soft" aria-live="polite">
        {toast}
      </div>
    </section>
  );
}

const inputBase =
  "w-full min-w-[10em] rounded-md border px-2 py-1.5 font-mono text-[1.05rem] font-medium text-ink outline-none focus:border-ink focus:bg-white";

function AnswerCell({ expr }: { expr: string }) {
  const v = expr ? tryCalc(expr) : null;
  return (
    <td className="w-[6em] border-b border-ink/10 px-2.5 py-1.5 text-right font-mono text-[1.05rem]">
      {!expr ? "" : v === null ? "—" : fmt(v)}
      {v !== null && !Number.isInteger(v) && (
        <span className="ml-1.5 inline-block rounded bg-[#fbecc4] px-1.5 py-px align-middle font-display text-[.65rem] font-semibold tracking-wide text-[#8a5a00] uppercase">
          decimal
        </span>
      )}
    </td>
  );
}

function Row({
  problem,
  onChange,
  flash,
}: {
  problem: Problem;
  onChange: (p: Problem[]) => void;
  flash: (t: string) => void;
}) {
  const [value, setValue] = useState(problem.expr);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const bad = value !== "" && tryCalc(value) === null;

  useEffect(() => {
    if (!confirm) return;
    const id = setTimeout(() => setConfirm(false), 3000);
    return () => clearTimeout(id);
  }, [confirm]);

  const commit = async () => {
    const expr = normalize(value);
    if (expr === problem.expr) { setValue(problem.expr); return; }
    try { calc(expr); } catch (e) { setError((e as Error).message); return; }
    try {
      onChange(await api(`/api/problems/${problem.no}`, "PUT", { expr }));
      flash(`Saved problem ${problem.no}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const remove = async () => {
    if (!confirm) { setConfirm(true); return; }
    try {
      onChange(await api(`/api/problems/${problem.no}`, "DELETE"));
      flash(`Deleted ${pretty(problem.expr)}`);
    } catch (e) {
      flash((e as Error).message);
    }
  };

  return (
    <tr>
      <td className="w-[3em] border-b border-ink/10 px-2.5 py-1.5 font-mono text-red">{problem.no}</td>
      <td className="border-b border-ink/10 px-2.5 py-1.5">
        <input
          id={`expr-${problem.no}`}
          aria-label={`Problem ${problem.no}`}
          autoComplete="off"
          value={value}
          onChange={(e) => { setValue(e.target.value); setError(""); }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") { setValue(problem.expr); setError(""); }
          }}
          className={`${inputBase} ${
            bad || error ? "border-red bg-[#fdeceb]" : "border-transparent bg-transparent hover:border-ink/15"
          }`}
        />
        {error && <div className="text-sm text-red">{error}</div>}
      </td>
      <AnswerCell expr={value} />
      <td className="w-[3em] border-b border-ink/10 px-2.5 py-1.5 text-right">
        <button
          onClick={remove}
          aria-label={`Delete problem ${problem.no}`}
          className={`rounded-full border px-2.5 py-1 text-sm font-semibold transition ${
            confirm
              ? "border-red bg-red text-white"
              : "border-ink/20 text-muted hover:bg-[#fdeceb] hover:text-red"
          }`}
        >
          {confirm ? "Sure?" : "Delete"}
        </button>
      </td>
    </tr>
  );
}

function NewRow({
  nextNo,
  onChange,
  flash,
}: {
  nextNo: number;
  onChange: (p: Problem[]) => void;
  flash: (t: string) => void;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const bad = value !== "" && tryCalc(value) === null;

  const add = async () => {
    const expr = normalize(value);
    try { calc(expr); } catch (e) { setError((e as Error).message); return; }
    setBusy(true);
    try {
      onChange(await api("/api/problems", "POST", { expr }));
      setValue("");
      flash(`Added problem ${nextNo}`);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
    inputRef.current?.focus();
  };

  return (
    <tr className="bg-[#f3efe4]">
      <td className="w-[3em] px-2.5 py-2 font-mono text-red">{nextNo}</td>
      <td className="px-2.5 py-2">
        <input
          ref={inputRef}
          id="new-expr"
          aria-label="New problem"
          placeholder="e.g. 40+15-7"
          autoComplete="off"
          value={value}
          onChange={(e) => { setValue(e.target.value); setError(""); }}
          onKeyDown={(e) => { if (e.key === "Enter") add(); }}
          className={`${inputBase} ${bad || error ? "border-red bg-[#fdeceb]" : "border-ink/20 bg-white"}`}
        />
        {error && <div className="text-sm text-red">{error}</div>}
      </td>
      <AnswerCell expr={value} />
      <td className="px-2.5 py-2 text-right">
        <button
          onClick={add}
          disabled={busy}
          className="rounded-full border-2 border-ink bg-ink px-3.5 py-1.5 text-sm font-semibold text-card transition hover:bg-[#333d3a] disabled:opacity-40"
        >
          Add
        </button>
      </td>
    </tr>
  );
}

function UploadButton({ onPick, flash }: { onPick: (u: Upload) => void; flash: (t: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);

  const read = async (file: File | undefined) => {
    if (!file) return;
    try {
      onPick({ name: file.name, ...parseProblemsCsv(await file.text()) });
    } catch {
      flash(`Couldn't read ${file.name}`);
    }
    if (inputRef.current) inputRef.current.value = ""; // so picking the same file again still fires
  };

  return (
    <>
      <button onClick={() => inputRef.current?.click()} className={pillButton}>
        Upload CSV
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv,text/plain"
        hidden
        onChange={(e) => read(e.target.files?.[0])}
      />
    </>
  );
}

function UploadPanel({
  upload,
  hasProblems,
  onDone,
}: {
  upload: Upload;
  hasProblems: boolean;
  onDone: (list: Problem[] | null, msg?: string) => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const count = upload.exprs.length;

  const save = async (mode: "replace" | "append") => {
    setBusy(true);
    try {
      const list = await api("/api/problems", "PUT", { exprs: upload.exprs, mode });
      onDone(list, mode === "append" ? `Added ${count} problems from ${upload.name}` : `Loaded ${count} problems from ${upload.name}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="w-full rounded-[14px] bg-card p-5 text-ink shadow-[0_14px_34px_rgba(0,0,0,.3)]">
      <p className="m-0 font-semibold">
        {count ? `Found ${count} problem${count === 1 ? "" : "s"} in ${upload.name}.` : `No problems found in ${upload.name}.`}
      </p>
      {upload.skipped.length > 0 && (
        <details className="mt-2 text-sm text-muted">
          <summary className="cursor-pointer">
            Skipped {upload.skipped.length} row{upload.skipped.length === 1 ? "" : "s"} that aren&apos;t valid problems
          </summary>
          <ul className="mt-1 max-h-40 overflow-y-auto pl-5 font-mono">
            {upload.skipped.map((s) => (
              <li key={s.line}>line {s.line}: {s.text || "(empty)"}</li>
            ))}
          </ul>
        </details>
      )}
      {error && <div className="mt-2 text-sm text-red">{error}</div>}
      <div className="mt-4 flex flex-wrap gap-2">
        {count > 0 && (
          <button
            onClick={() => save("replace")}
            disabled={busy}
            className="rounded-full border-2 border-ink bg-ink px-3.5 py-1.5 text-sm font-semibold text-card transition hover:bg-[#333d3a] disabled:opacity-40"
          >
            {hasProblems ? "Replace current list" : "Load problems"}
          </button>
        )}
        {count > 0 && hasProblems && (
          <button
            onClick={() => save("append")}
            disabled={busy}
            className="rounded-full border-2 border-ink px-3.5 py-1.5 text-sm font-semibold transition hover:bg-ink/5 disabled:opacity-40"
          >
            Add to the end
          </button>
        )}
        <button
          onClick={() => onDone(null)}
          disabled={busy}
          className="rounded-full border border-ink/20 px-3.5 py-1.5 text-sm font-semibold text-muted transition hover:bg-ink/5 disabled:opacity-40"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
