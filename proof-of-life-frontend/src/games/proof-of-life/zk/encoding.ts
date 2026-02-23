// Canonical public input ordering helpers.
// Keep this stable once on-chain verification is wired.

// v3 notes:
// - UltraHonk/Noir "public inputs" as consumed by the Soroban verifier are a flat list of 32-byte fields.
// - We include anti-replay fields (session_id, turn).
// - We include the expected public outputs (commitment(s), d2 / d2_chad) in the flattened list so the
//   contract can bind arguments to proof outputs and persist commitment on-chain.
export const ZK_INPUTS_VERSION = 3 as const;

export type Field = bigint;

export type PingPublicInputsV1 = Readonly<{
  commitment: Field;
  towerX: Field;
  towerY: Field;
}>;

// Matches Noir function signature public inputs: (commitment, tower_x, tower_y)
export function encodePingPublicInputsV1(x: PingPublicInputsV1): readonly Field[] {
  return [x.commitment, x.towerX, x.towerY] as const;
}

export type TurnStatusPublicInputsV1 = Readonly<{
  commitment: Field;
  chadX: Field;
  chadY: Field;
}>;

// Matches Noir function signature public inputs: (commitment, cx, cy)
export function encodeTurnStatusPublicInputsV1(x: TurnStatusPublicInputsV1): readonly Field[] {
  return [x.commitment, x.chadX, x.chadY] as const;
}

export type MovePublicInputsV1 = Readonly<{
  commitmentOld: Field;
  commitmentNew: Field;
}>;

// Matches Noir function signature public inputs: (commitment_old, commitment_new)
export function encodeMovePublicInputsV1(x: MovePublicInputsV1): readonly Field[] {
  return [x.commitmentOld, x.commitmentNew] as const;
}

// v3 public field lists (public inputs + public outputs, flattened in-order).
// These must match the exact order of fields used by the verifier contract.

export type PingPublicFieldsV3 = Readonly<{
  commitment: Field;
  towerX: Field;
  towerY: Field;
  sessionId: Field;
  turn: Field;
  d2: Field;
}>;

// Canonical UltraHonk field ordering (bb `bytes_and_fields`) for ping_distance (v3):
// [commitment, tower_x, tower_y, session_id, turn, d2]
export function encodePingPublicFieldsV3(x: PingPublicFieldsV3): readonly Field[] {
  return [x.commitment, x.towerX, x.towerY, x.sessionId, x.turn, x.d2] as const;
}

export type TurnStatusPublicFieldsV3 = Readonly<{
  commitment: Field;
  chadX: Field;
  chadY: Field;
  sessionId: Field;
  turn: Field;
  d2Chad: Field;
}>;

// Canonical UltraHonk field ordering (bb `bytes_and_fields`) for turn_status (v3):
// [commitment, cx, cy, session_id, turn, d2_chad]
export function encodeTurnStatusPublicFieldsV3(x: TurnStatusPublicFieldsV3): readonly Field[] {
  return [x.commitment, x.chadX, x.chadY, x.sessionId, x.turn, x.d2Chad] as const;
}

export type MovePublicFieldsV3 = Readonly<{
  commitmentOld: Field;
  commitmentNew: Field;
  sessionId: Field;
  turn: Field;
}>;

// Canonical UltraHonk field ordering (bb `bytes_and_fields`) for move_proof (v3):
// [commitment_old, commitment_new, session_id, turn]
export function encodeMovePublicFieldsV3(x: MovePublicFieldsV3): readonly Field[] {
  return [x.commitmentOld, x.commitmentNew, x.sessionId, x.turn] as const;
}
