import type { ProxaiConfig } from '../config.js';
import type { ProviderAdapter } from './adapter.js';
import { ClaudeCodeAdapter } from './claude.js';
import { CodexAdapter } from './codex.js';

type AdapterFactory = new () => ProviderAdapter;

const adapterFactories: Record<string, AdapterFactory> = {
  claude: ClaudeCodeAdapter,
  codex: CodexAdapter,
};

export class ProviderRouter {
  private adapters = new Map<string, ProviderAdapter>();

  constructor(config: ProxaiConfig) {
    for (const [name, provider] of Object.entries(config.providers)) {
      const Factory = adapterFactories[name];
      if (!Factory) {
        console.warn(`Unknown provider "${name}", skipping`);
        continue;
      }
      this.adapters.set(provider.model_id, new Factory());
    }
  }

  getAdapter(modelId: string): ProviderAdapter | undefined {
    return this.adapters.get(modelId);
  }

  listModels(): Array<{ id: string; name: string }> {
    return Array.from(this.adapters.entries()).map(([id, adapter]) => ({
      id,
      name: adapter.name,
    }));
  }

  async killSession(sessionId: string): Promise<void> {
    const kills = Array.from(this.adapters.values()).map((a) => a.kill(sessionId));
    await Promise.all(kills);
  }
}
