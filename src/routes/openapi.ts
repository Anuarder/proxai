import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  extendZodWithOpenApi,
  OpenAPIRegistry,
  OpenApiGeneratorV31,
} from '@asteasolutions/zod-to-openapi';

// NOTE: zod-to-openapi@7 uses z._def.typeName for type detection (a Zod v3 convention).
// Zod 4 removed typeName and uses z._def.type instead, causing "Unknown zod object type"
// errors when the library tries to auto-derive schemas. Work-around: supply an explicit
// `.openapi({ type: '...' })` on every schema so the library short-circuits its own
// type inference and uses the provided metadata verbatim.

extendZodWithOpenApi(z);

const registry = new OpenAPIRegistry();

// ────────────────────────────────────────────────────────────
// ProxaiEvent discriminated union
// ────────────────────────────────────────────────────────────
// We represent the union as a plain z.object (Zod 4 compatible) whose .openapi()
// override provides the full oneOf + discriminator schema.

const ProxaiEventSchema = z.object({ type: z.string() }).openapi({
  type: 'object',
  discriminator: { propertyName: 'type' },
  oneOf: [
    {
      type: 'object',
      required: ['type', 'request_id', 'model', 'provider'],
      properties: {
        type: { enum: ['start'] },
        request_id: { type: 'string' },
        model: { type: 'string' },
        provider: { type: 'string' },
      },
    },
    {
      type: 'object',
      required: ['type', 'text'],
      properties: { type: { enum: ['text_delta'] }, text: { type: 'string' } },
    },
    {
      type: 'object',
      required: ['type', 'text'],
      properties: { type: { enum: ['thinking_delta'] }, text: { type: 'string' } },
    },
    {
      type: 'object',
      required: ['type', 'id', 'name', 'input'],
      properties: {
        type: { enum: ['tool_use'] },
        id: { type: 'string' },
        name: { type: 'string' },
        input: {},
      },
    },
    {
      type: 'object',
      required: ['type', 'tool_use_id', 'content', 'is_error'],
      properties: {
        type: { enum: ['tool_result'] },
        tool_use_id: { type: 'string' },
        content: { type: 'string' },
        is_error: { type: 'boolean' },
      },
    },
    {
      type: 'object',
      required: ['type', 'path', 'action', 'summary'],
      properties: {
        type: { enum: ['file_edit'] },
        path: { type: 'string' },
        action: { enum: ['read', 'write', 'edit'] },
        summary: { type: 'string' },
      },
    },
    {
      type: 'object',
      required: ['type', 'command', 'output_summary'],
      properties: {
        type: { enum: ['command_exec'] },
        command: { type: 'string' },
        exit_code: { type: 'integer' },
        output_summary: { type: 'string' },
      },
    },
    {
      type: 'object',
      required: ['type', 'provider', 'message', 'hint'],
      properties: {
        type: { enum: ['auth_required'] },
        provider: { type: 'string' },
        message: { type: 'string' },
        hint: { type: 'string' },
      },
    },
    {
      type: 'object',
      required: ['type', 'code', 'message', 'retriable'],
      properties: {
        type: { enum: ['error'] },
        code: { type: 'string' },
        message: { type: 'string' },
        retriable: { type: 'boolean' },
        stderr_tail: { type: 'string' },
      },
    },
    {
      type: 'object',
      required: ['type', 'input_tokens', 'output_tokens', 'total_tokens'],
      properties: {
        type: { enum: ['usage'] },
        input_tokens: { type: 'integer' },
        output_tokens: { type: 'integer' },
        total_tokens: { type: 'integer' },
        cost_usd: { type: 'number' },
      },
    },
    {
      type: 'object',
      required: ['type', 'reason'],
      properties: {
        type: { enum: ['turn_complete'] },
        reason: { enum: ['stop', 'max_tokens', 'aborted', 'error'] },
      },
    },
    {
      type: 'object',
      required: ['type'],
      properties: { type: { enum: ['done'] } },
    },
  ],
});
registry.register('ProxaiEvent', ProxaiEventSchema);

// ────────────────────────────────────────────────────────────
// ChatRequest
// ────────────────────────────────────────────────────────────

const MessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
}).openapi({
  type: 'object',
  required: ['role', 'content'],
  properties: {
    role: { type: 'string', enum: ['system', 'user', 'assistant'] },
    content: { type: 'string' },
  },
});
registry.register('Message', MessageSchema);

const ChatRequestSchema = z.object({
  model: z.string(),
  mode: z.enum(['ask', 'agent']),
  messages: z.array(MessageSchema).min(1),
}).openapi({
  type: 'object',
  required: ['model', 'mode', 'messages'],
  properties: {
    model: { type: 'string' },
    mode: { type: 'string', enum: ['ask', 'agent'] },
    messages: {
      type: 'array',
      minItems: 1,
      items: { $ref: '#/components/schemas/Message' },
    },
  },
});
registry.register('ChatRequest', ChatRequestSchema);

// ────────────────────────────────────────────────────────────
// ModelsList
// ────────────────────────────────────────────────────────────

const ModelEntrySchema = z.object({
  id: z.string(),
  object: z.literal('model'),
  owned_by: z.string(),
  status: z.enum(['ready', 'not_authenticated', 'missing_binary', 'error']),
  hint: z.string().optional(),
  message: z.string().optional(),
}).openapi({
  type: 'object',
  required: ['id', 'object', 'owned_by', 'status'],
  properties: {
    id: { type: 'string' },
    object: { type: 'string', enum: ['model'] },
    owned_by: { type: 'string' },
    status: {
      type: 'string',
      enum: ['ready', 'not_authenticated', 'missing_binary', 'error'],
    },
    hint: { type: 'string' },
    message: { type: 'string' },
  },
});
registry.register('ModelEntry', ModelEntrySchema);

const ModelsListSchema = z.object({
  object: z.literal('list'),
  data: z.array(ModelEntrySchema),
}).openapi({
  type: 'object',
  required: ['object', 'data'],
  properties: {
    object: { type: 'string', enum: ['list'] },
    data: {
      type: 'array',
      items: { $ref: '#/components/schemas/ModelEntry' },
    },
  },
});
registry.register('ModelsList', ModelsListSchema);

// ────────────────────────────────────────────────────────────
// Paths
// ────────────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/v1/models',
  description: 'List models with live probe results',
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'OK',
      content: { 'application/json': { schema: ModelsListSchema } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/v1/chat/stream',
  description: 'Stream typed proxai events for a chat turn',
  security: [{ bearerAuth: [] }],
  request: { body: { content: { 'application/json': { schema: ChatRequestSchema } } } },
  responses: {
    200: {
      description: 'SSE stream of ProxaiEvent',
      content: { 'text/event-stream': { schema: ProxaiEventSchema } },
    },
    400: { description: 'Invalid request' },
    403: { description: 'Token does not permit this mode' },
  },
});

const ChatRequestWithStreamSchema = z.object({
  model: z.string(),
  mode: z.enum(['ask', 'agent']),
  messages: z.array(MessageSchema).min(1),
  stream: z.boolean().optional(),
}).openapi({
  type: 'object',
  required: ['model', 'mode', 'messages'],
  properties: {
    model: { type: 'string' },
    mode: { type: 'string', enum: ['ask', 'agent'] },
    messages: {
      type: 'array',
      minItems: 1,
      items: { $ref: '#/components/schemas/Message' },
    },
    stream: { type: 'boolean' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/v1/chat/completions',
  description: 'OpenAI-compatible completions, downconverted from typed events',
  security: [{ bearerAuth: [] }],
  request: { body: { content: { 'application/json': { schema: ChatRequestWithStreamSchema } } } },
  responses: {
    200: { description: 'OpenAI completion (streaming or non-streaming)' },
    400: { description: 'Invalid request' },
    403: { description: 'Token does not permit this mode' },
  },
});

registry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
});

// ────────────────────────────────────────────────────────────
// Generate document at module load time (once)
// ────────────────────────────────────────────────────────────

const generator = new OpenApiGeneratorV31(registry.definitions);
const document = generator.generateDocument({
  openapi: '3.1.0',
  info: {
    title: 'Proxai',
    version: '2.0.0',
    description: 'Local CLI proxy for Claude Code and Codex',
  },
  servers: [{ url: 'http://127.0.0.1:3077' }],
});

export function createOpenApiRoute() {
  return (_req: Request, res: Response): void => {
    res.json(document);
  };
}
