import React, { useEffect, useState, useRef } from 'react';
import { AsciiMeter, CRTPanel } from './components';
import { type ScriptEvent } from '../script/callScript';
import './CutsceneScreen.css';

const Waveform = (props: { active: boolean }) => {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!props.active) return;
    const interval = setInterval(() => setFrame((f) => f + 1), 100);
    return () => clearInterval(interval);
  }, [props.active]);

  return (
    <div className="pol-cutWave" aria-hidden>
      <div className="pol-cutWaveBars">
        {Array.from({ length: 12 }).map((_, i) => (
          <div
            key={i}
            className="pol-cutWaveBar"
            style={{
              height: props.active ? `${24 + Math.random() * 72}%` : '6%',
              opacity: props.active ? 0.45 + ((i + frame) % 4) * 0.12 : 0.25,
            }}
          />
        ))}
      </div>
    </div>
  );
};

const SignalRadar = (props: { active: boolean }) => {
  return (
    <div className={`pol-cutRadar ${props.active ? 'is-active' : ''}`} aria-hidden>
      <div className="pol-cutRadarSweep" />
      <div className="pol-cutRadarRing pol-cutRadarRing--1" />
      <div className="pol-cutRadarRing pol-cutRadarRing--2" />
      <div className="pol-cutRadarRing pol-cutRadarRing--3" />
      <div className="pol-cutRadarDot pol-cutRadarDot--a" />
      <div className="pol-cutRadarDot pol-cutRadarDot--b" />
      <div className="pol-cutRadarDot pol-cutRadarDot--c" />
      <div className="pol-cutRadarCore" />
    </div>
  );
};

export function CutsceneScreen(props: {
  script: readonly ScriptEvent[];
  onComplete: () => void;
}) {
  const scriptRef = useRef<readonly ScriptEvent[]>(props.script);
  const onCompleteRef = useRef(props.onComplete);
  const [lines, setLines] = useState<string[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    onCompleteRef.current = props.onComplete;
  }, [props.onComplete]);

  useEffect(() => {
    setLines([]);
    setIsTyping(true);
    let t = 0;
    const timers: number[] = [];
    for (const item of scriptRef.current) {
      t += item.delayMs;
      const id = window.setTimeout(() => {
        setLines((prev) => [...prev, item.line]);
      }, t);
      timers.push(id);
    }
    // Extend the cutscene by 6 seconds to ensure the final line is readable.
    const completeId = window.setTimeout(() => {
      setIsTyping(false);
      onCompleteRef.current();
    }, t + 6000);
    timers.push(completeId);
    return () => {
      for (const id of timers) window.clearTimeout(id);
    };
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    if (lines.length >= scriptRef.current.length) {
      setIsTyping(false);
    }
  }, [lines]);

  useEffect(() => {
    const audio = new Audio(new URL('../../../../../../assets/cutscene.mp3', import.meta.url).href);
    audio.play().catch((e) => console.error('Audio playback failed:', e));

    return () => {
      audio.pause();
      audio.currentTime = 0;
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        onCompleteRef.current();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const parseSpeaker = (line: string): { role: 'dispatch' | 'caller' | 'system'; label: string; text: string } => {
    const m = line.match(/^([^:]+):\s*(.*)$/);
    if (!m) return { role: 'system', label: 'SYSTEM', text: line };
    const rawSpeaker = m[1].trim();
    const text = m[2].trim();
    if (/^911\b/i.test(rawSpeaker)) return { role: 'dispatch', label: 'DISPATCH', text };
    if (/^CHAD\b/i.test(rawSpeaker)) return { role: 'caller', label: 'CALLER', text };
    return { role: 'system', label: rawSpeaker.toUpperCase(), text };
  };
  const progress = Math.min(100, Math.round((lines.length / Math.max(1, scriptRef.current.length)) * 100));
  const signalDb = Math.max(-92, -88 + progress);
  const confidence = Math.min(99, 42 + progress / 1.8);
  const activeRole = lines.length ? parseSpeaker(lines[lines.length - 1]).label : 'BOOT';

  return (
    <section className="pol-cutsceneRoot">
      <div className="pol-cutsceneNoise" />
      <div className="pol-cutsceneGlow pol-cutsceneGlow--emerald" />
      <div className="pol-cutsceneGlow pol-cutsceneGlow--amber" />

      <div className="pol-cutsceneWrap pol-cutsceneWrap--enter">
        <header className="pol-cutHeader">
          <div>
            <p className="pol-cutEyebrow">Emergency Frequency</p>
            <h2 className="pol-cutTitle">911-DISPATCH-LINK</h2>
          </div>
          <div className="pol-cutLive">
            <span className="pol-cutLiveDot" />
            LIVE FEED
          </div>
        </header>

        <div className="pol-cutMain">
          <aside className="pol-cutSide">
            <CRTPanel title="SIGNAL TRACE" className="h-full">
              <div className="pol-cutSideBody">
                <SignalRadar active={isTyping} />
                <Waveform active={isTyping} />
                <div className="pol-cutMeter">
                  <AsciiMeter label="Tracing..." value={progress} max={100} accent="emerald" compact />
                </div>
                <div className="pol-cutTelemetry">
                  <div className="pol-cutTeleCard">
                    <span>Signal</span>
                    <strong>{signalDb.toFixed(0)} dBm</strong>
                  </div>
                  <div className="pol-cutTeleCard">
                    <span>Confidence</span>
                    <strong>{confidence.toFixed(0)}%</strong>
                  </div>
                  <div className="pol-cutTeleCard">
                    <span>Voice</span>
                    <strong>{activeRole}</strong>
                  </div>
                </div>
                <div className="pol-cutTarget">
                  <div className="pol-cutTargetLabel">Target</div>
                  <div className="pol-cutTargetValue">UNKNOWN PITCH</div>
                  <div className="pol-cutTargetValue">HOLLOW CREEK</div>
                </div>
              </div>
            </CRTPanel>
          </aside>

          <CRTPanel title="TRANSCRIPT" className="flex-1">
            <div ref={scrollRef} className="pol-cutTranscript">
              {lines.map((line, i) => {
                const parsed = parseSpeaker(line);
                return (
                  <div
                    key={i}
                    className={`pol-cutLine ${
                      parsed.role === 'dispatch'
                        ? 'is-dispatch'
                        : parsed.role === 'caller'
                          ? 'is-caller'
                          : 'is-system'
                    } pol-cutLine--enter`}
                  >
                    <span className="pol-cutBadge">{parsed.label}</span>
                    <p>{parsed.text}</p>
                  </div>
                );
              })}

              {isTyping && (
                <div className="pol-cutTyping">
                  <span className="pol-cutTypingDot" />
                  Incoming transmission...
                </div>
              )}
            </div>
          </CRTPanel>
        </div>

        <footer className="pol-cutFooter">Press [SPACE] to Skip Sequence</footer>
      </div>
    </section>
  );
}
