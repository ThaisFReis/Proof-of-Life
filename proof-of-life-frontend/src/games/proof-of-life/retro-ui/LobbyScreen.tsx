/**
 * LobbyScreen — two-player matchmaking UI
 *
 * Sub-views:
 *   choose   → pick CREATE or JOIN
 *   create   → dispatcher: show lobby code, wait for response code
 *   join     → assassin: paste lobby code, accept mission, get response code
 *   waiting  → assassin: polls chain every 3s until session is live
 */

import React, { useEffect, useRef, useState } from 'react';
import { CRTPanel } from './components';
import './IntroScreen.css';
import {
  encodeLobbyCode,
  decodeLobbyCode,
  encodeResponse,
  decodeResponse,
  validateStellarAddress,
  generateSessionId,
} from '../lobby/lobbyCode';
import type { LobbyCode, LobbyPhase, LobbyResponse } from '../model';
import type { ChainBackend } from '../chain/chainBackend';

interface LobbyScreenProps {
  userAddress: string;
  networkPassphrase: string;
  contractId: string;
  chainBackend: ChainBackend | null;
  initialRole?: 'dispatcher' | 'assassin' | null;
  onLobbyComplete: (params: { sessionId: number; dispatcher: string; assassin: string; role: 'dispatcher' | 'assassin' }) => void;
  onBack: () => void;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setCopied(false), 2000);
    }).catch(() => undefined);
  };

  useEffect(() => () => { if (timerRef.current) window.clearTimeout(timerRef.current); }, []);

  return (
    <button
      className={`pol-lobbyCopyBtn ${copied ? 'pol-lobbyCopyBtn--copied' : ''} ${className ?? ''}`}
      onClick={handleCopy}
    >
      {copied ? 'COPIED!' : 'COPY'}
    </button>
  );
}

// ── sub-view: choose ──────────────────────────────────────────────────────────

function ChooseView({ onChoose, onBack }: { onChoose: (role: 'dispatcher' | 'assassin') => void; onBack: () => void }) {
  return (
    <div className="pol-lobbyScreen">
      <p className="pol-lobbyLabel" style={{ textAlign: 'center' }}>Select your role</p>
      <div className="pol-lobbyChoose">
        <button className="pol-lobbyChooseBtn pol-lobbyChooseBtn--create" onClick={() => onChoose('dispatcher')}>
          <span className="pol-lobbyChooseBtnIcon">📡</span>
          <span className="pol-lobbyChooseBtnLabel">Create Lobby</span>
          <span className="pol-lobbyChooseBtnDesc">Dispatcher — you start the game and ping the assassin's position</span>
        </button>
        <button className="pol-lobbyChooseBtn pol-lobbyChooseBtn--join" onClick={() => onChoose('assassin')}>
          <span className="pol-lobbyChooseBtnIcon">🗡️</span>
          <span className="pol-lobbyChooseBtnLabel">Join Lobby</span>
          <span className="pol-lobbyChooseBtnDesc">Assassin — you receive a lobby code and accept the mission</span>
        </button>
      </div>
      <button className="pol-lobbyBack" onClick={onBack}>← Back</button>
    </div>
  );
}

// ── sub-view: create (dispatcher) ────────────────────────────────────────────

