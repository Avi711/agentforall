export class InstanceOperationLock {
  private readonly locks = new Map<string, Promise<void>>();

  async run<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(id) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chained = previous.then(() => current, () => current);
    this.locks.set(id, chained);

    await previous.catch(() => undefined);
    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(id) === chained) this.locks.delete(id);
    }
  }
}
