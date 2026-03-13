import { Router } from 'express';
import type { Request, Response } from 'express';
import type { SessionManager } from '../sessions/manager.js';

export function createSessionsRoute(sessions: SessionManager): Router {
  const router = Router();

  router.post('/', (req: Request, res: Response) => {
    const { model, provider } = req.body;

    if (!model || !provider) {
      res.status(400).json({
        error: { message: 'Missing required fields: model and provider' },
      });
      return;
    }

    try {
      const session = sessions.createSession(model, provider);
      res.status(201).json(session);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      if (message.toLowerCase().includes('max concurrent')) {
        res.status(429).json({ error: { message } });
        return;
      }
      res.status(500).json({ error: { message } });
    }
  });

  router.get('/', (_req: Request, res: Response) => {
    const list = sessions.listSessions();
    res.json(list);
  });

  router.get('/:id', (req: Request<{ id: string }>, res: Response) => {
    const session = sessions.getSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: { message: 'Session not found' } });
      return;
    }

    const messages = sessions.getMessages(session.id);
    res.json({ ...session, messages });
  });

  router.delete('/:id', (req: Request<{ id: string }>, res: Response) => {
    const session = sessions.getSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: { message: 'Session not found' } });
      return;
    }

    sessions.deleteSession(session.id);
    res.status(204).send();
  });

  return router;
}
