export type ScriptEvent = Readonly<{
  delayMs: number; // relative delay from previous line
  line: string;
}>;

export function getBootSequence(): readonly ScriptEvent[] {
  return [
    { delayMs: 150, line: '> SYSTEM BOOT...' },
    { delayMs: 450, line: '> CAD-911 v3.1 (1998)' },
    { delayMs: 520, line: '> CONNECTING TO TOWER [HC-04]... OK.' },
    { delayMs: 520, line: '> POWER SOURCE: AUXILIARY GENERATOR (WARNING)' },
    { delayMs: 650, line: '> INCOMING CONNECTION (PRIORITY: EMERGENCY)...' },
  ] as const;
}

export function getIntroCallSequence(): readonly ScriptEvent[] {
  return [
    // Relative timings aligned to audio marks:
    // 00:00, 00:02, 00:08, 00:11, 00:21
    { delayMs: 0, line: '911 (YOU): 9-1-1, what is your emergency?' },
    { delayMs: 2000, line: 'CHAD: Hello? ... Hello?! Can you hear me? I... I think someone is here.' },
    { delayMs: 6000, line: '911 (YOU): Stay calm. Tell me where you are. What is your location?' },
    { delayMs: 3000, line: "CHAD: Hollow Creek Mansion. Look, I know—I know it's stupid! But the storm is just too strong out there... the power is completely dead. I can't see a thing in here." },
    { delayMs: 10000, line: '911 (YOU): Listen carefully. I am going to track your signal. Do exactly what I say.' },
  ] as const;
}
