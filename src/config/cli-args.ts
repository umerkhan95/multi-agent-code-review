import { z } from 'zod';
import { ReviewError, ErrorCodes } from '../utils/error-handler.js';

export const USAGE = 'Usage: npm run dev -- <owner> <repo> <pr-number>\nExample: npm run dev -- octocat Hello-World 1';

// GitHub owner/repo names: letters, digits, '-', '_', '.'
const githubName = z.string().regex(/^[A-Za-z0-9_.-]+$/, 'may only contain letters, digits, "-", "_" or "."');

const CliArgsSchema = z.object({
  owner: githubName,
  repo: githubName,
  prNumber: z
    .string()
    .regex(/^\d+$/, 'must be a positive integer')
    .transform((value) => parseInt(value, 10))
    .pipe(z.number().int().positive('must be a positive integer'))
});

export type CliArgs = z.output<typeof CliArgsSchema>;

/**
 * Parse and validate `<owner> <repo> <pr-number>` (process.argv.slice(2)).
 * @throws ReviewError with VALIDATION_FAILED and the usage text
 */
export function parseCliArgs(args: readonly string[]): CliArgs {
  const [owner, repo, prNumber] = args;
  if (owner === undefined || repo === undefined || prNumber === undefined) {
    throw new ReviewError(`Missing arguments.\n${USAGE}`, ErrorCodes.VALIDATION_FAILED);
  }

  const parsed = CliArgsSchema.safeParse({ owner, repo, prNumber });
  if (!parsed.success) {
    const messages = parsed.error.issues.map((issue) => `- ${issue.path.join('.')} ${issue.message}`);
    throw new ReviewError(`Invalid arguments:\n${messages.join('\n')}\n${USAGE}`, ErrorCodes.VALIDATION_FAILED);
  }
  return parsed.data;
}
