import type { Request, Response } from 'express';
import type { ModelEntry } from '../providers/router.js';
import type { ProbeResult } from '../providers/adapter.js';

export interface ModelsRouteDeps {
  listModels: () => ModelEntry[];
  probeProviders: () => Promise<Map<string, ProbeResult>>;
}

export function createModelsRoute(deps: ModelsRouteDeps) {
  return async (_req: Request, res: Response): Promise<void> => {
    const probes = await deps.probeProviders();
    const data = deps.listModels().map((entry) => {
      const result: ProbeResult = probes.get(entry.providerName) ?? { status: 'error', message: 'provider not probed' };
      const base = {
        id: entry.id,
        object: 'model' as const,
        owned_by: `proxai:${entry.providerName}`,
        cli_model: entry.cliModel,
      };
      if (result.status === 'ready') return { ...base, status: 'ready' };
      if (result.status === 'not_authenticated') return { ...base, status: 'not_authenticated', hint: result.hint };
      if (result.status === 'missing_binary') return { ...base, status: 'missing_binary' };
      return { ...base, status: 'error', message: result.message };
    });
    res.json({ object: 'list', data });
  };
}
