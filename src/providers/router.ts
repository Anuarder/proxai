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

export interface ModelEntry {
  id: string;
  adapter: ProviderAdapter;
  cliModel: string | null;
  providerName: string;
}

export interface ProbedModel {
  id: string;
  providerName: string;
  result: ProbeResult;
}

export class ProviderRouter {
  private byId = new Map<string, ModelEntry>();
  private adaptersByProvider = new Map<string, ProviderAdapter>();

  constructor(config: ProxaiConfig, registry: ChildRegistry) {
    for (const [providerName, provider] of Object.entries(config.providers)) {
      const Factory = adapterFactories[providerName];
      if (!Factory) {
        console.warn(`Unknown provider "${providerName}", skipping`);
        continue;
      }
      const adapter = new Factory(registry);
      this.adaptersByProvider.set(providerName, adapter);

      // Explicit catalog entries from provider.models[].
      for (const m of provider.models ?? []) {
        this.byId.set(m.id, {
          id: m.id,
          adapter,
          cliModel: m.cli_model,
          providerName,
        });
      }

      // Back-compat alias keyed by provider.model_id, mapped to default_model's cli_model (or null).
      if (!this.byId.has(provider.model_id)) {
        const defaultEntry = provider.default_model
          ? provider.models?.find((m) => m.id === provider.default_model)
          : undefined;
        this.byId.set(provider.model_id, {
          id: provider.model_id,
          adapter,
          cliModel: defaultEntry?.cli_model ?? null,
          providerName,
        });
      }
    }
  }

  getAdapter(modelId: string): ProviderAdapter | undefined {
    return this.byId.get(modelId)?.adapter;
  }

  getModelEntry(modelId: string): ModelEntry | undefined {
    return this.byId.get(modelId);
  }

  listModels(): ModelEntry[] {
    return Array.from(this.byId.values());
  }

  async probeProviders(timeoutMs: number): Promise<Map<string, ProbeResult>> {
    const entries = Array.from(this.adaptersByProvider.entries());
    const results = await Promise.all(
      entries.map(async ([name, adapter]) => [name, await adapter.probe(timeoutMs)] as const),
    );
    return new Map(results);
  }
}
