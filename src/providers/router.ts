import type { ProxaiConfig } from '../config.js';
import type { ProviderAdapter, ProbeResult } from './adapter.js';
import { ClaudeCodeAdapter } from './claude.js';
import { CodexAdapter } from './codex.js';
import type { ChildRegistry } from '../lifecycle/children.js';

type AdapterFactory = new (registry: ChildRegistry) => ProviderAdapter;

const adapterFactories: Record<string, AdapterFactory> = {
  claude: ClaudeCodeAdapter,
  codex: CodexAdapter,
};

export interface ProbedModel {
  id: string;
  providerName: string;
  result: ProbeResult;
}

export class ProviderRouter {
  private adapters = new Map<string, ProviderAdapter>();

  constructor(config: ProxaiConfig, registry: ChildRegistry) {
    for (const [name, provider] of Object.entries(config.providers)) {
      const Factory = adapterFactories[name];
      if (!Factory) {
        console.warn(`Unknown provider "${name}", skipping`);
        continue;
      }
      this.adapters.set(provider.model_id, new Factory(registry));
    }
  }

  getAdapter(modelId: string): ProviderAdapter | undefined {
    return this.adapters.get(modelId);
  }

  listAdapters(): { id: string; adapter: ProviderAdapter }[] {
    return Array.from(this.adapters.entries()).map(([id, adapter]) => ({ id, adapter }));
  }

  async probeAll(timeoutMs: number): Promise<ProbedModel[]> {
    const entries = Array.from(this.adapters.entries());
    const results = await Promise.all(
      entries.map(async ([id, adapter]) => ({
        id,
        providerName: adapter.name,
        result: await adapter.probe(timeoutMs),
      })),
    );
    return results;
  }
}
