import Link from 'next/link';

export const metadata = { title: 'Not found' };

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="max-w-md rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-lg font-semibold">Page not found</h1>
        <p className="mt-2 text-sm text-gray-600">The page or record does not exist, or you do not have access to it.</p>
        <Link href="/dashboard" className="mt-4 inline-block text-sm font-medium text-brand-600 hover:underline">Back to dashboard</Link>
      </div>
    </main>
  );
}
