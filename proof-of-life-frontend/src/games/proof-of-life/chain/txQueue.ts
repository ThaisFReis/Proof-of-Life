export class TxQueue {
  private tail: Promise<unknown> = Promise.resolve();

  enqueue<T>(fn: () => Promise<T>): Promise<T> {
    // Ensure we continue even if the previous item failed.
    const run = this.tail.catch(() => undefined).then(fn);
    this.tail = run;
    return run;
  }
}

