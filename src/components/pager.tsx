import Link from 'next/link';

/** Previous / next links that keep the current filters. */
export function Pager({ page, total, pageSize, basePath, params }: { page: number; total: number; pageSize: number; basePath: string; params: Record<string, string | undefined> }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const href = (p: number) => {
    const sp = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]);
    sp.set('page', String(p));
    return `${basePath}?${sp.toString()}`;
  };
  return (
    <div className="flex items-center justify-between px-4 py-3 text-sm text-gray-600">
      <span>{total} result{total === 1 ? '' : 's'} · page {page} of {pages}</span>
      <div className="flex gap-2">
        {page > 1 ? <Link className="rounded-lg border border-gray-200 px-3 py-1 hover:bg-gray-50" href={href(page - 1)}>Previous</Link> : null}
        {page < pages ? <Link className="rounded-lg border border-gray-200 px-3 py-1 hover:bg-gray-50" href={href(page + 1)}>Next</Link> : null}
      </div>
    </div>
  );
}

export const pageParam = (v: string | string[] | undefined) => Math.max(1, Number(Array.isArray(v) ? v[0] : v) || 1);
export const str = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
