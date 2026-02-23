export type ChainLogLevel = 'INFO' | 'WARN' | 'ERROR';

export type ChainLogEntry = Readonly<{
  ts: number;
  level: ChainLogLevel;
  msg: string;
}>;

export type ChainContext = Readonly<{
  network: 'SIM' | 'TESTNET' | 'FUTURE';
  contracts: Readonly<{
    game?: string;
    hub?: string;
    verifierPing?: string;
    verifierStatus?: string;
    verifierMove?: string;
  }>;
}>;

export function fakeTxHash(seed: string): string {
  // Deterministic, not cryptographic. Only for the prototype UI.
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const hex = h.toString(16).padStart(8, '0');
  return `TX_${hex.toUpperCase()}`;
}

export function formatChainLine(e: ChainLogEntry): string {
  const d = new Date(e.ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `[${hh}:${mm}:${ss}] ${e.level} ${e.msg}`;
}

export function appendChainLog(log: readonly ChainLogEntry[], entry: ChainLogEntry, limit = 200): ChainLogEntry[] {
  const next = [...log, entry];
  if (next.length <= limit) return next;
  return next.slice(next.length - limit);
}

export function mkChainContext(): ChainContext {
  return mkChainContextFrom({
    network: 'SIM',
    contracts: {
      game: 'SIM_PROOF_OF_LIFE',
      hub: 'SIM_GAME_HUB',
      verifierPing: 'SIM_NOIR_PING',
      verifierStatus: 'SIM_NOIR_STATUS',
      verifierMove: 'SIM_NOIR_MOVE',
    },
  });
}

export function mkChainContextFrom(partial: Partial<ChainContext>): ChainContext {
  return {
    network: partial.network ?? 'SIM',
    contracts: {
      game: partial.contracts?.game,
      hub: partial.contracts?.hub,
      verifierPing: partial.contracts?.verifierPing,
      verifierStatus: partial.contracts?.verifierStatus,
      verifierMove: partial.contracts?.verifierMove,
    },
  };
}
