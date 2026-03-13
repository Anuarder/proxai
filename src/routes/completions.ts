import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import type { SessionManager } from '../sessions/manager.js';
import type { ProviderAdapter } from '../providers/adapter.js';

export function createCompletionsRoute(
  sessions: SessionManager,
  getAdapter: (modelId: string) => ProviderAdapter | undefined,
) {
  return async (req: Request, res: Response): Promise<void> => {
    const { model, messages, stream, session_id } = req.body;

    if (!model || !messages || !Array.isArray(messages)) {
      res.status(400).json({
        error: { message: 'Missing required fields: model and messages' },
      });
      return;
    }

    const adapter = getAdapter(model);
    if (!adapter) {
      res.status(400).json({
        error: { message: `Unknown model: ${model}` },
      });
      return;
    }

    // Find or create session
    let session = session_id ? sessions.getSession(session_id) : null;
    if (!session) {
      session = sessions.createSession(model, adapter.name);
    }

    // Store user message and touch session
    const lastMessage = messages[messages.length - 1];
    sessions.addMessage(session.id, lastMessage.role, lastMessage.content);
    sessions.touchSession(session.id);

    // Build prompt from the latest user message
    const prompt = lastMessage.content;
    const cliSessionId = session.cli_session_id ?? null;

    const result = adapter.send(prompt, cliSessionId);

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const id = `chatcmpl-${randomUUID()}`;
      let fullContent = '';

      for await (const chunk of result.chunks) {
        fullContent += chunk;
        const data = {
          id,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model,
          session_id: session.id,
          choices: [
            {
              index: 0,
              delta: { content: chunk },
              finish_reason: null,
            },
          ],
        };
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      }

      // Final chunk with finish_reason
      const finalData = {
        id,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model,
        session_id: session.id,
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'stop',
          },
        ],
      };
      res.write(`data: ${JSON.stringify(finalData)}\n\n`);
      res.write('data: [DONE]\n\n');

      // Store assistant message
      sessions.addMessage(session.id, 'assistant', fullContent);

      // Capture CLI session ID
      const resolvedCliSessionId = await result.cliSessionId;
      if (resolvedCliSessionId) {
        sessions.updateCliSessionId(session.id, resolvedCliSessionId);
      }

      res.end();
    } else {
      // Non-streaming: collect all chunks
      let content = '';
      for await (const chunk of result.chunks) {
        content += chunk;
      }

      // Store assistant message
      sessions.addMessage(session.id, 'assistant', content);

      // Capture CLI session ID
      const resolvedCliSessionId = await result.cliSessionId;
      if (resolvedCliSessionId) {
        sessions.updateCliSessionId(session.id, resolvedCliSessionId);
      }

      res.json({
        id: `chatcmpl-${randomUUID()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model,
        session_id: session.id,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content },
            finish_reason: 'stop',
          },
        ],
      });
    }
  };
}
