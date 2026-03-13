export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface SendResult {
  chunks: AsyncIterable<string>;
  cliSessionId: Promise<string | null>;
}

export interface ProviderAdapter {
  readonly name: string;
  readonly modelId: string;
  send(prompt: string, cliSessionId: string | null): SendResult;
  kill(sessionId: string): Promise<void>;
}
