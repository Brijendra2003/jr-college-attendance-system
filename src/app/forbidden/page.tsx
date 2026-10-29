import Link from 'next/link';

export const metadata = { title: 'Not permitted' };

export default function Forbidden() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="max-w-md rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-lg font-semibold">You don&apos;t have access to this page</h1>
        <p className="mt-2 text-sm text-gray-600">
          Your role does not include this section. If you need it, ask the Admin to update your permissions.
        </p>
        <Link href="/dashboard" className="mt-4 inline-block text-sm font-medium text-brand-600 hover:underline">
          Back to dashboard
        </Link>
      </div>
    </main>
  );
}
