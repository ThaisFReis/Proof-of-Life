import { useState } from 'react';
import { useWalletStandalone } from '../hooks/useWalletStandalone';
import './WalletStandalone.css';

export function WalletStandalone() {
  const {
    publicKey,
    isConnected,
    isConnecting,
    error,
    isWalletAvailable,
    network,
    walletType,
    connect,
    connectManual,
    disconnect,
  } = useWalletStandalone();
  const [manualAddress, setManualAddress] = useState('');
  const [showManualInput, setShowManualInput] = useState(false);

  const address = typeof publicKey === 'string' ? publicKey : '';
  const shortAddress = address ? `${address.slice(0, 6)}...${address.slice(-4)}` : '';
  const isManualMode = walletType === 'manual';

  const handleManualConnect = () => {
    connectManual(manualAddress).catch(() => undefined);
  };

  return (
    <div className="wallet-standalone">
      <div className="wallet-standalone-card">
        {!isConnected ? (
          <>
            <div className="wallet-standalone-actions">
              <button
                className="wallet-standalone-button"
                onClick={() => connect().catch(() => undefined)}
                disabled={!isWalletAvailable || isConnecting}
              >
                {isConnecting ? 'Connecting...' : 'Connect Wallet'}
              </button>
              <button
                type="button"
                className="wallet-standalone-button wallet-standalone-button-secondary"
                onClick={() => setShowManualInput((current) => !current)}
                disabled={isConnecting}
              >
                {showManualInput ? 'Hide Manual' : 'Paste Address'}
              </button>
            </div>

            {showManualInput && (
              <div className="wallet-standalone-manual">
                <label className="wallet-standalone-label" htmlFor="manual-wallet-address">
                  Manual wallet address
                </label>
                <input
                  id="manual-wallet-address"
                  className="wallet-standalone-input"
                  type="text"
                  value={manualAddress}
                  onChange={(event) => setManualAddress(event.target.value)}
                  placeholder="G..."
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  className="wallet-standalone-button wallet-standalone-button-apply"
                  onClick={handleManualConnect}
                  disabled={isConnecting || manualAddress.trim().length === 0}
                >
                  Use Address
                </button>
                <div className="wallet-standalone-hint">
                  Manual mode is view-only. Use normal wallet connect to sign transactions.
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="wallet-standalone-connected">
            <button className="wallet-standalone-button" onClick={disconnect}>
              {shortAddress}
            </button>
            <div className={`wallet-standalone-badge ${isManualMode ? 'manual' : 'wallet'}`}>
              {isManualMode ? 'Manual Address' : 'Wallet Connected'}
            </div>
          </div>
        )}
      </div>

      {network && <div className="wallet-standalone-network">{network}</div>}

      {!isWalletAvailable && (
        <div className="wallet-standalone-error">Wallet connection is only available in the browser.</div>
      )}
      {error && <div className="wallet-standalone-error">{error}</div>}
    </div>
  );
}
