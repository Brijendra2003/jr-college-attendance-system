export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-4">
      <div className="h-8 w-64 animate-pulse rounded bg-gray-200" />
      <div className="h-4 w-96 max-w-full animate-pulse rounded bg-gray-100" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl bg-white shadow-sm" />
        ))}
      </div>
      <div className="h-80 animate-pulse rounded-xl bg-white shadow-sm" />
    </div>
  );
}
