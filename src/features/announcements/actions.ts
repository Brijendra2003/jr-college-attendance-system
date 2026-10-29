'use server';

import { z } from 'zod';
import { action, must } from '@/lib/auth/action';
import { announcementSchema } from '@/shared/schemas';

export const createAnnouncement = action({
  permission: 'announcements.college',
  scopes: ['all'],
  schema: announcementSchema.extend({ publish: z.boolean().default(true) }),
  message: (n: number | null) => (n === null ? 'Draft saved.' : `Published to ${n} recipient${n === 1 ? '' : 's'}.`),
  async run({ input, supabase, viewer }) {
    const { audience_roles, stream_ids, division_ids, publish, ...content } = input;
    const row = must(
      await supabase
        .from('announcements')
        .insert({
          ...content,
          scope: division_ids.length ? 'class' : stream_ids.length ? 'stream' : 'college',
          audience: { roles: audience_roles, stream_ids, division_ids },
          created_by: viewer.userId,
        })
        .select('id')
        .single(),
    ) as { id: string };
    if (!publish) return null;
    return must(await supabase.rpc('publish_announcement', { p_announcement_id: row.id })) as number;
  },
});

export const publishAnnouncement = action({
  permission: 'announcements.college',
  scopes: ['all'],
  schema: z.object({ id: z.uuid() }),
  message: (n: number) => `Published to ${n} recipient${n === 1 ? '' : 's'}.`,
  async run({ input, supabase }) {
    return must(await supabase.rpc('publish_announcement', { p_announcement_id: input.id })) as number;
  },
});
