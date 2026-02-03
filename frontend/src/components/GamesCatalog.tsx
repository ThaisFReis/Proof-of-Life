import { useState } from 'react';
import { TwentyOneGame } from '../games/twenty-one/TwentyOneGame';
import { NumberGuessGame } from '../games/number-guess/NumberGuessGame';
import { DiceDuelGame } from '../games/dice-duel/DiceDuelGame';
import { Resources } from './Resources';
import { useWallet } from '@/hooks/useWallet';
import './GamesCatalog.css';

const games = [
  {
    id: 'twenty-one',
    title: 'Twenty-One',
    emoji: '🃏',
    description: 'Card strategy duel where close-to-21 wins without busting.',
    tags: ['2 players', 'Card strategy'],
  },
  {
    id: 'number-guess',
    title: 'Number Guess',
    emoji: '🎯',
    description: 'Pick a number, lock it in, and reveal the closest guess.',
    tags: ['2 players', 'Fast rounds'],
  },
  {
    id: 'dice-duel',
    title: 'Dice Duel',
    emoji: '🎲',
    description: 'Roll two dice each and race for the highest total.',
    tags: ['2 players', 'Quick launch'],
  },
];

export function GamesCatalog() {
  const [selectedGame, setSelectedGame] = useState<string | null>(null);
  const { publicKey, isConnected, isConnecting, error } = useWallet();

  const userAddress = publicKey ?? '';

  const handleSelectGame = (gameId: string) => {
    setSelectedGame(gameId);
  };

  const handleBackToGames = () => {
    setSelectedGame(null);
  };

  const scrollToSection = (id: string) => {
    const target = document.getElementById(id);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  if (selectedGame === 'docs') {
    return <Resources onBack={handleBackToGames} />;
  }

  if (selectedGame === 'twenty-one') {
    return (
      <TwentyOneGame
        userAddress={userAddress}
        currentEpoch={1}
        availablePoints={1000000000n}
        onBack={handleBackToGames}
        onStandingsRefresh={() => console.log('Refresh standings')}
        onGameComplete={() => console.log('Game complete')}
      />
    );
  }

  if (selectedGame === 'number-guess') {
    return (
      <NumberGuessGame
        userAddress={userAddress}
        currentEpoch={1}
        availablePoints={1000000000n}
        onBack={handleBackToGames}
        onStandingsRefresh={() => console.log('Refresh standings')}
        onGameComplete={() => console.log('Game complete')}
      />
    );
  }

  if (selectedGame === 'dice-duel') {
    return (
      <DiceDuelGame
        userAddress={userAddress}
        currentEpoch={1}
        availablePoints={1000000000n}
        onBack={handleBackToGames}
        onStandingsRefresh={() => console.log('Refresh standings')}
        onGameComplete={() => console.log('Game complete')}
      />
    );
  }

  return (
    <div className="studio-home">
      <section className="hero">
        <div className="hero-content">
          <div className="hero-pill">Testnet Ready</div>
          <h2>Launch on-chain games with instant start and end hooks.</h2>
          <p>
            Build with Stellar Game Studio to wire points-based mechanics, deterministic outcomes,
            and multi-player flows without custom glue code.
          </p>
          <div className="hero-actions">
            <button onClick={() => scrollToSection('games')}>Explore Games</button>
            <button className="btn-secondary" onClick={() => handleSelectGame('docs')}>
              Open Docs
            </button>
          </div>
          <div className="hero-metrics">
            <div>
              <span className="metric-label">Games</span>
              <span className="metric-value">3 templates</span>
            </div>
            <div>
              <span className="metric-label">Network</span>
              <span className="metric-value">Stellar testnet</span>
            </div>
            <div>
              <span className="metric-label">Hooks</span>
              <span className="metric-value">start_game · end_game</span>
            </div>
          </div>
        </div>
        <div className="hero-panel">
          <div className="panel-title">Integration Snapshot</div>
          <pre>
            <code>{`game_hub.start_game(\n  game_id,\n  session_id,\n  player1,\n  player2,\n  player1_points,\n  player2_points,\n);`}</code>
          </pre>
          <div className="panel-footer">
            Use the shared Game Hub contract for points orchestration.
          </div>
        </div>
      </section>

      {!isConnected && (
        <div className="card wallet-banner">
          {error ? (
            <>
              <h3>Wallet Connection Error</h3>
              <p>{error}</p>
            </>
          ) : (
            <>
              <h3>{isConnecting ? 'Connecting…' : 'Connect a Dev Wallet'}</h3>
              <p>Use the switcher above to auto-connect and swap between demo players.</p>
            </>
          )}
        </div>
      )}

      <section id="games" className="games-section">
        <div className="section-header">
          <h3>Game Library</h3>
          <p>Choose a template to play now or fork into your own title.</p>
        </div>
        <div className="games-grid">
          {games.map((game, index) => (
            <button
              key={game.id}
              className="game-card"
              type="button"
              disabled={!isConnected}
              onClick={() => handleSelectGame(game.id)}
              style={{ animationDelay: `${index * 120}ms` }}
            >
              <div className="game-card-header">
                <span className="game-emoji">{game.emoji}</span>
                <span className="game-title">{game.title}</span>
              </div>
              <p className="game-description">{game.description}</p>
              <div className="game-tags">
                {game.tags.map((tag) => (
                  <span key={tag} className="game-tag">
                    {tag}
                  </span>
                ))}
              </div>
              <div className="game-cta">Launch Game</div>
            </button>
          ))}
        </div>
      </section>

      <section id="quickstart" className="quickstart-section">
        <div className="section-header">
          <h3>Quickstart</h3>
          <p>Deploy contracts, generate bindings, and start the frontend in minutes.</p>
        </div>
        <div className="quickstart-grid">
          <div className="quickstart-card">
            <h4>1. Setup</h4>
            <p>Build and deploy contracts to testnet.</p>
            <code>bun run setup</code>
          </div>
          <div className="quickstart-card">
            <h4>2. Generate bindings</h4>
            <p>Keep the frontend synced with your contracts.</p>
            <code>bun run bindings</code>
          </div>
          <div className="quickstart-card">
            <h4>3. Build the game loop</h4>
            <p>Call start and end hooks from your contract.</p>
            <code>start_game / end_game</code>
          </div>
        </div>
      </section>

      <section className="integration-section">
        <div className="section-header">
          <h3>Why Game Hub?</h3>
          <p>Use a shared contract to coordinate points, sessions, and outcomes.</p>
        </div>
        <div className="integration-grid">
          <div className="integration-card">
            <h4>Points orchestration</h4>
            <p>Lock points at start and unlock on completion with a single call.</p>
          </div>
          <div className="integration-card">
            <h4>Deterministic outcomes</h4>
            <p>Ship predictable simulations and reliable on-chain submissions.</p>
          </div>
          <div className="integration-card">
            <h4>Reusable templates</h4>
            <p>Start from proven game loops and customize fast.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
