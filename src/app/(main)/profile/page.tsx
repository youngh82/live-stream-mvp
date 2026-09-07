'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/domains/auth/hooks/useAuth';
import { BottomNav } from '@/shared/components/BottomNav';
import { createClient } from '@/shared/lib/supabase-client';
import { useFormatter, useTranslations } from 'next-intl';
import { LanguageSwitcher } from '@/shared/components/LanguageSwitcher';
import { ExternalLink, LogOut, User } from 'lucide-react';

export default function ProfilePage() {
  const t = useTranslations('profile');
  const format = useFormatter();
  const router = useRouter();
  const { user, loading } = useAuth();
  const supabase = createClient();

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  if (loading) {
    return (
      <>
        <div className="flex min-h-dvh items-center justify-center bg-gray-950">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white" />
        </div>
        <BottomNav />
      </>
    );
  }

  if (!user) {
    return (
      <>
        <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-gray-950">
          <User className="h-12 w-12 text-gray-600" />
          <p className="text-gray-400">{t('loginRequired')}</p>
          <button
            onClick={() => router.push('/login')}
            className="rounded-full bg-purple-600 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-purple-700"
          >
            {t('login')}
          </button>
        </div>
        <BottomNav />
      </>
    );
  }

  return (
    <>
      <div className="min-h-dvh bg-gray-950 text-white">
        <div className="mx-auto max-w-2xl px-4 py-8">
          <h1 className="mb-8 text-2xl font-bold">{t('title')}</h1>

          <section className="mb-6 rounded-xl bg-gray-900 p-6">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gray-700 text-xl font-bold">
                {user.nickname[0]?.toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-lg font-semibold">{user.nickname}</p>
                <p className="text-sm text-gray-400">
                  {t(`role_${user.role}`)}
                </p>
              </div>
            </div>

            {/* 다른 사람에게 보이는 화면을 본인도 확인할 수 있어야 한다.
                공유 링크도 여기서 복사한다. */}
            <Link
              href={`/u/${user.id}`}
              className="mt-4 flex items-center justify-center gap-2 rounded-lg bg-gray-800 py-2.5 text-sm text-gray-200 transition-colors hover:bg-gray-700"
            >
              <ExternalLink className="h-4 w-4" />
              {t('viewPublicProfile')}
            </Link>
          </section>

          <section className="mb-6 rounded-xl bg-gray-900 p-6">
            <div className="flex items-center justify-between">
              <span className="text-gray-400">{t('pointBalance')}</span>
              <span className="text-lg font-bold text-yellow-400">
                {format.number(user.point_balance)} P
              </span>
            </div>
          </section>

          {/* 언어 설정. 계정이 아니라 이 브라우저에 저장된다 (i18n/actions.ts) */}
          <section className="mb-6 rounded-xl bg-gray-900 p-6">
            <LanguageSwitcher />
          </section>

          <button
            onClick={handleLogout}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-gray-900 p-4 text-red-400 transition-colors hover:bg-gray-800"
          >
            <LogOut className="h-5 w-5" />
            {t('logout')}
          </button>

          <div className="h-20" />
        </div>
      </div>
      <BottomNav />
    </>
  );
}
