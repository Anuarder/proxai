import { z } from 'zod';
import * as yaml from 'js-yaml';
import * as fs from 'fs';
import * as path from 'path';

const ProviderModelSchema = z.object({
  id: z.string().min(1),
  cli_model: z.string().min(1),
});

const ProviderSchema = z.object({
  command: z.string(),
  model_id: z.string(),
  default_model: z.string().optional(),
  models: z.array(ProviderModelSchema).optional(),
});

const ModeSchema = z.object({
  system_prompt: z.string().nullable(),
  allowed_tools: z.array(z.string()).nullable(),
  mcp_config_file: z.string().nullable(),
});

const ConfigSchema = z
  .object({
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
  })
  .superRefine((cfg, ctx) => {
    // Cross-provider uniqueness of every selectable model id.
    const seen = new Map<string, string>(); // id -> providerName
    for (const [providerName, provider] of Object.entries(cfg.providers)) {
      const ids = [provider.model_id, ...(provider.models?.map((m) => m.id) ?? [])];
      for (const id of ids) {
        const prior = seen.get(id);
        if (prior && prior !== providerName) {
          ctx.addIssue({
            code: 'custom',
            path: ['providers', providerName],
            message: `duplicate model id "${id}" in providers "${prior}" and "${providerName}"`,
          });
        }
        seen.set(id, providerName);
      }
    }
    // default_model must reference one of this provider's models[i].id.
    for (const [providerName, provider] of Object.entries(cfg.providers)) {
      if (!provider.default_model) continue;
      const ok = provider.models?.some((m) => m.id === provider.default_model);
      if (!ok) {
        ctx.addIssue({
          code: 'custom',
          path: ['providers', providerName, 'default_model'],
          message: `default_model "${provider.default_model}" does not match any models[i].id`,
        });
      }
    }
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
