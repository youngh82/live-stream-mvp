'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Player } from '@/domains/stream/components/Player';
import { StreamOverlay } from '@/domains/stream/components/StreamOverlay';
import { ChatWindow } from '@/domains/chat/components/ChatWindow';
import { useChat } from '@/domains/chat/hooks/useChat';
import { useDonation } from '@/domains/donation/hooks/useDonation';
import { DonationButton } from '@/domains/donation/components/DonationButton';
import { DonationPanel } from '@/domains/donation/components/DonationPanel';
import { DonationAlertDisplay } from '@/domains/donation/components/DonationAlert';
import { useSocket } from '@/domains/chat/hooks/useSocket';
import type { FeedStream } from '@/domains/stream/hooks/useFeed';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';

interface FeedItemProps {
  stream: FeedStream;
  isActive: boolean;
  onRemove?: (streamId: string) => void;
}

export function FeedItem({ stream, isActive, onRemove }: FeedItemProps) {
  const t = useTranslations('feed');
  const router = useRouter();
  const [ended, setEnded] = useState(false);
  const [showDonationPanel, setShowDonationPanel] = useState(false);
  const { socket, connected, status: chatStatus, retry: retryChat } = useSocket(isActive);
  const {
    messages,
    viewerCount,
    sendMessage,
    banned,
    lastError,
    removeMessage,
  } = useChat({
    streamId: stream.id,
    enabled: isActive,
    socket,
    connected,
    status: chatStatus,
    retry: retryChat,
  });

  const {
    balance,
    sending,
    alerts,
    dismissAlert,
    sendDonation,
  } = useDonation({
    streamId: stream.id,
    socket,
    connected,
  });

  /**
   * 방송 종료 처리.
   *
   * 즉시 목록에서 빼버리면 보던 화면이 갑자기 사라져 혼란스럽다.
   * 종료 안내를 잠깐 보여준 뒤 목록에서 제거해 다음 방송으로 넘긴다.
   */
  const handleStreamEnd = useCallback(() => {
    setEnded(true);
    const t = setTimeout(() => onRemove?.(stream.id), 2500);
    return () => clearTimeout(t);
  }, [stream.id, onRemove]);

  const displayViewerCount = connected ? viewerCount : stream.viewer_count;

  if (ended) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-black">
        <p className="text-gray-300">{t('streamEnded')}</p>
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('movingToNext')}
        </div>
        {/* 자동 이동이 실패해도 갇히지 않도록 직접 빠져나갈 수단을 둔다 */}
        <button
          onClick={() => onRemove?.(stream.id)}
          className="mt-1 rounded-full bg-white/10 px-5 py-2 text-sm text-white transition-colors hover:bg-white/20"
        >
          {t('skipNow')}
        </button>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      {isActive ? (
        <Player
          streamId={stream.id}
          whepUrl={stream.whep_url}
          onStreamEnd={handleStreamEnd}
        />
      ) : (
        <PreloadPlaceholder stream={stream} />
      )}
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

      {/* Donation alert */}
      {isActive && (
        <DonationAlertDisplay alert={alerts[0]} onDismiss={dismissAlert} />
      )}

      {/* Donation button */}
      {isActive && (
        <div className="absolute right-3 bottom-[38vh] z-30">
          <DonationButton onClick={() => setShowDonationPanel(true)} />
        </div>
      )}

      {isActive && (
        <ChatWindow
          messages={messages}
          onSend={sendMessage}
          connected={connected}
          status={chatStatus}
          onRetry={retryChat}
          isOwner={stream.is_me}
          streamId={stream.id}
          banned={banned}
          lastError={lastError}
          onRemoveMessage={removeMessage}
        />
      )}

      {/* Donation panel (bottom sheet) */}
      {showDonationPanel && (
        <DonationPanel
          balance={balance}
          sending={sending}
          onSend={sendDonation}
          onClose={() => setShowDonationPanel(false)}
          onCharge={() => router.push('/charge')}
        />
      )}
    </div>
  );
}

function PreloadPlaceholder({ stream }: { stream: FeedStream }) {
  const linkRef = useRef<HTMLLinkElement | null>(null);

  useEffect(() => {
    try {
      const url = new URL(stream.whep_url);
      const link = document.createElement('link');
      link.rel = 'preconnect';
      link.href = url.origin;
      document.head.appendChild(link);
      linkRef.current = link;
    } catch {
      // Invalid URL, skip preconnect
    }

    return () => {
      if (linkRef.current) {
        document.head.removeChild(linkRef.current);
        linkRef.current = null;
      }
    };
  }, [stream.whep_url]);

  return (
    <div className="flex h-full w-full items-center justify-center bg-black">
      {stream.thumbnail_url ? (
        <img
          src={stream.thumbnail_url}
          alt={stream.title}
          className="h-full w-full object-cover opacity-60"
        />
      ) : (
        <Loader2 className="h-8 w-8 animate-spin text-white/40" />
      )}
    </div>
  );
}
