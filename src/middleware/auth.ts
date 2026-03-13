import type { Request, Response, NextFunction } from 'express';

export function createAuthMiddleware(token: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers.authorization;

    if (!header) {
      res.status(401).json({
        error: { message: 'Missing Authorization header', type: 'auth_error' },
      });
      return;
    }

    const bearer = header.replace(/^Bearer\s+/, '');
    if (bearer !== token) {
      res.status(401).json({
        error: { message: 'Invalid API key', type: 'auth_error' },
      });
      return;
    }

    next();
  };
}
