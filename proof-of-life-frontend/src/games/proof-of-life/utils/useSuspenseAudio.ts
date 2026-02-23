import { useEffect, useRef } from 'react';
import suspenseAudioUrl from '../../../assets/Wendel_Scherer_-_Dark_Mind_(mp3.pm).mp3';

export function useSuspenseAudio(active: boolean) {
  const audioRefs = useRef<HTMLAudioElement[]>([]);
  const currentIdx = useRef(0);

  useEffect(() => {
    let fadeInterval: number;
    let loopCheckInterval: number;

    if (active) {
      if (audioRefs.current.length === 0) {
        audioRefs.current = [new Audio(suspenseAudioUrl), new Audio(suspenseAudioUrl)];
        audioRefs.current.forEach(a => {
          a.volume = 0;
          // Preload
          a.load();
        });
      }
      
      const audio = audioRefs.current[currentIdx.current];
      audio.play().catch(e => console.warn('Suspense audio play failed:', e));

      // Quick fade-in
      let vol = audio.volume;
      fadeInterval = window.setInterval(() => {
        vol += 0.02;
        if (vol >= 0.45) { // Max volume 0.45 
          vol = 0.45;
          clearInterval(fadeInterval);
        }
        if (audioRefs.current[currentIdx.current]) {
           audioRefs.current[currentIdx.current].volume = vol;
        }
      }, 50);

      // Cross-fade looping logic
      // The track is ~30s. We trigger the next track a few seconds before the end
      // and fade the current one out.
      const crossfadeDuration = 3.0; // 3 seconds crossfade
      
      loopCheckInterval = window.setInterval(() => {
        const curAudio = audioRefs.current[currentIdx.current];
        if (!curAudio || isNaN(curAudio.duration)) return;
        
        // If we are getting close to the end
        if (curAudio.currentTime > curAudio.duration - crossfadeDuration) {
           const nextIdx = (currentIdx.current + 1) % 2;
           const nextAudio = audioRefs.current[nextIdx];
           
           // Start the next audio
           nextAudio.currentTime = 0;
           nextAudio.volume = 0;
           nextAudio.play().catch(() => {});
           
           // Fade out current, fade in next
           let cfTime = 0;
           const cfInterval = window.setInterval(() => {
             cfTime += 0.1;
             const ratio = Math.min(1, cfTime / crossfadeDuration);
             
             if (curAudio) curAudio.volume = Math.max(0, 0.45 * (1 - ratio));
             if (nextAudio) nextAudio.volume = Math.min(0.45, 0.45 * ratio);
             
             if (ratio >= 1) {
               window.clearInterval(cfInterval);
               curAudio.pause();
               curAudio.currentTime = 0;
             }
           }, 100);
           
           currentIdx.current = nextIdx;
        }
      }, 500);

    } else {
      // Fade out all active audio
      if (audioRefs.current.length > 0) {
        fadeInterval = window.setInterval(() => {
          let allMuted = true;
          audioRefs.current.forEach(audio => {
            let vol = audio.volume;
            vol -= 0.05;
            if (vol <= 0) {
              vol = 0;
              audio.pause();
              audio.currentTime = 0;
            } else {
              allMuted = false;
            }
            audio.volume = vol;
          });
          
          if (allMuted) {
            clearInterval(fadeInterval);
          }
        }, 100);
      }
    }

    return () => {
      if (fadeInterval) window.clearInterval(fadeInterval);
      if (loopCheckInterval) window.clearInterval(loopCheckInterval);
      if (!active) {
        audioRefs.current.forEach(audio => {
          audio.pause();
          audio.currentTime = 0;
        });
      }
    };
  }, [active]);
}
