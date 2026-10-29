import { Suspense } from 'react';
import Link from 'next/link';
import { LoginForm } from './login-form';

export const metadata = { title: 'Sign in' };

export default function LoginPage() {
  return (
    <>
      <h1 className="text-lg font-semibold text-gray-900">Sign in</h1>
      <p className="mt-1 text-sm text-gray-500">Principal, Supervisor, Office, Admin, Exam In-charge, Coordinators and class teachers.</p>
      <Suspense fallback={<div className="mt-6 h-48" />}>
        <LoginForm />
      </Suspense>
      <Link href="/forgot-password" className="mt-4 block text-center text-sm text-brand-600 hover:underline">
        Forgot password?
      </Link>
    </>
  );
}