function CreateView(props: {
  lobbyCode: LobbyCode;
  onLaunch: (assassinAddress: string) => void;
  onBack: () => void;
}) {
  const [responseInput, setResponseInput] = useState('');
  const [parsedResponse, setParsedResponse] = useState<LobbyResponse | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const encoded = encodeLobbyCode(props.lobbyCode);

  const handleResponseChange = (value: string) => {
    setResponseInput(value);
    setInputError(null);
    if (!value.trim()) {
      setParsedResponse(null);
      return;
    }
    const resp = decodeResponse(value.trim());
    if (!resp) {
      setParsedResponse(null);
      setInputError('Invalid response code. Ask the assassin to re-copy it.');
      return;
    }
    if (resp.sid !== props.lobbyCode.sid) {
      setParsedResponse(null);
      setInputError(`Session ID mismatch (expected ${props.lobbyCode.sid}, got ${resp.sid}). Wrong response code?`);
      return;
    }
    if (resp.a === props.lobbyCode.d) {
      setParsedResponse(null);
      setInputError('Assassin address cannot be the same as dispatcher address.');
      return;
    }
    setParsedResponse(resp);
  };

  return (
    <div className="pol-lobbyScreen">
      <div className="pol-lobbyStack">
        <p className="pol-lobbyLabel">Your lobby code</p>
        <p style={{ fontSize: '0.58rem', color: 'rgba(255,255,255,0.45)', letterSpacing: '0.08em', margin: 0 }}>
          Share this with the assassin player via Discord, chat, etc.
        </p>
        <div className="pol-lobbyCode">
          <span className="pol-lobbyCodeText">{encoded}</span>
          <CopyButton text={encoded} />
        </div>
      </div>

      <div className="pol-lobbyDivider" />

      <div className="pol-lobbyStack">
        <p className="pol-lobbyLabel">Paste assassin's response code</p>
        <input
          type="text"
          className="pol-setupInput"
          placeholder="POL1R-..."
          value={responseInput}
          onChange={(e) => handleResponseChange(e.target.value)}
        />
        {inputError && <div className="pol-lobbyError">{inputError}</div>}
        {parsedResponse && (
          <div className="pol-lobbyInfoBox">
            <div><span>ASSASSIN</span> {parsedResponse.a.slice(0, 10)}...{parsedResponse.a.slice(-6)}</div>
            <div><span>SESSION </span> {parsedResponse.sid}</div>
          </div>
        )}
      </div>

      <button
        className="pol-lobbyBtn"
        disabled={!parsedResponse}
        onClick={() => parsedResponse && props.onLaunch(parsedResponse.a)}
      >
        LAUNCH MISSION
      </button>

      <button className="pol-lobbyBack" onClick={props.onBack}>← Back</button>
    </div>
  );
}

// ── sub-view: join (assassin) ────────────────────────────────────────────────

function JoinView(props: {
  assassinAddress: string;
  onAccept: (lobby: LobbyCode) => void;
  onBack: () => void;
}) {
  const [codeInput, setCodeInput] = useState('');
  const [parsedLobby, setParsedLobby] = useState<LobbyCode | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);

  const handleCodeChange = (value: string) => {
    setCodeInput(value);
    setInputError(null);
    if (!value.trim()) {
      setParsedLobby(null);
      return;
    }
    const lobby = decodeLobbyCode(value.trim());
    if (!lobby) {
      setParsedLobby(null);
      setInputError('Invalid lobby code. Ask the dispatcher to re-copy it.');
      return;
    }
    if (!validateStellarAddress(props.assassinAddress)) {
      setParsedLobby(null);
      setInputError('Your wallet address is not a valid Stellar address.');
      return;
    }
    if (lobby.d === props.assassinAddress) {
      setParsedLobby(null);
      setInputError('You cannot join your own lobby (dispatcher and assassin must be different accounts).');
      return;
    }
    setParsedLobby(lobby);
  };

  return (
    <div className="pol-lobbyScreen">
      <div className="pol-lobbyStack">
        <p className="pol-lobbyLabel">Paste dispatcher's lobby code</p>
        <input
          type="text"
          className="pol-setupInput"
          placeholder="POL1-..."
          value={codeInput}
          onChange={(e) => handleCodeChange(e.target.value)}
        />
        {inputError && <div className="pol-lobbyError">{inputError}</div>}
        {parsedLobby && (
          <div className="pol-lobbyInfoBox">
            <div><span>DISPATCHER</span> {parsedLobby.d.slice(0, 10)}...{parsedLobby.d.slice(-6)}</div>
            <div><span>SESSION  </span> {parsedLobby.sid}</div>
            <div><span>NETWORK  </span> {parsedLobby.net.includes('Test') ? 'TESTNET' : parsedLobby.net.slice(0, 20)}</div>
          </div>
        )}
      </div>

      <button
        className="pol-lobbyBtn pol-lobbyBtn--copper"
        disabled={!parsedLobby}
        onClick={() => parsedLobby && props.onAccept(parsedLobby)}
      >
        ACCEPT MISSION
      </button>

      <button className="pol-lobbyBack" onClick={props.onBack}>← Back</button>
    </div>
  );
}

// ── sub-view: response code display (assassin post-accept) ────────────────────

function ResponseCodeView(props: {
  responseCode: string;
  hasChainBackend: boolean;
  onProceedToWait: () => void;
  onEnterDirectly: () => void;
  onBack: () => void;
}) {
  return (
    <div className="pol-lobbyScreen">
      <div className="pol-lobbyStack">
        <p className="pol-lobbyLabel">Your response code</p>
        <p style={{ fontSize: '0.58rem', color: 'rgba(255,255,255,0.45)', letterSpacing: '0.08em', margin: 0 }}>
          Send this back to the dispatcher so they can launch the game.
        </p>
        <div className="pol-lobbyCode" style={{ borderColor: 'rgba(255,175,84,0.4)', background: 'rgba(40,23,5,0.5)' }}>
          <span className="pol-lobbyCodeText" style={{ color: 'rgba(255,209,152,0.95)' }}>{props.responseCode}</span>
          <CopyButton text={props.responseCode} />
        </div>
      </div>

      <button className="pol-lobbyBtn" onClick={props.onEnterDirectly}>
        ENTER GAME (local sim)
      </button>
      {props.hasChainBackend && (
        <button className="pol-lobbyBtn pol-lobbyBtn--copper" onClick={props.onProceedToWait}>
          ENTER WAITING ROOM (on-chain)
        </button>
      )}
      <button className="pol-lobbyBack" onClick={props.onBack}>← Back</button>
    </div>
  );
}

