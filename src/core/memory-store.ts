import {
  composeLocalAgentStore,
  paginateAgentDocuments,
  paginateCheckpointBlobIds,
  paginateRunDocuments,
  type LocalAgentDocument,
  type LocalAgentRunDocument,
  type LocalAgentRunEventDocument,
  type LocalAgentStore
} from "@cursor/sdk";

/**
 * Zero-disk ephemeral LocalAgentStore.
 * Keeps SDK checkpoints/runs strictly in RAM while an Agent is active or warm,
 * and purges every byte immediately when `purgeAgent(agentId)` is called.
 */
export class EphemeralMemoryStore {
  private readonly agentsMap = new Map<string, LocalAgentDocument>();
  private readonly checkpointsMap = new Map<string, Map<string, Uint8Array>>();
  private readonly runsMap = new Map<string, Map<string, LocalAgentRunDocument>>();
  private readonly runEventsMap = new Map<string, LocalAgentRunEventDocument[]>();
  private seqCounter = 0;

  readonly store: LocalAgentStore;

  constructor() {
    this.store = composeLocalAgentStore({
      agents: {
        get: async ({ agentId }) => this.agentsMap.get(agentId) ?? null,
        create: async ({ agent }) => {
          const copy = structuredClone(agent);
          this.agentsMap.set(agent.agentId, copy);
          return copy;
        },
        update: async ({ agent }) => {
          const copy = structuredClone(agent);
          this.agentsMap.set(agent.agentId, copy);
          return copy;
        },
        delete: async ({ filter }) => {
          for (const [id, doc] of this.agentsMap) {
            const matchId = !filter.agentIds?.length || filter.agentIds.includes(id);
            const matchCwd = !filter.cwd || doc.cwd === filter.cwd;
            if (matchId && matchCwd) this.purgeAgent(id);
          }
        },
        list: async (input) => paginateAgentDocuments([...this.agentsMap.values()], input?.filter)
      },
      checkpoints: {
        get: async ({ agentId, blobId }) => {
          const buf = this.checkpointsMap.get(agentId)?.get(blobId);
          return buf ? new Uint8Array(buf) : null;
        },
        create: async ({ agentId, blobId, data }) => {
          let sub = this.checkpointsMap.get(agentId);
          if (!sub) {
            sub = new Map();
            this.checkpointsMap.set(agentId, sub);
          }
          sub.set(blobId, new Uint8Array(data));
        },
        update: async ({ agentId, blobId, data }) => {
          let sub = this.checkpointsMap.get(agentId);
          if (!sub) {
            sub = new Map();
            this.checkpointsMap.set(agentId, sub);
          }
          sub.set(blobId, new Uint8Array(data));
        },
        delete: async ({ filter }) => {
          const targetAgents = filter.agentIds?.length ? filter.agentIds : [...this.checkpointsMap.keys()];
          for (const agentId of targetAgents) {
            const sub = this.checkpointsMap.get(agentId);
            if (!sub) continue;
            if (!filter.blobIds?.length) {
              this.checkpointsMap.delete(agentId);
            } else {
              for (const b of filter.blobIds) sub.delete(b);
              if (sub.size === 0) this.checkpointsMap.delete(agentId);
            }
          }
        },
        list: async (input) => {
          const filter = input?.filter;
          const ids: string[] = [];
          const targetAgents = filter?.agentIds?.length ? filter.agentIds : [...this.checkpointsMap.keys()];
          for (const agentId of targetAgents) {
            const sub = this.checkpointsMap.get(agentId);
            if (!sub) continue;
            for (const blobId of sub.keys()) {
              if (!filter?.blobIds?.length || filter.blobIds.includes(blobId)) ids.push(blobId);
            }
          }
          return paginateCheckpointBlobIds(ids, filter);
        }
      },
      runs: {
        get: async ({ agentId, runId }) => this.runsMap.get(agentId)?.get(runId) ?? null,
        create: async ({ run }) => {
          const copy = structuredClone(run);
          let sub = this.runsMap.get(run.agentId);
          if (!sub) {
            sub = new Map();
            this.runsMap.set(run.agentId, sub);
          }
          sub.set(run.runId, copy);
          return copy;
        },
        update: async ({ run }) => {
          const copy = structuredClone(run);
          let sub = this.runsMap.get(run.agentId);
          if (!sub) {
            sub = new Map();
            this.runsMap.set(run.agentId, sub);
          }
          sub.set(run.runId, copy);
          return copy;
        },
        delete: async ({ filter }) => {
          const targetAgents = filter.agentIds?.length ? filter.agentIds : [...this.runsMap.keys()];
          for (const agentId of targetAgents) {
            const sub = this.runsMap.get(agentId);
            if (!sub) continue;
            if (!filter.runIds?.length) {
              for (const runId of sub.keys()) this.runEventsMap.delete(runId);
              this.runsMap.delete(agentId);
            } else {
              for (const runId of filter.runIds) {
                sub.delete(runId);
                this.runEventsMap.delete(runId);
              }
              if (sub.size === 0) this.runsMap.delete(agentId);
            }
          }
        },
        list: async (input) => {
          const filter = input?.filter;
          const all: LocalAgentRunDocument[] = [];
          const targetAgents = filter?.agentIds?.length ? filter.agentIds : [...this.runsMap.keys()];
          for (const agentId of targetAgents) {
            const sub = this.runsMap.get(agentId);
            if (!sub) continue;
            for (const doc of sub.values()) {
              if (!filter?.runIds?.length || filter.runIds.includes(doc.runId)) all.push(doc);
            }
          }
          return paginateRunDocuments(all, filter);
        }
      },
      runEvents: {
        append: async ({ runId, eventType, payload, payloadRef = null, idempotencyKey = null }) => {
          let events = this.runEventsMap.get(runId);
          if (!events) {
            events = [];
            this.runEventsMap.set(runId, events);
          }
          if (idempotencyKey) {
            const dup = events.find((e) => e.idempotencyKey === idempotencyKey);
            if (dup) return dup;
          }
          const seq = ++this.seqCounter;
          const doc: LocalAgentRunEventDocument = {
            runId,
            seq,
            offset: String(seq),
            eventType,
            payload,
            payloadRef,
            idempotencyKey,
            createdAt: Date.now()
          };
          events.push(doc);
          return doc;
        },
        list: async ({ runId, afterOffset, limit = 100 }) => {
          const events = this.runEventsMap.get(runId) ?? [];
          const afterSeq = afterOffset ? Number(afterOffset) : 0;
          const filtered = events.filter((e) => e.seq > afterSeq);
          const slice = filtered.slice(0, limit);
          const nextOffset = filtered.length > limit ? slice[slice.length - 1]?.offset : undefined;
          return { items: slice, ...(nextOffset ? { nextOffset } : {}) };
        },
        delete: async ({ filter }) => {
          if (!filter.runIds?.length) this.runEventsMap.clear();
          else for (const runId of filter.runIds) this.runEventsMap.delete(runId);
        }
      }
    });
  }

  purgeAgent(agentId: string): void {
    this.agentsMap.delete(agentId);
    this.checkpointsMap.delete(agentId);
    const runs = this.runsMap.get(agentId);
    if (runs) {
      for (const runId of runs.keys()) this.runEventsMap.delete(runId);
      this.runsMap.delete(agentId);
    }
  }

  stats(): { agents: number; checkpoints: number; runs: number; runEvents: number } {
    let checkpoints = 0;
    for (const m of this.checkpointsMap.values()) checkpoints += m.size;
    let runs = 0;
    for (const m of this.runsMap.values()) runs += m.size;
    return {
      agents: this.agentsMap.size,
      checkpoints,
      runs,
      runEvents: this.runEventsMap.size
    };
  }
}
