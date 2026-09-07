'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { createClient } from '@/shared/lib/supabase-client';

export default function RegisterPage() {
  const t = useTranslations('auth');
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [nicknameStatus, setNicknameStatus] = useState<
    'idle' | 'checking' | 'available' | 'taken'
  >('idle');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const checkNickname = useCallback(
    async (value: string) => {
      if (value.length < 2) {
        setNicknameStatus('idle');
        return;
      }
      setNicknameStatus('checking');
      const { data } = await supabase
        .from('users')
        .select('id')
        .eq('nickname', value)
        .maybeSingle();

      setNicknameStatus(data ? 'taken' : 'available');
    },
    [supabase],
  );

  function handleNicknameChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    setNickname(value);

    const timeout = setTimeout(() => checkNickname(value), 500);
    return () => clearTimeout(timeout);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (nicknameStatus === 'taken') return;
    setError('');
    setLoading(true);

    const { error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { nickname },
      },
    });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    router.push('/feed');
    router.refresh();
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-black px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-white">{t('signUp')}</h1>
          <p className="mt-2 text-sm text-gray-400">{t('signUpTagline')}</p>
        </div>

        {/* suppressHydrationWarning 이유는 login/page.tsx 주석 참고 */}
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
              placeholder={t('passwordHint')}
            />
          </div>

          <div>
            <label htmlFor="nickname" className="block text-sm text-gray-300">
              {t('nickname')}
            </label>
            <input
              suppressHydrationWarning
              id="nickname"
              type="text"
              value={nickname}
              onChange={handleNicknameChange}
              required
              minLength={2}
              maxLength={20}
              className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-900 px-4 py-3 text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
              placeholder={t('nicknameHint')}
            />
            {nicknameStatus === 'checking' && (
              <p className="mt-1 text-xs text-gray-400">{t('nicknameChecking')}</p>
            )}
            {nicknameStatus === 'available' && (
              <p className="mt-1 text-xs text-green-400">{t('nicknameAvailable')}</p>
            )}
            {nicknameStatus === 'taken' && (
              <p className="mt-1 text-xs text-red-400">{t('nicknameTaken')}</p>
            )}
          </div>

          {error && (
            <p className="text-sm text-red-400">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || nicknameStatus === 'taken'}
            className="w-full rounded-lg bg-purple-600 py-3 font-semibold text-white transition hover:bg-purple-700 disabled:opacity-50"
          >
            {loading ? t('signingUp') : t('signUp')}
          </button>
        </form>

        <p className="text-center text-sm text-gray-400">
          {t('haveAccount')}{' '}
          <Link href="/login" className="text-purple-400 hover:underline">
            {t('signIn')}
          </Link>
        </p>
      </div>
    </div>
  );
}
