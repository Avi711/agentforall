import type { AgentRuntimeAdapter, AgentRuntimeKind } from "./types.js";

export class AgentRuntimeRegistry {
  private readonly adapters: Map<AgentRuntimeKind, AgentRuntimeAdapter>;

  constructor(adapters: AgentRuntimeAdapter[]) {
    this.adapters = new Map(adapters.map((adapter) => [adapter.kind, adapter]));
  }

  get(kind: AgentRuntimeKind): AgentRuntimeAdapter {
    const adapter = this.adapters.get(kind);
    if (!adapter) throw new Error(`unsupported agent runtime: ${kind}`);
    return adapter;
  }
}
