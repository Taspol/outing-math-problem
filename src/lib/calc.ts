/** Safe arithmetic for + - * / (also × ÷ −) and brackets. Throws an Error with a readable message. */
export function calc(src: string): number {
  const s = normalize(src);
  if (!s) throw new Error("Type a problem");
  if (/[^0-9.+\-*/()]/.test(s)) throw new Error("Use only numbers, + − × ÷ and brackets");
  let i = 0;
  const peek = () => s[i];

  function num(): number {
    if (peek() === "(") {
      i++;
      const v = add();
      if (s[i] !== ")") throw new Error("Missing )");
      i++;
      return v;
    }
    if (peek() === "-") { i++; return -num(); }
    if (peek() === "+") { i++; return num(); }
    const m = /^\d+(\.\d+)?/.exec(s.slice(i));
    if (!m) throw new Error(`Something is missing near “${s.slice(i, i + 3) || "the end"}”`);
    i += m[0].length;
    return parseFloat(m[0]);
  }
  function mul(): number {
    let v = num();
    while (peek() === "*" || peek() === "/") {
      const op = s[i++];
      const r = num();
      if (op === "/" && r === 0) throw new Error("Can't divide by zero");
      v = op === "*" ? v * r : v / r;
    }
    return v;
  }
  function add(): number {
    let v = mul();
    while (peek() === "+" || peek() === "-") {
      const op = s[i++];
      const r = mul();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }

  const v = add();
  if (i < s.length) throw new Error(`Unexpected “${s[i]}”`);
  return Math.round(v * 1e9) / 1e9;
}

export function tryCalc(src: string): number | null {
  try { return calc(src); } catch { return null; }
}

export function normalize(expr: string): string {
  return expr.replace(/\s+/g, "").replace(/[×xX]/g, "*").replace(/÷/g, "/").replace(/[−–]/g, "-");
}

export function pretty(expr: string): string {
  return expr
    .replace(/\*/g, " × ")
    .replace(/\//g, " ÷ ")
    .replace(/\+/g, " + ")
    .replace(/([\d)])-/g, "$1 − ");
}

export function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, "");
}
