'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Eye } from 'lucide-react';
import { useCategoryLabel } from '@/domains/stream/hooks/useCategoryLabel';

export interface LiveCardStream {
  id: string;
  title: string;
  category: string | null;
  viewer_count: number;
  thumbnail_url: string | null;
  users: { id: string; nickname: string; avatar_url: string | null };
}

/**
 * 탐색·검색 결과의 방송 카드.
 *
 * 9:16 세로 비율에 cover다. 피드 썸네일과 같은 규칙 (ISSUES.md #16).
 */
export function LiveCard({
  stream,
  live = true,
}: {
  stream: LiveCardStream;
  live?: boolean;
}) {
  const t = useTranslations('stream');
  const categoryLabel = useCategoryLabel();

  return (
    <Link
      href={`/stream/${stream.id}`}
      className="group block overflow-hidden rounded-xl bg-gray-900"
    >
      <div className="relative aspect-[9/16] bg-gray-800">
        {stream.thumbnail_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={stream.thumbnail_url}
            alt={stream.title}
            className="h-full w-full object-cover transition-opacity group-hover:opacity-90"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-3xl">
            {stream.users.nickname[0]?.toUpperCase()}
          </div>
        )}

        {live && (
          <span className="absolute top-2 left-2 rounded bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
            {t('live')}
          </span>
        )}

        <span className="absolute right-2 bottom-2 flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white backdrop-blur">
          <Eye className="h-2.5 w-2.5" />
          {stream.viewer_count.toLocaleString()}
        </span>
      </div>

      <div className="p-2">
        <p className="truncate text-xs font-medium text-white">{stream.title}</p>
        <p className="mt-0.5 truncate text-[11px] text-gray-400">
          {stream.users.nickname}
          {stream.category && (
            <span className="text-gray-600"> · {categoryLabel(stream.category)}</span>
          )}
        </p>
      </div>
    </Link>
  );
}
