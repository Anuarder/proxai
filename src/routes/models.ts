import type { Request, Response } from 'express';

export function createModelsRoute(providers: Record<string, { model_id: string }>) {
  return (_req: Request, res: Response): void => {
    const data = Object.entries(providers).map(([name, provider]) => ({
      id: provider.model_id,
      object: 'model' as const,
      created: Math.floor(Date.now() / 1000),
      owned_by: `proxai:${name}`,
    }));

    res.json({ object: 'list', data });
  };
}
