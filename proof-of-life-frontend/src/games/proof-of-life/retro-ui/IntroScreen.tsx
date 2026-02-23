import React, { useEffect, useState } from 'react';
import { AsciiTitle, CRTPanel } from './components';
import './IntroScreen.css';

interface IntroProps {
  onStart: () => void;
  onShowRules: () => void;
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
  };
  userAddress: string;
  mode: 'single' | 'two-player';
  setMode: (m: 'single' | 'two-player') => void;
  assassinAddress: string;
  setAssassinAddress: (a: string) => void;
  devMode: boolean;
  setDevMode: (b: boolean) => void;
}

export function IntroScreen(props: IntroProps) {
  const [blink, setBlink] = useState(true);
  const [showLogin, setShowLogin] = useState(false);
  const configLocked = !props.wallet.isConnected;
  const isRealWallet = props.wallet.walletType === 'wallet';

  useEffect(() => {
    const interval = setInterval(() => setBlink((b) => !b), 800);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!showLogin && (e.key === 'Enter' || e.key === ' ')) {
        setShowLogin(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showLogin]);

  if (!showLogin) {
    return (
      <section className="pol-introLanding pol-introLanding--enter">
        <div className="pol-introNoise" />
        <div className="pol-introGlow pol-introGlow--left" />
        <div className="pol-introGlow pol-introGlow--right" />

        <div className="pol-introShell">
          <header className="pol-introHero">
            <div className="pol-introTitleWrap">
              <div className="pol-introAscii">
                <AsciiTitle />
              </div>
              <p className="pol-introTagline">TACTICAL RESPONSE SYSTEM v3.1</p>
            </div>
            <div className="pol-introPulse">
              <span className="pol-introPulseDot" />
              <span>SECURE CHANNEL OPEN</span>
            </div>
          </header>

          <aside className="pol-introMenuCard">
            <div className="pol-introMenuLabel">MISSION ENTRY</div>
            <button
              onClick={() => setShowLogin(true)}
              className="pol-introAction pol-introAction--primary"
            >
              <span className={blink ? 'pol-blink' : ''}>[ INITIATE UPLINK ]</span>
            </button>

            <button
              onClick={props.onShowRules}
              className="pol-introAction pol-introAction--secondary"
            >
              [ MISSION BRIEF ]
            </button>

            <p className="pol-introHint">PRESS ENTER OR SPACE TO CONTINUE</p>
          </aside>
        </div>
      </section>
    );
  }

  const handleConnect = () => {
    if (isRealWallet && props.wallet.connect) {
      props.wallet.connect().catch(() => undefined);
    } else {
      props.wallet.connectDev(1);
    }
  };

  return (
    <div className="pol-introSetup pol-introSetup--enter">
      <div className="pol-introNoise" />
      <CRTPanel
        title="SYSTEM BOOT"
        rightTag="CONFIG"
        className="w-full max-w-3xl shadow-[0_0_40px_rgba(0,0,0,0.6)] border-white/10 bg-black/80"
      >
        <div className="pol-setupGrid">
          <section className="pol-setupCard">
            <div className="pol-setupCardTop">
              <h3>Identity Uplink</h3>
              <div
                className={`pol-setupStatus ${props.wallet.isConnected ? 'pol-setupStatus--ok' : 'pol-setupStatus--warn'}`}
              >
                {props.wallet.isConnected ? 'VERIFIED' : 'UNSTABLE'}
              </div>
            </div>

            {!props.wallet.isConnected ? (
              <div className="pol-setupStack">
                <p className="pol-setupTerminalLine">&gt; Searching for operative signature...</p>
                <button
                  className="pol-setupBtn pol-setupBtn--connect"
                  onClick={handleConnect}
                  disabled={props.wallet.isConnecting}
                >
                  {props.wallet.isConnecting ? 'HANDSHAKE IN PROGRESS...' : 'CONNECT WALLET'}
                </button>
              </div>
            ) : (
              <div className="pol-setupStack">
                <div className="pol-setupIdentity">
                  <div className="pol-setupIdentityText">
                    ID: {props.userAddress.slice(0, 10)}...{props.userAddress.slice(-6)}
                    <span>[{props.wallet.walletId || (isRealWallet ? 'WALLET' : 'DEV')}]</span>
                  </div>
                  {isRealWallet && props.wallet.disconnect ? (
                    <button
                      className="pol-setupBtn pol-setupBtn--tiny"
                      onClick={props.wallet.disconnect}
                    >
                      Disconnect
                    </button>
                  ) : !isRealWallet ? (
                    <button
                      className="pol-setupBtn pol-setupBtn--tiny"
                      onClick={() => {
                        const current = props.wallet.walletId?.includes('player1')
                          ? 1
                          : props.wallet.walletId?.includes('player2')
                            ? 2
                            : 1;
                        props.wallet.switchPlayer(current === 1 ? 2 : 1);
                      }}
                    >
                      Swap ID
                    </button>
                  ) : null}
                </div>
              </div>
            )}

            {props.wallet.error && <div className="pol-setupError">ERROR: {props.wallet.error}</div>}

            {!props.wallet.hasContract && (
              <div className="pol-setupWarning">WARNING: NO ON-CHAIN CONTRACT DETECTED. SIMULATION MODE ONLY.</div>
            )}
          </section>

          <section
            className={`pol-setupCard pol-setupCard--config ${props.wallet.isConnected ? '' : 'pol-setupCard--locked'}`}
          >
            <div className="pol-setupRow">
              <span>Mission Type</span>
              <div className="pol-segmented">
                <button
                  className={`pol-segmentedBtn ${props.mode === 'single' ? 'is-active is-cyan' : ''}`}
                  disabled={configLocked}
                  onClick={() => {
                    props.setMode('single');
                    props.setAssassinAddress('');
                  }}
                >
                  Solo Ops
                </button>
                <button
                  className={`pol-segmentedBtn ${props.mode === 'two-player' ? 'is-active is-copper' : ''}`}
                  disabled={configLocked}
                  onClick={() => props.setMode('two-player')}
                >
                  Dual Operator
                </button>
              </div>
            </div>

            {props.mode === 'two-player' && (
              <div className="pol-setupStack pol-setupAnimateIn">
                <label className="pol-setupLabel">Assassin Operator ID</label>
                <input
                  type="text"
                  className="pol-setupInput"
                  placeholder="G... (Stellar address)"
                  value={props.assassinAddress}
                  disabled={configLocked}
                  onChange={(e) => props.setAssassinAddress(e.target.value)}
                />
              </div>
            )}

            <div className="pol-setupRow">
              <span>Protocol Security</span>
              <div className="pol-segmented">
                <button
                  className={`pol-segmentedBtn ${props.devMode ? 'is-active is-copper' : ''}`}
                  disabled={configLocked}
                  onClick={() => props.setDevMode(true)}
                >
                  DEV (OPEN)
                </button>
                <button
                  className={`pol-segmentedBtn ${!props.devMode ? 'is-active is-emerald' : ''}`}
                  disabled={configLocked}
                  onClick={() => props.setDevMode(false)}
                >
                  PROD (ZK)
                </button>
              </div>
            </div>

            <div className="pol-setupActions">
              <button
                className="pol-setupBtn pol-setupBtn--launch"
                onClick={props.onStart}
                disabled={!props.wallet.isConnected || (props.mode === 'two-player' && !props.assassinAddress.trim())}
              >
                {props.mode === 'single' ? 'EXECUTE SOLO MISSION' : 'ESTABLISH DUAL SESSION'}
              </button>

              <button onClick={() => setShowLogin(false)} className="pol-setupBack">
                Abort Sequence (Back)
              </button>
            </div>
          </section>
        </div>
      </CRTPanel>
    </div>
  );
}
