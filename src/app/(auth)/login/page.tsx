'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { createClient } from '@/shared/lib/supabase-client';

export default function LoginPage() {
  const t = useTranslations('auth');
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    const params = new URLSearchParams(window.location.search);
    router.push(params.get('redirect') || '/feed');
    router.refresh();
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-black px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-white">{t('signIn')}</h1>
          <p className="mt-2 text-sm text-gray-400">{t('signInTagline')}</p>
        </div>

        {/*
          suppressHydrationWarning: 비밀번호 관리자 확장이 하이드레이션 전에
          form/input에 자기 속성(__gcruniqueid 등)을 붙인다. 서버 HTML에는
          없으니 React가 mismatch로 잡는데, 앱이 고칠 수 있는 차이가 아니다.
          한 단계에만 적용되므로 form과 각 input에 따로 붙여야 한다.
        */}
        <form
          onSubmit={handleSubmit}
          className="space-y-4"
          suppressHydrationWarning
        >
          <div>
            <label htmlFor="email" className="block text-sm text-gray-300">
              {t('email')}
            </label>
            <input
              suppressHydrationWarning
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-900 px-4 py-3 text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
              placeholder="email@example.com"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm text-gray-300">
              {t('password')}
            </label>
            <input
              suppressHydrationWarning
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-900 px-4 py-3 text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="text-sm text-red-400">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-purple-600 py-3 font-semibold text-white transition hover:bg-purple-700 disabled:opacity-50"
          >
            {loading ? t('signingIn') : t('signIn')}
          </button>
        </form>

        <p className="text-center text-sm text-gray-400">
          {t('noAccount')}{' '}
          <Link href="/register" className="text-purple-400 hover:underline">
            {t('signUp')}
          </Link>
        </p>
      </div>
    </div>
  );
}
