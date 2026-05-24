'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    setLoading(true);
    setError('');

    const supabase = createClient();
    const { error: authError } = await supabase.auth.signUp({ email, password });

    if (authError) {
      setError(authError.message);
      setLoading(false);
    } else {
      router.push('/closet');
      router.refresh();
    }
  }

  return (
    <div className="min-h-screen flex flex-col justify-center px-6 py-12 max-w-sm mx-auto">
      <div className="mb-10">
        <h1 className="text-3xl font-bold text-stone-900 tracking-tight">Build your closet</h1>
        <p className="mt-2 text-stone-500 text-sm">AI that knows what you own.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-stone-600 mb-1.5">Email</label>
          <input
            className="input"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-stone-600 mb-1.5">Password</label>
          <input
            className="input"
            type="password"
            placeholder="8+ characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="new-password"
          />
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 px-4 py-3 rounded-xl">{error}</p>
        )}

        <button type="submit" disabled={loading} className="btn-primary mt-2">
          {loading ? 'Creating account…' : 'Get started'}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-stone-500">
        Already have an account?{' '}
        <Link href="/login" className="text-stone-900 font-medium underline underline-offset-2">
          Sign in
        </Link>
      </p>
    </div>
  );
}