// ── sub-view: waiting (assassin) ──────────────────────────────────────────────

function WaitingView(props: {
  sessionId: number;
  dispatcherAddress: string;
  assassinAddress: string;
  chainBackend: ChainBackend | null;
  onSessionFound: () => void;
  onBack: () => void;
}) {
  const [pollCount, setPollCount] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);
  const [source, setSource] = useState<'chain' | 'broadcast' | null>(null);
  const intervalRef = useRef<number | null>(null);
  const isExpectedPendingSessionError = (e: unknown) => {
    const s = String(e ?? '');
    return /Error\s*\(\s*Contract\s*,\s*#1\s*\)/i.test(s) || /Transaction simulation failed/i.test(s);
  };

  // Listen for dispatcher's BroadcastChannel signal (same-origin tab communication)
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const bc = new BroadcastChannel('pol-lobby');
    bc.onmessage = (ev) => {
      if (ev.data?.type === 'session-started' && ev.data?.sessionId === props.sessionId) {
        setSource('broadcast');
        props.onSessionFound();
      }
    };
    return () => bc.close();
  }, [props.sessionId]);

  // Also poll on-chain as fallback
  useEffect(() => {
    if (!props.chainBackend) return;

    const poll = async () => {
      try {
        const s = await props.chainBackend!.getSession(props.sessionId);
        if (s && typeof s.sessionId === 'number') {
          setSource('chain');
          setLastError(null);
          props.onSessionFound();
          return;
        }
      } catch (e) {
        if (isExpectedPendingSessionError(e)) {
          // Expected while dispatcher is still approving / submitting start_game.
          setLastError(null);
        } else {
          setLastError(String(e).slice(0, 120));
        }
      }
      setPollCount((c) => c + 1);
    };

    void poll();
    intervalRef.current = window.setInterval(() => void poll(), 3000);

    return () => {
      if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
    };
  }, [props.chainBackend, props.sessionId]);

  return (
    <div className="pol-lobbyScreen">
      <div className="pol-lobbyInfoBox">
        <div><span>DISPATCHER</span> {props.dispatcherAddress.slice(0, 10)}...{props.dispatcherAddress.slice(-6)}</div>
        <div><span>SESSION  </span> {props.sessionId}</div>
        <div><span>YOU      </span> {props.assassinAddress.slice(0, 10)}...{props.assassinAddress.slice(-6)}</div>
      </div>

      <div className="pol-lobbyWaiting">
        <div className="pol-lobbyWaitingTitle">WAITING FOR DISPATCHER...</div>
        <div className="pol-lobbyWaitingDots">
          <div className="pol-lobbyWaitingDot" />
          <div className="pol-lobbyWaitingDot" />
          <div className="pol-lobbyWaitingDot" />
        </div>
        <div className="pol-lobbyWaitingHint">
          Listening for dispatcher (tab sync + {props.chainBackend ? `chain poll #${pollCount + 1}` : 'no chain'})
        </div>
        {!lastError && props.chainBackend && (
          <div className="pol-lobbyWaitingHint" style={{ marginTop: '0.35rem', opacity: 0.75 }}>
            Waiting for player 1 to confirm the on-chain start transaction...
          </div>
        )}
        {lastError && <div className="pol-lobbyError">{lastError}</div>}
      </div>

      <button className="pol-lobbyBtn pol-lobbyBtn--copper" onClick={props.onSessionFound}>
        SKIP WAIT — ENTER GAME (local sim)
      </button>

      <button className="pol-lobbyBack" onClick={props.onBack}>← Abort</button>
    </div>
  );
}

// ── main component ────────────────────────────────────────────────────────────

