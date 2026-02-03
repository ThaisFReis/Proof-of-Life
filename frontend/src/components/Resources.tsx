import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import './Resources.css';

export type DocSection = 'quickstart' | 'create' | 'import' | 'publish';

interface ResourcesProps {
  onBack?: () => void;
}

export function Resources({ onBack }: ResourcesProps) {
  const [activeSection, setActiveSection] = useState<DocSection>('quickstart');

  const handleNavClick = (section: DocSection) => {
    setActiveSection(section);
  };

  const handleExternalLink = (url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="resources-page">
      <aside className="resources-sidebar">
        <div className="sidebar-content">
          {onBack && (
            <button className="nav-item back" onClick={onBack}>
              ← Back to Studio
            </button>
          )}

          <h3 className="sidebar-title">Documentation</h3>

          <nav className="sidebar-nav">
            <button
              className={`nav-item ${activeSection === 'quickstart' ? 'active' : ''}`}
              onClick={() => handleNavClick('quickstart')}
            >
              <span className="nav-icon" aria-hidden="true">
                🚀
              </span>
              Quickstart
            </button>

            <button
              className={`nav-item ${activeSection === 'create' ? 'active' : ''}`}
              onClick={() => handleNavClick('create')}
            >
              <span className="nav-icon" aria-hidden="true">
                ✨
              </span>
              Create a Game
            </button>

            <button
              className={`nav-item ${activeSection === 'import' ? 'active' : ''}`}
              onClick={() => handleNavClick('import')}
            >
              <span className="nav-icon" aria-hidden="true">
                📥
              </span>
              Import a Game
            </button>

            <button
              className={`nav-item ${activeSection === 'publish' ? 'active' : ''}`}
              onClick={() => handleNavClick('publish')}
            >
              <span className="nav-icon" aria-hidden="true">
                📢
              </span>
              Publish a Game
            </button>
          </nav>

          <div className="sidebar-divider" />

          <h3 className="sidebar-title">External Links</h3>

          <nav className="sidebar-nav">
            <button
              className="nav-item external"
              onClick={() => handleExternalLink('https://developers.stellar.org/docs/soroban')}
            >
              <span className="nav-icon" aria-hidden="true">
                🪐
              </span>
              <span className="nav-label">Soroban Docs</span>
              <span className="external-icon" aria-hidden="true">
                <ExternalLink size={16} />
              </span>
            </button>

            <button
              className="nav-item external"
              onClick={() => handleExternalLink('https://docs.rs/soroban-sdk/latest/soroban_sdk/')}
            >
              <span className="nav-icon" aria-hidden="true">
                📚
              </span>
              <span className="nav-label">Soroban SDK</span>
              <span className="external-icon" aria-hidden="true">
                <ExternalLink size={16} />
              </span>
            </button>

            <button
              className="nav-item external"
              onClick={() => handleExternalLink('https://developers.stellar.org/docs/tools/developer-tools')}
            >
              <span className="nav-icon" aria-hidden="true">
                🧰
              </span>
              <span className="nav-label">Stellar CLI</span>
              <span className="external-icon" aria-hidden="true">
                <ExternalLink size={16} />
              </span>
            </button>
          </nav>
        </div>
      </aside>

      <main className="resources-content">
        <DocumentationContent section={activeSection} />
      </main>
    </div>
  );
}

export function DocumentationContent({ section }: { section: DocSection }) {
  if (section === 'quickstart') return <QuickstartSection />;
  if (section === 'create') return <CreateGameSection />;
  if (section === 'import') return <ImportGameSection />;
  return <PublishGameSection />;
}

