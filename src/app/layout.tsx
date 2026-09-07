import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import "./globals.css";
import { siteUrl } from "@/shared/lib/site-url";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/** OG의 locale은 BCP-47이 아니라 `언어_지역` 형태여야 한다. */
const OG_LOCALE: Record<string, string> = {
  ko: "ko_KR",
  en: "en_US",
};

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = await getTranslations("site");

  return {
    // metadataBase가 없으면 하위 페이지의 openGraph.images 상대 경로가 무시되고
    // 빌드 시 경고가 뜬다. 크롤러는 우리 도메인을 모르므로 절대 URL이 필요하다.
    metadataBase: new URL(siteUrl()),
    title: {
      default: t("name"),
      // 방송/프로필 페이지가 자기 제목을 주면 뒤에 서비스명이 붙는다
      template: `%s | ${t("name")}`,
    },
    description: t("description"),
    openGraph: {
      siteName: t("name"),
      locale: OG_LOCALE[locale] ?? OG_LOCALE.ko,
      type: "website",
    },
  };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();

  return (
    // suppressHydrationWarning: 확장 프로그램이나 원격 뷰어가 <html>에 속성을
    // 주입하면(__gcrremoteframetoken 등) 하이드레이션 불일치 경고가 뜬다.
    // 이 옵션은 이 태그 자신의 속성 차이만 무시하고 하위 트리에는 적용되지
    // 않으므로, 실제 앱 코드의 하이드레이션 버그는 그대로 잡힌다.
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/*
          메시지를 통째로 클라이언트에 넘긴다. 이 앱은 피드·플레이어·채팅이
          전부 클라이언트 컴포넌트라 어차피 대부분이 필요하고, 화면마다
          쪼개면 스와이프로 화면을 넘길 때 사전이 따라 들어오는 지연이 생긴다.
        */}
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
