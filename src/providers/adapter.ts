import type { ProxaiEvent } from '../events/schema.js';
import type { ModeConfig } from '../modes/resolver.js';

export type { Message } from './prompt.js';

export interface SendResult {
  events: AsyncIterable<ProxaiEvent>;
}

export type ProbeResult =
  | { status: 'ready' }
  | { status: 'missing_binary' }
  | { status: 'not_authenticated'; hint: string }
  | { status: 'error'; message: string };

export interface ProviderAdapter {
  readonly name: string;
  readonly modelId: string;
  send(messages: import('./prompt.js').Message[], modeConfig: ModeConfig, signal: AbortSignal): SendResult;
  probe(timeoutMs: number): Promise<ProbeResult>;
}
