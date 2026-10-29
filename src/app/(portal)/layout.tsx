import { Suspense, type ReactNode } from 'react';
import { requireViewer } from '@/lib/auth/viewer';
import { getCollege, getYearContext } from '@/features/academics/context';
import { Sidebar, SidebarSkeleton } from '@/components/portal/sidebar';
import { Topbar } from '@/components/portal/topbar';

// The frame is static and prerenders into the shell; everything that reads the session
// streams in behind Suspense (Cache Components: request reads must sit inside a boundary).
export default function PortalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 border-r border-gray-200 bg-white lg:block">
        <Suspense fallback={<SidebarSkeleton />}>
          <SidebarSlot />
        </Suspense>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-10 border-b border-gray-200 bg-white/90 backdrop-blur">
          <Suspense fallback={<div className="h-14" />}>
            <TopbarSlot />
          </Suspense>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

async function SidebarSlot() {
  const [viewer, college] = await Promise.all([requireViewer(), getCollege()]);
  return <Sidebar viewer={viewer} collegeName={college?.name ?? ''} />;
}

async function TopbarSlot() {
  const [viewer, college, ctx] = await Promise.all([requireViewer(), getCollege(), getYearContext()]);
  return <Topbar viewer={viewer} years={ctx.years} yearId={ctx.year?.id ?? null} collegeName={college?.name ?? ''} />;
}
