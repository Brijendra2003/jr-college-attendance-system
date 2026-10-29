import 'server-only';
import { z } from 'zod';
import { createClient, type ServerClient } from '@/lib/supabase/server';
import { can, getViewer, needsMfa, type Viewer } from '@/lib/auth/viewer';
import { errorCode, errorMessage } from '@/shared/errors';
import type { Permission, Scope } from '@/shared/permissions';

export type ActionResult<T> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string; code?: string | null; fieldErrors?: Record<string, string[]> };

interface ActionConfig<S extends z.ZodType, R> {
  /** Any one of these permissions (in any of `scopes`, if given) allows the call. */
  permission: Permission | Permission[];
  scopes?: Scope[];
  schema: S;
  run: (ctx: { input: z.output<S>; supabase: ServerClient; viewer: Viewer }) => Promise<R>;
  /** Optional success message shown by the client. */
  message?: string | ((data: R) => string);
}

/** Thrown inside run() to return a friendly error without logging it as a failure. */
export class ActionError extends Error {}

/**
 * Wraps every Server Action. Server Actions are public HTTP endpoints, so this is mandatory:
 * it resolves the verified user, checks the account is active and permitted, validates input
 * with Zod, runs the action and maps database error codes to friendly messages.
 * The database still enforces RLS / RPC checks as the final gate.
 */
export function action<S extends z.ZodType, R>(config: ActionConfig<S, R>) {
  return async (raw: z.input<S>): Promise<ActionResult<R>> => {
    const viewer = await getViewer();
    if (!viewer) return { ok: false, error: errorMessage('AUTH_REQUIRED'), code: 'AUTH_REQUIRED' };
    // Pages redirect to /mfa; actions are endpoints, so they must refuse on their own.
    if (needsMfa(viewer) && process.env.JR_REQUIRE_MFA !== 'false') {
      return { ok: false, error: 'Complete two-step verification first (reload the page).', code: 'MFA_REQUIRED' };
    }

    const perms = Array.isArray(config.permission) ? config.permission : [config.permission];
    if (!perms.some((p) => can(viewer, p, config.scopes))) {
      return { ok: false, error: errorMessage('ATT_FORBIDDEN', viewer.language), code: 'ATT_FORBIDDEN' };
    }

    const parsed = config.schema.safeParse(raw);
    if (!parsed.success) {
      const flat = z.flattenError(parsed.error);
      return {
        ok: false,
        error: flat.formErrors[0] ?? 'Please check the highlighted fields.',
        code: 'INVALID_INPUT',
        fieldErrors: flat.fieldErrors as Record<string, string[]>,
      };
    }

    try {
      const supabase = await createClient();
      const data = await config.run({ input: parsed.data, supabase, viewer });
      const message = typeof config.message === 'function' ? config.message(data) : config.message;
      return { ok: true, data, message };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e);
      if (e instanceof ActionError) return { ok: false, error: msg };
      const code = errorCode(msg);
      if (!code) console.error('[action]', msg);
      return { ok: false, error: code ? errorMessage(code, viewer.language) : friendlyPgError(msg), code };
    }
  };
}

/** Map common Postgres constraint failures to readable text. */
function friendlyPgError(message: string): string {
  if (/duplicate key|unique constraint/i.test(message)) return 'A record with these details already exists.';
  if (/one_class_teacher/.test(message)) return 'This division already has a class teacher for those dates.';
  if (/one_primary_enrollment/.test(message)) return 'The student already has an enrollment for those dates.';
  if (/violates foreign key/i.test(message)) return 'This record is referenced elsewhere and cannot be changed this way.';
  if (/row-level security/i.test(message)) return errorMessage('ATT_FORBIDDEN');
  return errorMessage(null);
}

/** Unwrap a Supabase response inside run(): throws the database error so the wrapper maps it. */
export function must<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}
