import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { AsciiTitle, CRTPanel, NeonKPI, AsciiMeter, TerminalLog, WavePane, stars, meterBar, CRTModal } from './retro-ui/components';
import { IntroScreen } from './retro-ui/IntroScreen';
import { LobbyScreen } from './retro-ui/LobbyScreen';
import { CutsceneScreen } from './retro-ui/CutsceneScreen';
import { RetroMap } from './retro-ui/RetroMap';
import type { ChadCommand, GameMode, SessionState, TowerId } from './model';
import { commitLocation, createSession, recharge, requestPing, setChadCommand } from './localBackend';
import { formatPowerMeter } from './terminal/powerMeter';
import {
  DEFAULT_SIM_CONFIG,
  applyManualAssassinPath,
  createSecret,
  prepareAssassinTurnFromAssassinPhase,
  prepareAssassinTurnFromDispatcherAction,
  stepAfterDispatcherActionWithTrace,
  validateManualAssassinPath,
  type AssassinTurnPrepared,
  type Coord,
  type SecretState,
} from './sim/engine';
import { getAvailableChadCommands } from './sim/chadOptions';
import { getBootSequence, getIntroCallSequence } from './script/callScript';
import { getCellPlan, isBlockedTile, isChadSpawnable, isHideTile, listDoorMarkers, MAP_LABELS, ROOM_LEGEND } from './world/floorplan';
import { appendChainLog, fakeTxHash, formatChainLine, mkChainContextFrom, type ChainLogEntry } from './chain/chainLog';
import {
  ChainBackend,
  SESSION_ALLOW_ASSASSIN_TICK,
  SESSION_ALLOW_COMMIT_LOCATION,
  SESSION_ALLOW_DISPATCH,
  SESSION_ALLOW_LOCK_SECURE_MODE,
  SESSION_ALLOW_RECHARGE,
  SESSION_ALLOW_SUBMIT_MOVE_PROOF,
  SESSION_ALLOW_SUBMIT_PING_PROOF,
  SESSION_ALLOW_SUBMIT_TURN_STATUS_PROOF,
  roomIdForChadCommand,
  tryExtractTxHashFromError,
} from './chain/chainBackend';
import { CONTRACT_DEFAULT_TOWERS, towerXYFor } from './chain/towerCoords';
import { ZkProverClient } from './zk/proverClient';
import { PING_DISTANCE_MANIFEST, evaluatePingVerifierCompatibility } from './zk/compatibility';
import type { ContractSigner } from '@/types/signer';
import { config as appConfig } from '@/config';
import { shouldDisableChadCommands } from './ui/locks';
import { shouldRunAssassinTickFallback } from './ui/pipeline';
import './ProofOfLifeGame.css';
import { encryption, type EncryptedSecret } from './utils/encryption';
import { Keypair, TransactionBuilder } from '@stellar/stellar-sdk';

const createRandomSessionId = (): number => {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    let value = 0;
    const buffer = new Uint32Array(1);
    while (value === 0) {
      crypto.getRandomValues(buffer);
      value = buffer[0];
    }
    return value;
  }
  return (Math.floor(Math.random() * 0xffffffff) >>> 0) || 1;
};

const TOWERS: { id: TowerId; label: string }[] = [
  { id: 'N', label: 'NORTH' },
  { id: 'W', label: 'WEST' },
  { id: 'E', label: 'EAST' },
  { id: 'S', label: 'SOUTH' },
];

const ENABLE_SESSION_KEY_MODE = String((import.meta as any)?.env?.VITE_ENABLE_SESSION_KEY_MODE ?? 'true').toLowerCase() !== 'false';
const SESSION_KEY_TTL_LEDGERS = Number((import.meta as any)?.env?.VITE_SESSION_KEY_TTL_LEDGERS ?? 360);
const SESSION_KEY_MAX_WRITES = Number((import.meta as any)?.env?.VITE_SESSION_KEY_MAX_WRITES ?? 120);
const SESSION_KEY_POLL_INTERVAL_MS = Number((import.meta as any)?.env?.VITE_SESSION_KEY_POLL_INTERVAL_MS ?? 1500);
const SESSION_KEY_VISIBILITY_POLL_ATTEMPTS = Number((import.meta as any)?.env?.VITE_SESSION_KEY_VISIBILITY_POLL_ATTEMPTS ?? 20); // ~30s
const SESSION_KEY_SCOPE_POLL_FOREGROUND_ATTEMPTS = Number((import.meta as any)?.env?.VITE_SESSION_KEY_SCOPE_POLL_FOREGROUND_ATTEMPTS ?? 10); // ~15s
const SESSION_KEY_SCOPE_POLL_BACKGROUND_ATTEMPTS = Number((import.meta as any)?.env?.VITE_SESSION_KEY_SCOPE_POLL_BACKGROUND_ATTEMPTS ?? 60); // ~90s
// Secure-mode proof generation + submission can exceed 30s on testnet; avoid premature lock release.
const PIPELINE_WATCHDOG_MS = 120_000;
const SUBTITLE_TURN_DURATION_MS = 27_000;

type GameSyncMessage =
  | {
      type: 'assassin-turn-applied';
      sessionId: number;
      completedTurn: number;
      secret: SecretState;
    };

function fnv1a32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function deriveTwoPlayerSeed(sessionId: number, dispatcherAddr: string, assassinAddr: string, tag: string): number {
  return fnv1a32(`${tag}|${sessionId >>> 0}|${dispatcherAddr}|${assassinAddr}`) || 1;
}

function deriveTwoPlayerChadCoord(sessionId: number, dispatcherAddr: string, assassinAddr: string): { x: number; y: number } {
  const spawnable: { x: number; y: number }[] = [];
  for (let y = 0; y < DEFAULT_SIM_CONFIG.gridH; y++) {
    for (let x = 0; x < DEFAULT_SIM_CONFIG.gridW; x++) {
      if (isChadSpawnable(x, y)) spawnable.push({ x, y });
    }
  }
  if (!spawnable.length) return { ...DEFAULT_SIM_CONFIG.chadDefault };
  const idx = deriveTwoPlayerSeed(sessionId, dispatcherAddr, assassinAddr, 'chad') % spawnable.length;
  return spawnable[idx] ?? { ...DEFAULT_SIM_CONFIG.chadDefault };
}

function createSynchronizedSession(params: {
  sessionId: number;
  mode: GameMode;
  dispatcher: string;
  assassin: string;
}): SessionState {
  const s = createSession(params);
  if (params.mode !== 'two-player') return s;
  const chad = deriveTwoPlayerChadCoord(params.sessionId, params.dispatcher, params.assassin);
  return { ...s, chad_x: chad.x, chad_y: chad.y };
}

function hasOnchainPublicDiff(local: SessionState, onchain: SessionState): boolean {
  const preserveDeferredDispatcherState =
    local.mode === 'two-player' &&
    local.phase === 'dispatcher' &&
    local.turn_step === 'command' &&
    onchain.phase === 'dispatcher' &&
    onchain.turn === local.turn;
  const effectiveCommitmentSet = local.commitmentSet || onchain.commitmentSet;
  return (
    local.turn !== onchain.turn ||
    local.phase !== onchain.phase ||
    local.ended !== onchain.ended ||
    (!preserveDeferredDispatcherState && local.battery !== onchain.battery) ||
    local.alpha !== onchain.alpha ||
    local.alpha_max !== onchain.alpha_max ||
    local.commitmentSet !== effectiveCommitmentSet ||
    local.chad_x !== onchain.chad_x ||
    local.chad_y !== onchain.chad_y ||
    local.chad_hidden !== onchain.chad_hidden ||
    local.chad_hide_streak !== onchain.chad_hide_streak ||
    local.insecure_mode !== onchain.insecure_mode ||
    local.pending_ping_tower !== onchain.pending_ping_tower
  );
}

function mergeOnchainStateIntoTwoPlayerLocal(local: SessionState, onchain: SessionState): SessionState {
  const preserveDeferredDispatcherState =
    local.mode === 'two-player' &&
    local.phase === 'dispatcher' &&
    local.turn_step === 'command' &&
    onchain.phase === 'dispatcher' &&
    onchain.turn === local.turn;
  return {
    ...local,
    battery: preserveDeferredDispatcherState ? local.battery : onchain.battery,
    turn: onchain.turn,
    phase: onchain.phase,
    turn_step: preserveDeferredDispatcherState ? local.turn_step : onchain.turn_step,
    ended: onchain.ended,
    // Preserve locally-armed commitment on dispatcher until the first on-chain ping proof
    // sets the contract commitment. Otherwise the initial dispatcher controls get disabled.
    commitmentSet: local.commitmentSet || onchain.commitmentSet,
    alpha: onchain.alpha,
    alpha_max: onchain.alpha_max,
    moved_this_turn: onchain.moved_this_turn,
    chad_x: onchain.chad_x,
    chad_y: onchain.chad_y,
    chad_hidden: onchain.chad_hidden,
    chad_hide_streak: onchain.chad_hide_streak,
    pending_ping_tower: onchain.pending_ping_tower ?? null,
    insecure_mode: onchain.insecure_mode,
  };
}

function matchesReplayCandidateToOnchain(candidate: SessionState, onchain: SessionState): boolean {
  return (
    candidate.sessionId === onchain.sessionId &&
    candidate.dispatcher === onchain.dispatcher &&
    candidate.assassin === onchain.assassin &&
    candidate.turn === onchain.turn &&
    candidate.phase === onchain.phase &&
    candidate.ended === onchain.ended &&
    candidate.battery === onchain.battery &&
    candidate.commitmentSet === onchain.commitmentSet &&
    (candidate.alpha ?? 0) === (onchain.alpha ?? 0) &&
    (candidate.alpha_max ?? 0) === (onchain.alpha_max ?? 0) &&
    (candidate.chad_x ?? -1) === (onchain.chad_x ?? -1) &&
    (candidate.chad_y ?? -1) === (onchain.chad_y ?? -1) &&
    !!candidate.chad_hidden === !!onchain.chad_hidden &&
    (candidate.chad_hide_streak ?? 0) === (onchain.chad_hide_streak ?? 0)
  );
}

function tryReplayAssassinSyncTurn(params: {
  local: SessionState;
  secret: EncryptedSecret;
  onchain: SessionState;
}): { session: SessionState; secret: EncryptedSecret } | null {
  const { local, secret, onchain } = params;
  if (local.mode !== 'two-player') return null;
  if (local.ended || onchain.ended) return null;
  if (local.phase !== 'dispatcher' || local.turn_step !== 'action') return null;
  if (onchain.phase !== 'dispatcher') return null;
  if (onchain.turn !== local.turn + 1) return null;

  const baseSecret = encryption.decrypt(secret);
  const actionCandidates: SessionState[] = [];

  const pingState = requestPing(local, local.dispatcher, 'N');
  if (pingState.turn_step === 'command' && pingState.battery === onchain.battery) {
    actionCandidates.push(pingState);
  }

  const rechargeState = recharge(local, local.dispatcher);
  if (
    rechargeState.turn_step === 'command' &&
    rechargeState.battery === onchain.battery &&
    !actionCandidates.some((s) => s.battery === rechargeState.battery && s.turn_step === rechargeState.turn_step)
  ) {
    actionCandidates.push(rechargeState);
  }

  const matches: Array<{ session: SessionState; secret: EncryptedSecret }> = [];

  for (const actionState of actionCandidates) {
    const cmds = getAvailableChadCommands(actionState);
    for (const opt of cmds) {
      const queued = setChadCommand(actionState, actionState.dispatcher, opt.cmd);
      if (queued.pending_chad_cmd !== opt.cmd || queued.turn_step !== 'command') continue;
      const out = stepAfterDispatcherActionWithTrace(queued, baseSecret, DEFAULT_SIM_CONFIG);
      if (!matchesReplayCandidateToOnchain(out.session, onchain)) continue;
      matches.push({
        session: mergeOnchainStateIntoTwoPlayerLocal(out.session, onchain),
        secret: encryption.encrypt(out.secret),
      });
    }
  }

  return matches[0] ?? null;
}

function getSubtitleConversationLinesForSession(session: SessionState | null): string[] {
  if (!session) return [];
  const entries = (session.log ?? []).map((line, idx) => ({ line, idx }));
  const dialogue = entries.filter((e) => e.line.startsWith('YOU:') || e.line.startsWith('CHAD:'));
  if (!dialogue.length) return [];

  let boundaryIdx = -1;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (/^TURN\s+\d+\s+READY$/.test(entries[i].line)) {
      boundaryIdx = i;
      break;
    }
  }

  const afterBoundary = dialogue.filter((e) => e.idx > boundaryIdx);
  const windowBase = afterBoundary.length > 0 ? afterBoundary : dialogue.slice(-8);
  const youInWindow = windowBase.filter((e) => e.line.startsWith('YOU:'));

  let scoped = windowBase;
  if (youInWindow.length >= 2) {
    const guidanceIdx = youInWindow[youInWindow.length - 2].idx;
    scoped = windowBase.filter((e) => e.idx >= guidanceIdx);
  } else if (youInWindow.length === 1) {
    const startIdx = youInWindow[0].idx;
    scoped = windowBase.filter((e) => e.idx >= startIdx);
  }

  const lines = scoped.length > 0 ? scoped : windowBase;
  return lines.map((e) => e.line);
}

function subtitleLineHoldMsForCount(lineCount: number): number {
  return Math.max(2200, Math.floor(SUBTITLE_TURN_DURATION_MS / Math.max(1, lineCount)));
}

function estimateSubtitlePlaybackMs(lines: readonly string[]): number {
  if (!lines.length) return 0;
  return subtitleLineHoldMsForCount(lines.length) * lines.length;
}

function createLocalKeypairSigner(secretKey: string, networkPassphrase: string): { publicKey: string; signer: ContractSigner } {
  const keypair = Keypair.fromSecret(secretKey);
  return {
    publicKey: keypair.publicKey(),
    signer: {
      signTransaction: async (txXdr: string) => {
        const tx = TransactionBuilder.fromXDR(txXdr, networkPassphrase);
        tx.sign(keypair);
        return {
          signedTxXdr: tx.toXDR(),
          signerAddress: keypair.publicKey(),
        };
      },
      signAuthEntry: async (authEntryXdr: string) => ({
        signedAuthEntry: authEntryXdr,
        signerAddress: keypair.publicKey(),
      }),
    },
  };
}

async function fundSessionKeyOnTestnet(address: string): Promise<void> {
  const endpoint = `https://friendbot.stellar.org/?addr=${encodeURIComponent(address)}`;
  const res = await fetch(endpoint, { method: 'GET' });
  if (!res.ok) {
    throw new Error(`Friendbot funding failed (${res.status})`);
  }
}

