# Proof of Life

**A two-player asymmetric thriller on Stellar. Your position is a secret. Your moves are proofs.**

<p align="center">
  <a href="https://youtu.be/GUpeO5FyWu4?si=7tSO3IPQGp3c9AI8">
    <img src="https://img.youtube.com/vi/GUpeO5FyWu4/maxresdefault.jpg" alt="Proof of Life — Demo Video" width="720" />
    <br/>
    <strong>▶ Watch the Demo on YouTube</strong>
  </a>
</p>

---

## The Story

Chad is trapped inside a crumbling estate. Broken glass ceilings. Peeling wallpaper. A locked front door. Somewhere in those dark rooms, a silent Assassin is hunting him.

Chad's only lifeline is you — the **Dispatcher**. You can't see inside the mansion. All you have is a radio, four signal towers on the perimeter, and a dwindling battery. Guide Chad to safety before the Assassin closes in.

---

## Roles

| Role | What you do |
|---|---|
| **Dispatcher** | Remote operator. Ping the towers to triangulate the Assassin's position, then issue commands to Chad each turn. Survive 10 turns to extract Chad. |
| **Assassin** | Move secretly through the mansion. Your position is hidden on-chain via a ZK commitment. Reach Chad before extraction. |

---

## The Mansion

A 10×10 grid with nine interconnected areas:

**Indoor Garden · Hallway · Living Room · Study · Library Wing · Dining Room · Grand Hall · Industrial Kitchen · Winter Garden (sealed)**

Each room has hide spots — closets, pantries, crawl spaces — where Chad can duck out of sight for up to two consecutive turns.

---

## Gameplay

Each round has two phases:

**1. Dispatcher phase**
- `PING` — spend 20 battery to receive the squared distance from a tower to the Assassin (proven by ZK on-chain, exact position stays hidden)
- `RECHARGE` — recover 10 battery
- Then issue a command to Chad: `STAY`, `HIDE`, `WALK` (within a room), or `GO <room>` to move through a door

**2. Assassin phase**
- Move through the mansion toward Chad's last known position — hidden by a ZK commitment, invisible to the Dispatcher

### Win Conditions

- **Dispatcher wins** — Chad survives 10 turns → *EXTRACTION COMPLETE*
- **Assassin wins** — closes in on Chad → *SIGNAL LOST*, or Chad panics → *CHAD PANICS: RAN INTO THE FOREST*, or battery runs dry → *BLACKOUT*

---

## The ZK Layer

The Assassin's position is committed on-chain using **Poseidon2** over BN254. The Dispatcher never sees it directly. Each ping generates an **UltraHonk** proof (Noir circuits, verified by a Soroban smart contract) that proves the squared distance to a tower — without revealing the Assassin's grid coordinates.

| Circuit | What it proves |
|---|---|
| `ping_distance` | Squared distance from the Assassin to a signal tower |
| `move_proof` | The Assassin's new committed position after a move is valid |
| `turn_status` | The Assassin's position relative to Chad at end-of-turn |

Every claimed move and distance report is cryptographically verified on Stellar — no trusted server required.

---

## Running Locally

### Prerequisites

```bash
# Install Noir toolchain (pin to compatible versions)
noirup --version 1.0.0-beta.18
bbup -v 0.87.0
```

### Setup

```bash
git clone https://github.com/jamesbachini/Stellar-Game-Studio
cd Stellar-Game-Studio
bun install
bun run setup          # deploy contracts to testnet + generate bindings
```

### Start the game

```bash
# Terminal 1 — ZK prover server
PORT=8788 bun run zk:prover

# Terminal 2 — frontend
cd proof-of-life-frontend && bun run dev
```

### After contract or circuit changes

```bash
cd contracts/ultrahonk-verifier && stellar contract build && cd ../..
bun run zk:build               # recompile circuits
bun run deploy proof-of-life   # redeploy contract
bun run zk:wire:auto           # rewire on-chain verifiers
bun run bindings proof-of-life # regenerate TypeScript bindings
```

> **DEV mode** is available in the frontend to skip ZK proof submission — useful for demos and local testing.

---

## License

MIT License - see LICENSE file
