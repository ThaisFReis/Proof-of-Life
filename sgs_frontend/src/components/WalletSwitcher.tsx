import { useEffect, useRef, useState } from 'react';
import { useWallet } from '../hooks/useWallet';
import './WalletSwitcher.css';

export function WalletSwitcher() {
  const {
    publicKey,
    isConnected,
    isConnecting,
    walletType,
    error,
    connectDev,
    connectManual,
    disconnect,
    switchPlayer,
    getCurrentDevPlayer,
  } = useWallet();

  const currentPlayer = getCurrentDevPlayer();
  const hasAttemptedConnection = useRef(false);
  const [showManualInput, setShowManualInput] = useState(false);
  const [manualAddress, setManualAddress] = useState('');

  // Auto-connect to Player 1 on mount (only try once)
  useEffect(() => {
    if (!isConnected && !isConnecting && !hasAttemptedConnection.current && !showManualInput) {
      hasAttemptedConnection.current = true;
      connectDev(1).catch(console.error);
    }
  }, [isConnected, isConnecting, connectDev, showManualInput]);

  const handleSwitch = async () => {
    if (walletType !== 'dev') return;

    const nextPlayer = currentPlayer === 1 ? 2 : 1;
    try {
      await switchPlayer(nextPlayer);
    } catch (err) {
      console.error('Failed to switch player:', err);
    }
  };

  const handleManualConnect = async () => {
    try {
      await connectManual(manualAddress);
      setShowManualInput(false);
    } catch (err) {
      console.error('Failed to use manual address:', err);
    }
  };

  const handleShowManual = async () => {
    setShowManualInput((value) => !value);
    if (isConnected) {
      await disconnect();
    }
  };

  if (!isConnected) {
    return (
      <div className="wallet-switcher">
        <div className="wallet-panel">
          <div className="wallet-panel-actions">
            <button
              type="button"
              className="wallet-panel-button wallet-panel-button-secondary"
              onClick={handleShowManual}
              disabled={isConnecting}
            >
              {showManualInput ? 'Hide Manual' : 'Paste Address'}
            </button>
          </div>

          {showManualInput && (
            <div className="wallet-manual-form">
              <label className="wallet-manual-label" htmlFor="wallet-switcher-manual-address">
                Manual wallet address
              </label>
              <input
                id="wallet-switcher-manual-address"
                className="wallet-manual-input"
                type="text"
                value={manualAddress}
                onChange={(event) => setManualAddress(event.target.value)}
                placeholder="G..."
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                className="wallet-panel-button"
                onClick={handleManualConnect}
                disabled={isConnecting || manualAddress.trim().length === 0}
              >
                Use Address
              </button>
              <div className="wallet-manual-note">
                Manual mode is read-only and cannot sign transactions.
              </div>
            </div>
          )}
        </div>

        {error ? (
          <div className="wallet-error">
            <div className="error-title">Connection Failed</div>
            <div className="error-message">{error}</div>
          </div>
        ) : (
          <div className="wallet-status connecting">
            <span className="status-indicator"></span>
            <span className="status-text">Connecting...</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="wallet-switcher">
      {error && (
        <div className="wallet-error">
          {error}
        </div>
      )}

      <div className="wallet-info">
        <div className="wallet-status connected">
          <span className="status-indicator"></span>
          <div className="wallet-details">
            <div className="wallet-label">
              Connected Player {currentPlayer}
            </div>
            <div className="wallet-address">
              {publicKey ? `${publicKey.slice(0, 8)}...${publicKey.slice(-4)}` : ''}
            </div>
          </div>
          {walletType === 'dev' && (
            <button
              onClick={handleSwitch}
              className="switch-button"
              disabled={isConnecting}
            >
              Switch to Player {currentPlayer === 1 ? 2 : 1}
            </button>
          )}
          <button
            type="button"
            className="switch-button switch-button-secondary"
            onClick={handleShowManual}
            disabled={isConnecting}
          >
            {walletType === 'manual' ? 'Change Address' : 'Paste Address'}
          </button>
        </div>
      </div>

      {showManualInput && (
        <div className="wallet-panel wallet-panel-floating">
          <div className="wallet-manual-form">
            <label className="wallet-manual-label" htmlFor="wallet-switcher-manual-address-connected">
              Manual wallet address
            </label>
            <input
              id="wallet-switcher-manual-address-connected"
              className="wallet-manual-input"
              type="text"
              value={manualAddress}
              onChange={(event) => setManualAddress(event.target.value)}
              placeholder="G..."
              autoComplete="off"
              spellCheck={false}
            />
            <div className="wallet-panel-actions">
              <button
                type="button"
                className="wallet-panel-button"
                onClick={handleManualConnect}
                disabled={isConnecting || manualAddress.trim().length === 0}
              >
                Use Address
              </button>
              <button
                type="button"
                className="wallet-panel-button wallet-panel-button-secondary"
                onClick={() => setShowManualInput(false)}
              >
                Cancel
              </button>
            </div>
            <div className="wallet-manual-note">
              Manual mode is read-only and cannot sign transactions.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
