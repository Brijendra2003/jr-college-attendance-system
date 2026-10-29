'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getBrowserClient } from '@/lib/supabase/client';

/**
 * Subscribes to Realtime changes on the given tables and refreshes the Server Components
 * (debounced). RLS decides which changes this user receives.
 */
export function LiveRefresh({ tables, filter }: { tables: string[]; filter?: string }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<'connecting' | 'live' | 'offline'>('connecting');
  // Props are re-created on every RSC refresh; key the subscription on the names, not the array.
  const key = tables.join(',');

  useEffect(() => {
    const supabase = getBrowserClient();
    const channel = supabase.channel(`live:${key}:${filter ?? ''}`);
    for (const table of key.split(',')) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) }, () => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => router.refresh(), 800);
      });
    }
    channel.subscribe((s) => setStatus(s === 'SUBSCRIBED' ? 'live' : s === 'CLOSED' || s === 'CHANNEL_ERROR' ? 'offline' : 'connecting'));
    return () => {
      if (timer.current) clearTimeout(timer.current);
      supabase.removeChannel(channel);
    };
  }, [router, key, filter]);

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-gray-500" aria-live="polite">
      <span className={`size-2 rounded-full ${status === 'live' ? 'bg-green-500' : status === 'offline' ? 'bg-red-500' : 'bg-amber-400'}`} />
      {status === 'live' ? 'Live' : status === 'offline' ? 'Not live: refresh to update' : 'Connecting…'}
    </span>
  );
}
