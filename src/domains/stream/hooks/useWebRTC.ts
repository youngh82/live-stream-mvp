'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { isSoundOn, setSoundOn } from '@/domains/stream/lib/sound-preference';

interface UseWebRTCOptions {
  src: string; // WHEP endpoint URL
  autoPlay?: boolean;
}

interface UseWebRTCReturn {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  isLoading: boolean;
  isBuffering: boolean;
  error: string | null;
  muted: boolean;
  toggleMute: () => void;
  retry: () => void;
}

const MAX_RETRIES = 5;
const RETRY_DELAY = 3000;

export function useWebRTC({ src, autoPlay = true }: UseWebRTCOptions): UseWebRTCReturn {
  const t = useTranslations('player');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const whepResourceRef = useRef<string | null>(null);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [isBuffering, setIsBuffering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 첫 재생은 자동재생 정책 때문에 무조건 음소거로 시작한다.
  // 사용자가 이전에 소리를 켰다면 재생이 시작된 뒤 풀어준다.
  const [muted, setMuted] = useState(true);
  const mutedRef = useRef(true);

  const cleanup = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    // WHEP DELETE to release server resources
    if (whepResourceRef.current) {
      fetch(whepResourceRef.current, { method: 'DELETE' }).catch(() => {});
      whepResourceRef.current = null;
    }
  }, []);

  const startWebRTC = useCallback(async (video: HTMLVideoElement) => {
    cleanup();

    const pc = new RTCPeerConnection({
      iceServers: [], // Local network, no STUN/TURN needed for now
    });
    pcRef.current = pc;

    // Receive-only transceivers
    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.addTransceiver('audio', { direction: 'recvonly' });

    // When tracks arrive, attach to video element
    pc.ontrack = (event) => {
      console.log('[WebRTC] track received:', event.track.kind);
      // Use the first stream (contains both audio and video)
      if (video.srcObject !== event.streams[0]) {
        video.srcObject = event.streams[0];
      }
    };

    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      console.log('[WebRTC] ICE state:', state);

      if (state === 'connected' || state === 'completed') {
        setIsLoading(false);
        setIsBuffering(false);
        retryCountRef.current = 0;
      } else if (state === 'disconnected') {
        setIsBuffering(true);
      } else if (state === 'failed' || state === 'closed') {
        handleConnectionFailure();
      }
    };

    try {
      // Create offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Wait for ICE gathering to complete (or timeout)
      await waitForIceGathering(pc);

      // Send offer to WHEP endpoint
      const response = await fetch(src, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: pc.localDescription!.sdp,
      });

      if (!response.ok) {
        throw new Error(`WHEP error: ${response.status}`);
      }

      // Store resource URL for cleanup
      const location = response.headers.get('Location');
      if (location) {
        // Location can be relative or absolute
        whepResourceRef.current = new URL(location, src).toString();
      }

      const answerSdp = await response.text();
      await pc.setRemoteDescription({
        type: 'answer',
        sdp: answerSdp,
      });

      if (autoPlay) {
        video.playsInline = true;

        // 음소거로 재생을 시작한 뒤, 소리 설정이 켜져 있으면 해제를 시도한다.
        // 브라우저가 거부하면 음소거 상태로 남고 사용자가 직접 켜면 된다.
        video.muted = true;
        try {
          await video.play();
          if (isSoundOn()) {
            video.muted = false;
            mutedRef.current = false;
            setMuted(false);
          }
        } catch (e) {
          console.warn('[WebRTC] play failed:', e);
        }
      }
    } catch (err) {
      console.warn('[WebRTC] connection error:', err);
      handleConnectionFailure();
    }

    function handleConnectionFailure() {
      if (retryCountRef.current < MAX_RETRIES) {
        retryCountRef.current++;
        console.log(`[WebRTC] retry ${retryCountRef.current}/${MAX_RETRIES}`);
        setIsBuffering(true);
        retryTimerRef.current = setTimeout(() => {
          const v = videoRef.current;
          if (v) startWebRTC(v);
        }, RETRY_DELAY);
      } else {
        setError(t('connectFailed'));
        setIsLoading(false);
        setIsBuffering(false);
      }
    }
  }, [src, autoPlay, cleanup, t]);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    const next = !mutedRef.current;
    mutedRef.current = next;
    video.muted = next;
    setMuted(next);
    setSoundOn(!next);

    // 음소거 해제는 사용자 제스처로 발생하므로 이 시점의 play()는 허용된다
    if (!next && video.paused) {
      video.play().catch(() => {});
    }
  }, []);

  const retry = useCallback(() => {
    retryCountRef.current = 0;
    setError(null);
    setIsLoading(true);
    const video = videoRef.current;
    if (video) startWebRTC(video);
  }, [startWebRTC]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    console.log('[WebRTC] init with WHEP src:', src);
    setError(null);
    setIsLoading(true);
    setIsBuffering(false);
    retryCountRef.current = 0;

    startWebRTC(video);

    const onWaiting = () => setIsBuffering(true);
    const onPlaying = () => setIsBuffering(false);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('playing', onPlaying);

    return () => {
      console.log('[WebRTC] cleanup');
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('playing', onPlaying);
      cleanup();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  return { videoRef, isLoading, isBuffering, error, muted, toggleMute, retry };
}

function waitForIceGathering(pc: RTCPeerConnection): Promise<void> {
  return new Promise<void>((resolve) => {
    if (pc.iceGatheringState === 'complete') {
      resolve();
      return;
    }

    const timeout = setTimeout(() => {
      pc.removeEventListener('icegatheringstatechange', check);
      resolve(); // Proceed with whatever candidates we have
    }, 2000);

    function check() {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(timeout);
        pc.removeEventListener('icegatheringstatechange', check);
        resolve();
      }
    }

    pc.addEventListener('icegatheringstatechange', check);
  });
}
