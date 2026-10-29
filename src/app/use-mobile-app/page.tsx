import { Smartphone } from 'lucide-react';
import { signOut } from '@/features/auth/actions';

export const metadata = { title: 'Use the mobile app' };

export default function UseMobileApp() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="max-w-md rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <Smartphone aria-hidden className="mx-auto size-10 text-brand-600" />
        <h1 className="mt-3 text-lg font-semibold">Please use the mobile app</h1>
        <p className="mt-2 text-sm text-gray-600">
          Teachers, students and parents use the college&apos;s attendance app on Android or iPhone. Sign in there with the
          same email and password.
        </p>
        <p className="deva mt-2 text-sm text-gray-600" lang="mr">
          शिक्षक, विद्यार्थी आणि पालक महाविद्यालयाचे हजेरी ॲप वापरतात. त्याच ईमेल व पासवर्डने ॲपमध्ये साइन इन करा.
        </p>
        <form action={signOut} className="mt-5">
          <button type="submit" className="text-sm font-medium text-brand-600 hover:underline">Sign out</button>
        </form>
      </div>
    </main>
  );
}
