import type { ModeName, ProxaiConfig } from '../config.js';

export interface ModeConfig {
  systemPrompt: string | null;
  allowedTools: string[] | null;
  mcpConfigFile: string | null;
}

export function resolveModeConfig(mode: ModeName, config: ProxaiConfig): ModeConfig {
  const m = config.modes[mode];
  return {
    systemPrompt: m.system_prompt,
    allowedTools: m.allowed_tools,
    mcpConfigFile: m.mcp_config_file,
  };
}
