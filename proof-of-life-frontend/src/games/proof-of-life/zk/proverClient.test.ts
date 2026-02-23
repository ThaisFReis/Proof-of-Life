import { describe, expect, it } from 'bun:test';
import { ZkProverClient } from './proverClient';

function u32FieldHex(v: number): string {
  const b = new Uint8Array(32);
  b[28] = (v >>> 24) & 0xff;
  b[29] = (v >>> 16) & 0xff;
  b[30] = (v >>> 8) & 0xff;
  b[31] = v & 0xff;
  return `0x${Buffer.from(b).toString('hex')}`;
}

describe('zk/proverClient public inputs handling', () => {
  it('preserves ping_distance layout used by contract', async () => {
    const c = new ZkProverClient('http://local');
    (c as any).post = async () => ({
      circuit: 'ping_distance',
      proof_hex: '00',
      // [tower_x, tower_y, session_id, turn, commitment, d2]
      public_inputs_fields: [u32FieldHex(0), u32FieldHex(5), u32FieldHex(42), u32FieldHex(3), '0x' + '11'.repeat(32), u32FieldHex(25)],
    });
    const out = await c.pingDistance({
      x: 1, y: 2, salt: 3, tower_x: 0, tower_y: 5, session_id: 42, turn: 3,
    });
    // [tower_x, tower_y, session_id, turn, commitment, d2]
    expect(out.publicInputs).toEqual([u32FieldHex(0), u32FieldHex(5), u32FieldHex(42), u32FieldHex(3), '0x' + '11'.repeat(32), u32FieldHex(25)]);
    expect(out.commitment).toBe('0x' + '11'.repeat(32));
    expect(out.d2).toBe(25);
  });

  it('preserves move_proof layout used by contract', async () => {
    const c = new ZkProverClient('http://local');
    const sessionId = 3559003035; // > 2^31, must stay unsigned when decoded from field
    (c as any).post = async () => ({
      circuit: 'move_proof',
      proof_hex: '00',
      // [session_id, turn, commitment_old, commitment_new]
      public_inputs_fields: [u32FieldHex(sessionId), u32FieldHex(9), '0x' + '22'.repeat(32), '0x' + '33'.repeat(32)],
    });
    const out = await c.moveProof({
      x_old: 1, y_old: 1, salt_old: 1, x_new: 2, y_new: 2, salt_new: 2, session_id: sessionId, turn: 9,
    });
    expect(out.commitmentOld).toBe('0x' + '22'.repeat(32));
    expect(out.commitmentNew).toBe('0x' + '33'.repeat(32));
    // [session_id, turn, commitment_old, commitment_new]
    expect(out.publicInputs).toEqual([u32FieldHex(sessionId), u32FieldHex(9), '0x' + '22'.repeat(32), '0x' + '33'.repeat(32)]);
  });

  it('preserves turn_status beta9 layout (V2)', async () => {
    const c = new ZkProverClient('http://local');
    (c as any).post = async () => ({
      circuit: 'turn_status',
      proof_hex: '00',
      // [cx, cy, session_id, turn, commitment, d2_chad]
      public_inputs_fields: [u32FieldHex(4), u32FieldHex(7), u32FieldHex(99), u32FieldHex(2), '0x' + '44'.repeat(32), u32FieldHex(13)],
    });
    const out = await c.turnStatus({
      x: 1, y: 1, salt: 123, cx: 4, cy: 7, session_id: 99, turn: 2,
    });
    expect(out.commitment).toBe('0x' + '44'.repeat(32));
    // Expected: [cx, cy, session_id, turn, commitment, d2_chad] (V2)
    expect(out.publicInputs).toEqual([u32FieldHex(4), u32FieldHex(7), u32FieldHex(99), u32FieldHex(2), '0x' + '44'.repeat(32), u32FieldHex(13)]);
    expect(out.d2Chad).toBe(13);
  });

  it('keeps ping_distance layout unchanged and infers commitment/d2', async () => {
    const c = new ZkProverClient('http://local');
    const canonical = [u32FieldHex(0), u32FieldHex(5), u32FieldHex(7), u32FieldHex(1), '0x' + 'aa'.repeat(32), u32FieldHex(9)];
    (c as any).post = async () => ({
      circuit: 'ping_distance',
      proof_hex: '00',
      public_inputs_fields: canonical,
    });
    const out = await c.pingDistance({
      x: 1, y: 1, salt: 1, tower_x: 0, tower_y: 5, session_id: 7, turn: 1,
    });
    expect(out.publicInputs).toEqual(canonical);
    expect(out.commitment).toBe(canonical[4]);
    expect(out.d2).toBe(9);
  });

  it('throws when session/turn in public inputs do not match request', async () => {
    const c = new ZkProverClient('http://local');
    (c as any).post = async () => ({
      circuit: 'ping_distance',
      proof_hex: '00',
      public_inputs_fields: [u32FieldHex(0), u32FieldHex(5), u32FieldHex(999), u32FieldHex(8), '0x' + 'aa'.repeat(32), u32FieldHex(4)],
    });
    await expect(
      c.pingDistance({
        x: 1, y: 1, salt: 1, tower_x: 0, tower_y: 5, session_id: 7, turn: 1,
      })
    ).rejects.toThrow(/public input mismatch/i);
  });
});
