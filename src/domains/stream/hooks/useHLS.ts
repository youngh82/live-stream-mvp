'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import Hls from 'hls.js';

interface UseHLSOptions {
  src: string;
  autoPlay?: boolean;
}

interface UseHLSReturn {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  isLoading: boolean;
  isBuffering: boolean;
  error: string | null;
  retry: () => void;
}

const MAX_RETRIES = 5;
const RETRY_DELAY = 3000;

export function useHLS({ src, autoPlay = true }: UseHLSOptions): UseHLSReturn {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const retryCountRef = useRef(0);

  const [isLoading, setIsLoading] = useState(true);
  const [isBuffering, setIsBuffering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const retry = useCallback(() => {
    retryCountRef.current = 0;
    setError(null);
    setIsLoading(true);

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    // Force re-init by toggling a state — handled by the effect re-run
    const video = videoRef.current;
    if (!video) return;

    startHls(video);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  function startHls(video: HTMLVideoElement) {
    // Native HLS (Safari)
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
      video.muted = true;
      video.playsInline = true;
      video.play().catch(() => {});
      setIsLoading(false);
      return;
    }

    if (!Hls.isSupported()) {
      setError('HLS is not supported');
      setIsLoading(false);
      return;
    }

    const hls = new Hls({
      enableWorker: true,
      lowLatencyMode: true,
      // LL-HLS: part 단위로 재생 (세그먼트 기다리지 않음)
      liveSyncDurationCount: 1,
      liveMaxLatencyDurationCount: 2,
      liveSyncOnStallIncrease: 0,
      // 버퍼 최소화
      backBufferLength: 5,
      maxBufferLength: 2,
      maxMaxBufferLength: 5,
      maxBufferHole: 0.5,
    });

    hlsRef.current = hls;

    let jumped = false;

    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      console.log('[HLS] manifest parsed, starting playback');
      setIsLoading(false);
      retryCountRef.current = 0;
      if (autoPlay) {
        video.muted = true;
        video.play().catch((e) => console.warn('[HLS] play failed:', e));
      }
    });

    // liveSyncPosition은 첫 fragment 로드 후에야 유효함
    hls.on(Hls.Events.LEVEL_UPDATED, () => {
      if (hls.liveSyncPosition != null) {
        if (!jumped) {
          jumped = true;
          video.currentTime = hls.liveSyncPosition;
          console.log('[HLS] jumped to live edge:', hls.liveSyncPosition);
        } else if (!video.paused) {
          const drift = hls.liveSyncPosition - video.currentTime;
          if (drift > 3) {
            console.log('[HLS] drift too large, jumping to live edge:', drift.toFixed(1) + 's');
            video.currentTime = hls.liveSyncPosition;
          }
        }
      }
    });

    hls.on(Hls.Events.ERROR, (_event, data) => {
      console.warn('[HLS] error:', data.type, data.details, data.fatal);
      if (!data.fatal) return;

      if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        console.log('[HLS] recovering media error');
        hls.recoverMediaError();
      } else if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        if (retryCountRef.current < MAX_RETRIES) {
          retryCountRef.current++;
          console.log(`[HLS] network error, retry ${retryCountRef.current}/${MAX_RETRIES}`);
          setIsBuffering(true);
          setTimeout(() => hls.startLoad(), RETRY_DELAY);
        } else {
          setError('방송 연결에 실패했습니다');
          setIsLoading(false);
          setIsBuffering(false);
        }
      } else {
        setError('재생 오류가 발생했습니다');
        setIsLoading(false);
        hls.destroy();
        hlsRef.current = null;
      }
    });

    hls.loadSource(src);
    hls.attachMedia(video);
  }

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    console.log('[HLS] init with src:', src);
    setError(null);
    setIsLoading(true);
    setIsBuffering(false);
    retryCountRef.current = 0;

    startHls(video);

    const onWaiting = () => setIsBuffering(true);
    const onPlaying = () => setIsBuffering(false);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('playing', onPlaying);

    return () => {
      console.log('[HLS] cleanup');
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('playing', onPlaying);
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  return { videoRef, isLoading, isBuffering, error, retry };
}
