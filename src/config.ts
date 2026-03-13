import { z } from 'zod';
import * as yaml from 'js-yaml';
import * as fs from 'fs';
import * as path from 'path';

const ProviderSchema = z.object({
  command: z.string(),
  args: z.array(z.string()),
  model_id: z.string(),
});

const ConfigSchema = z.object({
  server: z
    .object({
      port: z.number(),
      host: z.string(),
    })
    .default({ port: 3077, host: '127.0.0.1' }),
  auth: z.object({
    bearer_token: z.string(),
  }),
  sessions: z
    .object({
      idle_timeout_ms: z.number(),
      max_concurrent: z.number(),
    })
    .default({ idle_timeout_ms: 300000, max_concurrent: 10 }),
  providers: z.record(z.string(), ProviderSchema),
});

export type ProxaiConfig = z.infer<typeof ConfigSchema>;

export function parseConfig(yamlString: string): ProxaiConfig {
  const raw = yaml.load(yamlString);
  return ConfigSchema.parse(raw);
}

export function loadConfig(filePath?: string): ProxaiConfig {
  const configPath = filePath ?? path.join(process.cwd(), 'proxai.config.yaml');
  const content = fs.readFileSync(configPath, 'utf-8');
  return parseConfig(content);
}
