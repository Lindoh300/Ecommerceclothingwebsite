import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

/* weighted: mostly the cool tones, the accent, and one warm note; colours come from the --art-n theme tokens */
const PALETTE = [1, 2, 3, 4, 1, 3, 2, 6, 6, 5].map((n) => `var(--art-${n})`);
const SHAPES = ["", "s1", "s2", "s3", "s4", "s5"];

type Rand = () => number;

interface CellSample {
  c1: string;
  c2: string;
  size: string;
  angle: string;
  radius: string;
  shape: string;
}
interface Sample {
  bg: string;
  cells: CellSample[];
}

function hashString(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return (Math.imul(h ^ (h >>> 16), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0;
}

function mulberry32(seed: number): Rand {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleGoo(count: number, rnd: Rand): Sample {
  const rand = (n: number) => Math.floor(rnd() * n);
  const pick = <T,>(arr: T[]): T => arr[rand(arr.length)];
  const bg = pick(PALETTE);
  const cells: CellSample[] = [];
  for (let i = 0; i < count; i++) {
    cells.push({
      c1: pick(PALETTE),
      c2: pick(PALETTE),
      size: (rand(2) + 1) * 100 + "%",
      angle: rand(4) * 90 + "deg",
      radius: rand(2) * 100 + "vw",
      shape: pick(SHAPES),
    });
  }
  return { bg, cells };
}

interface GooArtProps {
  cols?: number;
  rows?: number;
  variant?: "hero" | "tile";
  resampleMs?: number;
  seed?: string;
  className?: string;
}

export function GooArt({ cols = 6, rows = 6, variant = "tile", resampleMs, seed, className }: GooArtProps) {
  const count = cols * rows;
  const [sample, setSample] = useState<Sample>(() =>
    sampleGoo(count, seed ? mulberry32(hashString(seed)) : Math.random),
  );
  const hostRef = useRef<HTMLDivElement>(null);
  const first = useRef(true);

  // Re-derive when grid size or seed changes (skip the initial render).
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setSample(sampleGoo(count, seed ? mulberry32(hashString(seed)) : Math.random));
  }, [count, seed]);

  const resample = useCallback(() => setSample(sampleGoo(count, Math.random)), [count]);

  useEffect(() => {
    if (!resampleMs) return;
    if (typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let visible = true;
    let observer: IntersectionObserver | undefined;
    const el = hostRef.current;
    if (el && "IntersectionObserver" in window) {
      observer = new IntersectionObserver(
        (entries) => {
          visible = entries[0].isIntersecting;
        },
        { threshold: 0 },
      );
      observer.observe(el);
    }
    const id = window.setInterval(() => {
      if (visible && !document.hidden) resample();
    }, resampleMs);
    return () => {
      window.clearInterval(id);
      observer?.disconnect();
    };
  }, [resampleMs, resample]);

  const style = {
    "--cols": cols,
    "--rows": rows,
    width: "100%",
    height: "100%",
    background: sample.bg,
    filter: variant === "hero" ? "url(#goo)" : "url(#goo-sm)",
  } as CSSProperties;

  return (
    <div
      ref={hostRef}
      className={["goo", variant === "hero" ? "goo--slow" : "", className].filter(Boolean).join(" ")}
      style={style}
      onClick={resample}
    >
      {sample.cells.map((c, i) => (
        <div
          key={i}
          className="cell"
          style={
            {
              "--c1": c.c1,
              "--c2": c.c2,
              "--size": c.size,
              "--angle": c.angle,
              "--radius": c.radius,
            } as CSSProperties
          }
        >
          <div className={c.shape ? `inner ${c.shape}` : "inner"} />
        </div>
      ))}
    </div>
  );
}
