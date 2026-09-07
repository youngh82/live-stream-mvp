'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/domains/auth/hooks/useAuth';
import { useCamera } from '@/domains/stream/hooks/useCamera';
import { useWHIP } from '@/domains/stream/hooks/useWHIP';
import { useVideoFit } from '@/domains/stream/hooks/useVideoFit';
import { useChat } from '@/domains/chat/hooks/useChat';
import { useSocket } from '@/domains/chat/hooks/useSocket';
import { useDonation } from '@/domains/donation/hooks/useDonation';
import { DonationAlertDisplay } from '@/domains/donation/components/DonationAlert';
import {
  Camera,
  SwitchCamera,
  Mic,
  MicOff,
  Eye,
  X,
  Loader2,
  AlertTriangle,
} from 'lucide-react';

interface PublishInfo {
  streamId: string;
  streamKey: string;
  whipUrl: string;
  title: string;
  status: string;
}

export default function BroadcastPage() {
  const t = useTranslations('broadcast');
  const tStream = useTranslations('stream');
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  // 카메라 파이프라인이 쓰는 DOM 요소 (useCamera 주석 참고)
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [info, setInfo] = useState<PublishInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const liveSinceRef = useRef<number | null>(null);

  const camera = useCamera({ videoRef, canvasRef });
  const whip = useWHIP();

  // 세로 변환이 안 되는 기기에서는 원본 video가 그대로 보인다.
  // 그때 확대되지 않도록 비율에 맞춰 표시 방식을 고른다.
  const fit = useVideoFit(videoRef);

  const isLive = whip.state === 'live' || whip.state === 'reconnecting';

  // 방송 중일 때만 채팅·후원 소켓을 연결한다
  const { socket, connected } = useSocket(isLive);
  const { messages, viewerCount } = useChat({
    streamId: info?.streamId ?? '',
    enabled: isLive && Boolean(info),
    socket,
    connected,
  });
  const { alerts, dismissAlert } = useDonation({
    streamId: info?.streamId ?? '',
    socket,
    connected,
  });

  // 송출 정보 로드
  useEffect(() => {
    if (authLoading || !user) return;

    (async () => {
      try {
        const res = await fetch('/api/stream/publish-info');
        const body = await res.json();
        if (!res.ok) {
          setLoadError(body.error ?? t('publishInfoFailed'));
          return;
        }
        setInfo(body.data);
        setTitle(body.data.title ?? '');
      } catch {
        setLoadError(t('publishInfoFailed'));
      }
    })();
  }, [authLoading, user, t]);

  // 진입 시 카메라 열기.
  //
  // camera 객체는 매 렌더마다 새로 만들어지므로 의존성에 넣으면 이펙트가
  // 계속 재실행된다. getUserMedia는 무겁고 권한 프롬프트까지 띄우므로
  // ref로 "한 번만" 을 확실히 보장한다.
  const cameraOpenedRef = useRef(false);
  const openCameraRef = useRef(camera.open);

  useEffect(() => {
    openCameraRef.current = camera.open;
  }, [camera.open]);

  useEffect(() => {
    if (!info || cameraOpenedRef.current) return;
    cameraOpenedRef.current = true;
    openCameraRef.current();
  }, [info]);

  // 방송 중 경과 시간.
  //
  // 카운터를 1씩 올리는 대신 시작 시각과의 차이를 계산한다.
  // 탭이 백그라운드로 가면 타이머가 느려지는데, 이 방식은 영향받지 않는다.
  useEffect(() => {
    if (!isLive) return;

    liveSinceRef.current ??= Date.now();
    const tick = () =>
      setElapsed(
        Math.floor((Date.now() - (liveSinceRef.current ?? Date.now())) / 1000),
      );

    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [isLive]);

  // 방송 중에는 화면이 꺼지지 않게 한다
  useEffect(() => {
    if (!isLive) return;

    let cancelled = false;
    const acquire = async () => {
      try {
        if ('wakeLock' in navigator) {
          const lock = await navigator.wakeLock.request('screen');
          if (cancelled) lock.release();
          else wakeLockRef.current = lock;
        }
      } catch {
        // 지원하지 않는 브라우저는 그냥 넘어간다
      }
    };
    acquire();

    // 탭이 백그라운드에 갔다 돌아오면 wake lock이 해제되므로 다시 잡는다
    const onVisible = () => {
      if (document.visibilityState === 'visible') acquire();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      wakeLockRef.current?.release().catch(() => {});
      wakeLockRef.current = null;
    };
  }, [isLive]);

  const handleStart = useCallback(async () => {
    if (!info) return;

    const stream = camera.stream ?? (await camera.open());
    if (!stream) return;

    if (title !== info.title) {
      await fetch('/api/stream/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      }).catch(() => {});
    }

    liveSinceRef.current = null;
    await whip.start({
      whipUrl: info.whipUrl,
      streamKey: info.streamKey,
      stream,
    });
  }, [info, camera, title, whip]);

  const handleStop = useCallback(async () => {
    if (!confirm(t('stopConfirm'))) return;
    await whip.stop();
    camera.close();
    router.push('/dashboard');
  }, [whip, camera, router, t]);

  /**
   * 전/후면 전환.
   * 송출 중이면 재협상 없이 트랙만 교체해서 화면이 끊기지 않게 한다.
   */
  const handleFlip = useCallback(async () => {
    const next = await camera.flip();
    if (!next || !isLive) return;

    const newTrack = next.getVideoTracks()[0];
    if (newTrack) await whip.replaceVideoTrack(newTrack);
  }, [camera, isLive, whip]);

  if (authLoading) {
    return <Center><Loader2 className="h-8 w-8 animate-spin text-white" /></Center>;
  }

  if (!user) {
    return <Center><p className="text-gray-400">{t('loginRequired')}</p></Center>;
  }

  if (loadError) {
    return (
      <Center>
        <div className="max-w-xs text-center">
          <AlertTriangle className="mx-auto mb-3 h-9 w-9 text-yellow-500" />
          <p className="mb-4 text-white">{loadError}</p>
          <button
            onClick={() => router.push('/dashboard')}
            className="rounded-full bg-white/15 px-5 py-2.5 text-sm text-white"
          >
            {t('backToDashboard')}
          </button>
        </div>
      </Center>
    );
  }

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-black">
      {/*
        카메라 미리보기 — 원본 video 위에 잘라낸 canvas를 덮는다.

        video를 숨기면 iOS Safari가 프레임을 디코딩하지 않아 캔버스가 빈 채로
        남는다(실측: 디코딩 0×0). detached는 물론 display:none, 1px+투명도
        전부 마찬가지다. 그래서 정상 크기로 배치하고 canvas가 그 위를 덮는다.
        사용자에게는 잘라낸 세로 화면만 보이고, video는 가려져 있을 뿐
        렌더링되므로 디코딩이 정상 동작한다.

        세로 변환이 안 되는 기기에서는 canvas를 숨겨 원본이 그대로 보인다.

        전면 카메라는 거울처럼 좌우 반전 (미리보기에서만, 송출은 원본)
      */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="absolute inset-0 h-full w-full"
        style={{
          objectFit: fit,
          transform: camera.facing === 'user' ? 'scaleX(-1)' : undefined,
        }}
      />
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full bg-black"
        style={{
          objectFit: 'cover',
          display: camera.usingCrop ? 'block' : 'none',
          transform: camera.facing === 'user' ? 'scaleX(-1)' : undefined,
        }}
      />

      {camera.error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/85 px-6">
          <div className="max-w-sm text-center">
            <Camera className="mx-auto mb-3 h-10 w-10 text-red-400" />
            <p className="mb-5 text-sm leading-relaxed text-white">
              {camera.error}
            </p>
            <button
              onClick={() => {
                cameraOpenedRef.current = true;
                camera.open();
              }}
              className="rounded-full bg-white/15 px-5 py-2.5 text-sm text-white"
            >
              {t('retry')}
            </button>
          </div>
        </div>
      )}

      {/* 상단 상태 바 */}
      <div className="absolute inset-x-0 top-0 flex items-center justify-between p-4">
        <div className="flex items-center gap-2">
          {isLive && (
            <>
              <span className="flex items-center gap-1.5 rounded-full bg-red-600 px-2.5 py-1 text-xs font-bold text-white">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
                {tStream('live')}
              </span>
              <span className="rounded-full bg-black/50 px-2.5 py-1 font-mono text-xs text-white">
                {formatElapsed(elapsed)}
              </span>
              <span className="flex items-center gap-1 rounded-full bg-black/50 px-2.5 py-1 text-xs text-white">
                <Eye className="h-3 w-3" />
                {viewerCount}
              </span>
            </>
          )}
          {whip.state === 'reconnecting' && (
            <span className="rounded-full bg-yellow-500/90 px-2.5 py-1 text-xs font-medium text-black">
              {t('reconnecting')}
            </span>
          )}
        </div>

        <button
          onClick={isLive ? handleStop : () => router.push('/dashboard')}
          className="rounded-full bg-black/50 p-2 text-white"
          aria-label={isLive ? t('stop') : t('leave')}
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* 후원 알림 */}
      {isLive && (
        <DonationAlertDisplay alert={alerts[0]} onDismiss={dismissAlert} />
      )}

      {/* 방송 중 채팅 (읽기 전용) */}
      {isLive && messages.length > 0 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-32 max-h-[30vh] space-y-1.5 overflow-hidden px-4">
          {messages.slice(-6).map((m) => (
            <div key={m.id} className="text-sm">
              {m.type === 'system' ? (
                <span className="text-white/50">{m.content}</span>
              ) : (
                <>
                  <span
                    className={
                      m.type === 'donation'
                        ? 'font-bold text-yellow-400'
                        : 'font-semibold text-white/70'
                    }
                  >
                    {m.nickname}
                  </span>
                  <span className="ml-1.5 text-white drop-shadow">
                    {m.content}
                  </span>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 하단 컨트롤 */}
      <div className="absolute inset-x-0 bottom-0 p-5 pb-8">
        {!isLive && (
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('titlePlaceholder')}
            maxLength={60}
            className="mb-4 w-full rounded-xl border border-white/20 bg-black/50 px-4 py-3 text-white placeholder-white/40 backdrop-blur focus:border-white/50 focus:outline-none"
          />
        )}

        {whip.error && (
          <p className="mb-3 rounded-lg bg-red-500/20 px-3 py-2 text-center text-sm text-red-200">
            {whip.error}
          </p>
        )}

        <div className="flex items-center justify-between gap-4">
          <button
            onClick={camera.toggleMic}
            className="rounded-full bg-white/15 p-3.5 text-white backdrop-blur"
            aria-label={camera.micOn ? t('micOff') : t('micOn')}
          >
            {camera.micOn ? (
              <Mic className="h-5 w-5" />
            ) : (
              <MicOff className="h-5 w-5 text-red-400" />
            )}
          </button>

          {isLive ? (
            <button
              onClick={handleStop}
              className="flex-1 rounded-full bg-red-600 py-4 text-base font-bold text-white"
            >
              {t('stop')}
            </button>
          ) : (
            <button
              onClick={handleStart}
              disabled={
                whip.state === 'connecting' || !camera.stream || !info
              }
              className="flex flex-1 items-center justify-center gap-2 rounded-full bg-white py-4 text-base font-bold text-black disabled:opacity-40"
            >
              {whip.state === 'connecting' ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  {t('connecting')}
                </>
              ) : (
                t('start')
              )}
            </button>
          )}

          <button
            onClick={handleFlip}
            className="rounded-full bg-white/15 p-3.5 text-white backdrop-blur"
            aria-label={t('flipCamera')}
          >
            <SwitchCamera className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-gray-950 px-6">
      {children}
    </div>
  );
}

function formatElapsed(total: number): string {
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
