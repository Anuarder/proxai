import { z } from 'zod';
import * as yaml from 'js-yaml';
import * as fs from 'fs';
import * as path from 'path';

const ProviderSchema = z.object({
  command: z.string(),
  model_id: z.string(),
});

const ModeSchema = z.object({
  system_prompt: z.string().nullable(),
  allowed_tools: z.array(z.string()).nullable(),
  mcp_config_file: z.string().nullable(),
});

const ConfigSchema = z.object({
  server: z
    .object({ port: z.number(), host: z.string() })
    .default({ port: 3077, host: '127.0.0.1' }),
  auth: z.object({
    ask_token: z.string(),
    agent_token: z.string(),
    admin_token: z.string().optional(),
  }),
  timeouts: z
    .object({
      request_timeout_ms: z.number().int().default(300000),
      idle_timeout_ms: z.number().int().default(60000),
      probe_timeout_ms: z.number().int().default(5000),
      process_kill_grace_ms: z.number().int().default(2000),
    })
    .default({
      request_timeout_ms: 300000,
      idle_timeout_ms: 60000,
      probe_timeout_ms: 5000,
      process_kill_grace_ms: 2000,
    }),
  modes: z.object({
    ask: ModeSchema,
    agent: ModeSchema,
  }),
  providers: z.record(z.string(), ProviderSchema),
});

export type ProxaiConfig = z.infer<typeof ConfigSchema>;
export type ModeName = 'ask' | 'agent';

export function parseConfig(yamlString: string): ProxaiConfig {
  const raw = yaml.load(yamlString);
  return ConfigSchema.parse(raw);
}

export function loadConfig(filePath?: string): ProxaiConfig {
  const configPath = filePath ?? path.join(process.cwd(), 'proxai.config.yaml');
  const content = fs.readFileSync(configPath, 'utf-8');
  return parseConfig(content);
}
