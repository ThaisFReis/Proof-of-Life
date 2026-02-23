# Circuits (Noir)

This folder contains Noir circuit source for Proof of Life.

Status
- Circuit source is committed here.
- In this environment we are not compiling circuits by default (tooling may be missing). See `scripts/build_ultrahonk.sh`.

Public field encoding (v2)
- We standardize public field ordering to match the Noir function signature public inputs, with the circuit's public output appended as the final field.
- We include `session_id` and `turn` as public inputs for anti-replay.
- Commitments use `poseidon2_permutation([x, y, salt, 0], 4)[0]` (Poseidon2 over BN254).

v2 ordering (inputs + output):
- Ping distance: `[commitment, tower_x, tower_y, session_id, turn, d2]`
- Turn status: `[commitment, cx, cy, session_id, turn, d2_chad]`
- Move proof: `[commitment_old, commitment_new, session_id, turn]` (no public output)

See `proof-of-life-frontend/src/games/proof-of-life/zk/encoding.ts` for the canonical ordering helpers and tests.
