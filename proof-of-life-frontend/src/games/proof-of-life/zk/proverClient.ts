import { Buffer } from 'buffer';

export type PingDistanceReq = {
  x: number;
  y: number;
  salt: number;
  tower_x: number;
  tower_y: number;
  session_id: number;
  turn: number;
};

export type TurnStatusReq = {
  x: number;
  y: number;
  salt: number;
  cx: number;
  cy: number;
  session_id: number;
  turn: number;
};

export type MoveProofReq = {
  x_old: number;
  y_old: number;
  salt_old: number;
  x_new: number;
  y_new: number;
  salt_new: number;
  session_id: number;
  turn: number;
};

export type ProveResponse = {
  circuit: 'ping_distance' | 'turn_status' | 'move_proof';
  proof_hex: string; // raw bytes hex (no 0x)
  public_inputs_fields: string[]; // 0x-prefixed 32-byte hex fields
};

function bytesFromHex(hex: string): Uint8Array {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  return new Uint8Array(Buffer.from(h, 'hex'));
}

function fieldToU32(hex32: string): number {
  const h = hex32.startsWith('0x') ? hex32.slice(2) : hex32;
  // Big-endian u32 is stored in the last 4 bytes.
  const buf = Buffer.from(h, 'hex');
  if (buf.length !== 32) throw new Error(`expected 32-byte field, got ${buf.length}`);
  return (((buf[28]! << 24) | (buf[29]! << 16) | (buf[30]! << 8) | buf[31]!) >>> 0);
}

function ensureLen(fields: string[], n: number, circuit: string) {
  if (fields.length < n) {
    throw new Error(`invalid ${circuit} public_inputs_fields length=${fields.length}, expected >=${n}`);
  }
}

// Contract enforces v3 layout: [tower_x, tower_y, session_id, turn, commitment, d2]
function parsePingLayout(raw: string[], req: PingDistanceReq): { commitment: string; d2: number; normalized: string[] } {
  ensureLen(raw, 6, 'ping_distance');
  
  // Verify session_id (idx 2) and turn (idx 3) match request
  // We use relaxed checking to allow for prover returning hex strings or fields
  const sidField = fieldToU32(raw[2]!);
  const turnField = fieldToU32(raw[3]!);
  
  if (sidField !== (req.session_id >>> 0) || turnField !== (req.turn >>> 0)) {
    throw new Error(
      `ping_distance public input mismatch: expected session=${req.session_id >>> 0} turn=${req.turn >>> 0}, got session=${sidField} turn=${turnField}`
    );
  }

  return {
    commitment: raw[4]!,
    d2: fieldToU32(raw[5]!),
    // Pass raw through exactly as received, since it matches contract layout
    normalized: raw,
  };
}

// Contract checks: [cx, cy, session_id, turn, commitment, d2_chad]
function parseTurnStatusLayout(raw: string[], req: TurnStatusReq): { commitment: string; d2Chad: number; normalized: string[] } {
  ensureLen(raw, 6, 'turn_status');

  const sidField = fieldToU32(raw[2]!);
  const turnField = fieldToU32(raw[3]!);

  if (sidField !== (req.session_id >>> 0) || turnField !== (req.turn >>> 0)) {
    throw new Error(
      `turn_status public input mismatch: expected session=${req.session_id >>> 0} turn=${req.turn >>> 0}, got session=${sidField} turn=${turnField}`
    );
  }

  return {
    commitment: raw[4]!,
    d2Chad: fieldToU32(raw[5]!),
    normalized: raw
  };
}

// Contract checks: [session_id, turn, commitment_old, commitment_new]
function parseMoveLayout(raw: string[], req: MoveProofReq): { commitmentOld: string; commitmentNew: string; normalized: string[] } {
  ensureLen(raw, 4, 'move_proof');

  const sidField = fieldToU32(raw[0]!);
  const turnField = fieldToU32(raw[1]!);

  if (sidField !== (req.session_id >>> 0) || turnField !== (req.turn >>> 0)) {
    throw new Error(
      `move_proof public input mismatch: expected session=${req.session_id >>> 0} turn=${req.turn >>> 0}, got session=${sidField} turn=${turnField}`
    );
  }

  return {
    commitmentOld: raw[2]!,
    commitmentNew: raw[3]!,
    normalized: raw,
  };
}

export class ZkProverClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async pingDistance(req: PingDistanceReq): Promise<{ proof: Uint8Array; publicInputs: string[]; commitment: string; d2: number }> {
    const r = await this.post('/prove/ping_distance', req);
    const publicInputsRaw = r.public_inputs_fields.slice();
    const { commitment, d2, normalized } = parsePingLayout(publicInputsRaw, req);
    return { proof: bytesFromHex(r.proof_hex), publicInputs: normalized, commitment, d2 };
  }

  async moveProof(req: MoveProofReq): Promise<{ proof: Uint8Array; publicInputs: string[]; commitmentOld: string; commitmentNew: string }> {
    const r = await this.post('/prove/move_proof', req);
    const publicInputsRaw = r.public_inputs_fields.slice();
    const { commitmentOld, commitmentNew, normalized } = parseMoveLayout(publicInputsRaw, req);
    return { proof: bytesFromHex(r.proof_hex), publicInputs: normalized, commitmentOld, commitmentNew };
  }

  async turnStatus(req: TurnStatusReq): Promise<{ proof: Uint8Array; publicInputs: string[]; commitment: string; d2Chad: number }> {
    const r = await this.post('/prove/turn_status', req);
    const publicInputsRaw = r.public_inputs_fields.slice();
    const { commitment, d2Chad, normalized } = parseTurnStatusLayout(publicInputsRaw, req);
    return { proof: bytesFromHex(r.proof_hex), publicInputs: normalized, commitment, d2Chad };
  }

  private async post(pathname: string, body: any): Promise<ProveResponse> {
    const resp = await fetch(`${this.baseUrl}${pathname}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const t = await resp.text().catch(() => '');
      throw new Error(`prover ${resp.status}: ${t || resp.statusText}`);
    }
    return (await resp.json()) as ProveResponse;
  }
}
