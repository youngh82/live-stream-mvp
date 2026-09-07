import { LiveNotifications } from '@/domains/user/components/LiveNotifications';

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {children}
      {/* 팔로우한 방송자의 라이브 시작 알림.
          레이아웃에 두는 이유: 피드·프로필·시청 화면 어디에 있어도 받아야 한다. */}
      <LiveNotifications />
    </>
  );
}