function QuickstartSection() {
  return (
    <div className="doc-section">
      <h1 className="doc-title">Quickstart</h1>
      <p className="doc-subtitle">Get Stellar Game Studio running locally in minutes.</p>

      <div className="doc-content">
        <section className="content-block">
          <h2>Prerequisites</h2>
          <p>Install the toolchain below before you begin.</p>
          <ul>
            <li>
              <strong>
                <a href="https://bun.sh/" target="_blank" rel="noreferrer">
                  Bun
                </a>
              </strong>{' '}
              (v1.0+)
            </li>
            <li>
              <strong>
                <a href="https://www.rust-lang.org/" target="_blank" rel="noreferrer">
                  Rust & Cargo
                </a>
              </strong>{' '}
              (v1.84+)
            </li>
            <li>
              <strong>
                <a
                  href="https://developers.stellar.org/docs/tools/developer-tools"
                  target="_blank"
                  rel="noreferrer"
                >
                  Stellar CLI
                </a>
              </strong>{' '}
              (v21.0+)
            </li>
            <li>
              <strong>wasm32v1-none target</strong>
            </li>
          </ul>
          <div className="code-block">
            <pre>
              <code>{`curl -fsSL https://bun.sh/install | bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
cargo install --locked stellar-cli --features opt
rustup target add wasm32v1-none`}</code>
            </pre>
          </div>
          <div className="info-box">
            <div className="info-icon">🪟</div>
            <div>
              <strong>Windows note</strong>
              <p>
                Use WSL to run <code>bun</code>, <code>cargo</code>, and <code>stellar</code> reliably. The
                commands in this guide assume a Unix-like shell.
              </p>
            </div>
          </div>
        </section>

        <section className="content-block">
          <h2>One-command setup</h2>
          <p>Run the automated script to build, deploy, and start the dev server.</p>
          <div className="code-block">
            <pre>
              <code>{`bun run setup`}</code>
            </pre>
          </div>
          <div className="info-box">
            <div className="info-icon">ℹ️</div>
            <div>
              <strong>What happens during setup?</strong>
              <ol>
                <li>Builds all Soroban contracts</li>
                <li>Deploys contracts to Stellar testnet</li>
                <li>Generates TypeScript bindings</li>
                <li>Writes contract IDs to the root <code>.env</code></li>
                <li>Installs frontend dependencies</li>
                <li>Starts the dev server at localhost:3000</li>
              </ol>
            </div>
          </div>
        </section>

        <section className="content-block">
          <h2>Manual commands</h2>
          <p>Need to run steps independently? Use the scripts below.</p>
          <div className="code-block">
            <pre>
              <code>{`bun run build      # Build contracts only
bun run deploy     # Deploy to testnet
bun run bindings   # Generate TS bindings
bun run dev        # Start frontend dev server`}</code>
            </pre>
          </div>
          <p>
            Contract IDs are written to <code>.env</code> and summarized in <code>deployment.json</code> after
            deployment.
          </p>
        </section>
      </div>
    </div>
  );
}

function CreateGameSection() {
  return (
    <div className="doc-section">
      <h1 className="doc-title">Create a New Game</h1>
      <p className="doc-subtitle">
        Build a Soroban contract and UI that integrates with Game Hub and the studio frontend.
      </p>

      <div className="doc-content">
        <section className="content-block">
          <h2>Overview</h2>
          <p>
            A new game requires a Soroban contract, a small frontend module, and a catalog entry. The
            build/deploy/bindings scripts auto-discover contracts from the workspace, so you do not
            need to edit scripts when adding games.
          </p>
        </section>

        <section className="content-block">
          <h2>Files you will modify</h2>
          <ul>
            <li>
              <code>Cargo.toml</code> (root) - Add the contract to the workspace
            </li>
            <li>
              <code>contracts/&lt;game-name&gt;/</code> - New contract source
            </li>
            <li>
              <code>frontend/src/games/&lt;game-name&gt;/</code> - UI + service files
            </li>
            <li>
              <code>frontend/src/utils/constants.ts</code> - Add a named export (optional)
            </li>
            <li>
              <code>frontend/src/config.ts</code> - Add backwards-compatible aliases if needed
            </li>
            <li>
              <code>frontend/src/components/GamesCatalog.tsx</code> - Catalog card + routing
            </li>
          </ul>
        </section>

        <section className="content-block">
          <h2>Step 1: Copy a template contract</h2>
          <div className="code-block">
            <pre>
              <code>{`cp -r contracts/number-guess contracts/my-game`}</code>
            </pre>
          </div>
        </section>

        <section className="content-block">
          <h2>Step 2: Update the contract manifest</h2>
          <p>Edit <code>contracts/my-game/Cargo.toml</code> with your package name.</p>
          <div className="code-block">
            <pre>
              <code>{`[package]
name = "my-game"
version = "0.1.0"
edition = "2021"
publish = false

[lib]
crate-type = ["cdylib", "rlib"]
doctest = false

[dependencies]
soroban-sdk = { workspace = true }`}</code>
            </pre>
          </div>
        </section>

        <section className="content-block">
          <h2>Step 3: Add the contract to the workspace</h2>
          <p>Update the root <code>Cargo.toml</code>:</p>
          <div className="code-block">
            <pre>
              <code>{`[workspace]
resolver = "2"
members = [
  "contracts/mock-game-hub",
  "contracts/twenty-one",
  "contracts/number-guess",
  "contracts/my-game",  # Add this line
]`}</code>
            </pre>
          </div>
        </section>

        <section className="content-block">
          <h2>Step 4: Implement Game Hub integration</h2>
          <p>
            Your contract must call <code>start_game</code> and <code>end_game</code> on the Game Hub contract.
            Use the client interface below.
          </p>
          <div className="code-block">
            <pre>
              <code>{`#[contractclient(name = "GameHubClient")]
pub trait GameHub {
    fn start_game(
        env: Env,
        game_id: Address,
        session_id: u32,
        player1: Address,
        player2: Address,
        player1_points: i128,
        player2_points: i128,
    );

    fn end_game(env: Env, session_id: u32, player1_won: bool);
}`}</code>
            </pre>
          </div>
          <div className="info-box">
            <div className="info-icon">🔐</div>
            <div>
              <strong>Require player auth for points</strong>
              <p>
                Enforce <code>require_auth_for_args</code> on start_game inputs so each player signs their
                points commitment. Use <code>require_auth</code> for other player-driven actions.
              </p>
            </div>
          </div>
        </section>

        <section className="content-block">
          <h2>Step 5: Store game state with TTL</h2>
          <p>
            Use temporary storage for session state and extend the TTL to roughly 30 days to keep
            games recoverable without long-term storage costs.
          </p>
          <div className="info-box">
            <div className="info-icon">🧊</div>
            <div>
              <strong>Deterministic randomness only</strong>
              <p>Do not use ledger time or sequence as a random seed. Keep simulations deterministic.</p>
            </div>
          </div>
        </section>

        <section className="content-block">
          <h2>Step 6: Add tests</h2>
          <p>Use the mock Game Hub pattern in your unit tests.</p>
          <div className="code-block">
            <pre>
              <code>{`let env = Env::default();
env.mock_all_auths();

let hub_addr = env.register(MockGameHub, ());
let admin = Address::generate(&env);
let game_id = env.register(MyGameContract, (&admin, &hub_addr));
let client = MyGameContractClient::new(&env, &game_id);

let game_hub = MockGameHubClient::new(&env, &hub_addr);
game_hub.add_game(&game_id);`}</code>
            </pre>
          </div>
        </section>

        <section className="content-block">
          <h2>Step 7: Build, deploy, and generate bindings</h2>
          <p>Once your contract is listed in the workspace, the scripts handle the rest.</p>
          <div className="code-block">
            <pre>
              <code>{`bun run setup`}</code>
            </pre>
          </div>
          <p>
            Example: a crate named <code>my-game</code> generates <code>bindings/my_game/</code> and writes
            <code>VITE_MY_GAME_CONTRACT_ID</code> to the root <code>.env</code>.
          </p>
        </section>
      </div>
    </div>
  );
}

