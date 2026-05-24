import type { Request, Response } from 'express';
import type { ProbedModel } from '../providers/router.js';

export interface ModelsRouteDeps {
  probeAll: () => Promise<ProbedModel[]>;
}

export function createModelsRoute(deps: ModelsRouteDeps) {
  return async (_req: Request, res: Response): Promise<void> => {
    const probed = await deps.probeAll();
    const data = probed.map(({ id, providerName, result }) => {
      const base = { id, object: 'model' as const, owned_by: `proxai:${providerName}` };
      if (result.status === 'ready') return { ...base, status: 'ready' };
      if (result.status === 'not_authenticated') return { ...base, status: 'not_authenticated', hint: result.hint };
      if (result.status === 'missing_binary') return { ...base, status: 'missing_binary' };
      return { ...base, status: 'error', message: result.message };
    });
    res.json({ object: 'list', data });
  };
}
