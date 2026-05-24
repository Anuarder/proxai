import type { Request, Response, NextFunction } from 'express';
import type { ModeName } from '../config.js';

export interface AuthConfig {
  ask_token: string;
  agent_token: string;
  admin_token?: string;
}

export interface AuthedRequest extends Request {
  mode?: ModeName;
  allowedModes?: Set<ModeName>;
}

export function createAuthMiddleware(authCfg: AuthConfig) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    const header = req.headers.authorization;
    if (!header) {
      res.status(401).json({ error: { message: 'Missing Authorization header', code: 'unauthenticated' } });
      return;
    }
    const bearer = header.replace(/^Bearer\s+/, '');
    const scopes = new Set<ModeName>();
    if (bearer === authCfg.ask_token) scopes.add('ask');
    if (bearer === authCfg.agent_token) scopes.add('agent');
    if (authCfg.admin_token && bearer === authCfg.admin_token) {
      scopes.add('ask');
      scopes.add('agent');
    }
    if (scopes.size === 0) {
      res.status(401).json({ error: { message: 'Invalid API key', code: 'unauthenticated' } });
      return;
    }
    req.allowedModes = scopes;
    next();
  };
}

export function requireMode() {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    const requested = req.body?.mode;
    if (requested !== 'ask' && requested !== 'agent') {
      res.status(400).json({ error: { message: 'Missing or invalid `mode` field; must be "ask" or "agent"', code: 'invalid_mode' } });
      return;
    }
    if (!req.allowedModes?.has(requested)) {
      res.status(403).json({ error: { message: `Token does not permit mode "${requested}"`, code: 'forbidden_mode' } });
      return;
    }
    req.mode = requested;
    next();
  };
}
