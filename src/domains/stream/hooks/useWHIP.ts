'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

/**
 * WHIP(WebRTC-HTTP Ingestion Protocol) 송출 훅.
 *
 * useWebRTC(WHEP 재생)의 거울상이다.
 *   WHEP: recvonly 트랜시버 → offer → POST → answer
 *   WHIP: 카메라 트랙 추가 → offer → POST → answer
 *
 * 인증은 HTTP Basic으로 stream_key를 넘긴다. RTMP는 URL 쿼리로 받지만
 * WHIP은 Basic 헤더로 받는다는 점만 다르고, 서버의 /api/stream/auth 는
 * 두 경우 모두 동일하게 처리한다.
 */

export type WHIPState =
  | 'idle'
  | 'connecting'
  | 'live'
  | 'reconnecting'
  | 'error';

interface StartOptions {
  whipUrl: string;
  streamKey: string;
  stream: MediaStream;
}

const MAX_BITRATE = 2_500_000; // 2.5 Mbps — 720p 세로 기준
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000;

export function useWHIP() {
  const t = useTranslations('whip');
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const resourceUrlRef = useRef<string | null>(null);
  const optionsRef = useRef<StartOptions | null>(null);
  const retryRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stoppedRef = useRef(false);

  const [state, setState] = useState<WHIPState>('idle');
  const [error, setError] = useState<string | null>(null);

  const teardown = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    pcRef.current?.close();
    pcRef.current = null;
  }, []);

  /** WHIP 세션 종료 — 서버 자원을 반납해 방송이 즉시 종료되게 한다 */
  const stop = useCallback(async () => {
    stoppedRef.current = true;
    teardown();

    const resource = resourceUrlRef.current;
    resourceUrlRef.current = null;

    if (resource) {
      try {
        await fetch(resource, { method: 'DELETE' });
      } catch {
        // 이미 끊겼으면 무시. MediaMTX가 타임아웃으로 정리한다.
      }
    }

    setState('idle');
    setError(null);
  }, [teardown]);

  // negotiate가 실패 시 자기 자신을 다시 호출해야 해서 ref로 우회한다
  const negotiateRef = useRef<((opts: StartOptions) => Promise<void>) | null>(
    null,
  );

  const handleFailure = useCallback(
    (opts: StartOptions, message: string) => {
      if (stoppedRef.current) return;

      if (retryRef.current < MAX_RETRIES) {
        retryRef.current++;
        setState('reconnecting');
        retryTimerRef.current = setTimeout(() => {
          negotiateRef.current?.(opts).catch(() => {});
        }, RETRY_DELAY);
      } else {
        setError(message);
        setState('error');
      }
    },
    [],
  );

  const negotiate = useCallback(async (opts: StartOptions) => {
    teardown();

    const pc = new RTCPeerConnection({ iceServers: [] });
    pcRef.current = pc;

    for (const track of opts.stream.getTracks()) {
      pc.addTrack(track, opts.stream);
    }

    // 업링크가 약한 모바일 환경을 고려해 상한을 걸어둔다.
    // 실제 비트레이트는 WebRTC 혼잡 제어가 이 아래에서 조절한다.
    for (const sender of pc.getSenders()) {
      if (sender.track?.kind !== 'video') continue;
      const params = sender.getParameters();
      params.encodings = params.encodings?.length
        ? params.encodings
        : [{}];
      params.encodings[0].maxBitrate = MAX_BITRATE;
      try {
        await sender.setParameters(params);
      } catch {
        // 일부 브라우저는 협상 전 setParameters를 거부한다. 치명적이지 않다.
      }
    }

    pc.oniceconnectionstatechange = () => {
      const s = pc.iceConnectionState;
      if (s === 'connected' || s === 'completed') {
        retryRef.current = 0;
        setState('live');
      } else if (s === 'disconnected') {
        setState('reconnecting');
      } else if (s === 'failed') {
        handleFailure(opts, t('disconnected'));
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIceGathering(pc);

    const res = await fetch(opts.whipUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/sdp',
        Authorization: `Basic ${btoa(`streamer:${opts.streamKey}`)}`,
      },
      body: pc.localDescription!.sdp,
    });

    if (res.status === 401) {
      throw new Error(t('unauthorized'));
    }
    if (res.status === 409 || res.status === 400) {
      const body = await res.text().catch(() => '');
      throw new Error(
        body.includes('already')
          ? t('alreadyPublishing')
          : t('publishFailedWithStatus', { status: res.status }),
      );
    }
    if (!res.ok) {
      throw new Error(t('publishFailedWithStatus', { status: res.status }));
    }

    const location = res.headers.get('Location');
    if (location) {
      resourceUrlRef.current = new URL(location, opts.whipUrl).toString();
    }

    await pc.setRemoteDescription({
      type: 'answer',
      sdp: await res.text(),
    });
  }, [teardown, handleFailure, t]);

  useEffect(() => {
    negotiateRef.current = negotiate;
  }, [negotiate]);

  const start = useCallback(
    async (opts: StartOptions) => {
      stoppedRef.current = false;
      optionsRef.current = opts;
      retryRef.current = 0;
      setError(null);
      setState('connecting');

      try {
        await negotiate(opts);
      } catch (err) {
        setError(err instanceof Error ? err.message : t('publishFailed'));
        setState('error');
        teardown();
      }
    },
    [negotiate, teardown, t],
  );

  const retry = useCallback(() => {
    if (optionsRef.current) start(optionsRef.current);
  }, [start]);

  /**
   * 송출 중 비디오 트랙 교체 (전/후면 카메라 전환).
   * replaceTrack은 재협상이 필요 없어서 화면이 끊기지 않는다.
   */
  const replaceVideoTrack = useCallback(async (track: MediaStreamTrack) => {
    const sender = pcRef.current
      ?.getSenders()
      .find((s) => s.track?.kind === 'video');
    if (sender) await sender.replaceTrack(track);
  }, []);

  return { state, error, start, stop, retry, replaceVideoTrack };
}

function waitForIceGathering(pc: RTCPeerConnection): Promise<void> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();

    const timeout = setTimeout(finish, 2000);

    function finish() {
      clearTimeout(timeout);
      pc.removeEventListener('icegatheringstatechange', check);
      resolve();
    }
    function check() {
      if (pc.iceGatheringState === 'complete') finish();
    }

    pc.addEventListener('icegatheringstatechange', check);
  });
}
