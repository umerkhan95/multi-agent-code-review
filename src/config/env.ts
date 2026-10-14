import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { ReviewError, ErrorCodes } from '../utils/error-handler.js';

/**
 * Environment settings schema (validated once at startup, like pydantic-settings).
 * Secrets are only ever read from process.env — never hardcoded.
 */

// Treat unset and blank values the same, so `ANTHROPIC_BASE_URL=` means "not set"
const optionalString = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().optional()
);

const EnvSchema = z
  .object({
    ANTHROPIC_API_KEY: optionalString,
    ANTHROPIC_BASE_URL: optionalString.pipe(z.string().url().optional()),
    AWS_ACCESS_KEY_ID: optionalString,
    AWS_SECRET_ACCESS_KEY: optionalString,
    AWS_REGION: optionalString,
    ANTHROPIC_MODEL: optionalString,
    PROJECT_ROOT: optionalString,
    GITHUB_TOKEN: optionalString,
    LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info')
  })
  .superRefine((env, ctx) => {
    const hasAnthropicKey = env.ANTHROPIC_API_KEY !== undefined;
    const hasAwsKeys = env.AWS_ACCESS_KEY_ID !== undefined && env.AWS_SECRET_ACCESS_KEY !== undefined;

    if (!hasAnthropicKey && !hasAwsKeys) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ANTHROPIC_API_KEY'],
        message:
          'No authentication configured. Set ONE of:\n' +
          '  Option 1 (Anthropic API): ANTHROPIC_API_KEY=sk-ant-...\n' +
          '  Option 2 (AWS Bedrock):   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY and AWS_REGION'
      });
    }
    if (!hasAnthropicKey && hasAwsKeys && env.AWS_REGION === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AWS_REGION'],
        message: 'AWS_REGION is required for AWS Bedrock authentication (e.g. AWS_REGION=us-east-1)'
      });
    }
    if (env.ANTHROPIC_API_KEY?.startsWith('voc-') && env.ANTHROPIC_BASE_URL === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ANTHROPIC_BASE_URL'],
        message: 'A Vocareum key (voc-...) only works with the Vocareum gateway: set ANTHROPIC_BASE_URL (in Vocareum: echo $ANTHROPIC_BASE_URL)'
      });
    }
    if (env.ANTHROPIC_MODEL === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ANTHROPIC_MODEL'],
        message:
          'ANTHROPIC_MODEL is required. Examples:\n' +
          '  Anthropic API: ANTHROPIC_MODEL=claude-sonnet-4-5-20250929\n' +
          '  AWS Bedrock:   ANTHROPIC_MODEL=us.anthropic.claude-sonnet-4-5-20250929-v1:0'
      });
    }
    if (env.PROJECT_ROOT === undefined || !isAbsolute(env.PROJECT_ROOT)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PROJECT_ROOT'],
        message: 'PROJECT_ROOT must be the absolute path to project/starter (the folder containing .claude/skills/)'
      });
    }
  })
  .transform((env) => ({
    authMethod: env.ANTHROPIC_API_KEY !== undefined ? ('anthropic' as const) : ('bedrock' as const),
    model: env.ANTHROPIC_MODEL ?? '',
    projectRoot: env.PROJECT_ROOT ?? '',
    baseUrl: env.ANTHROPIC_BASE_URL,
    awsRegion: env.AWS_REGION,
    hasGithubToken: env.GITHUB_TOKEN !== undefined,
    logLevel: env.LOG_LEVEL
  }));

export type AppEnv = z.output<typeof EnvSchema>;

/**
 * Validate the environment at the boundary and fail fast with an actionable message.
 * @throws ReviewError with MISSING_API_KEY or INVALID_CONFIG
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = EnvSchema.safeParse(source);
  if (parsed.success) {
    return parsed.data;
  }

  const messages = parsed.error.issues.map((issue) => `- ${issue.message}`);
  const missingAuth = parsed.error.issues.some((issue) => issue.path[0] === 'ANTHROPIC_API_KEY');
  throw new ReviewError(
    `Invalid environment configuration:\n${messages.join('\n')}`,
    missingAuth ? ErrorCodes.MISSING_API_KEY : ErrorCodes.INVALID_CONFIG,
    { fields: parsed.error.issues.map((issue) => issue.path.join('.')) }
  );
}