export function LobbyScreen(props: LobbyScreenProps) {
  const bootRole = props.initialRole ?? null;
  const [phase, setPhase] = useState<LobbyPhase>(bootRole === 'dispatcher' ? 'create' : bootRole === 'assassin' ? 'join' : 'choose');
  const [lobbyRole, setLobbyRole] = useState<'dispatcher' | 'assassin' | null>(bootRole);
  const [lobbyCode, setLobbyCode] = useState<LobbyCode | null>(
    bootRole === 'dispatcher'
      ? {
          v: 1,
          sid: generateSessionId(),
          d: props.userAddress,
          net: props.networkPassphrase,
          cid: props.contractId,
        }
      : null
  );
  const [acceptedLobby, setAcceptedLobby] = useState<LobbyCode | null>(null);
  const [responseCode, setResponseCode] = useState<string | null>(null);

  const handleChoose = (role: 'dispatcher' | 'assassin') => {
    setLobbyRole(role);
    if (role === 'dispatcher') {
      const sid = generateSessionId();
      const code: LobbyCode = {
        v: 1,
        sid,
        d: props.userAddress,
        net: props.networkPassphrase,
        cid: props.contractId,
      };
      setLobbyCode(code);
      setPhase('create');
    } else {
      setPhase('join');
    }
  };

  const handleDispatcherLaunch = (assassinAddress: string) => {
    if (!lobbyCode) return;
    // Broadcast to other tabs on the same origin so the assassin's waiting room auto-enters
    if (typeof BroadcastChannel !== 'undefined') {
      const bc = new BroadcastChannel('pol-lobby');
      bc.postMessage({ type: 'session-started', sessionId: lobbyCode.sid });
      bc.close();
    }
    props.onLobbyComplete({
      sessionId: lobbyCode.sid,
      dispatcher: props.userAddress,
      assassin: assassinAddress,
      role: 'dispatcher',
    });
  };

  const handleAssassinAccept = (lobby: LobbyCode) => {
    setAcceptedLobby(lobby);
    const resp: LobbyResponse = { v: 1, sid: lobby.sid, a: props.userAddress };
    setResponseCode(encodeResponse(resp));
    setPhase('join'); // stay on join, but we'll show the response code
  };

  // Determine what to show in join phase
  const showingResponseCode = phase === 'join' && lobbyRole === 'assassin' && responseCode !== null;

  const handleProceedToWait = () => {
    setPhase('waiting');
  };

  const handleSessionFound = () => {
    if (!acceptedLobby) return;
    props.onLobbyComplete({
      sessionId: acceptedLobby.sid,
      dispatcher: acceptedLobby.d,
      assassin: props.userAddress,
      role: 'assassin',
    });
  };

  const handleBack = () => {
    if (phase === 'choose') {
      props.onBack();
    } else if (phase === 'waiting') {
      // Back from waiting → show response code again
      setPhase('join');
    } else {
      setPhase('choose');
      setLobbyRole(null);
      setLobbyCode(null);
      setAcceptedLobby(null);
      setResponseCode(null);
    }
  };

  const titleFor: Record<LobbyPhase, string> = {
    choose:  'DUAL OPERATOR',
    create:  'CREATE LOBBY',
    join:    showingResponseCode ? 'MISSION ACCEPTED' : 'JOIN LOBBY',
    waiting: 'WAITING ROOM',
  };

  return (
    <div className="pol-introSetup pol-introSetup--enter">
      <div className="pol-introNoise" />
      <CRTPanel
        title={titleFor[phase]}
        rightTag="LOBBY"
        className="w-full max-w-lg shadow-[0_0_40px_rgba(0,0,0,0.6)] border-white/10 bg-black/80"
      >
        {phase === 'choose' && (
          <ChooseView onChoose={handleChoose} onBack={handleBack} />
        )}

        {phase === 'create' && lobbyCode && (
          <CreateView
            lobbyCode={lobbyCode}
            onLaunch={handleDispatcherLaunch}
            onBack={handleBack}
          />
        )}

        {phase === 'join' && !showingResponseCode && (
          <JoinView
            assassinAddress={props.userAddress}
            onAccept={handleAssassinAccept}
            onBack={handleBack}
          />
        )}

        {phase === 'join' && showingResponseCode && responseCode && (
          <ResponseCodeView
            responseCode={responseCode}
            hasChainBackend={!!props.chainBackend}
            onProceedToWait={handleProceedToWait}
            onEnterDirectly={handleSessionFound}
            onBack={handleBack}
          />
        )}

        {phase === 'waiting' && acceptedLobby && (
          <WaitingView
            sessionId={acceptedLobby.sid}
            dispatcherAddress={acceptedLobby.d}
            assassinAddress={props.userAddress}
            chainBackend={props.chainBackend}
            onSessionFound={handleSessionFound}
            onBack={handleBack}
          />
        )}
      </CRTPanel>
    </div>
  );
}