export function ProofOfLifeGame(props: {
  userAddress: string;
  getContractSigner?: () => ContractSigner;
  wallet: {
    isConnected: boolean;
    isConnecting: boolean;
    error: string | null;
    connect?: () => Promise<void>;
    disconnect?: () => void;
    connectDev: (playerNumber: 1 | 2) => Promise<void>;
    switchPlayer: (playerNumber: 1 | 2) => Promise<void>;
    walletId: string | null;
    walletType?: 'dev' | 'wallet' | null;
    devReady: boolean;
    hasContract: boolean;
  }
}) {
  const { wallet } = props;
  const user = props.userAddress || 'GUEST';
  const [mode, setMode] = useState<GameMode>('single');
  const [dispatcherAddress, setDispatcherAddress] = useState('');
  const [sessionId, setSessionId] = useState(() => createRandomSessionId());
  const [showRules, setShowRules] = useState(false); // Modal State
  const [showLogs, setShowLogs] = useState(false);   // Logs Modal State
  const [showGameFinishedModal, setShowGameFinishedModal] = useState(false);
  const [assassinAddress, setAssassinAddress] = useState('');
  const [session, setSession] = useState<SessionState | null>(null);
  const [secret, setSecret] = useState<EncryptedSecret | null>(null);
  const [uiPhase, setUiPhase] = useState<'setup' | 'lobby' | 'boot' | 'cutscene' | 'play'>('setup');
  const [visibleUiPhase, setVisibleUiPhase] = useState<'setup' | 'lobby' | 'boot' | 'cutscene' | 'play'>('setup');
  const [lobbyRole, setLobbyRole] = useState<'dispatcher' | 'assassin' | null>(null);
  const [phaseTransition, setPhaseTransition] = useState<'idle' | 'exiting' | 'entering'>('idle');
  const [hoverDrain, setHoverDrain] = useState<string | null>(null);
  const [recharging, setRecharging] = useState(false);
  const [chat, setChat] = useState('');
  const [timeouts] = useState<number[]>(() => []);
  const [chainLog, setChainLog] = useState<ChainLogEntry[]>([]);
  const [sessionKeySecret, setSessionKeySecret] = useState<string | null>(null);
  const [sessionKeyPublic, setSessionKeyPublic] = useState<string | null>(null);
  const [chainTowers, setChainTowers] = useState<any | null>(null);
  // Shadow-mode on-chain: we defer the on-chain `dispatch` until after the player chooses Chad's command,
  // so the UI can keep the "PING first, then command" flow.
  const [pendingPing, setPendingPing] = useState<{ tower: TowerId; d2: number } | null>(null);
  const [lastPingResult, setLastPingResult] = useState<{ tower: TowerId; d2: number; at: number; turn: number } | null>(null);
  const [assassinPlannedPath, setAssassinPlannedPath] = useState<Coord[]>([]);
  const [assassinTurnBusy, setAssassinTurnBusy] = useState(false);
  const [assassinTurnError, setAssassinTurnError] = useState<string | null>(null);
  const [commandLocked, setCommandLocked] = useState(false);
  const [chainPipelineLocked, setChainPipelineLocked] = useState(false);
  const [onchainMutationLocked, setOnchainMutationLocked] = useState(false);
  const [onchainBootstrapPending, setOnchainBootstrapPending] = useState(false);
  const [onchainSessionHealthy, setOnchainSessionHealthy] = useState(true);
  const [zkVerifiersReady, setZkVerifiersReady] = useState(true);
  const [activeSubtitleLine, setActiveSubtitleLine] = useState('...');
  const [devMode, setDevMode] = useState(false); // Forced secure mode (PROD/ZK only)
  const devModeSessionRef = useRef<boolean>(false);
  const verifierBypassModeRef = useRef<boolean>(false);
  const subtitleTimersRef = useRef<number[]>([]);
  const subtitleKeyRef = useRef('');
  const pingProofRef = useRef<Promise<boolean> | null>(null);
  const proofTurnRef = useRef<number | null>(null);
  const onchainBootstrapPendingRef = useRef(false);
  const onchainSessionHealthyRef = useRef(true);
  // Immediate lock guards (avoid React state timing windows on very fast clicks).
  const commandLockRef = useRef(false);
  const chainPipelineLockRef = useRef(false);
  const onchainMutationLockRef = useRef(false);
  const activeSessionIdRef = useRef<number | null>(null);
  const sessionKeyPollTokenRef = useRef(0);
  const pipelineFailsafeRef = useRef<number | null>(null);
  const dialogueUnlockTimerRef = useRef<number | null>(null);
  const chainLogScrollRef = useRef<HTMLDivElement>(null);
  const phaseExitTimerRef = useRef<number | null>(null);
  const phaseEnterTimerRef = useRef<number | null>(null);
  const latestSessionRef = useRef<SessionState | null>(null);
  const latestSecretRef = useRef<EncryptedSecret | null>(null);
  const finishedModalSessionRef = useRef<number | null>(null);
  const assassinSyncPollBusyRef = useRef(false);
  const assassinSyncWarnedTurnRef = useRef<number | null>(null);
  const assassinSyncLastErrorRef = useRef<{ msg: string; at: number } | null>(null);
  const assassinSubmitBusyRef = useRef(false);
  const phaseTransitionMs = 220;
  useEffect(() => {
    const el = chainLogScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chainLog]);

  useEffect(() => {
    if (uiPhase === visibleUiPhase) return;

    if (phaseExitTimerRef.current) {
      window.clearTimeout(phaseExitTimerRef.current);
      phaseExitTimerRef.current = null;
    }
    if (phaseEnterTimerRef.current) {
      window.clearTimeout(phaseEnterTimerRef.current);
      phaseEnterTimerRef.current = null;
    }

    setPhaseTransition('exiting');
    phaseExitTimerRef.current = window.setTimeout(() => {
      setVisibleUiPhase(uiPhase);
      setPhaseTransition('entering');
      phaseEnterTimerRef.current = window.setTimeout(() => {
        setPhaseTransition('idle');
        phaseEnterTimerRef.current = null;
      }, phaseTransitionMs);
      phaseExitTimerRef.current = null;
    }, phaseTransitionMs);
  }, [uiPhase, visibleUiPhase]);

  useEffect(() => {
    return () => {
      if (phaseExitTimerRef.current) window.clearTimeout(phaseExitTimerRef.current);
      if (phaseEnterTimerRef.current) window.clearTimeout(phaseEnterTimerRef.current);
      if (dialogueUnlockTimerRef.current) window.clearTimeout(dialogueUnlockTimerRef.current);
    };
  }, []);

  useEffect(() => {
    latestSessionRef.current = session;
  }, [session]);

  useEffect(() => {
    latestSecretRef.current = secret;
  }, [secret]);

  useEffect(() => {
    if (!session?.ended) return;
    const sid = session.sessionId >>> 0;
    if (finishedModalSessionRef.current === sid) return;
    finishedModalSessionRef.current = sid;
    setShowGameFinishedModal(true);
  }, [session?.ended, session?.sessionId]);

  const prover = useMemo(() => {
    const url = (import.meta as any)?.env?.VITE_ZK_PROVER_URL ?? 'http://127.0.0.1:8788';
    return new ZkProverClient(String(url));
  }, []);

  const chainCtx = useMemo(() => {
    const pass = appConfig.networkPassphrase;
    const network = pass.includes('Test') ? 'TESTNET' : 'FUTURE';
    return mkChainContextFrom({
      network,
      contracts: {
        game: appConfig.proofOfLifeId || undefined,
        hub: appConfig.mockGameHubId || undefined,
      },
    });
  }, []);

  const chainBackend = useMemo(() => {
    const getSigner = props.getContractSigner;
    if (!getSigner) return null;
    if (!appConfig.proofOfLifeId || appConfig.proofOfLifeId === 'YOUR_CONTRACT_ID') return null;
    if (!user || user === 'GUEST') return null;
    try {
      let signer = getSigner();
      let sourcePublicKey = user;
      if (sessionKeySecret && sessionKeyPublic) {
        const sessionSigner = createLocalKeypairSigner(sessionKeySecret, appConfig.networkPassphrase);
        signer = sessionSigner.signer;
        sourcePublicKey = sessionKeyPublic;
      }
      return new ChainBackend(
        {
          rpcUrl: appConfig.rpcUrl,
          networkPassphrase: appConfig.networkPassphrase,
          contractId: appConfig.proofOfLifeId,
        },
        signer,
        sourcePublicKey
      );
    } catch {
      return null;
    }
  }, [props.getContractSigner, user, sessionKeySecret, sessionKeyPublic]);
  const onchainGameplayEnabled = !!chainBackend && zkVerifiersReady && onchainSessionHealthy;
  const onchainDisableReason = !chainBackend
    ? 'on-chain backend unavailable'
    : !zkVerifiersReady
      ? 'verifiers not configured'
      : !onchainSessionHealthy
        ? 'session desynchronized'
        : null;

  const isContractCode = (e: unknown, code: number): boolean => {
    const s = String(e ?? '');
    // Providers format contract errors differently (with/without spaces). Accept both.
    const re = new RegExp(`Error\\(\\s*Contract\\s*,\\s*#${code}\\s*\\)`, 'i');
    return re.test(s);
  };
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const isTxMalformedError = (e: unknown): boolean => /txMalformed/i.test(String(e ?? ''));
  const isSessionKeyAuthContractError = (e: unknown): boolean => [28, 29, 30, 31, 32].some((code) => isContractCode(e, code));
  const isDesyncError = (e: unknown): boolean => [6, 10, 12, 18, 19, 20].some((code) => isContractCode(e, code));
  const formatProofErrorForChainLog = (e: unknown): string => {
    const raw = String(e ?? '');
    if (devModeSessionRef.current) return raw;
    if (raw.includes('pi_len') || isContractCode(e, 22)) {
      return 'secure-mode proof validation failed (details redacted)';
    }
    return raw;
  };
  const markOnchainDesynced = (reason: string) => {
    onchainSessionHealthyRef.current = false;
    setOnchainSessionHealthy(false);
    setChainLog((l2) =>
      appendChainLog(l2, {
        ts: Date.now(),
        level: 'WARN',
        msg: `ONCHAIN: session desynchronized (${reason}). Disabling on-chain mutations for this session; restart required.`,
      })
    );
  };

  const activeMode = session?.mode ?? mode;
  const dispatcher = activeMode === 'single' ? user : dispatcherAddress.trim() || user;
  const assassin = activeMode === 'single' ? user : assassinAddress.trim() || 'UNKNOWN';
  const playerRole: 'dispatcher' | 'assassin' | 'observer' =
    activeMode === 'single'
      ? 'dispatcher'
      : user === dispatcher
        ? 'dispatcher'
        : user === assassin
          ? 'assassin'
          : (lobbyRole ?? 'observer');
  const isDispatcherClient = playerRole === 'dispatcher';
  const isAssassinClient = playerRole === 'assassin';
  const manualAssassinControlEnabled = activeMode === 'two-player';
  const assassinClientByRole = isAssassinClient || lobbyRole === 'assassin';
  const chadHiddenForMap =
    activeMode === 'two-player' &&
    !!session &&
    (
      !!session.chad_hidden ||
      !!(session.chad_hide_streak && session.chad_hide_streak > 0) ||
      (typeof session.chad_x === 'number' && typeof session.chad_y === 'number' && isHideTile(session.chad_x, session.chad_y))
    );
  const shouldShowChadMarkerOnMap = !chadHiddenForMap;
  const secretState = useMemo<SecretState | null>(() => {
    if (!secret) return null;
    try {
      return encryption.decrypt(secret);
    } catch {
      return null;
    }
  }, [secret]);
  const assassinTurnPrepared = useMemo<AssassinTurnPrepared | null>(() => {
    if (!manualAssassinControlEnabled || !isAssassinClient) return null;
    if (!session || !secretState) return null;
    return prepareAssassinTurnFromAssassinPhase(session, secretState, DEFAULT_SIM_CONFIG);
  }, [manualAssassinControlEnabled, isAssassinClient, session, secretState]);
  const assassinPathValidation = useMemo(() => {
    if (!assassinTurnPrepared) return null;
    return validateManualAssassinPath(assassinTurnPrepared, assassinPlannedPath, DEFAULT_SIM_CONFIG);
  }, [assassinTurnPrepared, assassinPlannedPath]);
  const assassinTurnCanSubmit =
    !!assassinTurnPrepared &&
    !!assassinPathValidation?.ok &&
    !assassinTurnBusy &&
    !onchainBootstrapPending &&
    !onchainMutationLocked &&
    !chainPipelineLocked &&
    uiPhase === 'play' &&
    !!chainBackend &&
    onchainGameplayEnabled &&
    onchainSessionHealthy;

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const bc = new BroadcastChannel('pol-game-sync');
    bc.onmessage = (ev: MessageEvent<GameSyncMessage>) => {
      const msg = ev.data;
      if (!msg || msg.type !== 'assassin-turn-applied') return;
      const cur = latestSessionRef.current;
      if (!cur || cur.mode !== 'two-player') return;
      if ((cur.sessionId >>> 0) !== (msg.sessionId >>> 0)) return;
      if (isAssassinClient) return;
      setSecret(encryption.encrypt(msg.secret));
      setChainLog((l) =>
        appendChainLog(l, {
          ts: Date.now(),
          level: 'INFO',
          msg: `SYNC: received assassin state for turn ${msg.completedTurn} via local tab channel`,
        }, 240)
      );
    };
    return () => {
      bc.close();
    };
  }, [isAssassinClient]);

  const power = useMemo(() => formatPowerMeter(session?.battery ?? 100), [session?.battery]);
  const controlsLocked = uiPhase !== 'play';
  const firstSecureTurnRequiresPing =
    !!session &&
    onchainGameplayEnabled &&
    !devModeSessionRef.current &&
    !verifierBypassModeRef.current &&
    session.turn === 0;
  const actionBusy = commandLocked || !!pendingPing || chainPipelineLocked || onchainMutationLocked || onchainBootstrapPending;
  const canPing =
    !!session &&
    !session.ended &&
    session.phase === 'dispatcher' &&
    session.turn_step === 'action' &&
    session.commitmentSet &&
    session.battery >= session.pingCost &&
    !actionBusy;
  const canRecharge =
    !!session &&
    !session.ended &&
    session.phase === 'dispatcher' &&
    session.turn_step === 'action' &&
    session.commitmentSet &&
    !firstSecureTurnRequiresPing &&
    !actionBusy;
  const chadCmdOptions = useMemo(() => (session ? getAvailableChadCommands(session) : []), [session]);
  const disableChadCmds = shouldDisableChadCommands({ uiPhase, session, commandLocked, chainPipelineLocked });
  const statusLabel = session
    ? !onchainSessionHealthy && !session.ended
      ? 'DESYNC'
      : session.ended
      ? session.outcome === 'win_extraction'
        ? 'EXTRACTED'
        : 'LOST'
      : 'ONLINE'
    : 'ONLINE';
  const statusClass =
    statusLabel === 'EXTRACTED'
      ? 'text-emerald-300'
      : statusLabel === 'LOST'
        ? 'text-red-400'
        : statusLabel === 'DESYNC'
          ? 'text-amber-300'
          : 'text-emerald-400';
  const proximityReadout = useMemo(() => {
    if (!lastPingResult) return null;
    const maxD2 = ((DEFAULT_SIM_CONFIG.gridW - 1) ** 2) + ((DEFAULT_SIM_CONFIG.gridH - 1) ** 2);
    const closeness = Math.max(0, Math.min(1, 1 - (lastPingResult.d2 / maxD2)));
    const strengthPct = Math.round(closeness * 100);

    let band = 'WEAK';
    let toneClass = 'text-cyan-300';
    if (strengthPct >= 85) {
      band = 'LOCKED';
      toneClass = 'text-red-300';
    } else if (strengthPct >= 65) {
      band = 'HOT';
      toneClass = 'text-amber-300';
    } else if (strengthPct >= 45) {
      band = 'WARM';
      toneClass = 'text-yellow-200';
    } else if (strengthPct >= 25) {
      band = 'COLD';
      toneClass = 'text-cyan-300';
    }

    return { strengthPct, band, toneClass };
  }, [lastPingResult]);
  const sessionOutcomeSummary = useMemo(() => {
    const outcome = session?.outcome;
    switch (outcome) {
      case 'win_extraction':
        return { title: 'MISSION SUCCESS', tone: 'text-emerald-300', detail: 'Chad survived and reached extraction.' };
      case 'loss_caught':
        return { title: 'MISSION FAILED', tone: 'text-red-300', detail: 'Chad was caught by the assassin.' };
      case 'loss_blackout':
        return { title: 'MISSION FAILED', tone: 'text-red-300', detail: 'Generator power reached zero (blackout).' };
      case 'loss_panic':
        return { title: 'MISSION FAILED', tone: 'text-red-300', detail: 'Chad panicked and the run collapsed.' };
      default:
        return { title: 'SESSION ENDED', tone: 'text-amber-300', detail: 'The game session has ended.' };
    }
  }, [session?.outcome]);
  const subtitleConversationLines = useMemo(() => getSubtitleConversationLinesForSession(session), [session]);
  const activeSubtitle = useMemo(() => {
    const m = activeSubtitleLine.match(/^([A-Z]+):\s*(.*)$/);
    if (!m) return { speaker: null as string | null, text: activeSubtitleLine };
    return { speaker: m[1], text: m[2] ?? '' };
  }, [activeSubtitleLine]);
  useEffect(() => {
    const key = subtitleConversationLines.join('\n');
    if (key === subtitleKeyRef.current) return;
    subtitleKeyRef.current = key;

    subtitleTimersRef.current.forEach((id) => window.clearTimeout(id));
    subtitleTimersRef.current = [];

    if (!subtitleConversationLines.length) {
      setActiveSubtitleLine('...');
      return;
    }

    const subtitleLineHoldMs = subtitleLineHoldMsForCount(subtitleConversationLines.length);
    subtitleConversationLines.forEach((line, idx) => {
      const id = window.setTimeout(() => setActiveSubtitleLine(line), idx * subtitleLineHoldMs);
      subtitleTimersRef.current.push(id);
    });

    return () => {
      subtitleTimersRef.current.forEach((id) => window.clearTimeout(id));
      subtitleTimersRef.current = [];
    };
  }, [subtitleConversationLines]);

  useEffect(() => {
    if (!isAssassinClient || session?.mode !== 'two-player') {
      setAssassinPlannedPath([]);
      setAssassinTurnError(null);
      setAssassinTurnBusy(false);
      assassinSubmitBusyRef.current = false;
      return;
    }
    if (!session || session.ended || session.phase !== 'assassin') {
      setAssassinPlannedPath([]);
      setAssassinTurnError(null);
      setAssassinTurnBusy(false);
      assassinSubmitBusyRef.current = false;
      return;
    }
    setAssassinTurnError(null);
  }, [isAssassinClient, session?.mode, session?.sessionId, session?.turn, session?.phase, session?.ended]);

  useEffect(() => {
    if (!chainBackend) return;
    if (!session || session.mode !== 'two-player') return;
    if (isDispatcherClient) {
      if (uiPhase !== 'play') return;
    } else {
      if (uiPhase !== 'cutscene' && uiPhase !== 'play') return;
    }

    let cancelled = false;
    let timerId: number | null = null;

    const poll = async () => {
      if (cancelled || assassinSyncPollBusyRef.current) return;
      const curLocal = latestSessionRef.current;
      if (!curLocal || curLocal.mode !== 'two-player') return;

      assassinSyncPollBusyRef.current = true;
      try {
        const sid = activeSessionIdRef.current ?? curLocal.sessionId;
        const fetched = await chainBackend.getSession(sid);
        if (cancelled) return;

        const onchain: SessionState = {
          ...fetched,
          mode: 'two-player',
          dispatcher: curLocal.dispatcher,
          assassin: curLocal.assassin,
        };

        const localNow = latestSessionRef.current;
        if (!localNow || localNow.mode !== 'two-player') return;
        if (!hasOnchainPublicDiff(localNow, onchain)) return;

        const nextSession = mergeOnchainStateIntoTwoPlayerLocal(localNow, onchain);

        if (onchain.turn > localNow.turn) {
          if (assassinSyncWarnedTurnRef.current !== onchain.turn) {
            assassinSyncWarnedTurnRef.current = onchain.turn;
            setChainLog((l) =>
              appendChainLog(l, {
                ts: Date.now(),
                level: 'WARN',
                msg: `TWO-PLAYER SYNC applied for turn ${onchain.turn} (public chain state updated)`,
              }, 240)
            );
          }
        }

        setSession(nextSession);
      } catch (e) {
        if (!cancelled) {
          const msg = String(e);
          const now = Date.now();
          const last = assassinSyncLastErrorRef.current;
          const shouldLog = !last || last.msg !== msg || (now - last.at) > 10_000;
          if (shouldLog) {
            assassinSyncLastErrorRef.current = { msg, at: now };
            setChainLog((l) =>
              appendChainLog(l, {
                ts: now,
                level: 'WARN',
                msg: `TWO-PLAYER SYNC poll failed: ${msg}`,
              }, 240)
            );
          }
        }
      } finally {
        assassinSyncPollBusyRef.current = false;
      }
    };

    void poll();
    timerId = window.setInterval(() => { void poll(); }, 1800);
    return () => {
      cancelled = true;
      if (timerId !== null) window.clearInterval(timerId);
    };
  }, [chainBackend, isDispatcherClient, session?.mode, session?.sessionId, uiPhase]);

  const clearPipelineFailsafe = () => {
    if (pipelineFailsafeRef.current !== null) {
      window.clearTimeout(pipelineFailsafeRef.current);
      pipelineFailsafeRef.current = null;
    }
  };

  const releasePipelineLocks = () => {
    clearPipelineFailsafe();
    chainPipelineLockRef.current = false;
    onchainMutationLockRef.current = false;
    setPendingPing(null);
    setChainPipelineLocked(false);
    setOnchainMutationLocked(false);
  };

  const start = (forcedSessionId?: number, overrides?: { mode?: GameMode; assassin?: string }) => {
    if (dialogueUnlockTimerRef.current !== null) {
      window.clearTimeout(dialogueUnlockTimerRef.current);
      dialogueUnlockTimerRef.current = null;
    }
    commandLockRef.current = false;
    setCommandLocked(false);
    // Cancel any scheduled script events from a previous run.
    while (timeouts.length) {
      const id = timeouts.pop();
      if (typeof id === 'number') window.clearTimeout(id);
    }

    const sid = typeof forcedSessionId === 'number' ? forcedSessionId : sessionId;
    // Use overrides when called from lobby (React state may not have flushed yet).
    const startMode = overrides?.mode ?? mode;
    const startAssassin = overrides?.assassin ?? assassin;
    const sessionKeyPollToken = ++sessionKeyPollTokenRef.current;
    activeSessionIdRef.current = sid;
    setSessionKeySecret(null);
    setSessionKeyPublic(null);
    const s = createSynchronizedSession({
      sessionId: sid,
      mode: startMode,
      dispatcher,
      assassin: startAssassin,
    });
    // Start with an empty log; boot + intro script will populate it.
    // ARM IMMEDIATELY on execution
    const armedSession = commitLocation(s, startAssassin);
    setSession({ ...armedSession, log: [] });
    setLastPingResult(null);
    const chad = { x: s.chad_x ?? 5, y: s.chad_y ?? 5 };
    const secretSeed = startMode === 'two-player'
      ? deriveTwoPlayerSeed(sid, dispatcher, startAssassin, 'secret')
      : undefined;
    setSecret(encryption.encrypt(createSecret(secretSeed, chad)));
    setUiPhase('boot');
    // PROD-only: force secure mode for every session start.
    devModeSessionRef.current = false;
    // Clear stale session key from any previous game so the memoized chainBackend
    // falls back to the dispatcher's wallet (correct source account + sequence).
    setSessionKeySecret(null);
    setSessionKeyPublic(null);
    verifierBypassModeRef.current = false;
    proofTurnRef.current = null;
    setOnchainSessionHealthy(true);
    onchainSessionHealthyRef.current = true;
    onchainBootstrapPendingRef.current = false;
    setOnchainBootstrapPending(false);
    setChainLog([
      { ts: Date.now(), level: 'INFO', msg: `CHAIN TERMINAL ONLINE (${chainCtx.network})` },
      { ts: Date.now(), level: 'INFO', msg: `RPC=${appConfig.rpcUrl}` },
      { ts: Date.now(), level: 'INFO', msg: `CONTRACT(game)=${chainCtx.contracts.game ?? 'UNCONFIGURED'}` },
      { ts: Date.now(), level: 'INFO', msg: `CONTRACT(hub)=${chainCtx.contracts.hub ?? 'UNCONFIGURED'}` },
      { ts: Date.now(), level: 'INFO', msg: 'ZK: UltraHonk/BN254 verifiers wired on-chain — ping_distance, turn_status, move_proof' },
    ]);

    if (chainBackend) {
      // Fire-and-forget "shadow" chain actions. Gameplay continues locally even if RPC fails.
      void chainBackend.getVerifiers()
        .then((v) => {
          // Contract returns get_verifiers() as (ping, turn_status, move).
          const now = Date.now();
          setChainLog((l) => {
            let next = appendChainLog(l, { ts: now,     level: 'INFO', msg: `VERIFIER(ping)   = ${v[0]}` }, 240);
            next =     appendChainLog(next, { ts: now+1, level: 'INFO', msg: `VERIFIER(status) = ${v[1]}` }, 240);
            next =     appendChainLog(next, { ts: now+2, level: 'INFO', msg: `VERIFIER(move)   = ${v[2]}` }, 240);
            return next;
          });
          const gameId = chainCtx.contracts.game ?? '';
          let ready = !!gameId && v[0] !== gameId && v[1] !== gameId && v[2] !== gameId;
          const secureModeWanted = !devModeSessionRef.current;
          const compat = evaluatePingVerifierCompatibility({
            deployedPingVerifier: String(v[0] ?? ''),
            secureMode: secureModeWanted,
          });
          setChainLog((l) =>
            appendChainLog(
              l,
              {
                ts: Date.now(),
                level: 'INFO',
                msg: secureModeWanted
                  ? 'ZK COMPAT local ping manifest loaded (secure mode; details redacted)'
                  : `ZK COMPAT local ping circuit=${PING_DISTANCE_MANIFEST.circuitVersion} layout=${PING_DISTANCE_MANIFEST.publicInputLayoutVersion} vk=${PING_DISTANCE_MANIFEST.vkHash.slice(0, 16)}${PING_DISTANCE_MANIFEST.vkHash.length > 16 ? '...' : ''}`,
              },
              240
            )
          );
          if (ready && secureModeWanted && !compat.ok) {
            ready = false;
            setChainLog((l) =>
              appendChainLog(
                l,
                {
                  ts: Date.now(),
                  level: 'WARN',
                  msg: `ZK COMPAT preflight failed (secure mode): ${compat.reasons.join('; ')}`,
                },
                240
              )
            );
          }
          setZkVerifiersReady(ready);
          if (!ready) {
            setChainLog((l) =>
              appendChainLog(
                l,
                {
                  ts: Date.now(),
                  level: 'WARN',
                  msg: secureModeWanted
                    ? 'VERIFIERS/ZK compatibility not ready for secure mode. Proof submissions will be skipped.'
                    : 'VERIFIERS not configured on-chain (set_verifiers required). Proof submissions will be skipped.',
                },
                240
              )
            );
          }
        })
        .catch((e) => {
          setZkVerifiersReady(false);
          setChainLog((l) => appendChainLog(l, { ts: Date.now(), level: 'WARN', msg: `VERIFIERS: unavailable (${String(e)})` }, 240));
        });

      void chainBackend.getTowers()
        .then((t) => {
          setChainTowers(t as any);
          setChainLog((l) =>
            appendChainLog(l, { ts: Date.now(), level: 'INFO', msg: `TOWERS N=(${(t as any).n_x},${(t as any).n_y}) E=(${(t as any).e_x},${(t as any).e_y}) S=(${(t as any).s_x},${(t as any).s_y}) W=(${(t as any).w_x},${(t as any).w_y})` }, 240)
          );
        })
        .catch((e) => setChainLog((l) => appendChainLog(l, { ts: Date.now(), level: 'WARN', msg: `TOWERS: unavailable (${String(e)})` }, 240)));

      onchainBootstrapPendingRef.current = true;
      setOnchainBootstrapPending(true);
      onchainMutationLockRef.current = true;
      setOnchainMutationLocked(true);
      void (async () => {
        // Build a fresh bootstrap backend using the dispatcher's wallet as source account.
        // The memoized `chainBackend` may still hold a stale session key from the previous game
        // (React state updates are async), so we bypass it entirely for the bootstrap flow.
        const getSigner = props.getContractSigner;
        if (!getSigner) {
          setChainLog((l) => appendChainLog(l, { ts: Date.now(), level: 'ERROR', msg: 'No contract signer available — cannot bootstrap on-chain session' }));
          onchainBootstrapPendingRef.current = false;
          setOnchainBootstrapPending(false);
          onchainMutationLockRef.current = false;
          setOnchainMutationLocked(false);
          return;
        }
        const bootstrapBackend = new ChainBackend(
          { rpcUrl: appConfig.rpcUrl, networkPassphrase: appConfig.networkPassphrase, contractId: appConfig.proofOfLifeId },
          getSigner(),
          user  // dispatcher's public key — always funded, correct sequence number
        );
        try {
          const wantsSingleConfirm = ENABLE_SESSION_KEY_MODE && wallet.walletType === 'wallet' && user !== 'GUEST';

          if (wantsSingleConfirm && user === dispatcher) {
            const sessionKey = Keypair.random();
            if (appConfig.networkPassphrase.includes('Test')) {
              await fundSessionKeyOnTestnet(sessionKey.publicKey());
            }
            const dispatcherAllowMask = SESSION_ALLOW_DISPATCH | SESSION_ALLOW_RECHARGE | SESSION_ALLOW_LOCK_SECURE_MODE;
            const assassinAllowMask = user === startAssassin
              ? (
                SESSION_ALLOW_COMMIT_LOCATION |
                SESSION_ALLOW_SUBMIT_PING_PROOF |
                SESSION_ALLOW_SUBMIT_MOVE_PROOF |
                SESSION_ALLOW_SUBMIT_TURN_STATUS_PROOF |
                SESSION_ALLOW_ASSASSIN_TICK
              )
              : 0;

            const r = await bootstrapBackend.startGameWithSessionKey({
              sessionId: sid,
              dispatcher,
              assassin: startAssassin,
              insecureMode: !!devModeSessionRef.current,
              delegate: sessionKey.publicKey(),
              ttlLedgers: Math.max(1, SESSION_KEY_TTL_LEDGERS),
              maxWrites: Math.max(1, SESSION_KEY_MAX_WRITES),
              dispatcherAllowMask,
              assassinAllowMask,
            });
            // Wallet confirmed + TX submitted — safe to start the cutscene now.
            setUiPhase('cutscene');
            let dispatcherScopeReady = false;
            let assassinScopeReady = user !== startAssassin;
            const delegatePk = sessionKey.publicKey();
            const stillCurrentSession = () =>
              activeSessionIdRef.current === sid && sessionKeyPollTokenRef.current === sessionKeyPollToken;

            const pollSessionVisible = async (attempts: number): Promise<boolean> => {
              for (let i = 0; i < attempts; i++) {
                if (!stillCurrentSession()) return false;
                try {
                  const sCheck = await bootstrapBackend.getSession(sid);
                  if (typeof sCheck.sessionId === 'number') return true;
                } catch (pollErr) {
                  if (i === 0 || (i + 1) % 5 === 0) {
                    console.warn(`[session-key] visibility poll ${i + 1}/${attempts} failed:`, pollErr);
                  }
                }
                if (i < attempts - 1) await sleep(SESSION_KEY_POLL_INTERVAL_MS);
              }
              return false;
            };

            const pollScopes = async (attempts: number, label: 'foreground' | 'background') => {
              for (let i = 0; i < attempts; i++) {
                if (!stillCurrentSession()) return;
                try {
                  const dScope = await bootstrapBackend.getSessionKeyScope({
                    owner: dispatcher,
                    sessionId: sid,
                    role: 'Dispatcher',
                  });
                  dispatcherScopeReady = !!dScope && dScope.delegate === delegatePk;
                  if (user === startAssassin) {
                    const aScope = await bootstrapBackend.getSessionKeyScope({
                      owner: startAssassin,
                      sessionId: sid,
                      role: 'Assassin',
                    });
                    assassinScopeReady = !!aScope && aScope.delegate === delegatePk;
                  }
                  if (dispatcherScopeReady && assassinScopeReady) return;
                } catch (pollErr) {
                  if (i === 0 || (i + 1) % 5 === 0) {
                    console.warn(`[session-key] ${label} scope poll ${i + 1}/${attempts} failed:`, pollErr);
                  }
                }
                if ((i + 1) % 10 === 0 || (label === 'foreground' && i + 1 === attempts)) {
                  console.info(`[session-key] ${label} scope poll ${i + 1}/${attempts} — dispatcher=${dispatcherScopeReady} assassin=${assassinScopeReady}`);
                }
                if (i < attempts - 1) await sleep(SESSION_KEY_POLL_INTERVAL_MS);
              }
            };

            const sessionVisible = await pollSessionVisible(SESSION_KEY_VISIBILITY_POLL_ATTEMPTS);
            if (sessionVisible) {
              await pollScopes(SESSION_KEY_SCOPE_POLL_FOREGROUND_ATTEMPTS, 'foreground');
            }
            if (dispatcherScopeReady && assassinScopeReady) {
              setSessionKeySecret(sessionKey.secret());
              setSessionKeyPublic(sessionKey.publicKey());
              setChainLog((l2) =>
                appendChainLog(l2, {
                  ts: Date.now(),
                  level: 'INFO',
                  msg: `TX ${r.txHash ?? 'UNKNOWN'} ok start_game_with_session_key delegate=${sessionKey.publicKey().slice(0, 8)}... one-confirm mode enabled`,
                })
              );
            } else {
              setChainLog((l2) =>
                appendChainLog(l2, {
                  ts: Date.now(),
                  level: 'WARN',
                  msg: `SESSION KEY scope validation pending (dispatcher=${dispatcherScopeReady} assassin=${assassinScopeReady}) session=${sid}; continuing with wallet-per-tx mode for now`,
                })
              );

              // Keep polling in the background on slow testnet settlement and auto-enable
              // one-confirm mode if the scopes appear later.
              void (async () => {
                try {
                  if (!sessionVisible) {
                    const visibleLater = await pollSessionVisible(SESSION_KEY_SCOPE_POLL_BACKGROUND_ATTEMPTS);
                    if (!visibleLater || !stillCurrentSession()) return;
                  }
                  await pollScopes(SESSION_KEY_SCOPE_POLL_BACKGROUND_ATTEMPTS, 'background');
                  if (!stillCurrentSession()) return;
                  if (dispatcherScopeReady && assassinScopeReady) {
                    setSessionKeySecret(sessionKey.secret());
                    setSessionKeyPublic(delegatePk);
                    setChainLog((l2) =>
                      appendChainLog(l2, {
                        ts: Date.now(),
                        level: 'INFO',
                        msg: `SESSION KEY scopes confirmed late (delegate=${delegatePk.slice(0, 8)}...) session=${sid}; one-confirm mode enabled`,
                      })
                    );
                  } else {
                    setChainLog((l2) =>
                      appendChainLog(l2, {
                        ts: Date.now(),
                        level: 'WARN',
                        msg: `SESSION KEY scope validation failed (dispatcher=${dispatcherScopeReady} assassin=${assassinScopeReady}) session=${sid}; wallet-per-tx mode will continue`,
                      })
                    );
                  }
                } catch (eBg) {
                  console.warn('[session-key] background validation failed:', eBg);
                }
              })();
            }
          } else {
            const r = await bootstrapBackend.startGame({ sessionId: sid, dispatcher, assassin: startAssassin });
            // Wallet confirmed + TX submitted — safe to start the cutscene now.
            setUiPhase('cutscene');
            setChainLog((l) => appendChainLog(l, { ts: Date.now(), level: 'INFO', msg: `TX ${r.txHash ?? 'UNKNOWN'} invoke start_game session=${sid} dispatcher=${dispatcher} assassin=${startAssassin}` }));

            // Guard against indexing/settlement delay: ensure session is visible before mode lock.
            // Testnet can take 15-30s to settle; poll generously.
            let sessionVisible = false;
            for (let i = 0; i < 20; i++) {
              try {
                const sCheck = await bootstrapBackend.getSession(sid);
                if (typeof sCheck.sessionId === 'number') {
                  sessionVisible = true;
                  break;
                }
              } catch (pollErr) {
                // Log the first and every 5th poll error to help diagnose failures
                if (i === 0 || i % 5 === 0) {
                  console.warn(`[poll ${i}] getSession(${sid}) error:`, pollErr);
                  setChainLog((l) => appendChainLog(l, { ts: Date.now(), level: 'WARN', msg: `getSession poll ${i}: ${pollErr instanceof Error ? pollErr.message : String(pollErr)}` }));
                }
              }
              if (i > 0 && i % 5 === 0) {
                setChainLog((l) => appendChainLog(l, { ts: Date.now(), level: 'INFO', msg: `Waiting for session ${sid} to settle on-chain... (${i * 1.5}s)` }));
              }
              await sleep(1500);
            }
            if (!sessionVisible) {
              throw new Error(`start_game submitted but session=${sid} not visible yet on-chain after 30s`);
            }

            if (devModeSessionRef.current) {
              try {
                const r2 = await bootstrapBackend.setInsecureMode({ sessionId: sid, enabled: true });
                setChainLog((l2) => appendChainLog(l2, { ts: Date.now(), level: 'INFO', msg: `TX ${r2.txHash ?? 'UNKNOWN'} ok set_insecure_mode=true (DEV MODE)` }));
              } catch (e2) {
                const h2 = tryExtractTxHashFromError(e2);
                setChainLog((l2) => appendChainLog(l2, { ts: Date.now(), level: 'WARN', msg: `set_insecure_mode failed${h2 ? ` (hash=${h2})` : ''}: ${String(e2)}` }));
                setChainLog((l2) => appendChainLog(l2, { ts: Date.now(), level: 'WARN', msg: 'DEV MODE active for this session: submit_ping_proof will stay disabled and assassin_tick fallback will be used.' }));
              }
            } else {
              try {
                let locked = false;
                let lastErr: unknown;
                for (let attempt = 0; attempt < 3; attempt++) {
                  try {
                    const r2 = await bootstrapBackend.lockSecureMode({ sessionId: sid, dispatcher });
                    setChainLog((l2) => appendChainLog(l2, { ts: Date.now(), level: 'INFO', msg: `TX ${r2.txHash ?? 'UNKNOWN'} ok lock_secure_mode session=${sid} (PRODUCTION MODE)` }));
                    locked = true;
                    break;
                  } catch (e2) {
                    lastErr = e2;
                    if (isContractCode(e2, 1) && attempt < 2) {
                      setChainLog((l2) =>
                        appendChainLog(l2, {
                          ts: Date.now(),
                          level: 'WARN',
                          msg: `lock_secure_mode retry ${attempt + 1}/2 after SessionNotFound (waiting chain visibility)`,
                        })
                      );
                      await sleep(900 * (attempt + 1));
                      continue;
                    }
                    throw e2;
                  }
                }
                if (!locked) throw lastErr ?? new Error('lock_secure_mode failed');
              } catch (e2) {
                const h2 = tryExtractTxHashFromError(e2);
                setChainLog((l2) => appendChainLog(l2, { ts: Date.now(), level: 'WARN', msg: `lock_secure_mode failed${h2 ? ` (hash=${h2})` : ''}: ${String(e2)}` }));
                markOnchainDesynced('lock_secure_mode failed');
              }
            }

            if (wantsSingleConfirm) {
              try {
                const sessionKey = Keypair.random();
                if (appConfig.networkPassphrase.includes('Test')) {
                  await fundSessionKeyOnTestnet(sessionKey.publicKey());
                }
                const dispatcherAllowMask = user === dispatcher ? (SESSION_ALLOW_DISPATCH | SESSION_ALLOW_RECHARGE | SESSION_ALLOW_LOCK_SECURE_MODE) : 0;
                const assassinAllowMask =
                  user === startAssassin
                    ? (
                      SESSION_ALLOW_COMMIT_LOCATION |
                      SESSION_ALLOW_SUBMIT_PING_PROOF |
                      SESSION_ALLOW_SUBMIT_MOVE_PROOF |
                      SESSION_ALLOW_SUBMIT_TURN_STATUS_PROOF |
                      SESSION_ALLOW_ASSASSIN_TICK
                    )
                    : 0;

                if (dispatcherAllowMask !== 0 || assassinAllowMask !== 0) {
                  const r3 = await bootstrapBackend.authorizeSessionKey({
                    owner: user,
                    sessionId: sid,
                    delegate: sessionKey.publicKey(),
                    ttlLedgers: Math.max(1, SESSION_KEY_TTL_LEDGERS),
                    maxWrites: Math.max(1, SESSION_KEY_MAX_WRITES),
                    dispatcherAllowMask,
                    assassinAllowMask,
                  });
                  setSessionKeySecret(sessionKey.secret());
                  setSessionKeyPublic(sessionKey.publicKey());
                  setChainLog((l2) =>
                    appendChainLog(l2, {
                      ts: Date.now(),
                      level: 'INFO',
                      msg: `TX ${r3.txHash ?? 'UNKNOWN'} ok authorize_session_key delegate=${sessionKey.publicKey().slice(0, 8)}... one-confirm mode enabled`,
                    })
                  );
                }
              } catch (e3) {
                const h3 = tryExtractTxHashFromError(e3);
                setChainLog((l2) =>
                  appendChainLog(l2, {
                    ts: Date.now(),
                    level: 'WARN',
                    msg: `authorize_session_key failed${h3 ? ` (hash=${h3})` : ''}; falling back to wallet-per-tx: ${String(e3)}. Check deployed contract includes authorize_session_key and redeploy/rebind if needed.`,
                  })
                );
              }
            }
          }
        } catch (e) {
          // Start the cutscene even when the TX fails so the player can still interact locally.
          setUiPhase('cutscene');
          const h = tryExtractTxHashFromError(e);
          setChainLog((l) => appendChainLog(l, { ts: Date.now(), level: 'ERROR', msg: `start_game failed${h ? ` (hash=${h})` : ''}: ${String(e)}` }));
          markOnchainDesynced('start_game failed');
        } finally {
          onchainBootstrapPendingRef.current = false;
          setOnchainBootstrapPending(false);
          onchainMutationLockRef.current = false;
          setOnchainMutationLocked(false);
        }
      })();
    }

    const enqueue = (events: readonly { delayMs: number; line: string }[], onDone?: () => void) => {
      let t = 0;
      for (const e of events) {
        t += e.delayMs;
        const id = window.setTimeout(() => {
          setSession((cur) => (cur ? { ...cur, log: [...cur.log, e.line].slice(-200) } : cur));
        }, t);
        timeouts.push(id);
      }
      if (onDone) {
        const id = window.setTimeout(onDone, t + 60);
        timeouts.push(id);
      }
    };


    // With a chain backend, the cutscene is started inside the async IIFE once the
    // wallet confirms the TX. Without a chain backend (local/sim mode), start immediately.
    if (!chainBackend) {
      setUiPhase('cutscene');
    }
    enqueue(getBootSequence());
  };

  const restartSyncedSession = () => {
    const nextSessionId = createRandomSessionId();
    setShowGameFinishedModal(false);
    setSessionId(nextSessionId);
    if (dialogueUnlockTimerRef.current !== null) {
      window.clearTimeout(dialogueUnlockTimerRef.current);
      dialogueUnlockTimerRef.current = null;
    }
    commandLockRef.current = false;
    setCommandLocked(false);
    releasePipelineLocks();
    pingProofRef.current = null;
    proofTurnRef.current = null;
    verifierBypassModeRef.current = false;
    setOnchainSessionHealthy(true);
    onchainSessionHealthyRef.current = true;
    start(nextSessionId);
  };

  const handleCreateNewSessionFromFinishedModal = () => {
    setShowGameFinishedModal(false);
    finishedModalSessionRef.current = null;
    restartSyncedSession();
  };

  const arm = () => {
    if (!session) return;

    // Two-player mode: verify assassin role for commitment
    if (session.mode === 'two-player' && user !== assassin) {
      setSession((cur) =>
        cur ? { ...cur, log: [...cur.log, `ERROR: ARM COMMITMENT requires ASSASSIN wallet (current: DISPATCHER)`].slice(-200) } : cur
      );
      setChainLog((l) =>
        appendChainLog(l, {
          ts: Date.now(),
          level: 'ERROR',
          msg: `ROLE MISMATCH: ARM COMMITMENT requires ASSASSIN wallet. Please switch to assassin (${assassin.slice(0,8)}...)`
        })
      );
      return;
    }

    setSession(commitLocation(session, assassin));

    // In 100% ZK flow, we do NOT use on-chain `commit_location` (it bypasses ZK).
    // The first verified ping proof will lock the commitment on-chain.
    const seed = `commit:${session.sessionId}:${assassin}`;
    setChainLog((l) =>
      appendChainLog(l, {
        ts: Date.now(),
        level: 'INFO',
        msg: `COMMIT_LOCATION skipped — first ping proof will set ZK commitment on-chain`,
      })
    );
  };

  const afterAction = (next: SessionState, opts?: { blind?: boolean; tower?: TowerId }) => {
    if (next.ended) {
      setSession(next);
      return;
    }

    // For single-player local sim, we can return the ping distance immediately (before Chad command).
    let outSession = next;
    if (opts?.tower && secret) {
      const s0 = encryption.decrypt(secret);
      const tower = towerXYFor(opts.tower, chainTowers);
      const dx = s0.assassin.x - tower.x;
      const dy = s0.assassin.y - tower.y;
      const d2 = dx * dx + dy * dy;
      outSession = { ...outSession, log: [...outSession.log, `STATUS... D2=${d2}`].slice(-200) };
      setPendingPing({ tower: opts.tower, d2 });
      setLastPingResult({ tower: opts.tower, d2, at: Date.now(), turn: next.turn });

      const seed = `ping:${next.sessionId}:${next.turn}:${opts.tower}`;
      setChainLog((l) =>
        appendChainLog(
          l,
          { ts: Date.now(), level: 'INFO', msg: `TX ${chainBackend ? 'PENDING' : fakeTxHash(seed)} ping tower=${opts.tower} cost=${next.pingCost} (on-chain dispatch deferred until command)` },
          240
        )
      );
      setChainLog((l) => appendChainLog(l, { ts: Date.now(), level: 'INFO', msg: `EVENT (SIM) PingDistance d2=${d2}` }, 240));
    } else if (opts?.blind) {
      setPendingPing(null);
      const seed = `recharge:${next.sessionId}:${next.turn}`;
      if (onchainGameplayEnabled) {
        setChainLog((l) =>
          appendChainLog(l, {
            ts: Date.now(),
            level: 'INFO',
            msg: `TX ${chainBackend ? 'PENDING' : fakeTxHash(seed)} recharge +${next.rechargeAmount} (on-chain dispatch deferred until command)`,
          })
        );
      } else if (chainBackend) {
        setChainLog((l) =>
          appendChainLog(l, {
            ts: Date.now(),
            level: 'WARN',
            msg: `ONCHAIN: recharge skipped (${onchainDisableReason ?? 'disabled'}) session=${next.sessionId} turn=${next.turn}`,
          })
        );
      } else {
        setChainLog((l) =>
          appendChainLog(l, {
            ts: Date.now(),
            level: 'INFO',
            msg: `TX ${fakeTxHash(seed)} invoke recharge +${next.rechargeAmount} contract=${chainCtx.contracts.game}`,
          })
        );
      }
    }

    setSession(outSession);

    const blind = !!opts?.blind;
    if (blind) {
      setRecharging(true);
      window.setTimeout(() => setRecharging(false), 700);
    }
  };

  const afterChadCommand = (queued: SessionState) => {
    if (queued.mode === 'two-player' && isDispatcherClient) {
      afterChadCommandTwoPlayerDispatcher(queued);
      return;
    }
    if (commandLockRef.current || chainPipelineLockRef.current || onchainMutationLockRef.current || onchainBootstrapPendingRef.current) return;
    // Prevent multiple commands being clicked in the same "command" window.
    commandLockRef.current = true;
    setCommandLocked(true);
    setSession(queued);
    if (queued.ended) {
      commandLockRef.current = false;
      setCommandLocked(false);
      return;
    }
    // Dispatcher two-player sessions also need local turn resolution (using the dispatcher's secret).
    // Only bail out if we truly lack the secret state.
    if (!secret) {
      commandLockRef.current = false;
      setCommandLocked(false);
      releasePipelineLocks();
      return;
    }
    let hadPingForThisTurn = false;

    if (onchainGameplayEnabled) {
      const cmd = queued.pending_chad_cmd ?? 'STAY';
      const ping = pendingPing;
      hadPingForThisTurn = !!ping;
      chainPipelineLockRef.current = true;
      setChainPipelineLocked(true);
      clearPipelineFailsafe();
      pipelineFailsafeRef.current = window.setTimeout(() => {
        if (chainPipelineLockRef.current || onchainMutationLockRef.current) {
          setChainLog((l2) =>
            appendChainLog(l2, {
              ts: Date.now(),
              level: 'WARN',
              msg: 'Pipeline watchdog: releasing stuck action locks after timeout.',
            })
          );
          releasePipelineLocks();
        }
      }, PIPELINE_WATCHDOG_MS);
      if (!ping) {
        setChainLog((l) =>
          appendChainLog(l, {
            ts: Date.now(),
            level: 'INFO',
            msg: `TX PENDING invoke recharge_with_command cmd=${cmd} (+battery, no ping)`,
          })
        );
        onchainMutationLockRef.current = true;
        setOnchainMutationLocked(true);
        pingProofRef.current = (async () => {
          try {
            const r = await (chainBackend as any).rechargeWithCommand({
              sessionId: queued.sessionId >>> 0,
              dispatcher,
              command: cmd,
            });
            setChainLog((l2) =>
              appendChainLog(l2, {
                ts: Date.now(),
                level: 'INFO',
                msg: `TX ${r.txHash ?? 'UNKNOWN'} ok recharge_with_command cmd=${cmd} session=${queued.sessionId >>> 0} turn=${queued.turn >>> 0}`,
              })
            );
            return false;
          } catch (e) {
            const h = tryExtractTxHashFromError(e);
            if (isSessionKeyAuthContractError(e)) {
              setSessionKeySecret(null);
              setSessionKeyPublic(null);
              setChainLog((l2) =>
                appendChainLog(l2, {
                  ts: Date.now(),
                  level: 'WARN',
                  msg: 'ONCHAIN: session-key authorization failed (#28-#32) during recharge_with_command. One-confirm mode disabled for this run.',
                })
              );
            } else if (isTxMalformedError(e)) {
              setSessionKeySecret(null);
              setSessionKeyPublic(null);
              setChainLog((l2) =>
                appendChainLog(l2, {
                  ts: Date.now(),
                  level: 'WARN',
                  msg: 'ONCHAIN: recharge_with_command transaction was malformed (txMalformed). One-confirm mode disabled for this run.',
                })
              );
            } else if (isDesyncError(e)) {
              markOnchainDesynced('recharge_with_command mismatch');
            }
            setChainLog((l2) =>
              appendChainLog(l2, {
                ts: Date.now(),
                level: 'ERROR',
                msg: `recharge_with_command failed${h ? ` (hash=${h})` : ''}: ${String(e)}`,
              })
            );
            throw e;
          } finally {
            onchainMutationLockRef.current = false;
            setOnchainMutationLocked(false);
          }
        })();
      } else {
        onchainMutationLockRef.current = true;
        setOnchainMutationLocked(true);
        const towerId = ping.tower === 'N' ? 0 : ping.tower === 'E' ? 1 : ping.tower === 'S' ? 2 : 3;
        const d2Local = ping.d2;
        const s0 = encryption.decrypt(secret);
        setChainLog((l) =>
          appendChainLog(l, {
            ts: Date.now(),
            level: 'INFO',
            msg: `TX PENDING invoke dispatch tower=${ping.tower} cmd=${cmd} (insecure clears ping)`,
          })
        );
        const pingProofPromise = (async () => {
          try {
            if (!s0) throw new Error('missing secret state (assassin coord)');
            let towers = chainTowers;
            if (!towers) {
              try {
                towers = await chainBackend.getTowers();
                setChainTowers(towers as any);
                setChainLog((l) =>
                  appendChainLog(l, {
                    ts: Date.now(),
                    level: 'INFO',
                    msg: `TOWERS N=(${(towers as any).n_x},${(towers as any).n_y}) E=(${(towers as any).e_x},${(towers as any).e_y}) S=(${(towers as any).s_x},${(towers as any).s_y}) W=(${(towers as any).w_x},${(towers as any).w_y})`,
                  })
                );
              } catch {
                towers = CONTRACT_DEFAULT_TOWERS;
                setChainLog((l) =>
                  appendChainLog(l, {
                    ts: Date.now(),
                    level: 'WARN',
                    msg: 'ONCHAIN: get_towers unavailable in bindings; using contract default towers',
                  })
                );
              }
            }
            const towerXY = towerXYFor(ping.tower, towers);
            const r1 = await chainBackend.dispatch({ sessionId: queued.sessionId, dispatcher, towerId, command: cmd });
            setChainLog((l) =>
              appendChainLog(l, {
                ts: Date.now(),
                level: 'INFO',
                msg: `TX ${r1.txHash ?? 'UNKNOWN'} ok dispatch tower=${ping.tower} cmd=${cmd} session=${queued.sessionId} turn=${queued.turn}`,
              })
            );
            
            let onchainNow: SessionState | null = null;
            for (let poll = 0; poll < 12; poll++) {
              try {
                const sPoll = await chainBackend.getSession(queued.sessionId);
                onchainNow = sPoll;
                const phaseOk = sPoll.phase === 'assassin';
                const pendingTowerOk = (sPoll.pending_ping_tower ?? null) === (towerId >>> 0);
                if (phaseOk && pendingTowerOk) break;
              } catch {
                // retry below
              }
              if (poll < 11) await sleep(700);
            }
            if (!onchainNow) {
              markOnchainDesynced('post-dispatch session fetch failed');
              return false;
            }
            const turn = onchainNow.turn >>> 0;
            proofTurnRef.current = turn;
            setChainLog((l) => appendChainLog(l, {
              ts: Date.now(),
              level: 'INFO',
              msg: `ONCHAIN SESSION: turn=${onchainNow.turn ?? '?'} phase=${onchainNow.phase ?? '?'} chad=(${onchainNow.chad_x ?? '?'},${onchainNow.chad_y ?? '?'}) alpha=${onchainNow.alpha ?? '?'} battery=${onchainNow.battery ?? '?'} ended=${onchainNow.ended ?? '?'}`,
            }));
            if (onchainNow.phase !== 'assassin' || (onchainNow.pending_ping_tower ?? null) !== (towerId >>> 0)) {
              markOnchainDesynced(
                `post-dispatch did not converge (phase=${onchainNow.phase}, pending_tower=${String(onchainNow.pending_ping_tower ?? null)}, expected_tower=${towerId >>> 0})`
              );
              return false;
            }
            if ((queued.turn >>> 0) !== turn) {
              setChainLog((l) =>
                appendChainLog(l, {
                  ts: Date.now(),
                  level: 'WARN',
                  msg: `ONCHAIN: authoritative turn differs from local simulation local=${queued.turn >>> 0} onchain=${turn}; using on-chain turn for proofs.`,
                })
              );
            }
            // DEV mode: do not submit heavy ZK proofs on-chain.
            // We rely on assassin_tick fallback to keep turn/phase aligned for demos.
            if (devModeSessionRef.current) {
              setChainLog((l) =>
                appendChainLog(l, {
                  ts: Date.now(),
                  level: 'WARN',
                  msg: `DEV MODE: skipping submit_ping_proof session=${queued.sessionId} turn=${turn} (assassin_tick fallback will advance turn)`,
                })
              );
              return false;
            }
            if (verifierBypassModeRef.current) {
              if (!onchainNow.insecure_mode) {
                verifierBypassModeRef.current = false;
                markOnchainDesynced('verifier bypass requested while session is secure mode');
                setChainLog((l) =>
                  appendChainLog(l, {
                    ts: Date.now(),
                    level: 'WARN',
                    msg: `ONCHAIN: verifier bypass refused (session insecure_mode=false) session=${queued.sessionId} turn=${turn}`,
                  })
                );
                return false;
              }
              setChainLog((l) =>
                appendChainLog(l, {
                  ts: Date.now(),
                  level: 'WARN',
                  msg: `ONCHAIN: verifier bypass active; skipping submit_ping_proof session=${queued.sessionId} turn=${turn}`,
                })
              );
              return false;
            }
            const pingProof = await prover.pingDistance({
              x: s0.assassin.x,
              y: s0.assassin.y,
              salt: s0.salt,
              tower_x: towerXY.x,
              tower_y: towerXY.y,
              session_id: queued.sessionId >>> 0,
              turn: turn >>> 0,
            });
            if (pingProof.d2 !== d2Local) {
              setChainLog((l) =>
                appendChainLog(l, {
                  ts: Date.now(),
                  level: 'WARN',
                  msg: `PING MISMATCH local_d2=${d2Local} prover_d2=${pingProof.d2} (tower=${ping.tower})`,
                })
              );
            }
            if (!zkVerifiersReady) {
              setChainLog((l) =>
                appendChainLog(
                  l,
                  {
                    ts: Date.now(),
                    level: 'WARN',
                    msg: `ONCHAIN: submit_ping_proof skipped (verifiers not configured) session=${queued.sessionId} turn=${turn}`,
                  },
                  240
                )
              );
              return false;
            }
            if (!onchainSessionHealthy) {
              setChainLog((l) =>
                appendChainLog(
                  l,
                  {
                    ts: Date.now(),
                    level: 'WARN',
                    msg: `ONCHAIN: submit_ping_proof skipped (session desynchronized) session=${queued.sessionId} turn=${turn}`,
                  },
                  240
                )
              );
              return false;
            }
            setChainLog((l) => appendChainLog(l, { ts: Date.now(), level: 'INFO', msg: `ZK ping_distance proof generated [${pingProof.publicInputs.length} public inputs]` }));
            // Guard against transient RPC/state lag: #7 (NotAssassinTurn) can occur if the
            // dispatch state hasn't propagated uniformly yet. Retry a few times before desync.
            let r2: Awaited<ReturnType<typeof chainBackend.submitPingProof>> | null = null;
            let lastPingErr: unknown = null;
            let lastObservedPhase: string | null = null;
            let lastObservedTurn: number | null = null;
            let lastObservedPendingTower: number | null = null;
            const maxPingSubmitAttempts = 6;
            for (let attempt = 0; attempt < maxPingSubmitAttempts; attempt++) {
              try {
                // Pre-submit phase sanity check (best-effort).
                let readyPhase = false;
                for (let p = 0; p < 8; p++) {
                  try {
                    const sBeforePing = await chainBackend.getSession(queued.sessionId);
                    lastObservedPhase = sBeforePing.phase;
                    lastObservedTurn = typeof sBeforePing.turn === 'number' ? (sBeforePing.turn >>> 0) : null;
                    lastObservedPendingTower =
                      typeof sBeforePing.pending_ping_tower === 'number'
                        ? (sBeforePing.pending_ping_tower >>> 0)
                        : null;
                    const phaseOk = sBeforePing.phase === 'assassin';
                    const pendingTowerOk = (sBeforePing.pending_ping_tower ?? null) === (towerId >>> 0);
                    if (phaseOk && pendingTowerOk) {
                      readyPhase = true;
                      break;
                    }
                  } catch {
                    // retry below
                  }
                  await sleep(700);
                }
                if (!readyPhase) {
                  throw new Error(
                    `submit_ping_proof precheck: on-chain state did not converge (phase=${String(lastObservedPhase)}, turn=${String(lastObservedTurn)}, pending_tower=${String(lastObservedPendingTower)}, expected_tower=${towerId >>> 0})`
                  );
                }

                r2 = await chainBackend.submitPingProof({
                  sessionId: queued.sessionId,
                  assassin,
                  towerId,
                  d2: pingProof.d2,
                  proof: pingProof.proof,
                  publicInputs: pingProof.publicInputs,
                });
                break;
              } catch (ePing) {
                lastPingErr = ePing;
                if (isContractCode(ePing, 7) && attempt < maxPingSubmitAttempts - 1) {
                  setChainLog((l2) =>
                    appendChainLog(l2, {
                      ts: Date.now(),
                      level: 'WARN',
                      msg: `submit_ping_proof retry ${attempt + 1}/${maxPingSubmitAttempts - 1} after NotAssassinTurn (phase=${String(lastObservedPhase)} turn=${String(lastObservedTurn)} pending_tower=${String(lastObservedPendingTower)})`,
                    })
                  );
                  await sleep(900 * (attempt + 1));
                  continue;
                }
                throw ePing;
              }
            }
            if (!r2) throw lastPingErr ?? new Error('submit_ping_proof failed');
            setChainLog((l) =>
              appendChainLog(l, {
                ts: Date.now(),
                level: 'INFO',
                msg: `TX ${r2.txHash ?? 'UNKNOWN'} ok submit_ping_proof d2=${pingProof.d2} session=${queued.sessionId} turn=${turn}`,
              })
            );

            // The remaining proofs (move + turn_status) are submitted after the local sim resolves,
            // because we need the assassin path + final d2_chad.
            return true;
          } catch (e) {
            const h = tryExtractTxHashFromError(e);
            const errText = String(e ?? '');
            if (errText.includes('pi_len')) {
              const secureUi = !devModeSessionRef.current;
              markOnchainDesynced(
                secureUi
                  ? 'secure-mode proof validation failed'
                  : 'ping verifier public-input layout mismatch (rewire verifiers / regenerate artifacts)'
              );
              setChainLog((l2) =>
                appendChainLog(l2, {
                  ts: Date.now(),
                  level: 'WARN',
                  msg: secureUi
                    ? 'ONCHAIN: proof validation failed in secure mode (details redacted). Bypass disabled; stopping local progression to avoid desync.'
                    : 'ONCHAIN: verifier reported public input length mismatch (pi_len). Expected verifier VK does not match current ping circuit/output layout.',
                })
              );
            } else if (isContractCode(e, 22)) {
              let insecureMode = false;
              try {
                const sChk = await chainBackend.getSession(queued.sessionId);
                insecureMode = !!sChk.insecure_mode;
              } catch {
                // Best-effort check; treat unknown as secure to avoid false bypass.
              }
              if (insecureMode) {
                if (!verifierBypassModeRef.current) {
                  verifierBypassModeRef.current = true;
                  setChainLog((l2) =>
                    appendChainLog(l2, {
                      ts: Date.now(),
                      level: 'WARN',
                      msg: 'ONCHAIN: verifier rejected proof (#22 InvalidProof). Session is insecure_mode=true, enabling temporary verifier bypass; assassin_tick fallback will keep turns synchronized.',
                    })
                  );
                }
              } else {
                markOnchainDesynced('ping verifier rejected proof in secure mode');
                setChainLog((l2) =>
                  appendChainLog(l2, {
                    ts: Date.now(),
                    level: 'WARN',
                    msg: 'ONCHAIN: verifier rejected proof (#22 InvalidProof) while session insecure_mode=false. Bypass disabled; stopping local progression to avoid desync.',
                  })
                );
              }
            } else if (isContractCode(e, 7)) {
              markOnchainDesynced('submit_ping_proof remained NotAssassinTurn after retries');
            } else if (isSessionKeyAuthContractError(e)) {
              markOnchainDesynced('session key authorization rejected during dispatch');
              setSessionKeySecret(null);
              setSessionKeyPublic(null);
              setChainLog((l2) =>
                appendChainLog(l2, {
                  ts: Date.now(),
                  level: 'WARN',
                  msg: 'ONCHAIN: session-key authorization failed (#28-#32) during dispatch. One-confirm mode disabled for this run.',
                })
              );
            } else if (isTxMalformedError(e)) {
              markOnchainDesynced('dispatch tx malformed');
              setSessionKeySecret(null);
              setSessionKeyPublic(null);
              setChainLog((l2) =>
                appendChainLog(l2, {
                  ts: Date.now(),
                  level: 'WARN',
                  msg: 'ONCHAIN: dispatch transaction was malformed (txMalformed). One-confirm mode disabled for this run.',
                })
              );
            } else if (isDesyncError(e)) {
              markOnchainDesynced('dispatch/proof mismatch');
            }
            setChainLog((l) =>
              appendChainLog(l, {
                ts: Date.now(),
                level: 'ERROR',
                msg: `dispatch pipeline failed${h ? ` (hash=${h})` : ''}: ${formatProofErrorForChainLog(e)}`,
              })
            );
            return false;
          } finally {
            // keep pendingPing until the local sim resolution completes
          }
        })();
        pingProofRef.current = pingProofPromise;
      }
    } else if (chainBackend) {
      setChainLog((l) =>
        appendChainLog(
          l,
          {
            ts: Date.now(),
            level: 'WARN',
            msg: `ONCHAIN: command pipeline skipped (${onchainDisableReason ?? 'disabled'}) session=${queued.sessionId} turn=${queued.turn}`,
          },
          240
        )
      );
    }

    window.setTimeout(() => {
      if (!secret || queued.ended) {
        commandLockRef.current = false;
        setCommandLocked(false);
        releasePipelineLocks();
        return;
      }

      const out = stepAfterDispatcherActionWithTrace(queued, encryption.decrypt(secret), DEFAULT_SIM_CONFIG);
      const rechargeDialogueLockMs = !hadPingForThisTurn
        ? estimateSubtitlePlaybackMs(getSubtitleConversationLinesForSession(out.session))
        : 0;
      const rollbackLocalStep = (reason: string) => {
        setSecret(secret);
        setSession(queued);
        setChainLog((l2) =>
          appendChainLog(l2, {
            ts: Date.now(),
            level: 'WARN',
            msg: `LOCAL: rolled back simulated turn (${reason}) to preserve chain/local sync`,
          })
        );
      };
      if (!onchainSessionHealthyRef.current) {
        commandLockRef.current = false;
        setCommandLocked(false);
        releasePipelineLocks();
        return;
      }
      setSecret(encryption.encrypt(out.secret));
      if (dialogueUnlockTimerRef.current !== null) {
        window.clearTimeout(dialogueUnlockTimerRef.current);
        dialogueUnlockTimerRef.current = null;
      }
      if (rechargeDialogueLockMs > 0) {
        dialogueUnlockTimerRef.current = window.setTimeout(() => {
          commandLockRef.current = false;
          setCommandLocked(false);
          dialogueUnlockTimerRef.current = null;
        }, rechargeDialogueLockMs);
      } else {
        commandLockRef.current = false;
        setCommandLocked(false);
      }
      setSession(out.session);
      setChainLog((l) =>
        appendChainLog(l, {
          ts: Date.now(),
          level: 'INFO',
          msg: `SIM RESOLVED cmd=${queued.pending_chad_cmd ?? 'STAY'} turn=${queued.turn} session=${queued.sessionId}`,
        })
      );
      // Log that the assassin moved — without exposing coordinates (sealed by ZK commitment).
      setChainLog((l) =>
        appendChainLog(l, {
          ts: Date.now(),
          level: 'INFO',
          msg: out.trace.path.length > 0
            ? `ASSASSIN ADVANCED ${out.trace.path.length} step${out.trace.path.length > 1 ? 's' : ''} [position sealed by ZK commitment]`
            : `ASSASSIN HELD POSITION [position sealed by ZK commitment]`,
        })
      );

      // After local sim resolves, submit move proofs for each step and then a turn_status proof.
      // NOTE: In two-player mode, this proof submission logic is currently skipped (secret is null).
      // For full two-player support, the assassin needs a separate UI to generate and submit proofs
      // using their own wallet and locally stored secret.
      if (onchainGameplayEnabled && out.trace.path.length) {
        const sessionId0 = queued.sessionId >>> 0;
        const turn0 = proofTurnRef.current ?? (queued.turn >>> 0);
        // Decrypt strictly for this proof generation scope
        const s0 = encryption.decrypt(secret);
        const salt0 = s0.salt;
        const path = out.trace.path;
        const from = out.trace.from;

        void (async () => {
          const maybeRunAssassinTickFallback = async (pingProofConfirmed: boolean, hadPingForTurn: boolean): Promise<boolean> => {
            const devFallback = shouldRunAssassinTickFallback({
              devMode: devModeSessionRef.current,
              pingProofConfirmed,
              zkVerifiersReady,
            });
            const verifierBypass = verifierBypassModeRef.current;
            // In no-ping turns (recharge path), move/status proofs are intentionally skipped.
            // We still need assassin_tick to advance on-chain phase/turn and avoid #6 NotDispatcherTurn.
            const rechargePathTurnSync = !hadPingForTurn;
            if (!devFallback && !rechargePathTurnSync && !verifierBypass) return true;
            try {
              const pre = await chainBackend.getSession(sessionId0);
              if (pre.phase !== 'assassin') {
                setChainLog((l2) =>
                  appendChainLog(l2, {
                    ts: Date.now(),
                    level: 'WARN',
                    msg: `assassin_tick skipped (${rechargePathTurnSync ? 'recharge path' : verifierBypass ? 'verifier bypass' : 'dev fallback'}) because on-chain phase=${pre.phase}`,
                  })
                );
                return true;
              }
              const rTick = await chainBackend.assassinTick({
                sessionId: sessionId0,
                assassin,
                d2Chad: 0,
              });
              const reason = rechargePathTurnSync ? 'recharge path' : verifierBypass ? 'verifier bypass' : 'dev fallback';
              setChainLog((l2) =>
                appendChainLog(l2, {
                  ts: Date.now(),
                  level: 'INFO',
                  msg: `TX ${rTick.txHash ?? 'UNKNOWN'} ok assassin_tick (${reason}) session=${sessionId0} -> turn ${turn0 + 1}`,
                })
              );
              return true;
            } catch (e) {
              const h = tryExtractTxHashFromError(e);
              const reason = rechargePathTurnSync ? 'recharge path' : verifierBypass ? 'verifier bypass' : 'dev fallback';
              markOnchainDesynced(`assassin_tick fallback failed (${reason})`);
              rollbackLocalStep(`assassin_tick fallback failed (${reason})`);
              setChainLog((l2) =>
                appendChainLog(l2, {
                  ts: Date.now(),
                  level: 'WARN',
                  msg: `assassin_tick (${reason}) failed${h ? ` (hash=${h})` : ''}: ${String(e)}`,
                })
              );
              return false;
            }
          };

          try {
            const pingOk = pingProofRef.current ? await pingProofRef.current : false;
            if (!pingOk) {
              if (hadPingForThisTurn) {
                setChainLog((l2) =>
                  appendChainLog(l2, {
                    ts: Date.now(),
                    level: 'WARN',
                    msg: `ONCHAIN: skipping move/status proofs (ping proof not confirmed) session=${sessionId0} turn=${turn0}`,
                  })
                );
                await maybeRunAssassinTickFallback(false, hadPingForThisTurn);
                return;
              }

              // Recharge path: no ping this turn, but we still need to submit move proofs
              // so the on-chain commitment stays in sync. Without this, the next ping turn
              // would fail with CommitmentMismatch (#20).
              setChainLog((l2) =>
                appendChainLog(l2, {
                  ts: Date.now(),
                  level: 'INFO',
                  msg: `ONCHAIN: recharge path — submitting move proofs to keep commitment in sync session=${sessionId0} turn=${turn0}`,
                })
              );

              // In DEV mode or verifier bypass, skip move proofs and use assassin_tick fallback
              if (devModeSessionRef.current || verifierBypassModeRef.current) {
                const reason = devModeSessionRef.current ? 'dev mode' : 'verifier bypass';
                setChainLog((l2) =>
                  appendChainLog(l2, {
                    ts: Date.now(),
                    level: 'WARN',
                    msg: `ONCHAIN: skipping recharge-path move proofs (${reason}) session=${sessionId0} turn=${turn0}`,
                  })
                );
                await maybeRunAssassinTickFallback(false, hadPingForThisTurn);
                return;
              }

              // Generate all move proofs in parallel, then batch-submit.
              const moveProofInputs = path.map((step, i) => ({
                x_old: i === 0 ? from.x : path[i - 1].x,
                y_old: i === 0 ? from.y : path[i - 1].y,
                salt_old: salt0,
                x_new: step.x,
                y_new: step.y,
                salt_new: salt0,
                session_id: sessionId0,
                turn: turn0,
              }));
              const moveProofs = await Promise.all(moveProofInputs.map((inp) => prover.moveProof(inp)));
              setChainLog((l2) =>
                appendChainLog(l2, {
                  ts: Date.now(),
                  level: 'INFO',
                  msg: `ZK ${moveProofs.length} move_proofs generated in parallel (recharge path)`,
                })
              );
              if ('submitMultiMoveProof' in chainBackend && moveProofs.length > 0) {
                const rMv = await (chainBackend as any).submitMultiMoveProof({
                  sessionId: sessionId0,
                  assassin,
                  entries: moveProofs.map((mv) => ({
                    newCommitment: mv.commitmentNew,
                    proof: mv.proof,
                    publicInputs: mv.publicInputs,
                  })),
                });
                setChainLog((l2) =>
                  appendChainLog(l2, {
                    ts: Date.now(),
                    level: 'INFO',
                    msg: `TX ${rMv.txHash ?? 'UNKNOWN'} ok submit_multi_move_proof (recharge path, ${moveProofs.length} steps)`,
                  })
                );
              } else {
                for (const mv of moveProofs) {
                  const rMv = await chainBackend.submitMoveProof({
                    sessionId: sessionId0,
                    assassin,
                    newCommitment: mv.commitmentNew,
                    proof: mv.proof,
                    publicInputs: mv.publicInputs,
                  });
                  setChainLog((l2) =>
                    appendChainLog(l2, {
                      ts: Date.now(),
                      level: 'INFO',
                      msg: `TX ${rMv.txHash ?? 'UNKNOWN'} ok submit_move_proof (recharge path) [ZK-verified step, coordinates sealed]`,
                    })
                  );
                }
              }

              // After move proofs, call assassin_tick to advance the turn
              // (no turn_status proof needed on recharge path since there's no ping)
              try {
                const pre = await chainBackend.getSession(sessionId0);
                if (pre.phase === 'assassin') {
                  const rTick = await chainBackend.assassinTick({
                    sessionId: sessionId0,
                    assassin,
                    d2Chad: 0,
                  });
                  setChainLog((l2) =>
                    appendChainLog(l2, {
                      ts: Date.now(),
                      level: 'INFO',
                      msg: `TX ${rTick.txHash ?? 'UNKNOWN'} ok assassin_tick (recharge path + move proofs) session=${sessionId0} -> turn ${turn0 + 1}`,
                    })
                  );
                }
              } catch (eTick) {
                const h = tryExtractTxHashFromError(eTick);
                if (isDesyncError(eTick)) markOnchainDesynced('assassin_tick after recharge move proofs');
                setChainLog((l2) =>
                  appendChainLog(l2, {
                    ts: Date.now(),
                    level: 'WARN',
                    msg: `assassin_tick (recharge path) failed${h ? ` (hash=${h})` : ''}: ${String(eTick)}`,
                  })
                );
              }
              return;
            }
            // Generate all move proofs in parallel, then batch-submit.
            {
              const moveProofInputs = path.map((step, i) => ({
                x_old: i === 0 ? from.x : path[i - 1].x,
                y_old: i === 0 ? from.y : path[i - 1].y,
                salt_old: salt0,
                x_new: step.x,
                y_new: step.y,
                salt_new: salt0,
                session_id: sessionId0,
                turn: turn0,
              }));
              const moveProofs = await Promise.all(moveProofInputs.map((inp) => prover.moveProof(inp)));
              setChainLog((l2) =>
                appendChainLog(l2, {
                  ts: Date.now(),
                  level: 'INFO',
                  msg: `ZK ${moveProofs.length} move_proofs generated in parallel (ping path)`,
                })
              );
              if ('submitMultiMoveProof' in chainBackend && moveProofs.length > 0) {
                const rMv = await (chainBackend as any).submitMultiMoveProof({
                  sessionId: sessionId0,
                  assassin,
                  entries: moveProofs.map((mv) => ({
                    newCommitment: mv.commitmentNew,
                    proof: mv.proof,
                    publicInputs: mv.publicInputs,
                  })),
                });
                setChainLog((l2) =>
                  appendChainLog(l2, {
                    ts: Date.now(),
                    level: 'INFO',
                    msg: `TX ${rMv.txHash ?? 'UNKNOWN'} ok submit_multi_move_proof (ping path, ${moveProofs.length} steps)`,
                  })
                );
              } else {
                for (const mv of moveProofs) {
                  const rMv = await chainBackend.submitMoveProof({
                    sessionId: sessionId0,
                    assassin,
                    newCommitment: mv.commitmentNew,
                    proof: mv.proof,
                    publicInputs: mv.publicInputs,
                  });
                  setChainLog((l2) =>
                    appendChainLog(l2, {
                      ts: Date.now(),
                      level: 'INFO',
                      msg: `TX ${rMv.txHash ?? 'UNKNOWN'} ok submit_move_proof [ZK-verified step, coordinates sealed]`,
                    })
                  );
                }
              }
            }

            // Always bind turn_status proof to authoritative on-chain Chad coordinates.
            // In Secure Mode, we fetch from the chain to ensure parity.
            let cx = out.session.chad_x ?? 0;
            let cy = out.session.chad_y ?? 0;
            let chadCoordSource: 'on-chain' | 'frontend-sim' = 'frontend-sim';

            try {
              const onchainSession = await chainBackend.getSession(sessionId0);
              if (typeof onchainSession.chad_x === 'number' && typeof onchainSession.chad_y === 'number') {
                cx = onchainSession.chad_x;
                cy = onchainSession.chad_y;
                chadCoordSource = 'on-chain';
              }
            } catch (e) {
              // If getSession fails, we use the local sim coordinates (already in cx, cy).
              // This is safe because the contract now uses real grid coordinates.
            }

            setChainLog((l2) =>
              appendChainLog(l2, {
                ts: Date.now(),
                level: 'INFO',
                msg: `turn_status coord source=${chadCoordSource} cx=${cx} cy=${cy} session=${sessionId0} turn=${turn0}`,
              })
            );

            const finalPos = path.length > 0 ? path[path.length - 1] : from;
            const st = await prover.turnStatus({
              x: finalPos.x,
              y: finalPos.y,
              salt: salt0,
              cx,
              cy,
              session_id: sessionId0,
              turn: turn0,
            });
            setChainLog((l2) =>
              appendChainLog(l2, {
                ts: Date.now(),
                level: 'INFO',
                msg: `ZK turn_status proof generated bytes=${st.proof.length} public_inputs=${st.publicInputs.length}`,
              })
            );
            const rSt = await chainBackend.submitTurnStatusProof({
              sessionId: sessionId0,
              assassin,
              d2Chad: st.d2Chad,
              proof: st.proof,
              publicInputs: st.publicInputs,
            });
            setChainLog((l2) =>
              appendChainLog(l2, {
                ts: Date.now(),
                level: 'INFO',
                msg: `TX ${rSt.txHash ?? 'UNKNOWN'} ok submit_turn_status_proof d2_chad=${st.d2Chad} advance_turn`,
              })
            );
          } catch (e) {
            const h = tryExtractTxHashFromError(e);
            if (isContractCode(e, 22)) {
              let insecureMode = false;
              try {
                const sChk = await chainBackend.getSession(sessionId0);
                insecureMode = !!sChk.insecure_mode;
              } catch {
                // Best-effort check; treat unknown as secure to avoid false bypass.
              }
              if (insecureMode) {
                if (!verifierBypassModeRef.current) {
                  verifierBypassModeRef.current = true;
                  setChainLog((l2) =>
                    appendChainLog(l2, {
                      ts: Date.now(),
                      level: 'WARN',
                      msg: 'ONCHAIN: move/status verifier rejected proof (#22 InvalidProof). Session is insecure_mode=true, enabling temporary verifier bypass.',
                    })
                  );
                }
                await maybeRunAssassinTickFallback(false, hadPingForThisTurn);
              } else {
                markOnchainDesynced('move/status verifier rejected proof in secure mode');
                rollbackLocalStep('verifier rejected move/status proof in secure mode');
                setChainLog((l2) =>
                  appendChainLog(l2, {
                    ts: Date.now(),
                    level: 'WARN',
                    msg: 'ONCHAIN: move/status verifier rejected proof (#22 InvalidProof) while session insecure_mode=false. Bypass disabled; stopping local progression to avoid desync.',
                  })
                );
              }
            } else if (isDesyncError(e)) {
              markOnchainDesynced('move/status proof mismatch');
            }
            setChainLog((l2) =>
              appendChainLog(l2, {
                ts: Date.now(),
                level: 'ERROR',
                msg: `proof pipeline failed${h ? ` (hash=${h})` : ''}: ${formatProofErrorForChainLog(e)}`,
              })
            );
          } finally {
            pingProofRef.current = null;
            proofTurnRef.current = null;
            releasePipelineLocks();
          }
        })();
      } else {
        if (onchainGameplayEnabled) {
          void (async () => {
            try {
              const pingOk = pingProofRef.current ? await pingProofRef.current : false;
              const devFallback = shouldRunAssassinTickFallback({
                devMode: devModeSessionRef.current,
                pingProofConfirmed: false,
                zkVerifiersReady,
              });
              const verifierBypass = verifierBypassModeRef.current;
              const rechargePathTurnSync = !hadPingForThisTurn;
              if (!pingOk && (devFallback || rechargePathTurnSync || verifierBypass)) {
                try {
                  const pre = await chainBackend.getSession(queued.sessionId >>> 0);
                  if (pre.phase !== 'assassin') {
                    setChainLog((l2) =>
                      appendChainLog(l2, {
                        ts: Date.now(),
                        level: 'WARN',
                        msg: `assassin_tick skipped (${rechargePathTurnSync ? 'recharge path' : verifierBypass ? 'verifier bypass' : 'dev fallback'}) because on-chain phase=${pre.phase}`,
                      })
                    );
                    return;
                  }
                  const rTick = await chainBackend.assassinTick({
                    sessionId: queued.sessionId >>> 0,
                    assassin,
                    d2Chad: 0,
                  });
                  const reason = rechargePathTurnSync ? 'recharge path' : verifierBypass ? 'verifier bypass' : 'dev fallback';
                  setChainLog((l2) =>
                    appendChainLog(l2, {
                      ts: Date.now(),
                      level: 'INFO',
                      msg: `TX ${rTick.txHash ?? 'UNKNOWN'} ok assassin_tick (${reason}) session=${queued.sessionId >>> 0} -> turn ${(queued.turn >>> 0) + 1}`,
                    })
                  );
                } catch (e) {
                  const h = tryExtractTxHashFromError(e);
                  markOnchainDesynced('assassin_tick fallback mismatch');
                  rollbackLocalStep('assassin_tick fallback mismatch');
                  const reason = rechargePathTurnSync ? 'recharge path' : verifierBypass ? 'verifier bypass' : 'dev fallback';
                  setChainLog((l2) =>
                    appendChainLog(l2, {
                      ts: Date.now(),
                      level: 'WARN',
                      msg: `assassin_tick (${reason}) failed${h ? ` (hash=${h})` : ''}: ${String(e)}`,
                    })
                  );
                }
              }
            } finally {
              pingProofRef.current = null;
              proofTurnRef.current = null;
              releasePipelineLocks();
            }
          })();
        } else {
          pingProofRef.current = null;
          proofTurnRef.current = null;
          releasePipelineLocks();
        }
      }
    }, 700);
  };

  // ── Lobby handlers ────────────────────────────────────────────────────────

  const handleLobbyComplete = (params: { sessionId: number; dispatcher: string; assassin: string; role: 'dispatcher' | 'assassin' }) => {
    setLobbyRole(params.role);
    if (params.role === 'dispatcher') {
      // Dispatcher: set addresses then trigger the full start() flow (on-chain bootstrap + wallet modal)
      setMode('two-player');
      setDispatcherAddress(params.dispatcher);
      setAssassinAddress(params.assassin);
      setSessionId(params.sessionId);
      start(params.sessionId, { mode: 'two-player', assassin: params.assassin });
    } else {
      // Assassin: create a local session and wait for dispatcher's on-chain tx
      joinAsAssassin(params.sessionId, params.dispatcher, params.assassin);
    }
  };

  /** Assassin joins: set up local state and go to cutscene (no on-chain tx). */
  const joinAsAssassin = (sid: number, dispatcherAddr: string, assassinAddr: string) => {
    if (dialogueUnlockTimerRef.current !== null) {
      window.clearTimeout(dialogueUnlockTimerRef.current);
      dialogueUnlockTimerRef.current = null;
    }
    commandLockRef.current = false;
    setCommandLocked(false);
    while (timeouts.length) {
      const id = timeouts.pop();
      if (typeof id === 'number') window.clearTimeout(id);
    }

    setMode('two-player');
    setDispatcherAddress(dispatcherAddr);
    setAssassinAddress(assassinAddr);
    setSessionId(sid);
    activeSessionIdRef.current = sid;
    const sessionKeyPollToken = ++sessionKeyPollTokenRef.current;
    setSessionKeySecret(null);
    setSessionKeyPublic(null);

    const s = createSynchronizedSession({ sessionId: sid, mode: 'two-player', dispatcher: dispatcherAddr, assassin: assassinAddr });
    const armedSession = commitLocation(s, assassinAddr);
    setSession({ ...armedSession, log: [] });
    setLastPingResult(null);
    const chad = { x: s.chad_x ?? 5, y: s.chad_y ?? 5 };
    const secretSeed = deriveTwoPlayerSeed(sid, dispatcherAddr, assassinAddr, 'secret');
    setSecret(encryption.encrypt(createSecret(secretSeed, chad)));

    devModeSessionRef.current = false;
    verifierBypassModeRef.current = false;
    proofTurnRef.current = null;
    setOnchainSessionHealthy(true);
    onchainSessionHealthyRef.current = true;
    onchainBootstrapPendingRef.current = false;
    setOnchainBootstrapPending(false);
    setChainLog([
      { ts: Date.now(), level: 'INFO', msg: `CHAIN TERMINAL ONLINE (${chainCtx.network}) [ASSASSIN MODE]` },
      { ts: Date.now(), level: 'INFO', msg: `SESSION=${sid} DISPATCHER=${dispatcherAddr.slice(0, 10)}...` },
    ]);

    setUiPhase('cutscene');

    const wantsSingleConfirm = ENABLE_SESSION_KEY_MODE && wallet.walletType === 'wallet' && user !== 'GUEST';
    if (wantsSingleConfirm && user === assassinAddr) {
      void (async () => {
        const getSigner = props.getContractSigner;
        if (!getSigner) return;

        const stillCurrentSession = () =>
          activeSessionIdRef.current === sid && sessionKeyPollTokenRef.current === sessionKeyPollToken;

        const authBackend = new ChainBackend(
          { rpcUrl: appConfig.rpcUrl, networkPassphrase: appConfig.networkPassphrase, contractId: appConfig.proofOfLifeId },
          getSigner(),
          user
        );

        try {
          let sessionVisible = false;
          for (let i = 0; i < SESSION_KEY_VISIBILITY_POLL_ATTEMPTS; i++) {
            if (!stillCurrentSession()) return;
            try {
              const sCheck = await authBackend.getSession(sid);
              if (typeof sCheck.sessionId === 'number') {
                sessionVisible = true;
                break;
              }
            } catch {
              // Dispatcher may still be waiting on testnet settlement.
            }
            if (i < SESSION_KEY_VISIBILITY_POLL_ATTEMPTS - 1) await sleep(SESSION_KEY_POLL_INTERVAL_MS);
          }

          if (!stillCurrentSession()) return;
          if (!sessionVisible) {
            setChainLog((l) =>
              appendChainLog(l, {
                ts: Date.now(),
                level: 'WARN',
                msg: `SESSION KEY authorize skipped for assassin (session not visible yet) session=${sid}; wallet-per-tx mode will continue`,
              })
            );
            return;
          }

          const sessionKey = Keypair.random();
          if (appConfig.networkPassphrase.includes('Test')) {
            await fundSessionKeyOnTestnet(sessionKey.publicKey());
          }
          if (!stillCurrentSession()) return;

          const assassinAllowMask =
            SESSION_ALLOW_COMMIT_LOCATION |
            SESSION_ALLOW_SUBMIT_PING_PROOF |
            SESSION_ALLOW_SUBMIT_MOVE_PROOF |
            SESSION_ALLOW_SUBMIT_TURN_STATUS_PROOF |
            SESSION_ALLOW_ASSASSIN_TICK;

          const r = await authBackend.authorizeSessionKey({
            owner: assassinAddr,
            sessionId: sid,
            delegate: sessionKey.publicKey(),
            ttlLedgers: Math.max(1, SESSION_KEY_TTL_LEDGERS),
            maxWrites: Math.max(1, SESSION_KEY_MAX_WRITES),
            dispatcherAllowMask: 0,
            assassinAllowMask,
          });

          if (!stillCurrentSession()) return;
          setSessionKeySecret(sessionKey.secret());
          setSessionKeyPublic(sessionKey.publicKey());
          setChainLog((l) =>
            appendChainLog(l, {
              ts: Date.now(),
              level: 'INFO',
              msg: `TX ${r.txHash ?? 'UNKNOWN'} ok authorize_session_key delegate=${sessionKey.publicKey().slice(0, 8)}... [ASSASSIN] one-confirm mode enabled`,
            })
          );
        } catch (e) {
          if (!stillCurrentSession()) return;
          const h = tryExtractTxHashFromError(e);
          setChainLog((l) =>
            appendChainLog(l, {
              ts: Date.now(),
              level: 'WARN',
              msg: `assassin authorize_session_key failed${h ? ` (hash=${h})` : ''}; wallet-per-tx mode will continue: ${String(e)}`,
            })
          );
        }
      })();
    }
  };

  const clearAssassinPath = () => {
    setAssassinPlannedPath([]);
    setAssassinTurnError(null);
  };

  const undoAssassinPathStep = () => {
    setAssassinPlannedPath((cur) => (cur.length ? cur.slice(0, -1) : cur));
    setAssassinTurnError(null);
  };

  const handleAssassinMapTileClick = (coord: Coord) => {
    if (!assassinTurnPrepared) return;
    if (assassinTurnBusy || assassinSubmitBusyRef.current) return;
    if (controlsLocked) return;

    const last = assassinPlannedPath.length ? assassinPlannedPath[assassinPlannedPath.length - 1] : null;
    const anchor = last ?? assassinTurnPrepared.from;
    if (anchor.x === coord.x && anchor.y === coord.y) {
      if (assassinPlannedPath.length) undoAssassinPathStep();
      return;
    }

    const backtrackTarget = assassinPlannedPath.length >= 2
      ? assassinPlannedPath[assassinPlannedPath.length - 2]!
      : assassinTurnPrepared.from;
    if (assassinPlannedPath.length >= 1 && backtrackTarget.x === coord.x && backtrackTarget.y === coord.y) {
      undoAssassinPathStep();
      return;
    }

    const nextPath = [...assassinPlannedPath, { x: coord.x, y: coord.y }];
    const validation = validateManualAssassinPath(assassinTurnPrepared, nextPath, DEFAULT_SIM_CONFIG);
    if (!validation.ok) {
      setAssassinTurnError(validation.reason ?? 'Invalid assassin path');
      return;
    }
    setAssassinTurnError(null);
    setAssassinPlannedPath(nextPath);
  };

  const afterChadCommandTwoPlayerDispatcher = (queued: SessionState) => {
    if (commandLockRef.current || chainPipelineLockRef.current || onchainMutationLockRef.current || onchainBootstrapPendingRef.current) return;
    commandLockRef.current = true;
    setCommandLocked(true);
    setSession(queued);

    if (queued.ended) {
      commandLockRef.current = false;
      setCommandLocked(false);
      return;
    }

    // Local/SIM fallback keeps legacy auto-resolution behavior (two-player manual control targets on-chain mode).
    if (!onchainGameplayEnabled || !chainBackend) {
      if (secret) {
        const out = stepAfterDispatcherActionWithTrace(queued, encryption.decrypt(secret), DEFAULT_SIM_CONFIG);
        setSecret(encryption.encrypt(out.secret));
        setSession(out.session);
      }
      commandLockRef.current = false;
      setCommandLocked(false);
      releasePipelineLocks();
      return;
    }

    const cmd = queued.pending_chad_cmd ?? 'STAY';
    const ping = pendingPing;
    chainPipelineLockRef.current = true;
    setChainPipelineLocked(true);
    clearPipelineFailsafe();
    pipelineFailsafeRef.current = window.setTimeout(() => {
      if (chainPipelineLockRef.current || onchainMutationLockRef.current) {
        setChainLog((l2) =>
          appendChainLog(l2, {
            ts: Date.now(),
            level: 'WARN',
            msg: 'Pipeline watchdog: releasing stuck action locks after timeout.',
          })
        );
        releasePipelineLocks();
        commandLockRef.current = false;
        setCommandLocked(false);
      }
    }, PIPELINE_WATCHDOG_MS);

    onchainMutationLockRef.current = true;
    setOnchainMutationLocked(true);

    void (async () => {
      try {
        if (!ping) {
          setChainLog((l) =>
            appendChainLog(l, {
              ts: Date.now(),
              level: 'INFO',
              msg: `TX PENDING invoke recharge_with_command cmd=${cmd} (+battery, no ping)`,
            })
          );
          const r = await (chainBackend as any).rechargeWithCommand({
            sessionId: queued.sessionId >>> 0,
            dispatcher,
            command: cmd,
          });
          setChainLog((l) =>
            appendChainLog(l, {
              ts: Date.now(),
              level: 'INFO',
              msg: `TX ${r.txHash ?? 'UNKNOWN'} ok recharge_with_command cmd=${cmd} session=${queued.sessionId >>> 0} turn=${queued.turn >>> 0}`,
            })
          );
        } else {
          const towerId = ping.tower === 'N' ? 0 : ping.tower === 'E' ? 1 : ping.tower === 'S' ? 2 : 3;
          setChainLog((l) =>
            appendChainLog(l, {
              ts: Date.now(),
              level: 'INFO',
              msg: `TX PENDING invoke dispatch tower=${ping.tower} cmd=${cmd}`,
            })
          );
          const r = await chainBackend.dispatch({ sessionId: queued.sessionId, dispatcher, towerId, command: cmd });
          setChainLog((l) =>
            appendChainLog(l, {
              ts: Date.now(),
              level: 'INFO',
              msg: `TX ${r.txHash ?? 'UNKNOWN'} ok dispatch tower=${ping.tower} cmd=${cmd} session=${queued.sessionId} turn=${queued.turn}`,
            })
          );
        }

        let onchainNow: SessionState | null = null;
        for (let poll = 0; poll < 12; poll++) {
          try {
            const sPoll = await chainBackend.getSession(queued.sessionId);
            onchainNow = sPoll;
            if (sPoll.phase === 'assassin') break;
          } catch {
            // retry
          }
          if (poll < 11) await sleep(700);
        }
        if (onchainNow) {
          setSession((cur) => (cur && cur.mode === 'two-player'
            ? mergeOnchainStateIntoTwoPlayerLocal(cur, { ...onchainNow!, mode: 'two-player', dispatcher: cur.dispatcher, assassin: cur.assassin })
            : cur));
        }
        setChainLog((l) =>
          appendChainLog(l, {
            ts: Date.now(),
            level: 'INFO',
            msg: `DISPATCHER TURN COMPLETE — waiting for assassin turn (${queued.sessionId}:${queued.turn})`,
          })
        );
      } catch (e) {
        const h = tryExtractTxHashFromError(e);
        if (isSessionKeyAuthContractError(e)) {
          setSessionKeySecret(null);
          setSessionKeyPublic(null);
          setChainLog((l2) =>
            appendChainLog(l2, {
              ts: Date.now(),
              level: 'WARN',
              msg: 'ONCHAIN: session-key authorization failed during dispatcher command. One-confirm mode disabled for this run.',
            })
          );
        } else if (isTxMalformedError(e)) {
          setSessionKeySecret(null);
          setSessionKeyPublic(null);
          setChainLog((l2) =>
            appendChainLog(l2, {
              ts: Date.now(),
              level: 'WARN',
              msg: 'ONCHAIN: dispatcher command transaction was malformed (txMalformed). One-confirm mode disabled for this run.',
            })
          );
        } else if (isDesyncError(e)) {
          markOnchainDesynced('dispatcher command mismatch');
        }
        setChainLog((l) =>
          appendChainLog(l, {
            ts: Date.now(),
            level: 'ERROR',
            msg: `dispatcher command failed${h ? ` (hash=${h})` : ''}: ${String(e)}`,
          })
        );
      } finally {
        onchainMutationLockRef.current = false;
        setOnchainMutationLocked(false);
        commandLockRef.current = false;
        setCommandLocked(false);
        pingProofRef.current = null;
        proofTurnRef.current = null;
        releasePipelineLocks();
      }
    })();
  };

  const submitAssassinTurn = async () => {
    if (!session || !chainBackend || !chainBackend) return;
    if (!assassinTurnPrepared || !secretState) return;
    if (!assassinPathValidation?.ok) {
      setAssassinTurnError(assassinPathValidation?.reason ?? 'Invalid assassin path');
      return;
    }
    if (assassinSubmitBusyRef.current || assassinTurnBusy) return;
    if (user !== assassin) {
      setAssassinTurnError('Assassin wallet required');
      setChainLog((l) =>
        appendChainLog(l, {
          ts: Date.now(),
          level: 'ERROR',
          msg: `ROLE MISMATCH: ASSASSIN TURN requires assassin wallet (${assassin.slice(0, 8)}...)`,
        })
      );
      return;
    }

    let out: { session: SessionState; secret: SecretState; trace: { path: Coord[]; from: Coord; to: Coord } };
    try {
      out = applyManualAssassinPath(assassinTurnPrepared, assassinPlannedPath, DEFAULT_SIM_CONFIG);
    } catch (e) {
      setAssassinTurnError(String(e));
      return;
    }

    assassinSubmitBusyRef.current = true;
    setAssassinTurnBusy(true);
    setAssassinTurnError(null);

    chainPipelineLockRef.current = true;
    setChainPipelineLocked(true);
    onchainMutationLockRef.current = true;
    setOnchainMutationLocked(true);

    const sessionId0 = session.sessionId >>> 0;
    const path = out.trace.path;
    const from = out.trace.from;
    const s0 = assassinTurnPrepared.secret;
    const hadPing = typeof session.pending_ping_tower === 'number';
    const pendingTowerIdx = typeof session.pending_ping_tower === 'number' ? (session.pending_ping_tower >>> 0) : null;

    const maybeRunAssassinTickFallback = async (reason: 'recharge path' | 'dev fallback' | 'verifier bypass' | 'ping proof unavailable', d2Chad = 0): Promise<void> => {
      const pre = await chainBackend.getSession(sessionId0);
      if (pre.phase !== 'assassin') {
        setChainLog((l) =>
          appendChainLog(l, {
            ts: Date.now(),
            level: 'WARN',
            msg: `assassin_tick skipped (${reason}) because on-chain phase=${pre.phase}`,
          })
        );
        return;
      }
      const rTick = await chainBackend.assassinTick({
        sessionId: sessionId0,
        assassin,
        d2Chad,
      });
      setChainLog((l) =>
        appendChainLog(l, {
          ts: Date.now(),
          level: 'INFO',
          msg: `TX ${rTick.txHash ?? 'UNKNOWN'} ok assassin_tick (${reason}) session=${sessionId0}`,
        })
      );
    };

    try {
      setChainLog((l) =>
        appendChainLog(l, {
          ts: Date.now(),
          level: 'INFO',
          msg: `ASSASSIN TURN READY path_steps=${path.length} turn=${session.turn >>> 0} session=${sessionId0}`,
        })
      );

      const onchainStart = await chainBackend.getSession(sessionId0);
      if (onchainStart.phase !== 'assassin') {
        throw new Error(`on-chain phase is ${onchainStart.phase}; expected assassin`);
      }
      const turn0 = onchainStart.turn >>> 0;
      let pingProofConfirmed = false;

      if (hadPing && pendingTowerIdx !== null) {
        const towerIdLabel: TowerId = pendingTowerIdx === 0 ? 'N' : pendingTowerIdx === 1 ? 'E' : pendingTowerIdx === 2 ? 'S' : 'W';
        let towers = chainTowers;
        if (!towers) {
          try {
            towers = await chainBackend.getTowers();
            setChainTowers(towers as any);
          } catch {
            towers = CONTRACT_DEFAULT_TOWERS;
          }
        }
        const towerXY = towerXYFor(towerIdLabel, towers);
        const dx = s0.assassin.x - towerXY.x;
        const dy = s0.assassin.y - towerXY.y;
        const d2Local = (dx * dx) + (dy * dy);

        if (devModeSessionRef.current) {
          setChainLog((l) =>
            appendChainLog(l, {
              ts: Date.now(),
              level: 'WARN',
              msg: `DEV MODE: skipping submit_ping_proof session=${sessionId0} turn=${turn0}`,
            })
          );
        } else if (verifierBypassModeRef.current) {
          setChainLog((l) =>
            appendChainLog(l, {
              ts: Date.now(),
              level: 'WARN',
              msg: `ONCHAIN: verifier bypass active; skipping submit_ping_proof session=${sessionId0} turn=${turn0}`,
            })
          );
        } else if (!zkVerifiersReady || !onchainSessionHealthyRef.current) {
          setChainLog((l) =>
            appendChainLog(l, {
              ts: Date.now(),
              level: 'WARN',
              msg: `ONCHAIN: submit_ping_proof skipped (verifiers/session unavailable) session=${sessionId0} turn=${turn0}`,
            }, 240)
          );
        } else {
          const pingProof = await prover.pingDistance({
            x: s0.assassin.x,
            y: s0.assassin.y,
            salt: s0.salt,
            tower_x: towerXY.x,
            tower_y: towerXY.y,
            session_id: sessionId0,
            turn: turn0,
          });
          if (pingProof.d2 !== d2Local) {
            setChainLog((l) =>
              appendChainLog(l, {
                ts: Date.now(),
                level: 'WARN',
                msg: `PING MISMATCH local_d2=${d2Local} prover_d2=${pingProof.d2} (tower=${towerIdLabel})`,
              })
            );
          }
          setChainLog((l) => appendChainLog(l, { ts: Date.now(), level: 'INFO', msg: `ZK ping_distance proof generated [${pingProof.publicInputs.length} public inputs]` }));
          const rPing = await chainBackend.submitPingProof({
            sessionId: sessionId0,
            assassin,
            towerId: pendingTowerIdx,
            d2: pingProof.d2,
            proof: pingProof.proof,
            publicInputs: pingProof.publicInputs,
          });
          setChainLog((l) =>
            appendChainLog(l, {
              ts: Date.now(),
              level: 'INFO',
              msg: `TX ${rPing.txHash ?? 'UNKNOWN'} ok submit_ping_proof d2=${pingProof.d2} session=${sessionId0} turn=${turn0}`,
            })
          );
          pingProofConfirmed = true;
          setLastPingResult({ tower: towerIdLabel, d2: pingProof.d2, at: Date.now(), turn: turn0 });
        }
      }

      const shouldSkipMoveProofs = devModeSessionRef.current || verifierBypassModeRef.current;
      if (path.length > 0 && !shouldSkipMoveProofs) {
        const moveProofInputs = path.map((step, i) => ({
          x_old: i === 0 ? from.x : path[i - 1].x,
          y_old: i === 0 ? from.y : path[i - 1].y,
          salt_old: s0.salt,
          x_new: step.x,
          y_new: step.y,
          salt_new: s0.salt,
          session_id: sessionId0,
          turn: turn0,
        }));
        const moveProofs = await Promise.all(moveProofInputs.map((inp) => prover.moveProof(inp)));
        setChainLog((l) =>
          appendChainLog(l, {
            ts: Date.now(),
            level: 'INFO',
            msg: `ZK ${moveProofs.length} move_proofs generated${hadPing ? ' (ping path)' : ' (recharge path)'}`,
          })
        );
        if ('submitMultiMoveProof' in chainBackend && moveProofs.length > 0) {
          const rMv = await (chainBackend as any).submitMultiMoveProof({
            sessionId: sessionId0,
            assassin,
            entries: moveProofs.map((mv: any) => ({
              newCommitment: mv.commitmentNew,
              proof: mv.proof,
              publicInputs: mv.publicInputs,
            })),
          });
          setChainLog((l) =>
            appendChainLog(l, {
              ts: Date.now(),
              level: 'INFO',
              msg: `TX ${rMv.txHash ?? 'UNKNOWN'} ok submit_multi_move_proof (${moveProofs.length} steps)`,
            })
          );
        } else {
          for (const mv of moveProofs as any[]) {
            const rMv = await chainBackend.submitMoveProof({
              sessionId: sessionId0,
              assassin,
              newCommitment: mv.commitmentNew,
              proof: mv.proof,
              publicInputs: mv.publicInputs,
            });
            setChainLog((l) =>
              appendChainLog(l, {
                ts: Date.now(),
                level: 'INFO',
                msg: `TX ${rMv.txHash ?? 'UNKNOWN'} ok submit_move_proof [ZK-verified step, coordinates sealed]`,
              })
            );
          }
        }
      } else if (path.length > 0 && shouldSkipMoveProofs) {
        const reason = devModeSessionRef.current ? 'dev mode' : 'verifier bypass';
        setChainLog((l) =>
          appendChainLog(l, {
            ts: Date.now(),
            level: 'WARN',
            msg: `ONCHAIN: skipping move proofs (${reason}) session=${sessionId0} turn=${turn0}`,
          })
        );
      }

      if (hadPing && pingProofConfirmed && !shouldSkipMoveProofs) {
        let cx = out.session.chad_x ?? 0;
        let cy = out.session.chad_y ?? 0;
        try {
          const onchainSession = await chainBackend.getSession(sessionId0);
          if (typeof onchainSession.chad_x === 'number' && typeof onchainSession.chad_y === 'number') {
            cx = onchainSession.chad_x;
            cy = onchainSession.chad_y;
          }
        } catch {
          // fall back to local prepared sim output
        }
        const finalPos = path.length > 0 ? path[path.length - 1] : from;
        const st = await prover.turnStatus({
          x: finalPos.x,
          y: finalPos.y,
          salt: s0.salt,
          cx,
          cy,
          session_id: sessionId0,
          turn: turn0,
        });
        setChainLog((l) =>
          appendChainLog(l, {
            ts: Date.now(),
            level: 'INFO',
            msg: `ZK turn_status proof generated bytes=${st.proof.length} public_inputs=${st.publicInputs.length}`,
          })
        );
        const rSt = await chainBackend.submitTurnStatusProof({
          sessionId: sessionId0,
          assassin,
          d2Chad: st.d2Chad,
          proof: st.proof,
          publicInputs: st.publicInputs,
        });
        setChainLog((l) =>
          appendChainLog(l, {
            ts: Date.now(),
            level: 'INFO',
            msg: `TX ${rSt.txHash ?? 'UNKNOWN'} ok submit_turn_status_proof d2_chad=${st.d2Chad} advance_turn`,
          })
        );
      } else {
        const reason = !hadPing
          ? 'recharge path'
          : devModeSessionRef.current
            ? 'dev fallback'
            : verifierBypassModeRef.current
              ? 'verifier bypass'
              : 'ping proof unavailable';
        await maybeRunAssassinTickFallback(reason);
      }

      setSecret(encryption.encrypt(out.secret));
      setSession(out.session);
      setAssassinPlannedPath([]);
      setAssassinTurnError(null);
      if (typeof BroadcastChannel !== 'undefined') {
        try {
          const bc = new BroadcastChannel('pol-game-sync');
          const msg: GameSyncMessage = {
            type: 'assassin-turn-applied',
            sessionId: sessionId0,
            completedTurn: turn0,
            secret: out.secret,
          };
          bc.postMessage(msg);
          bc.close();
        } catch {
          // Same-origin tab sync is best-effort; chain polling remains the fallback.
        }
      }
      setChainLog((l) =>
        appendChainLog(l, {
          ts: Date.now(),
          level: 'INFO',
          msg: `ASSASSIN TURN SUBMITTED path_steps=${path.length} session=${sessionId0} turn=${turn0}`,
        })
      );
    } catch (e) {
      const h = tryExtractTxHashFromError(e);
      if (isSessionKeyAuthContractError(e)) {
        setSessionKeySecret(null);
        setSessionKeyPublic(null);
        setChainLog((l2) =>
          appendChainLog(l2, {
            ts: Date.now(),
            level: 'WARN',
            msg: 'ONCHAIN: assassin session-key authorization failed during submit. One-confirm mode disabled for this run.',
          })
        );
      } else if (isTxMalformedError(e)) {
        setSessionKeySecret(null);
        setSessionKeyPublic(null);
        setChainLog((l2) =>
          appendChainLog(l2, {
            ts: Date.now(),
            level: 'WARN',
            msg: 'ONCHAIN: assassin transaction was malformed (txMalformed). One-confirm mode disabled for this run.',
          })
        );
      } else if (isContractCode(e, 22)) {
        try {
          const sChk = await chainBackend.getSession(sessionId0);
          if (sChk.insecure_mode && !verifierBypassModeRef.current) {
            verifierBypassModeRef.current = true;
            setChainLog((l2) =>
              appendChainLog(l2, {
                ts: Date.now(),
                level: 'WARN',
                msg: 'ONCHAIN: verifier rejected assassin proof (#22 InvalidProof). insecure_mode=true, enabling verifier bypass.',
              })
            );
          }
        } catch {
          // best-effort
        }
      } else if (isDesyncError(e)) {
        markOnchainDesynced('assassin turn proof mismatch');
      }
      setAssassinTurnError(String(e));
      setChainLog((l) =>
        appendChainLog(l, {
          ts: Date.now(),
          level: 'ERROR',
          msg: `assassin turn failed${h ? ` (hash=${h})` : ''}: ${formatProofErrorForChainLog(e)}`,
        })
      );
    } finally {
      assassinSubmitBusyRef.current = false;
      setAssassinTurnBusy(false);
      chainPipelineLockRef.current = false;
      setChainPipelineLocked(false);
      onchainMutationLockRef.current = false;
      setOnchainMutationLocked(false);
    }
  };

  const doPing = (tower: TowerId) => {
    if (!session) return;
    if (!canPing) return;
    if (pendingPing || commandLocked || commandLockRef.current || chainPipelineLockRef.current || onchainMutationLockRef.current || onchainBootstrapPendingRef.current) return;

    // Two-player mode: verify dispatcher role
    if (session.mode === 'two-player' && user !== dispatcher) {
      setSession((cur) =>
        cur ? { ...cur, log: [...cur.log, `ERROR: PING requires DISPATCHER wallet (current: ASSASSIN)`].slice(-200) } : cur
      );
      setChainLog((l) =>
        appendChainLog(l, {
          ts: Date.now(),
          level: 'ERROR',
          msg: `ROLE MISMATCH: PING action requires DISPATCHER wallet. Please switch to dispatcher (${dispatcher.slice(0,8)}...)`
        })
      );
      return;
    }

    const next = requestPing(session, dispatcher, tower);
    afterAction(next, { blind: false, tower });
  };

  const doRecharge = () => {
    if (!session) return;
    if (!canRecharge) return;
    if (pendingPing || commandLocked || commandLockRef.current || chainPipelineLockRef.current || onchainMutationLockRef.current || onchainBootstrapPendingRef.current) return;

    // Two-player mode: verify dispatcher role
    if (session.mode === 'two-player' && user !== dispatcher) {
      setSession((cur) =>
        cur ? { ...cur, log: [...cur.log, `ERROR: RECHARGE requires DISPATCHER wallet (current: ASSASSIN)`].slice(-200) } : cur
      );
      setChainLog((l) =>
        appendChainLog(l, {
          ts: Date.now(),
          level: 'ERROR',
          msg: `ROLE MISMATCH: RECHARGE action requires DISPATCHER wallet. Please switch to dispatcher (${dispatcher.slice(0,8)}...)`
        })
      );
      return;
    }

    const next = recharge(session, dispatcher);
    afterAction(next, { blind: true });
  };

  const doChadCommand = (cmd: ChadCommand) => {
    if (!session) return;
    if (disableChadCmds) return;
    if (commandLockRef.current || chainPipelineLockRef.current || onchainMutationLockRef.current || onchainBootstrapPendingRef.current) return;

    // Two-player mode: verify dispatcher role
    if (session.mode === 'two-player' && user !== dispatcher) {
      setSession((cur) =>
        cur ? { ...cur, log: [...cur.log, `ERROR: COMMAND requires DISPATCHER wallet (current: ASSASSIN)`].slice(-200) } : cur
      );
      setChainLog((l) =>
        appendChainLog(l, {
          ts: Date.now(),
          level: 'ERROR',
          msg: `ROLE MISMATCH: CHAD COMMAND requires DISPATCHER wallet. Please switch to dispatcher (${dispatcher.slice(0,8)}...)`
        })
      );
      return;
    }

    afterChadCommand(setChadCommand(session, dispatcher, cmd));
  };

  const doSendChat = () => {
    if (!session) return;
    const msg = chat.trim();
    if (!msg) return;
    setChat('');
    setSession((cur) => (cur ? { ...cur, log: [...cur.log, `YOU: ${msg}`].slice(-200) } : cur));
  };

  const renderPhaseContent = () => {
    if (visibleUiPhase === 'setup' || visibleUiPhase === 'boot') {
      return (
        <IntroScreen
          onStart={start}
          onShowRules={() => setShowRules(true)}
          onCreateLobby={() => setUiPhase('lobby')}
          onJoinLobby={() => setUiPhase('lobby')}
          wallet={wallet}
          userAddress={user}
          mode={mode}
          setMode={setMode}
          assassinAddress={assassinAddress}
          setAssassinAddress={setAssassinAddress}
          devMode={devMode}
          setDevMode={setDevMode}
        />
      );
    }

    if (visibleUiPhase === 'lobby') {
      return (
        <LobbyScreen
          userAddress={user}
          networkPassphrase={appConfig.networkPassphrase}
          contractId={appConfig.proofOfLifeId || ''}
          chainBackend={chainBackend}
          onLobbyComplete={handleLobbyComplete}
          onBack={() => setUiPhase('setup')}
        />
      );
    }

    if (visibleUiPhase === 'cutscene') {
      return (
        <CutsceneScreen
          script={getIntroCallSequence()}
          onComplete={() => setUiPhase('play')}
        />
      );
    }

    return (
      session && (
      <div className="pol-boardLayout">
        
        {/* 1. HEADER ROW - Integrated */}
        <div className="pol-boardTopbar">
           <div className="pol-boardTopbarBrand">
              <div className="pol-boardBeacon">
                <div className="pol-boardBeaconCore" />
              </div>
              <div>
                <div className="pol-boardTitle">PROOF OF LIFE</div>
              </div>
           </div>
           
           {/* Controls in Header */}
           <div className="pol-boardTopbarControls">
              <button
                onClick={() => setShowRules(true)} 
                className="pol-boardTopbarBtn pol-boardTopbarBtn--ghost"
              >
                 MISSION BRIEF
              </button>
              <button
                 onClick={() => setShowLogs(true)}
                 className="pol-boardTopbarBtn pol-boardTopbarBtn--cyan"
              >
                 COMMS LOGS
              </button>
              {!onchainSessionHealthy ? (
                <>
                  <span className="pol-boardDesyncBadge">RESYNC REQUIRED</span>
                  <button
                    onClick={restartSyncedSession}
                    className="pol-boardTopbarBtn pol-boardTopbarBtn--amber"
                  >
                    RESTART SYNC
                  </button>
                </>
              ) : null}
              <div className="pol-boardTopbarSep" />
	              <div className="pol-boardMeta">
	                  <div>SESSION: <span className="text-white">{session.sessionId}</span></div>
	                  <div>TURN: <span className="text-amber-300">{session.turn}</span></div>
	                  <div>NETWORK: <span className="text-cyan-400">{chainCtx.network}</span></div>
	                  <div>ROLE: <span className={playerRole === 'dispatcher' ? 'text-cyan-300' : playerRole === 'assassin' ? 'text-red-300' : 'text-white/70'}>{playerRole.toUpperCase()}</span></div>
	                  <div>STATUS: <span className={statusClass}>{statusLabel}</span></div>
	              </div>
           </div>
        </div>

        {/* 2. MAIN AREA (Map + Overlays) */}
        <div className="pol-boardArena">
            <div className="pol-boardArenaGlow" />
            <div className="pol-boardArenaScanlines" />
            
            {/* MAP LAYER */}
            <div className="absolute inset-0 z-[1] flex items-center justify-center pol-boardMapLayer">
                <RetroMap
                  session={session}
                  secret={secret}
                  showChadMarker={shouldShowChadMarkerOnMap}
                  showAssassinMarker={session.mode !== 'two-player' || assassinClientByRole}
                  assassinPath={session.mode === 'two-player' && assassinClientByRole ? assassinPlannedPath : undefined}
                  assassinPathStart={session.mode === 'two-player' && assassinClientByRole && assassinTurnPrepared ? assassinTurnPrepared.from : null}
                  onTileClick={session.mode === 'two-player' && assassinClientByRole && assassinTurnPrepared && uiPhase === 'play'
                    ? (coord) => handleAssassinMapTileClick(coord as Coord)
                    : undefined}
                  towers={TOWERS.map(t => {
                    const coords = towerXYFor(t.id, chainTowers);
                    return { ...t, x: coords.x, y: coords.y };
                  })}
                />
            </div>

            {/* OVERLAY: Top Left (Dossier) */}
            {/* OVERLAY: Left Stack (Dossier + Command Override) */}
            <div className="pol-boardStack pol-boardStack--left">
                <CRTPanel title="DOSSIER" rightTag="A-34" className="pol-boardPanel flex-none">
                  <div className="space-y-1">
                    <NeonKPI label="NAME" value="CHAD" accent="emerald" size="sm" />
                    <NeonKPI label="ROLE" value="RUNNER" accent="cyan" size="sm" />
                    <NeonKPI label="STATE" value="PANIC" accent="purple" size="sm" />
                    <NeonKPI label="THREAT" value={stars(3)} accent="purple" size="sm" />
                  </div>
                </CRTPanel>

               <CRTPanel title="PROXIMITY SCANNER" rightTag="LIVE" className="pol-boardPanel flex-none">
                 {lastPingResult && proximityReadout ? (
                   <div className="space-y-1 text-[11px] tracking-wide text-white/80">
                     <div className="flex items-center justify-between">
                       <span className="text-white/50">SOURCE</span>
                       <span className="text-cyan-300">{lastPingResult.tower}</span>
                     </div>
                     <div className="flex items-center justify-between">
                       <span className="text-white/50">SIGNAL</span>
                       <span className={proximityReadout.toneClass}>{proximityReadout.band}</span>
                     </div>
                     <pre className={["text-[10px] leading-none", proximityReadout.toneClass].join(" ")}>
                       {meterBar(proximityReadout.strengthPct, 100, 12)}
                     </pre>
                     <div className="flex items-center justify-between">
                       <span className="text-white/50">INTENSITY</span>
                       <span className={proximityReadout.toneClass}>{proximityReadout.strengthPct}%</span>
                     </div>
                     <div className="flex items-center justify-between">
                       <span className="text-white/50">TURN</span>
                       <span className="text-cyan-300">{lastPingResult.turn}</span>
                     </div>
                     <div className="pt-1 text-[10px] text-white/45 uppercase tracking-wider">
                       last scan {new Date(lastPingResult.at).toLocaleTimeString()}
                     </div>
                   </div>
                 ) : (
                   <div className="text-[11px] tracking-wide text-white/50">
                     Scanner idle. Send first ping...
                   </div>
                 )}
               </CRTPanel>

	                 <CRTPanel
	                   title={session.mode === 'two-player' && isAssassinClient ? 'ASSASSIN CONSOLE' : 'COMMAND OVERRIDE'}
	                   className="pol-boardPanel flex-1 min-h-0 flex flex-col"
	                 >
	                   {session.mode === 'two-player' && isAssassinClient ? (
	                     <div className="space-y-2 p-2 text-[11px] tracking-wide text-white/80">
	                       <div className="flex items-center justify-between">
	                         <span className="text-red-300 font-semibold">KILLER CONTROL</span>
	                         <span className="text-white/50">{session.phase === 'assassin' ? 'ACTIVE' : 'WAIT'}</span>
	                       </div>
	                       <div className="grid grid-cols-2 gap-2 text-[10px]">
	                         <div className="rounded border border-white/10 px-2 py-1">
	                           <div className="text-white/45">MAX STEPS</div>
	                           <div className="text-red-300">{assassinTurnPrepared?.maxSteps ?? '-'}</div>
	                         </div>
	                         <div className="rounded border border-white/10 px-2 py-1">
	                           <div className="text-white/45">USED</div>
	                           <div className="text-red-300">{assassinPlannedPath.length}</div>
	                         </div>
	                       </div>
	                       {assassinTurnPrepared ? (
	                         <>
	                           <div className="text-white/55">
	                             Click adjacent tiles on the map to build the killer path, then submit the assassin turn.
	                           </div>
	                           <div className={[
	                             'rounded border px-2 py-2 text-[10px]',
	                             assassinPathValidation?.ok ? 'border-emerald-400/30 text-emerald-200' : 'border-amber-300/30 text-amber-200',
	                           ].join(' ')}>
	                             {assassinPathValidation?.ok
	                               ? `PATH READY (${assassinPlannedPath.length}/${assassinTurnPrepared.maxSteps})`
	                               : (assassinTurnError || assassinPathValidation?.reason || 'Build a valid path to continue')}
	                           </div>
	                           <div className="grid grid-cols-3 gap-2">
	                             <button
	                               onClick={clearAssassinPath}
	                               disabled={assassinTurnBusy || assassinPlannedPath.length === 0}
	                               className="pol-boardTopbarBtn pol-boardTopbarBtn--ghost text-[10px]"
	                             >
	                               CLEAR
	                             </button>
	                             <button
	                               onClick={undoAssassinPathStep}
	                               disabled={assassinTurnBusy || assassinPlannedPath.length === 0}
	                               className="pol-boardTopbarBtn pol-boardTopbarBtn--ghost text-[10px]"
	                             >
	                               UNDO
	                             </button>
	                             <button
	                               onClick={() => { void submitAssassinTurn(); }}
	                               disabled={!assassinTurnCanSubmit}
	                               className="pol-boardTopbarBtn pol-boardTopbarBtn--cyan text-[10px]"
	                             >
	                               {assassinTurnBusy ? 'SUBMITTING' : 'SUBMIT'}
	                             </button>
	                           </div>
	                         </>
	                       ) : (
	                         <div className="text-white/55">
	                           Waiting for dispatcher action to hand over the assassin turn.
	                         </div>
	                       )}
	                     </div>
	                   ) : (
	                     <div className="grid grid-cols-2 gap-2 overflow-y-auto p-1 custom-scrollbar">
	                       {chadCmdOptions.map((opt) => (
	                         <button
	                           key={opt.cmd}
	                           onClick={() => doChadCommand(opt.cmd)}
	                           disabled={disableChadCmds || !isDispatcherClient}
	                           className={[
	                             'pol-boardCmdBtn',
	                             session?.pending_chad_cmd === opt.cmd ? 'is-active' : '',
	                           ].join(" ")}
	                         >
	                           {opt.label}
	                         </button>
	                       ))}
	                     </div>
	                   )}
	               </CRTPanel>
            </div>

            {/* OVERLAY: Top Right (Meters) */}
            {/* OVERLAY: Right Stack (Meters + Triangulation) */}
            <div className="pol-boardStack pol-boardStack--right">
                <CRTPanel title="METERS" rightTag="PWR/ALPH" className="pol-boardPanel flex-none">
                  <div className="space-y-2">
                    <AsciiMeter label="PWR" value={session.battery} max={100} accent={session.battery <= 20 ? "purple" : session.battery <= 50 ? "cyan" : "emerald"} compact={true} />
                    <AsciiMeter
                      label="ALP"
                      value={typeof session.alpha === 'number' ? session.alpha : 5}
                      max={typeof session.alpha_max === 'number' ? session.alpha_max : 5}
                      accent="emerald"
                      compact={true}
                    />
	                    {session.mode === 'two-player' && isAssassinClient ? (
	                      <div className="text-[11px] tracking-wide text-white/55 border border-white/10 rounded px-2 py-2">
	                        Dispatcher-only control panel hidden on assassin client.
	                      </div>
	                    ) : (
	                      <button onClick={doRecharge} disabled={!canRecharge || controlsLocked || !isDispatcherClient} className="pol-boardRechargeBtn">
	                        RECHARGE GENERATOR
	                      </button>
	                    )}
	                  </div>
	                </CRTPanel>

	               <CRTPanel
	                 title={session.mode === 'two-player' && isAssassinClient ? 'ASSASSIN STATUS' : 'TRIANG. UPLINK'}
	                 rightTag={session.mode === 'two-player' && isAssassinClient ? 'ROLE' : 'PINGS'}
	                 className="pol-boardPanel flex-1 min-h-0 flex flex-col"
	               >
	                  {session.mode === 'two-player' && isAssassinClient ? (
	                    <div className="space-y-2 p-2 text-[11px] tracking-wide text-white/80">
	                      <div className="flex items-center justify-between">
	                        <span className="text-white/50">DISPATCHER</span>
	                        <span className="text-cyan-300">{dispatcher.slice(0, 8)}...</span>
	                      </div>
	                      <div className="flex items-center justify-between">
	                        <span className="text-white/50">ASSASSIN</span>
	                        <span className="text-red-300">{assassin.slice(0, 8)}...</span>
	                      </div>
	                      <div className="flex items-center justify-between">
	                        <span className="text-white/50">PHASE</span>
	                        <span className={session.phase === 'assassin' ? 'text-red-300' : 'text-cyan-300'}>{session.phase.toUpperCase()}</span>
	                      </div>
	                      <div className="flex items-center justify-between">
	                        <span className="text-white/50">PENDING PING</span>
	                        <span className="text-white/80">
	                          {typeof session.pending_ping_tower === 'number'
	                            ? (session.pending_ping_tower === 0 ? 'N' : session.pending_ping_tower === 1 ? 'E' : session.pending_ping_tower === 2 ? 'S' : 'W')
	                            : 'NONE'}
	                        </span>
	                      </div>
	                      <div className="flex items-center justify-between">
	                        <span className="text-white/50">PATH</span>
	                        <span className={assassinPathValidation?.ok ? 'text-emerald-300' : 'text-amber-200'}>
	                          {assassinTurnPrepared ? `${assassinPlannedPath.length}/${assassinTurnPrepared.maxSteps}` : '--'}
	                        </span>
	                      </div>
	                      <div className="pt-1 text-white/55">
	                        {assassinTurnPrepared
	                          ? 'Build a killer path on the map and submit the assassin turn.'
	                          : 'Waiting for dispatcher actions. Use COMMS LOGS to follow chain activity.'}
	                      </div>
	                    </div>
	                  ) : (
	                    <div className="grid grid-cols-2 gap-2 overflow-y-auto p-1 custom-scrollbar">
	                      {TOWERS.map((t) => (
	                        <button
	                          key={t.id}
	                          onClick={() => doPing(t.id)}
	                          className="pol-boardPingBtn"
	                          disabled={!canPing || controlsLocked || !isDispatcherClient}
	                        >
	                          PING {t.label}
	                        </button>
	                      ))}
	                    </div>
	                  )}
	               </CRTPanel>
            </div>
        </div>
        <div className="pol-boardSubtitleBelow" aria-live="polite">
          <div className="pol-boardSubtitleLine">
            {activeSubtitle.speaker ? (
              <>
                <span
                  className={[
                    'pol-boardSubtitleSpeaker',
                    activeSubtitle.speaker === 'CHAD'
                      ? 'pol-boardSubtitleSpeaker--chad'
                      : activeSubtitle.speaker === 'YOU'
                        ? 'pol-boardSubtitleSpeaker--you'
                        : 'pol-boardSubtitleSpeaker--default',
                  ].join(' ')}
                >
                  {activeSubtitle.speaker}:
                </span>{' '}
                <span>{activeSubtitle.text}</span>
              </>
            ) : (
              <span>{activeSubtitle.text}</span>
            )}
          </div>
        </div>
      </div>
  ));
  };

  return (
    <div className="h-screen w-screen bg-black text-white flex flex-col overflow-hidden font-mono p-4 relative">
       {/* Background */}
       <div className="fixed inset-0 pointer-events-none -z-10">
          <div className="absolute -top-32 left-1/4 h-96 w-96 rounded-full bg-fuchsia-500/10 blur-3xl opacity-60" />
          <div className="absolute top-24 right-1/4 h-96 w-96 rounded-full bg-cyan-500/10 blur-3xl opacity-60" />
          <div className="absolute bottom-0 left-1/3 h-96 w-96 rounded-full bg-emerald-500/10 blur-3xl opacity-60" />
       </div>


      {/* 2. MAIN CONTENT (Grow to fill available space) */}
      <main className="flex-1 min-h-0 relative z-10 w-full max-w-[1920px] mx-auto">
        <div className={`pol-phaseTransition pol-phaseTransition--${phaseTransition}`}>
          {renderPhaseContent()}
        </div>
      </main>

      {onchainBootstrapPending && (
        <div className="pol-walletPendingOverlay" role="status" aria-live="polite" aria-atomic="true">
          <div className="pol-walletPendingCard">
            <div className="pol-walletPendingSpinner" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <div className="pol-walletPendingText">
              <div className="pol-walletPendingTitle">Opening Wallet Confirmation</div>
              <div className="pol-walletPendingSub">Approve the transaction in your wallet modal to continue.</div>
            </div>
          </div>
        </div>
      )}

      {/* LOGS MODAL */}
      <CRTModal
        isOpen={showGameFinishedModal && !!session?.ended}
        onClose={() => setShowGameFinishedModal(false)}
        title="SESSION REPORT"
        actionLabel="CLOSE"
      >
        {session ? (
          <div className="space-y-4 text-xs">
            <div className="rounded border border-white/10 bg-black/40 p-3">
              <div className={["text-sm font-bold tracking-widest", sessionOutcomeSummary.tone].join(' ')}>
                {sessionOutcomeSummary.title}
              </div>
              <div className="mt-1 text-white/70">{sessionOutcomeSummary.detail}</div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded border border-white/10 bg-white/5 p-3">
                <div className="text-white/45 uppercase tracking-wider">Session</div>
                <div className="mt-1 text-cyan-300 font-semibold">{session.sessionId}</div>
              </div>
              <div className="rounded border border-white/10 bg-white/5 p-3">
                <div className="text-white/45 uppercase tracking-wider">Mode</div>
                <div className="mt-1 text-white">{session.mode === 'two-player' ? 'Two Player' : 'Single Player'}</div>
              </div>
              <div className="rounded border border-white/10 bg-white/5 p-3">
                <div className="text-white/45 uppercase tracking-wider">Turns</div>
                <div className="mt-1 text-white">{session.turn}</div>
              </div>
              <div className="rounded border border-white/10 bg-white/5 p-3">
                <div className="text-white/45 uppercase tracking-wider">Battery / Alpha</div>
                <div className="mt-1 text-white">{session.battery} / {session.alpha ?? '-'}</div>
              </div>
            </div>

            {session.log.length ? (
              <div className="rounded border border-white/10 bg-white/5 p-3">
                <div className="text-white/45 uppercase tracking-wider">Last Event</div>
                <div className="mt-2 text-white/80">{session.log[session.log.length - 1]}</div>
              </div>
            ) : null}

            <div className="flex justify-end">
              <button
                onClick={handleCreateNewSessionFromFinishedModal}
                className="px-4 py-2 rounded border border-cyan-400/30 bg-cyan-500/10 text-cyan-300 text-xs tracking-widest uppercase hover:bg-cyan-500/20"
              >
                Create New Session
              </button>
            </div>
          </div>
        ) : null}
      </CRTModal>

      <CRTModal
        isOpen={showLogs}
        onClose={() => setShowLogs(false)}
        title="COMMS LOGS"
        actionLabel="CLOSE LOGS"
      >
         <div className="flex flex-col gap-4 h-[60vh]">
            <div className="flex-1 min-h-0 border border-white/10 p-2 bg-black/40 rounded overflow-hidden flex flex-col">
                <div className="text-[10px] text-emerald-400 mb-1 tracking-widest border-b border-white/5 pb-1">TRANSCRIPT</div>
                <TerminalLog lines={session?.log || []} className="flex-1" />
            </div>
            <div className="flex-1 min-h-0 border border-white/10 p-2 bg-black/40 rounded overflow-hidden flex flex-col">
                <div className="text-[10px] text-cyan-400 mb-1 tracking-widest border-b border-white/5 pb-1">SYSTEM CHAIN</div>
                 <div ref={chainLogScrollRef} className="flex-1 overflow-y-auto pol-scroller min-h-0 font-mono text-[11px] leading-[1.4] space-y-0.5 p-1">
                   {chainLog.map((e, i) => {
                     const d = new Date(e.ts);
                     const time = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
                     const levelCls = e.level === 'ERROR' ? 'text-red-400' : e.level === 'WARN' ? 'text-yellow-300' : 'text-cyan-300/70';
                     const msgCls   = e.level === 'ERROR' ? 'text-red-300/90' : e.level === 'WARN' ? 'text-yellow-100/80' : 'text-white/75';
                     return (
                       <div key={i} className="flex gap-1.5 items-start min-w-0">
                         <span className="text-white/25 shrink-0 tabular-nums">{String(i + 1).padStart(3,'0')}</span>
                         <span className="text-white/20 shrink-0">│</span>
                         <span className="text-white/40 shrink-0 tabular-nums">[{time}]</span>
                         <span className={`${levelCls} shrink-0 w-10 font-bold`}>{e.level}</span>
                         <span className={`${msgCls} break-all`}>{e.msg}</span>
                       </div>
                     );
                   })}
                 </div>
            </div>
         </div>
      </CRTModal>

      {/* GAME RULES MODAL - ALWAYS RENDERED (Controlled by showRules) */}
      <CRTModal 
        isOpen={showRules} 
        onClose={() => {
          setShowRules(false);
        }} 
        title="MISSION BRIEFING"
        actionLabel="CLOSE BRIEFING"
      >
        <div className="space-y-5 font-mono text-white/80 text-xs leading-relaxed">

           {/* Situation */}
           <div className="border border-amber-500/30 bg-amber-500/5 p-4 rounded">
              <h3 className="text-amber-400 font-bold text-sm mb-2 tracking-widest uppercase border-b border-amber-500/20 pb-2">
                 Situation — October 31, 1998
              </h3>
              <p className="text-amber-100/70">
                 A college student named <strong className="text-amber-300">CHAD</strong> is trapped inside Hollow Creek Mansion with a masked killer.
                 Power lines are down. Police can't reach him. Air rescue needs time.
              </p>
              <p className="text-amber-100/70 mt-2">
                 <strong className="text-amber-300">You are the 911 Dispatcher.</strong> Using only a radio triangulation terminal and an emergency generator,
                 you must keep Chad alive until dawn — turn 10.
              </p>
           </div>

           {/* Roles */}
           <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2 border border-cyan-500/20 bg-cyan-500/5 p-3 rounded">
                 <h4 className="text-cyan-300 font-bold tracking-wider uppercase border-b border-white/10 pb-1">You — Dispatcher</h4>
                 <ul className="space-y-1 text-cyan-100/70">
                    <li><strong className="text-cyan-300">PING TOWERS</strong> — each ping returns a signal distance from the Assassin to a tower, draining battery.</li>
                    <li><strong className="text-cyan-300">COMMAND CHAD</strong> — tell him where to move or hide using Command Override.</li>
                    <li><strong className="text-cyan-300">RECHARGE</strong> — skip a ping to restore generator power.</li>
                    <li><strong className="text-cyan-300">CALL POLICE</strong> — guess the Assassin's exact tile to end the game instantly.</li>
                 </ul>
              </div>

              <div className="space-y-2 border border-fuchsia-500/20 bg-fuchsia-500/5 p-3 rounded">
                 <h4 className="text-fuchsia-300 font-bold tracking-wider uppercase border-b border-white/10 pb-1">The Assassin — Hidden</h4>
                 <p className="text-fuchsia-100/70">
                    His exact position is <strong className="text-fuchsia-300">never shown on the map</strong> — it's cryptographically hidden on-chain.
                    Each ping only reveals how far he is from a tower, not where he is.
                 </p>
                 <p className="text-fuchsia-100/70 mt-1">
                    Use multiple pings to narrow down his location by cross-referencing the distances.
                 </p>
              </div>
           </div>

           {/* Meters */}
           <div className="border border-white/10 bg-white/5 p-4 rounded space-y-2">
              <h4 className="text-white/60 font-bold tracking-wider uppercase border-b border-white/10 pb-1">The Two Meters</h4>
              <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-[11px]">
                 <div>
                    <span className="text-emerald-300 font-bold">PWR — Generator Power</span>
                    <p className="text-white/50 mt-0.5">Starts at 100. Each ping costs 20. Hits zero = terminal goes dark. Game over.</p>
                 </div>
                 <div>
                    <span className="text-cyan-300 font-bold">ALP — Chad's Alpha / Sanity</span>
                    <p className="text-white/50 mt-0.5">Drops when the Assassin is nearby. Hits zero = Chad panics and is caught. Game over.</p>
                 </div>
              </div>
           </div>

           {/* Win/Lose */}
           <div className="grid grid-cols-2 gap-4 text-[11px]">
              <div className="border border-emerald-500/20 bg-emerald-500/5 p-3 rounded">
                 <h4 className="text-emerald-400 font-bold tracking-wider mb-1">YOU WIN IF...</h4>
                 <ul className="space-y-1 text-emerald-100/60">
                    <li>Chad survives to <strong className="text-emerald-300">Turn 10</strong> (police arrive), or</li>
                    <li>You <strong className="text-emerald-300">CALL POLICE</strong> with the correct tile guess.</li>
                 </ul>
              </div>
              <div className="border border-red-500/20 bg-red-500/5 p-3 rounded">
                 <h4 className="text-red-400 font-bold tracking-wider mb-1">YOU LOSE IF...</h4>
                 <ul className="space-y-1 text-red-100/60">
                    <li><strong className="text-red-300">PWR</strong> reaches zero (generator fails),</li>
                    <li><strong className="text-red-300">ALP</strong> reaches zero (Chad breaks down), or</li>
                    <li>The Assassin reaches Chad's tile.</li>
                 </ul>
              </div>
           </div>

        </div>
      </CRTModal>
    </div>
  );
}
