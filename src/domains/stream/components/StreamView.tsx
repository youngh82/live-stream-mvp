'use client';

import { useEffect, useState } from 'react';
import { Player } from '@/domains/stream/components/Player';
import { StreamOverlay } from '@/domains/stream/components/StreamOverlay';
import { ChatWindow } from '@/domains/chat/components/ChatWindow';
import { StreamEndedScreen } from '@/domains/stream/components/StreamEndedScreen';
import { useChat } from '@/domains/chat/hooks/useChat';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';

function LivePlayer({
  streamId,
  onStreamEnd,
}: {
  streamId: string;
  onStreamEnd: () => void;
}) {
  const [whepUrl, setWhepUrl] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/stream/${streamId}/hls`)
      .then((res) => res.json())
      .then(({ data }) => {
        if (data?.whep_url) setWhepUrl(data.whep_url);
      })
      .catch(() => {});
  }, [streamId]);

  if (!whepUrl) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-black">
        <Loader2 className="h-8 w-8 animate-spin text-white" />
      </div>
    );
  }

  return (
    <Player streamId={streamId} whepUrl={whepUrl} onStreamEnd={onStreamEnd} />
  );
}

interface StreamInfo {
  id: string;
  title: string;
  status: string;
  viewer_count: number;
  started_at: string;
  is_following?: boolean;
  is_me?: boolean;
  users: {
    id: string;
    nickname: string;
    avatar_url: string | null;
  };
}

/**
 * 방송 시청 화면.
 *
 * 페이지 자체는 OG 메타데이터(generateMetadata)를 내보내야 해서 서버 컴포넌트로
 * 남기고, 실제 재생·채팅은 전부 이 클라이언트 컴포넌트가 담당한다.
 */
export function StreamView({ id }: { id: string }) {
  const t = useTranslations('stream');
  const [stream, setStream] = useState<StreamInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isLive = stream?.status === 'live';
  const {
    messages,
    viewerCount,
    connected,
    sendMessage,
    banned,
    lastError,
    removeMessage,
  } = useChat({
    streamId: id,
    enabled: isLive,
  });

  const displayViewerCount = connected
    ? viewerCount
    : (stream?.viewer_count ?? 0);

  useEffect(() => {
    async function fetchStream() {
      try {
        const res = await fetch(`/api/stream/${id}`);
        if (!res.ok) {
          setError(t('notFound'));
          return;
        }
        const { data } = await res.json();
        setStream(data);
      } catch {
        setError(t('loadFailed'));
      } finally {
        setLoading(false);
      }
    }

    fetchStream();
  }, [id, t]);

  if (loading) {
    return (
      <div className="flex h-dvh items-center justify-center bg-black">
        <Loader2 className="h-8 w-8 animate-spin text-white" />
      </div>
    );
  }

  if (error || !stream) {
    return (
      <div className="flex h-dvh items-center justify-center bg-black">
        <p className="text-gray-400">{error || t('notFound')}</p>
      </div>
    );
  }

  return (
    <div className="relative h-dvh w-full bg-black">
      {isLive ? (
        <>
          <LivePlayer
            streamId={stream.id}
            onStreamEnd={() =>
              setStream((s) => (s ? { ...s, status: 'ended' } : null))
            }
          />
          <StreamOverlay
            title={stream.title}
            streamerName={stream.users.nickname}
            streamerAvatar={stream.users.avatar_url}
            viewerCount={displayViewerCount}
            shareUrl={`/stream/${stream.id}`}
            streamerId={stream.users.id}
            isFollowing={stream.is_following}
            isMe={stream.is_me}
            streamId={stream.id}
          />
          <ChatWindow
            messages={messages}
            onSend={sendMessage}
            connected={connected}
            isOwner={stream.is_me}
            streamId={stream.id}
            banned={banned}
            lastError={lastError}
            onRemoveMessage={removeMessage}
          />
        </>
      ) : (
        <StreamEndedScreen
          streamerId={stream.users.id}
          streamerName={stream.users.nickname}
          streamerAvatar={stream.users.avatar_url}
          isFollowing={stream.is_following}
          isMe={stream.is_me}
          idle={stream.status !== 'ended'}
        />
      )}
    </div>
  );
}
