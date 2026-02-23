import { describe, expect, it } from 'bun:test';
import { TxQueue } from './txQueue';

describe('chain/TxQueue', () => {
  it('runs enqueued jobs sequentially (no overlap)', async () => {
    const q = new TxQueue();
    const events: string[] = [];

    let running = 0;
    const job = (name: string, delayMs: number) =>
      q.enqueue(async () => {
        events.push(`start:${name}`);
        running++;
        expect(running).toBe(1);
        await new Promise((r) => setTimeout(r, delayMs));
        running--;
        events.push(`end:${name}`);
        return name;
      });

    const p1 = job('a', 30);
    const p2 = job('b', 1);
    const p3 = job('c', 1);

    expect(await p1).toBe('a');
    expect(await p2).toBe('b');
    expect(await p3).toBe('c');

    expect(events).toEqual(['start:a', 'end:a', 'start:b', 'end:b', 'start:c', 'end:c']);
  });

  it('continues after a failure', async () => {
    const q = new TxQueue();
    const events: string[] = [];

    const p1 = q.enqueue(async () => {
      events.push('a');
      throw new Error('fail');
    });
    const p2 = q.enqueue(async () => {
      events.push('b');
      return 2;
    });

    await expect(p1).rejects.toThrow(/fail/);
    expect(await p2).toBe(2);
    expect(events).toEqual(['a', 'b']);
  });
});

