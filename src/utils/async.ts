export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

export function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // Prevent unhandled rejection crashes when parked sessions are evicted early
  promise.catch(() => undefined);
  return { promise, resolve, reject };
}

export class AsyncEventQueue<T> {
  private readonly buffer: T[] = [];
  private readonly waiters: Array<{
    resolve: (r: IteratorResult<T>) => void;
    reject: (e: unknown) => void;
  }> = [];
  private closed = false;
  private failure: unknown = null;

  push(item: T): void {
    if (this.closed || this.failure !== null) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve({ value: item, done: false });
    else this.buffer.push(item);
  }

  close(): void {
    if (this.closed || this.failure !== null) return;
    this.closed = true;
    while (this.waiters.length > 0) {
      this.waiters.shift()!.resolve({ value: undefined as unknown as T, done: true });
    }
  }

  fail(err: unknown): void {
    if (this.closed || this.failure !== null) return;
    this.failure = err;
    while (this.waiters.length > 0) {
      this.waiters.shift()!.reject(err);
    }
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T, void, unknown> {
    while (true) {
      if (this.buffer.length > 0) {
        yield this.buffer.shift()!;
        continue;
      }
      if (this.failure !== null) throw this.failure;
      if (this.closed) return;
      const next = await new Promise<IteratorResult<T>>((resolve, reject) => {
        this.waiters.push({ resolve, reject });
      });
      if (next.done) return;
      yield next.value;
    }
  }
}
