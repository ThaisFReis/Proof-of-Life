import React, { useMemo, useRef, useEffect } from "react";

export function meterBar(value: number, max: number, blocks = 16) {
  const v = Math.max(0, Math.min(max, value));
  const filled = Math.round((v / max) * blocks);
  return `[${"█".repeat(filled)}${"·".repeat(Math.max(0, blocks - filled))}]`;
}

export function stars(n: number) {
  return "★".repeat(n) + " ".repeat(Math.max(0, 5 - n));
}

export function AsciiTitle() {
  return (
    <h1 className="pol-asciiTitle">PROOF OF LIFE</h1>
  );
}

export function CRTPanel(props: {
  title: string;
  rightTag?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={[
        "relative rounded-2xl border border-white/10 bg-black/60",
        "shadow-[0_0_0_1px_rgba(255,255,255,0.04),0_0_40px_rgba(80,200,255,0.05)]",
        "overflow-hidden",
        props.className ?? "",
      ].join(" ")}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
        <div className="flex items-center gap-2">
          <span className="inline-block size-2 rounded-full bg-emerald-400/80 shadow-[0_0_18px_rgba(16,185,129,0.35)]" />
          <span className="text-[11px] tracking-[0.22em] uppercase text-white/70">
            {props.title}
          </span>
        </div>
        {props.rightTag ? (
          <span className="text-[10px] tracking-[0.22em] uppercase text-cyan-300/70">
            {props.rightTag}
          </span>
        ) : null}
      </div>

      {/* scanlines + subtle vignette */}
      <div className="pointer-events-none absolute inset-0 opacity-35">
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[length:100%_3px]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,rgba(0,0,0,0.55)_70%,rgba(0,0,0,0.85)_100%)]" />
      </div>

      <div className="relative p-3 flex-1 flex flex-col min-h-0">{props.children}</div>
    </div>
  );
}

export function NeonKPI(props: {
  label: string;
  value: string;
  accent: "purple" | "cyan" | "emerald";
  size?: "sm" | "md";
}) {
  const accentCls =
    props.accent === "purple"
      ? "text-fuchsia-300"
      : props.accent === "cyan"
        ? "text-cyan-300"
        : "text-emerald-300";

  const isSmall = props.size === "sm";

  return (
    <div className="flex items-baseline justify-between gap-2">
      <div className={[
        "uppercase text-white/50",
        isSmall ? "text-[9px] tracking-[0.15em]" : "text-[10px] tracking-[0.22em]"
      ].join(" ")}>
        {props.label}
      </div>
      <div className={[
        "font-semibold",
        accentCls,
        isSmall ? "text-xs tracking-wider" : "tracking-[0.12em]"
      ].join(" ")}>
        {props.value}
      </div>
    </div>
  );
}

export function AsciiMeter(props: {
  label: string;
  value: number;
  max: number;
  accent: "purple" | "cyan" | "emerald";
  hint?: string;
  compact?: boolean;
}) {
  const accentCls =
    props.accent === "purple"
      ? "text-fuchsia-300"
      : props.accent === "cyan"
        ? "text-cyan-300"
        : "text-emerald-300";

  if (props.compact) {
    return (
      <div className="space-y-0.5">
          <div className="flex justify-between items-baseline">
            <span className="text-[9px] tracking-widest text-white/50">{props.label}</span>
            <span className={["text-[9px]", accentCls].join(" ")}>{Math.round((props.value / props.max) * 100)}%</span>
          </div>
          <pre className={["text-[10px] leading-none", accentCls].join(" ")}>
            {meterBar(props.value, props.max, 12)}
          </pre>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <div className="text-[10px] tracking-[0.22em] uppercase text-white/55">
          {props.label}
        </div>
        <div className={["text-[10px] tracking-[0.22em] uppercase", accentCls].join(" ")}>
          {Math.round((props.value / props.max) * 100)}%
        </div>
      </div>
      <pre className={["text-[12px] leading-none", accentCls].join(" ")}>
        {meterBar(props.value, props.max, 18)}{" "}
        <span className="text-white/55">
          {props.value}/{props.max}
        </span>
      </pre>
      {props.hint ? (
        <div className="text-[11px] text-white/45">{props.hint}</div>
      ) : null}
    </div>
  );
}

export function TerminalLog(props: { lines: string[], className?: string }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [props.lines]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - (el.scrollTop + el.clientHeight);
    stickToBottomRef.current = distanceFromBottom < 24;
  };

  return (
    <div className={`flex flex-col gap-2 ${props.className ?? ''}`}>


      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 overflow-auto rounded-xl border border-white/10 bg-black/40 p-3 pol-scroller"
      >
        <div className="space-y-1 font-mono text-[12px] leading-[1.25]">
          {props.lines.map((l, i) => (
            <div key={i} className="whitespace-pre-wrap">
              <span className="text-cyan-300/70">{String(i + 1).padStart(3, "0")}</span>
              <span className="text-white/35"> │ </span>
              <span className="text-white/70">{l}</span>
            </div>
          ))}
        </div>
      </div>


    </div>
  );
}

export function WavePane(props: { title: string }) {
  return (
    <div className="space-y-2">
      <div className="text-[10px] tracking-[0.22em] uppercase text-white/55">
        {props.title}
      </div>
      <div className="rounded-xl border border-white/10 bg-black/40 p-3">
        <pre className="text-[11px] leading-tight text-cyan-300/70 select-none overflow-hidden">
{String.raw`╔══════════════════════════════════╗
║  ~~~\__/~~~\____/~~~\__/~~~\__   ║
║  __/  \__  \__/  __/  \__  \_    ║
║  \__/\__/ \__/ \__/\__/ \__/     ║
║  SIGNAL: STABLE  ░░░▒▒▓▓▒▒░░     ║
║  ZK-PROOF: VERIFIED [OK]         ║
╚══════════════════════════════════╝`}
        </pre>
      </div>
    </div>
  );
}

export function CRTModal(props: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  actionLabel?: string;
  children: React.ReactNode;
}) {
  if (!props.isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-300">
      <div className="w-full max-w-2xl animate-in zoom-in-95 duration-300">
        <CRTPanel title={props.title} rightTag="SYSTEM">
          <div className="max-h-[70vh] overflow-y-auto pr-2 pol-scroller space-y-4">
            {props.children}
          </div>
          <div className="mt-4 flex justify-end border-t border-white/10 pt-3">
             <button
               onClick={props.onClose}
               className="px-6 py-2 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded hover:bg-emerald-500/20 text-xs tracking-widest uppercase transition-all shadow-[0_0_10px_rgba(16,185,129,0.1)] hover:shadow-[0_0_20px_rgba(16,185,129,0.2)]"
             >
               {props.actionLabel || 'ACKNOWLEDGE & PROCEED'}
             </button>
          </div>
        </CRTPanel>
      </div>
    </div>
  );
}
