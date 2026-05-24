import { z } from 'zod';

export const StartEvent = z.object({
  type: z.literal('start'),
  request_id: z.string(),
  model: z.string(),
  provider: z.string(),
});

export const TextDeltaEvent = z.object({
  type: z.literal('text_delta'),
  text: z.string(),
});

export const ThinkingDeltaEvent = z.object({
  type: z.literal('thinking_delta'),
  text: z.string(),
});

export const ToolUseEvent = z.object({
  type: z.literal('tool_use'),
  id: z.string(),
  name: z.string(),
  input: z.unknown(),
});

export const ToolResultEvent = z.object({
  type: z.literal('tool_result'),
  tool_use_id: z.string(),
  content: z.string(),
  is_error: z.boolean(),
});

export const FileEditEvent = z.object({
  type: z.literal('file_edit'),
  path: z.string(),
  action: z.enum(['read', 'write', 'edit']),
  summary: z.string(),
});

export const CommandExecEvent = z.object({
  type: z.literal('command_exec'),
  command: z.string(),
  exit_code: z.number().int().optional(),
  output_summary: z.string(),
});

export const AuthRequiredEvent = z.object({
  type: z.literal('auth_required'),
  provider: z.string(),
  message: z.string(),
  hint: z.string(),
});

export const ErrorEvent = z.object({
  type: z.literal('error'),
  code: z.string(),
  message: z.string(),
  retriable: z.boolean(),
  stderr_tail: z.string().optional(),
});

export const UsageEvent = z.object({
  type: z.literal('usage'),
  input_tokens: z.number().int(),
  output_tokens: z.number().int(),
  total_tokens: z.number().int(),
  cost_usd: z.number().optional(),
});

export const TurnCompleteEvent = z.object({
  type: z.literal('turn_complete'),
  reason: z.enum(['stop', 'max_tokens', 'aborted', 'error']),
});

export const DoneEvent = z.object({ type: z.literal('done') });

export const ProxaiEventSchema = z.discriminatedUnion('type', [
  StartEvent,
  TextDeltaEvent,
  ThinkingDeltaEvent,
  ToolUseEvent,
  ToolResultEvent,
  FileEditEvent,
  CommandExecEvent,
  AuthRequiredEvent,
  ErrorEvent,
  UsageEvent,
  TurnCompleteEvent,
  DoneEvent,
]);

export type ProxaiEvent = z.infer<typeof ProxaiEventSchema>;
