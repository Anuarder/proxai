export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export function assemblePrompt(messages: Message[]): string {
  if (messages.length === 0) throw new Error('assemblePrompt: empty messages');
  const labels: Record<Message['role'], string> = {
    system: 'System',
    user: 'User',
    assistant: 'Assistant',
  };
  return messages.map((m) => `${labels[m.role]}: ${m.content}`).join('\n\n');
}
