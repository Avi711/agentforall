const MAX_TRACKED = 200;

// Produced chunks kept until the relay accepted each; a redelivery resends the rest, never re-asks the model. In memory only.
export class ReplyQueue {
  constructor(limit = MAX_TRACKED) {
    this.limit = limit;
    this.pending = new Map();
  }

  has(wamid) {
    return this.pending.has(wamid);
  }

  add(wamid, sends) {
    const list = this.pending.get(wamid) ?? [];
    list.push(...sends);
    this.pending.delete(wamid);
    this.pending.set(wamid, list);
    while (this.pending.size > this.limit) this.pending.delete(this.pending.keys().next().value);
  }

  // In order; the first failure stops the flush and keeps the rest for the next attempt.
  async flush(wamid, send) {
    const list = this.pending.get(wamid);
    if (!list) return;
    while (list.length > 0) {
      await send(list[0]);
      list.shift();
    }
    this.pending.delete(wamid);
  }

  forget(wamid) {
    this.pending.delete(wamid);
  }
}
