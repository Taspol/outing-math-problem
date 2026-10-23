"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fmt, pretty, tryCalc } from "@/lib/calc";
import type { Problem } from "@/lib/types";
import type { Phase, SessionState } from "@/lib/sessionTypes";
import QrModal from "./QrModal";

// A round: the clock runs once for the whole round. The operator steps through cards (answer first,
// then the next problem) and keeps score themselves.
type Settings = { seconds: number; sound: boolean };

const RADIUS = 52;
const CIRC = 2 * Math.PI * RADIUS;
const SETTINGS_KEY = "omf-round-settings";
const DEFAULT_SETTINGS: Settings = { seconds: 30, sound: true };

function clampSeconds(n: number) {
  return Math.max(5, Math.min(600, Math.round(n) || DEFAULT_SETTINGS.seconds));
}

export default function FlipGame({ problems, active }: { problems: Problem[]; active: boolean }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [seen, setSeen] = useState<Set<number>>(new Set());
  const [current, setCurrent] = useState<Problem | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [showAnswer, setShowAnswer] = useState(false);
  const [status, setStatus] = useState({ title: "Ready", sub: "Press Start round to begin the clock" });

  // round
  const [phase, setPhase] = useState<Phase>("idle");
  const [round, setRound] = useState(0);
  const flipTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const dealing = useRef(false); // true while the next card is flipping in, so a double click can't skip a card

  // timer
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [elapsedBefore, setElapsedBefore] = useState(0);
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(0);
  const audioRef = useRef<AudioContext | null>(null);

  // session + monitor
  const [session, setSession] = useState<{ id: string; url: string } | null>(null);
  const [begun, setBegun] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [viewers, setViewers] = useState(0);
  const [history, setHistory] = useState<SessionState["history"]>([]);
  const [beginError, setBeginError] = useState("");
  const [beginning, setBeginning] = useState(false);

  // full screen ("presenting"): the card fills the screen. Uses the browser's Fullscreen API where it
  // exists; on phones without it (iPhone Safari) it still fills the page.
  const [presenting, setPresenting] = useState(false);
  const usedFsApi = useRef(false);

  const duration = clampSeconds(settings.seconds);
  const elapsed = elapsedBefore + (running ? (now - startedAt) / 1000 : 0);
  const playing = phase === "playing";
  const cardsThisRound = history.filter((h) => h.round === round).length;

  // load / save settings
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
      setSettings({
        ...DEFAULT_SETTINGS,
        ...saved,
        seconds: clampSeconds(Number(saved.seconds ?? DEFAULT_SETTINGS.seconds)),
      });
    } catch {}
  }, []);
  const updateSettings = (patch: Partial<Settings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch };
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  };

  // drop "seen" marks for problems that no longer exist
  useEffect(() => {
    setSeen((s) => new Set([...s].filter((no) => no <= problems.length)));
  }, [problems.length]);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(id);
  }, [running]);

  useEffect(() => () => clearTimeout(flipTimer.current), []);

  const timeUpSound = useCallback(() => {
    try {
      const ctx = (audioRef.current ??= new AudioContext());
      [[880, 0, 0.18], [880, 0.25, 0.18], [660, 0.5, 0.5]].forEach(([freq, at, len]) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = freq;
        o.type = "square";
        g.gain.setValueAtTime(0.12, ctx.currentTime + at);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + at + len);
        o.connect(g).connect(ctx.destination);
        o.start(ctx.currentTime + at);
        o.stop(ctx.currentTime + at + len + 0.05);
      });
    } catch {}
  }, []);

  const completeSound = useCallback(() => {
    try {
      const ctx = (audioRef.current ??= new AudioContext());
      [[660, 0, 0.12], [880, 0.13, 0.12], [1175, 0.26, 0.45]].forEach(([freq, at, len]) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = freq;
        o.type = "triangle";
        g.gain.setValueAtTime(0.18, ctx.currentTime + at);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + at + len);
        o.connect(g).connect(ctx.destination);
        o.start(ctx.currentTime + at);
        o.stop(ctx.currentTime + at + len + 0.05);
      });
    } catch {}
  }, []);

  // time up: the round ends and the card on the table shows its answer
  useEffect(() => {
    if (running && playing && elapsed >= duration) {
      clearTimeout(flipTimer.current);
      dealing.current = false;
      setRunning(false);
      setElapsedBefore(duration);
      setDone(true);
      setPhase("over");
      setShowAnswer(true);
      setFlipped(true);
      setStatus({ title: "Time's up!", sub: "Press Next round to play again" });
      if (settings.sound) timeUpSound();
    }
  }, [running, playing, elapsed, duration, settings.sound, timeUpSound]);

  const remaining = problems.filter((p) => !seen.has(p.no));

  /** Flip to a new random card. The clock is not touched: it runs for the whole round. */
  const dealCard = useCallback(
    (roundNo: number) => {
      if (!problems.length) return;
      const pool = remaining.length ? remaining : problems;
      const baseSeen = remaining.length ? seen : new Set<number>();
      const pick = pool[Math.floor(Math.random() * pool.length)];
      setSeen(new Set(baseSeen).add(pick.no));

      const show = () => {
        dealing.current = false;
        setHistory((h) => [
          ...h,
          { position: problems.indexOf(pick) + 1, expr: pick.expr, answer: pick.answer, round: roundNo },
        ]);
        setCurrent(pick);
        setShowAnswer(false);
        setFlipped(true);
      };

      clearTimeout(flipTimer.current);
      if (flipped) {
        dealing.current = true;
        setFlipped(false);
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        flipTimer.current = setTimeout(show, reduce ? 0 : 380);
      } else {
        show();
      }
    },
    [problems, remaining, seen, flipped],
  );

  const startRound = useCallback(() => {
    if (!problems.length) return;
    if (settings.sound && !audioRef.current) {
      try { audioRef.current = new AudioContext(); } catch {}
    }
    const next = round + 1;
    setRound(next);
    setPhase("playing");
    const t = performance.now();
    setElapsedBefore(0);
    setStartedAt(t);
    setNow(t);
    setDone(false);
    setRunning(true);
    setStatus({ title: "Go!", sub: "Click to show the answer" });
    dealCard(next);
  }, [problems.length, settings.sound, round, dealCard]);

  // During a round each click does the next step: show this card's answer, then flip to a new problem.
  const step = useCallback(() => {
    if (!playing || !running || !current || dealing.current) return;
    if (!showAnswer) {
      setShowAnswer(true);
      setStatus({ title: "Answer", sub: "Click for the next problem" });
    } else {
      setStatus({ title: "Go!", sub: "Click to show the answer" });
      dealCard(round);
    }
  }, [playing, running, current, showAnswer, dealCard, round]);

  const togglePause = useCallback(() => {
    if (!playing) return;
    if (running) {
      setElapsedBefore(elapsed);
      setRunning(false);
      setStatus({ title: "Paused", sub: "Press Resume to continue" });
    } else {
      const t = performance.now();
      setStartedAt(t);
      setNow(t);
      setRunning(true);
      setStatus({ title: "Go!", sub: showAnswer ? "Click for the next problem" : "Click to show the answer" });
    }
  }, [playing, running, elapsed, showAnswer]);

  const reset = () => {
    clearTimeout(flipTimer.current);
    dealing.current = false;
    setSeen(new Set());
    setRunning(false);
    setElapsedBefore(0);
    setDone(false);
    setCurrent(null);
    setFlipped(false);
    setShowAnswer(false);
    setHistory([]);
    setPhase("idle");
    setRound(0);
    setStatus({ title: "Shuffled", sub: `All ${problems.length} cards are back in the deck` });
  };

  // The operator ends the round when the team has finished: the clock stops and the screen says so.
  const complete = useCallback(() => {
    if (!playing) return;
    clearTimeout(flipTimer.current);
    dealing.current = false;
    const t = elapsed;
    setElapsedBefore(t);
    setRunning(false);
    setPhase("complete");
    setFlipped(true);
    setStatus({ title: "Complete!", sub: `Finished in ${t.toFixed(1)} s · press Next round` });
    if (settings.sound) completeSound();
  }, [playing, elapsed, settings.sound, completeSound]);

  // The main action: start a round when none is running, otherwise take the next step.
  const primary = useCallback(() => {
    if (playing) step();
    else startRound();
  }, [playing, step, startRound]);

  const toggleFullscreen = useCallback(async () => {
    if (!presenting) {
      setPresenting(true);
      try {
        await document.documentElement.requestFullscreen?.();
        usedFsApi.current = !!document.fullscreenElement;
      } catch {
        usedFsApi.current = false;
      }
    } else {
      setPresenting(false);
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    }
  }, [presenting]);

  // Leaving browser full screen with Esc should also leave our layout.
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement && usedFsApi.current) {
        usedFsApi.current = false;
        setPresenting(false);
      }
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // keyboard shortcuts
  useEffect(() => {
    if (!active || !begun || qrOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, select, textarea")) return;
      const k = e.key.toLowerCase();
      if (e.code === "Space" || e.key === "Enter" || e.key === "ArrowRight") { e.preventDefault(); primary(); }
      else if (k === "c") complete();
      else if (k === "p") togglePause();
      else if (k === "f") toggleFullscreen();
      else if (e.key === "Escape" && presenting && !document.fullscreenElement) setPresenting(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active, begun, qrOpen, primary, complete, togglePause, toggleFullscreen, presenting]);

  // ---- session: begin, sync to monitors, end ----
  const begin = async () => {
    setBeginError("");
    setBeginning(true);
    try {
      const res = await fetch("/api/session", { method: "POST" });
      if (!res.ok) throw new Error();
      const { id, lanOrigins } = (await res.json()) as { id: string; lanOrigins: string[] };
      // "localhost" only works on this computer, so point phones at the computer's Wi-Fi address instead.
      const local = ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
      const origin = local && lanOrigins.length ? lanOrigins[0] : window.location.origin;
      setSession({ id, url: `${origin}/monitor/${id}` });
      setViewers(0);
      setQrOpen(true);
    } catch {
      setBeginError("Couldn't start a session. Check that the app server is running, then try again.");
    }
    setBeginning(false);
  };

  const startGame = useCallback(() => {
    setQrOpen(false);
    setBegun(true);
  }, []);

  const position = current ? problems.findIndex((p) => p.no === current.no) + 1 || current.no : 1;

  const pushState = useCallback(
    async (extra?: Partial<SessionState>) => {
      if (!session) return;
      const state: SessionState = {
        problem: current,
        position,
        revealed: showAnswer,
        running,
        done,
        elapsed: elapsedBefore + (running ? (performance.now() - startedAt) / 1000 : 0),
        duration,
        mode: "down",
        drawn: problems.length - remaining.length,
        total: problems.length,
        status,
        history,
        ended: false,
        phase,
        round,
        ...extra,
      };
      try {
        const res = await fetch(`/api/session/${session.id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(state),
        });
        if (res.ok) setViewers((await res.json()).viewers ?? 0);
      } catch {}
    },
    [session, current, position, showAnswer, running, done, elapsedBefore, startedAt, duration, problems.length, remaining.length, status, history, phase, round],
  );

  // Send on every real change (new card, score, pause, time up…), never on the 100 ms clock tick.
  useEffect(() => {
    pushState();
  }, [pushState]);

  // While the QR is up, keep the "monitors connected" count fresh.
  useEffect(() => {
    if (!session || !qrOpen) return;
    const poll = async () => {
      try {
        const res = await fetch(`/api/session/${session.id}`);
        if (res.ok) setViewers((await res.json()).viewers ?? 0);
      } catch {}
    };
    poll();
    const t = setInterval(poll, 2000);
    return () => clearInterval(t);
  }, [session, qrOpen]);

  const endSession = async () => {
    await pushState({ ended: true });
    reset();
    setSession(null);
    setBegun(false);
    if (presenting) toggleFullscreen();
    setStatus({ title: "Ready", sub: "Press Start round to begin the clock" });
  };

  // ring display (always counting down for the round)
  const left = Math.max(0, duration - elapsed);
  const shown = phase === "idle" ? duration : Math.ceil(left);
  const frac = phase === "idle" ? 1 : left / duration;
  const warn = playing && left <= 5 && left > 0;

  const answer = current ? tryCalc(current.expr) : null;

  const btn =
    "rounded-full border-2 border-line px-[22px] py-3 font-semibold text-on-felt transition hover:bg-white/10 active:translate-y-px disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent";
  const smallBtn =
    "rounded-full border border-line px-4 py-1.5 text-sm font-semibold text-on-felt-soft transition hover:bg-white/10 hover:text-on-felt disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent";
  const corner = "absolute text-center font-mono text-[clamp(1rem,3.2cqw,2rem)] leading-tight text-red";

  // Size the problem to the card: monospace glyphs are ~0.62em wide, and long problems may wrap to two lines.
  const problemText = current ? `${pretty(current.expr)}${showAnswer ? "" : " = ?"}` : "";
  const lines = problemText.length > 22 ? 2 : 1;
  const problemSize = `min(13cqw, ${((84 * lines) / (Math.max(problemText.length, 1) * 0.62)).toFixed(2)}cqw)`;

  const cardSize = presenting
    ? "max-w-[min(97vw,calc((100dvh-200px)*5/3.4))]"
    : "max-w-[min(1000px,calc((100dvh-330px)*5/3.4))]";

  const primaryLabel = playing
    ? showAnswer ? "Next problem" : "Show answer"
    : phase === "idle" ? "Start round" : "Next round";

  return (
    <section
      className={
        presenting
          ? "fixed inset-0 z-40 flex flex-col items-center justify-center gap-[2.5dvh] bg-[radial-gradient(ellipse_at_50%_30%,var(--felt)_0%,var(--felt-deep)_100%)] px-[max(12px,1.5vw)] py-[2dvh]"
          : "flex w-full flex-col items-center gap-[22px]"
      }
    >
      <span hidden={presenting} className="font-mono text-sm tabular-nums text-on-felt-soft">
        {problems.length ? `${remaining.length} of ${problems.length} cards left` : "No problems yet"}
        {round > 0 && ` · round ${round}`}
      </span>

      {!begun ? (
        <div className="flex aspect-[4/3] w-full max-w-[min(1000px,calc((100dvh-320px)*5/3.4))] min-w-[min(100%,320px)] flex-col items-center justify-center gap-5 rounded-[clamp(14px,2.4cqw,28px)] border-2 border-dashed border-line px-6 text-center sm:aspect-[5/3.4]">
          <p className="text-xs font-semibold tracking-[.08em] text-on-felt-soft uppercase">
            {duration} s per round · {problems.length} cards
          </p>
          <h2 className="max-w-[18ch] text-[clamp(1.8rem,5vw,3.2rem)] leading-[1.05] font-extrabold tracking-tight text-balance">
            Ready when your team is
          </h2>
          <p className="max-w-[44ch] text-on-felt-soft">
            Begin a session to get a QR code. Scan it on the host&apos;s phone to follow each problem and its answer live.
          </p>
          <button
            onClick={begin}
            disabled={beginning || !problems.length}
            className="rounded-full border-2 border-gold bg-gold px-9 py-4 text-xl font-semibold text-[#2a2205] shadow-[0_10px_24px_rgba(0,0,0,.25)] transition hover:bg-gold-hi active:translate-y-px disabled:opacity-50"
          >
            {beginning ? "Starting…" : "Begin session"}
          </button>
          {beginError && <p className="max-w-[40ch] text-sm text-[#ffb4ab]">{beginError}</p>}
        </div>
      ) : (
        <>
      {/* card: clicking it does the same as the main button */}
      <div
        role="button"
        tabIndex={0}
        aria-label={primaryLabel}
        onClick={primary}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); primary(); } }}
        className={`@container relative aspect-[4/3] w-full ${cardSize} min-w-[min(100%,320px)] cursor-pointer perspective-[1400px] sm:aspect-[5/3.4]`}
      >
        <div
          className={`relative h-full w-full transition-transform duration-500 ease-[cubic-bezier(.3,1.3,.5,1)] transform-3d ${
            flipped ? "rotate-y-180" : ""
          }`}
        >
          {/* back */}
          <div className="absolute inset-0 flex rounded-[clamp(14px,2.4cqw,28px)] bg-card p-[clamp(10px,1.8cqw,20px)] shadow-[0_18px_40px_rgba(0,0,0,.35),0_2px_0_rgba(0,0,0,.15)] backface-hidden">
            <div className="flex h-full w-full flex-col items-center justify-center gap-[2cqw] rounded-[clamp(8px,1.4cqw,16px)] bg-[repeating-linear-gradient(45deg,var(--red)_0_10px,var(--red-deep)_10px_20px)] text-card">
              <div className="grid size-[1.5em] place-items-center rounded-full bg-card text-[18cqw] leading-none font-extrabold text-red">
                ?
              </div>
              <div className="rounded-md bg-red-deep px-[1.6cqw] py-[.6cqw] text-[clamp(.8rem,2.4cqw,1.4rem)] font-medium tracking-[.08em] uppercase">
                {playing ? "Next problem…" : `Tap to start · ${duration}s`}
              </div>
            </div>
          </div>

          {/* front */}
          <div className="absolute inset-0 flex rotate-y-180 flex-col items-center justify-center rounded-[clamp(14px,2.4cqw,28px)] bg-card px-[8cqw] py-[6cqw] text-ink shadow-[0_18px_40px_rgba(0,0,0,.35),0_2px_0_rgba(0,0,0,.15)] backface-hidden">
            {[`${corner} top-[3cqw] left-[3.2cqw]`, `${corner} right-[3.2cqw] bottom-[3cqw] rotate-180`].map((cls) => (
              <div key={cls} className={cls}>
                #{position}
                <small className="block text-[.55em] text-muted">problem</small>
              </div>
            ))}
            {phase === "over" && (
              <div className="absolute top-[3.5cqw] left-1/2 -translate-x-1/2 rounded-full bg-red px-[2.4cqw] py-[.8cqw] text-[clamp(.9rem,3cqw,1.8rem)] font-extrabold tracking-wide whitespace-nowrap text-white">
                Time&apos;s up · {cardsThisRound} {cardsThisRound === 1 ? "problem" : "problems"}
              </div>
            )}
            <div
              style={{ fontSize: problemSize }}
              className="max-w-full text-center font-mono leading-[1.15] font-medium tracking-tight text-balance [overflow-wrap:anywhere]"
            >
              {current ? pretty(current.expr) : ""}
              {current && !showAnswer && <span className="text-muted"> = ?</span>}
            </div>
            {/* answer overlays the lower part of the card so the problem doesn't move */}
            <div
              aria-live="polite"
              className={`pointer-events-none absolute inset-x-0 bottom-[9%] text-center font-mono text-[11cqw] leading-none text-red transition duration-300 ${
                showAnswer ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
              }`}
            >
              = {current && answer !== null ? fmt(answer) : "?"}
            </div>
          </div>
        </div>

        {/* COMPLETE stamp over the whole card, so everyone in the room sees the round is done */}
        {phase === "complete" && (
          <div
            role="status"
            className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-[clamp(14px,2.4cqw,28px)] bg-[#2f9e6a]/25 [transform:translateZ(2px)]"
          >
            <div className="flex animate-stamp flex-col items-center rounded-[2.4cqw] border-[0.9cqw] border-[#2f9e6a] bg-white/95 px-[5cqw] py-[2cqw] text-[#2f9e6a] shadow-[0_18px_40px_rgba(0,0,0,.25)]">
              <span className="text-[13cqw] leading-none font-extrabold tracking-tight">COMPLETE</span>
              <span className="mt-[1cqw] font-mono text-[4.2cqw] leading-none tabular-nums">
                ✓ {elapsedBefore.toFixed(1)} s · {cardsThisRound} {cardsThisRound === 1 ? "problem" : "problems"}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* one compact row right under the card: clock, main step, Complete and Pause always fit on screen */}
      <div className="flex w-full flex-wrap items-center justify-center gap-x-8 gap-y-3">
        <div className="flex items-center gap-3.5">
          <div className={`relative shrink-0 ${presenting ? "size-28 md:size-36" : "size-28 md:size-32"}`}>
            <svg viewBox="0 0 120 120" aria-hidden="true" className="size-full -rotate-90">
              <circle cx="60" cy="60" r={RADIUS} fill="none" strokeWidth="10" className="stroke-line" />
              <circle
                cx="60"
                cy="60"
                r={RADIUS}
                fill="none"
                strokeWidth="10"
                strokeLinecap="round"
                strokeDasharray={CIRC}
                strokeDashoffset={CIRC * (1 - frac)}
                className={`transition-[stroke-dashoffset,stroke] duration-300 ease-linear ${warn ? "stroke-red" : "stroke-gold"}`}
              />
            </svg>
            <div
              key={done ? "done" : "live"}
              className={`absolute inset-0 grid place-items-center font-mono leading-none font-medium tabular-nums ${
                presenting ? "text-[2.8rem] md:text-[3.6rem]" : "text-[2.8rem] md:text-[3.2rem]"
              } ${warn || done ? "text-red" : ""} ${done ? "animate-pulse-num" : ""}`}
            >
              {shown}
            </div>
          </div>
          <div className="max-w-[18ch] text-sm leading-snug text-on-felt-soft">
            {round > 0 && (
              <span className="font-mono text-xs tabular-nums">
                Round {round} · problem {cardsThisRound}
              </span>
            )}
            <strong className="block text-lg text-on-felt">{status.title}</strong>
            {status.sub}
          </div>
        </div>

        <div className="flex flex-wrap justify-center gap-2.5">
          <button
            className={`${btn} min-w-[10.5em] border-gold bg-gold text-[#2a2205] hover:bg-gold-hi`}
            onClick={primary}
            disabled={!problems.length || (playing && !running)}
          >
            {primaryLabel}
          </button>
          <button
            className={`${btn} border-[#2f9e6a] bg-[#2f9e6a] text-white hover:bg-[#37b479] disabled:hover:bg-[#2f9e6a]`}
            onClick={complete}
            disabled={!playing}
            title={playing ? "End this round as complete (C)" : "Start a round first"}
          >
            Complete ✓
          </button>
          <button className={`${btn} min-w-[6.5em]`} onClick={togglePause} disabled={!playing}>
            {playing && !running ? "Resume" : "Pause"}
          </button>
          {presenting && (
            <button className={btn} onClick={toggleFullscreen}>
              Exit full screen
            </button>
          )}
        </div>
      </div>

      {/* less-used buttons */}
      {!presenting && (
        <div className="flex flex-wrap justify-center gap-2">
          {[
            { label: "Full screen", onClick: toggleFullscreen, disabled: false },
            { label: "Shuffle deck", onClick: reset, disabled: playing },
            { label: `Show QR${viewers ? ` · ${viewers}` : ""}`, onClick: () => setQrOpen(true), disabled: false },
          ].map((b) => (
            <button key={b.label} className={smallBtn} onClick={b.onClick} disabled={b.disabled}>
              {b.label}
            </button>
          ))}
          <button className={`${smallBtn} hover:border-red hover:bg-red/20`} onClick={endSession}>
            End session
          </button>
        </div>
      )}

        </>
      )}

      {/* settings (locked while a round is running) */}
      <fieldset
        hidden={presenting}
        disabled={playing}
        className="flex w-full min-w-0 flex-wrap items-center justify-center gap-x-[22px] gap-y-3.5 border-t border-line pt-[18px] text-[.95rem] text-on-felt-soft disabled:opacity-60"
      >
        <label htmlFor="seconds" className="flex items-center gap-2">
          Time per round (sec)
          <input
            id="seconds"
            type="number"
            min={5}
            max={600}
            value={settings.seconds}
            onChange={(e) => updateSettings({ seconds: Number(e.target.value) })}
            onBlur={() => updateSettings({ seconds: clampSeconds(settings.seconds) })}
            className="w-[5.5em] rounded-lg border border-line bg-black/20 px-2 py-1.5 font-mono text-on-felt"
          />
        </label>
        <label htmlFor="sound" className="flex items-center gap-2">
          <input id="sound" type="checkbox" checked={settings.sound} onChange={(e) => updateSettings({ sound: e.target.checked })} />
          Sounds
        </label>
      </fieldset>
      <p hidden={presenting} className="text-center text-xs text-on-felt-soft">
        <Kbd>Space</Kbd> start / answer / next · <Kbd>C</Kbd> complete · <Kbd>P</Kbd> pause · <Kbd>F</Kbd> full screen
      </p>
      {qrOpen && session && (
        <QrModal
          url={session.url}
          sessionId={session.id}
          viewers={viewers}
          starting={!begun}
          onStart={startGame}
          onClose={startGame}
        />
      )}
    </section>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-line px-1.5 font-mono">{children}</kbd>;
}