function ImportGameSection() {
  return (
    <div className="doc-section">
      <h1 className="doc-title">Import a Game</h1>
      <p className="doc-subtitle">
        Bring an existing Soroban game into Stellar Game Studio with minimal wiring.
      </p>

      <div className="doc-content">
        <section className="content-block">
          <h2>Overview</h2>
          <p>
            Importing a game means copying the contract + UI, adding the contract to the workspace, and
            registering it in the catalog. No script changes are required.
          </p>
        </section>

        <section className="content-block">
          <h2>Step 1: Add contract files</h2>
          <div className="code-block">
            <pre>
              <code>{`cp -r /path/to/game-contract contracts/imported-game`}</code>
            </pre>
          </div>
        </section>

        <section className="content-block">
          <h2>Step 2: Add to the workspace</h2>
          <div className="code-block">
            <pre>
              <code>{`[workspace]
members = [
  "contracts/mock-game-hub",
  "contracts/twenty-one",
  "contracts/number-guess",
  "contracts/imported-game",  # Add this
]`}</code>
            </pre>
          </div>
        </section>

        <section className="content-block">
          <h2>Step 3: Build, deploy, and generate bindings</h2>
          <div className="code-block">
            <pre>
              <code>{`bun run setup`}</code>
            </pre>
          </div>
          <p>
            Example: a crate named <code>imported-game</code> generates <code>bindings/imported_game/</code> and
            writes <code>VITE_IMPORTED_GAME_CONTRACT_ID</code> to the root <code>.env</code>.
          </p>
        </section>

        <section className="content-block">
          <h2>Step 4: Add the frontend module</h2>
          <p>Copy the game UI into the studio frontend.</p>
          <div className="code-block">
            <pre>
              <code>{`cp -r /path/to/game/frontend/src/games/imported-game frontend/src/games/`}</code>
            </pre>
          </div>
          <div className="info-box">
            <div className="info-icon">💡</div>
            <div>
              <strong>Service pattern for portability</strong>
              <p>Make sure the service accepts a <code>contractId</code> so you can reuse it elsewhere.</p>
            </div>
          </div>
          <div className="code-block">
            <pre>
              <code>{`import { Client as ImportedGameClient } from 'imported-game';
import { NETWORK_PASSPHRASE, RPC_URL } from '@/utils/constants';

export class ImportedGameService {
  private contractId: string;
  private baseClient: ImportedGameClient;

  constructor(contractId: string) {
    this.contractId = contractId;
    this.baseClient = new ImportedGameClient({
      contractId: this.contractId,
      networkPassphrase: NETWORK_PASSPHRASE,
      rpcUrl: RPC_URL,
    });
  }
}`}</code>
            </pre>
          </div>
        </section>

        <section className="content-block">
          <h2>Step 5: Register in the catalog</h2>
          <p>Update <code>frontend/src/components/GamesCatalog.tsx</code>:</p>
          <ul>
            <li>Import your game component</li>
            <li>Add a render branch for the new game</li>
            <li>Add a game card in the grid</li>
          </ul>
        </section>

        <section className="content-block">
          <h2>Step 6: Verify locally</h2>
          <div className="code-block">
            <pre>
              <code>{`bun run setup
# or individually:
bun run build
bun run deploy
bun run bindings
cd frontend && bun run dev`}</code>
            </pre>
          </div>
        </section>
      </div>
    </div>
  );
}

