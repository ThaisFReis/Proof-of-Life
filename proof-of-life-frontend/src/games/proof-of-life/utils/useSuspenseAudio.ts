import { useEffect, useRef } from 'react';

export function useSuspenseAudio(active: boolean) {
  const ctxRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);

  useEffect(() => {
    let fadeOutTimer: number;

    if (active) {
      if (ctxRef.current) return;
      try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioContextClass) return;
        
        const ctx = new AudioContextClass();
        ctxRef.current = ctx;
        
        const masterGain = ctx.createGain();
        masterGain.gain.setValueAtTime(0, ctx.currentTime);
        masterGain.connect(ctx.destination);
        gainRef.current = masterGain;

        // Low cinematic rumble
        const osc1 = ctx.createOscillator();
        osc1.type = 'triangle';
        osc1.frequency.setValueAtTime(45, ctx.currentTime);

        // Detuned for beating ominous feel
        const osc2 = ctx.createOscillator();
        osc2.type = 'sawtooth';
        osc2.frequency.setValueAtTime(45.5, ctx.currentTime);
        
        // High harmonic for tension
        const osc3 = ctx.createOscillator();
        osc3.type = 'sine';
        osc3.frequency.setValueAtTime(90.2, ctx.currentTime);
        const gain3 = ctx.createGain();
        gain3.gain.setValueAtTime(0.08, ctx.currentTime);
        osc3.connect(gain3);

        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        // Keep it muffled and distant
        filter.frequency.setValueAtTime(150, ctx.currentTime); 

        osc1.connect(filter);
        osc2.connect(filter);
        gain3.connect(filter);
        filter.connect(masterGain);

        osc1.start();
        osc2.start();
        osc3.start();

        // Slow cinematic fade-in (4 seconds)
        masterGain.gain.linearRampToValueAtTime(0.25, ctx.currentTime + 4);
      } catch (e) {
        console.warn('Suspense audio init failed:', e);
      }
    } else {
      if (ctxRef.current && gainRef.current) {
        const ctx = ctxRef.current;
        // Fade out
        gainRef.current.gain.linearRampToValueAtTime(0, ctx.currentTime + 3);
        fadeOutTimer = window.setTimeout(() => {
          if (ctxRef.current === ctx) {
            ctx.close().catch(() => {});
            ctxRef.current = null;
            gainRef.current = null;
          }
        }, 3100);
      }
    }

    return () => {
      // Clean up timer on unmount
      if (fadeOutTimer) window.clearTimeout(fadeOutTimer);
      // Close context immediately on unmount if it was active
      if (ctxRef.current && !active) {
         ctxRef.current.close().catch(() => {});
         ctxRef.current = null;
      }
    };
  }, [active]);
}
