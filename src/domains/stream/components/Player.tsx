'use client';

import { useWebRTC } from '@/domains/stream/hooks/useWebRTC';
import { useStreamLifecycle } from '@/domains/stream/hooks/useStreamLifecycle';
import { useVideoFit } from '@/domains/stream/hooks/useVideoFit';
import { useTranslations } from 'next-intl';
import { Loader2, WifiOff, RefreshCw, Volume2, VolumeX } from 'lucide-react';

interface PlayerProps {
  streamId: string;
  whepUrl: string;
  onStreamEnd?: () => void;
}

export function Player({ streamId, whepUrl, onStreamEnd }: PlayerProps) {
  const t = useTranslations('player');
  const { videoRef, isLoading, isBuffering, error, muted, toggleMute, retry } = useWebRTC({
    src: whepUrl,
    autoPlay: true,
  });

  const { isEnded } = useStreamLifecycle({
    streamId,
    onStreamEnd,
  });

  // 방송 소스가 세로면 화면을 채우고, 가로면 확대하지 않고 전체를 보여준다
  const fit = useVideoFit(videoRef);

  if (isEnded) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-black">
        <div className="text-center">
          <WifiOff className="mx-auto mb-3 h-10 w-10 text-gray-500" />
          <p className="text-lg font-medium text-white">{t('ended')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full bg-black">
      {/*
        음소거 여부는 useWebRTC가 제어한다. 여기서 muted를 하드코딩하면
        소리를 켤 방법이 사라진다.

        object-fit은 useVideoFit이 영상 비율을 보고 정한다. 방송자가 가로로
        송출하더라도 시청자 화면에서 확대되지 않는다.
      */}
      <video
        ref={videoRef}
        style={{ objectFit: fit }}
        className="h-full w-full"
        playsInline
        autoPlay
      />

      {/* 소리 토글 — 음소거 중에는 눈에 띄게 안내한다 */}
      {!isLoading && !error && (
        <button
          onClick={toggleMute}
          aria-label={muted ? t('unmute') : t('mute')}
          className={
            muted
              ? 'absolute top-4 right-4 z-30 flex items-center gap-1.5 rounded-full bg-black/65 py-2 pr-3.5 pl-3 text-sm font-medium text-white backdrop-blur'
              : 'absolute top-4 right-4 z-30 rounded-full bg-black/50 p-2.5 text-white backdrop-blur'
          }
        >
          {muted ? (
            <>
              <VolumeX className="h-4 w-4" />
              {t('unmute')}
            </>
          ) : (
            <Volume2 className="h-4 w-4" />
          )}
        </button>
      )}

      {/* Loading spinner */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60">
          <Loader2 className="h-10 w-10 animate-spin text-white" />
        </div>
      )}

      {/* Buffering indicator */}
      {isBuffering && !isLoading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-white/80" />
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80">
          <div className="text-center">
            <WifiOff className="mx-auto mb-3 h-10 w-10 text-red-400" />
            <p className="mb-4 text-white">{error}</p>
            <button
              onClick={retry}
              className="inline-flex items-center gap-2 rounded-full bg-white/20 px-5 py-2.5 text-sm text-white transition-colors hover:bg-white/30"
            >
              <RefreshCw className="h-4 w-4" />
              {t('retry')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