function PublishGameSection() {
  return (
    <div className="doc-section">
      <h1 className="doc-title">Publish a Game</h1>
      <p className="doc-subtitle">Deploy on mainnet and host your game on your own domain.</p>

      <div className="doc-content">
        <section className="content-block">
          <h2>Overview</h2>
          <p>
            Stellar Game Studio does not host third-party games. To publish, you deploy your contract
            to mainnet and host a standalone frontend on your own infrastructure.
          </p>
        </section>

        <section className="content-block">
          <h2>Step 1: Deploy your contract to mainnet</h2>
          <div className="code-block">
            <pre>
              <code>{`# Build optimized WASM
bun run build

# Install + deploy on mainnet
stellar contract install --wasm target/wasm32v1-none/release/my_game.wasm --source <ADMIN> --network mainnet
stellar contract deploy --wasm-hash <WASM_HASH> --source <ADMIN> --network mainnet -- \\
  --admin <ADMIN_ADDRESS> --game-hub <GAME_HUB_MAINNET_CONTRACT_ID>`}</code>
            </pre>
          </div>
          <div className="info-box">
            <div className="info-icon">✅</div>
            <div>
              <strong>Use the correct Game Hub mainnet ID</strong>
              <p>
                Ask the Game Hub admin for the current mainnet contract ID and ensure your admin key is
                funded for deployment.
              </p>
            </div>
          </div>
        </section>

        <section className="content-block">
          <h2>Step 2: Register your game (whitelist)</h2>
          <p>
            The mainnet Game Hub only accepts outcomes from approved games. The admin must call
            <code>add_game</code> with your contract ID and developer address.
          </p>
          <div className="code-block">
            <pre>
              <code>{`stellar contract invoke --id <GAME_HUB_MAINNET_CONTRACT_ID> --source <GAME_HUB_ADMIN> --network mainnet -- \\
  add_game --game_id <YOUR_GAME_CONTRACT_ID> --developer <YOUR_DEVELOPER_ADDRESS>`}</code>
            </pre>
          </div>
        </section>

        <section className="content-block">
          <h2>Step 3: Generate a standalone frontend</h2>
          <p>
            The publish script creates a production-ready frontend that renders only your game and
            swaps in the standalone wallet hook.
          </p>
          <div className="code-block">
            <pre>
              <code>{`bun run publish my-game

# Optional: choose a custom output directory
bun run publish my-game --out ../my-game-frontend`}</code>
            </pre>
          </div>
        </section>

        <section className="content-block">
          <h2>Step 4: Configure runtime settings</h2>
          <p>
            Update <code>public/game-studio-config.js</code> in the standalone output with your mainnet
            values.
          </p>
          <div className="code-block">
            <pre>
              <code>{`window.__STELLAR_GAME_STUDIO_CONFIG__ = {
  rpcUrl: "https://soroban-mainnet.stellar.org",
  networkPassphrase: "Public Global Stellar Network ; September 2015",
  contractIds: {
    "my-game": "<YOUR_MAINNET_CONTRACT_ID>"
  },
  simulationSourceAddress: "<OPTIONAL_FUNDED_ADDRESS>"
};`}</code>
            </pre>
          </div>
          <p>This file is loaded at runtime so you can update contract IDs without rebuilding.</p>
        </section>

        <section className="content-block">
          <h2>Step 5: Deploy the frontend</h2>
          <p>Build the standalone site and deploy to any static host.</p>
          <div className="code-block">
            <pre>
              <code>{`bun install
bun run build

# Vercel
vercel --prod

# Surge
npx surge dist

# Cloudflare Pages
wrangler pages deploy dist`}</code>
            </pre>
          </div>
        </section>
      </div>
    </div>
  );
}
