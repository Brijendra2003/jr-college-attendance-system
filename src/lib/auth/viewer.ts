import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { assertEdition } from '@/lib/supabase/edition';
import { getCollege } from '@/features/academics/context';
import { hasPermission, WEB_ROLES, type Grant, type Permission, type Role, type Scope } from '@/shared/permissions';

export interface Viewer {
  userId: string;
  email: string | null;
  displayName: string;
  language: 'en' | 'mr' | 'hi';
  roles: Role[];
  grants: Grant[];
  staffId: string | null;
  classDivisions: { id: string; name: string }[];
  coordinatorStreams: { id: string; code: string; name: string }[];
  aal: 'aal1' | 'aal2';
}

/**
 * The signed-in user, resolved once per request. Identity comes from verified JWT claims
 * (getClaims), never from getSession(). Roles and grants are read from the database so an
 * admin's edits apply on the next request.
 */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  // createClient() reads cookies() first, which marks the render as request-time during prerender.
  const supabase = await createClient();
  await assertEdition();
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  if (!claims?.sub) return null;

  const [{ data: profile }, { data: caps }] = await Promise.all([
    supabase.from('profiles').select('display_name, email, preferred_language, is_active').eq('id', claims.sub).maybeSingle(),
    supabase.rpc('my_capabilities'),
  ]);
  if (!profile?.is_active) return null;

  const roles = (caps?.roles ?? []) as Role[];
  const { data: grants } = roles.length
    ? await supabase.from('role_permissions').select('permission, scope').in('role', roles)
    : { data: [] as Grant[] };

  return {
    userId: claims.sub,
    email: profile.email ?? (claims.email as string | undefined) ?? null,
    displayName: profile.display_name || profile.email || 'User',
    language: profile.preferred_language ?? 'en',
    roles,
    grants: (grants ?? []) as Grant[],
    staffId: caps?.staff_id ?? null,
    classDivisions: caps?.class_divisions ?? [],
    coordinatorStreams: caps?.coordinator_streams ?? [],
    aal: (claims.aal as 'aal1' | 'aal2') ?? 'aal1',
  };
});

export function can(viewer: Viewer, permission: Permission, scopes?: Scope | Scope[]) {
  return hasPermission(viewer.grants, permission, scopes);
}

/** Has a web role, or is a class teacher (the class-teacher web desk). */
export function isWebUser(viewer: Viewer) {
  return viewer.roles.some((r) => WEB_ROLES.includes(r)) || viewer.classDivisions.length > 0;
}

/** Principal and Admin must complete TOTP MFA (web doc §7). */
export function needsMfa(viewer: Viewer) {
  return viewer.aal !== 'aal2' && viewer.roles.some((r) => r === 'principal' || r === 'admin');
}

/**
 * Redirects to sign-in, the mobile-app page, MFA or first-run setup as needed;
 * returns the viewer otherwise.
 */
export async function requireViewer(): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  if (!isWebUser(viewer)) redirect('/use-mobile-app');
  if (needsMfa(viewer) && process.env.JR_REQUIRE_MFA !== 'false') redirect('/mfa');
  const college = await getCollege();
  if (!college?.setup_completed_at) redirect('/setup');
  return viewer;
}

/** Page guard: any scope of the permission (or of one of the permissions) is enough to open the page. */
export async function requirePermission(permission: Permission | Permission[]): Promise<Viewer> {
  const viewer = await requireViewer();
  const list = Array.isArray(permission) ? permission : [permission];
  if (!list.some((p) => can(viewer, p))) redirect('/forbidden');
  return viewer;
}
