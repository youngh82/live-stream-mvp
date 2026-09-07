'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Compass, Home, Radio, User } from 'lucide-react';

/**
 * 하단 탭 높이.
 *
 * 피드에서는 채팅 입력창이 이 탭에 가리지 않도록 같은 값만큼 띄워야 해서,
 * 두 곳이 어긋나지 않게 한 곳에서 정의한다.
 * (아이콘 20px + 라벨 + py-2.5 = 약 3.5rem)
 */
export const BOTTOM_NAV_HEIGHT = '3.5rem';

/**
 * 탭이 4개로 늘어도 **높이는 그대로 둔다.**
 * BOTTOM_NAV_HEIGHT는 채팅 입력창 위치와 묶여 있다 (ISSUES.md #13).
 */
const navItems = [
  { href: '/feed', key: 'home', icon: Home },
  { href: '/explore', key: 'explore', icon: Compass },
  { href: '/dashboard', key: 'broadcast', icon: Radio },
  { href: '/profile', key: 'profile', icon: User },
] as const;

export function BottomNav() {
  const pathname = usePathname();
  const t = useTranslations('nav');

  return (
    <nav
      style={{ height: BOTTOM_NAV_HEIGHT }}
      className="fixed inset-x-0 bottom-0 z-50 box-content border-t border-white/10 bg-black/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg"
    >
      <div className="flex items-center justify-around">
        {navItems.map(({ href, key, icon: Icon }) => {
          const isActive = pathname === href || pathname.startsWith(href + '/');
          return (
            <Link
              key={href}
              href={href}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] transition-colors ${
                isActive ? 'text-white' : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              <Icon className="h-5 w-5" />
              <span>{t(key)}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
