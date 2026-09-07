'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { useTranslations } from 'next-intl';

/**
 * 모바일 세로 방송용 카메라/마이크.
 *
 * 문제: 폰을 세로로 들어도 카메라가 가로 프레임(1920×1080)을 주는 기기가 있다.
 * 그대로 송출하면 시청자는 위아래 검은 띠가 붙은 가로 영상을 보게 되고,
 * 세로 풀스크린이라는 이 서비스의 전제가 깨진다.
 *
 * 해결: 카메라 프레임을 캔버스에 9:16으로 가운데 잘라 그린 뒤,
 * 그 캔버스를 송출 소스로 쓴다. 실제로 나가는 영상이 세로가 된다.
 *
 * iOS 주의사항 (실측으로 확인):
 *   화면에 보이지 않는 <video>는 iOS Safari가 프레임을 디코딩하지 않는다.
 *   detached는 물론이고 display:none, visibility:hidden, 1px + opacity 0.01도
 *   전부 videoWidth가 0으로 남는다.
 *   그래서 원본 video를 정상 크기로 배치하고 그 위를 canvas로 덮는다.
 *   가려져 있을 뿐 렌더링되는 요소라 디코딩이 정상 동작한다.
 *   → 두 엘리먼트는 화면 쪽에서 배치해야 하므로, 컴포넌트가 만든 ref를
 *     이 훅에 넘겨준다.
 */

interface UseCameraOptions {
  /** 원본 카메라를 재생할 video 요소 (화면에 보이게 배치되어야 한다) */
  videoRef: RefObject<HTMLVideoElement | null>;
  /** 9:16으로 잘라 그릴 canvas 요소 */
  canvasRef: RefObject<HTMLCanvasElement | null>;
}

export type Facing = 'user' | 'environment';

const TARGET_W = 720;
const TARGET_H = 1280;
const TARGET_AR = TARGET_W / TARGET_H; // 0.5625
const FRAME_WAIT_MS = 4000;

/** 이전 캡처 세션을 놓아준 뒤 iOS가 정리할 시간을 준다 */
const CAMERA_RELEASE_MS = 200;

/**
 * 세로 변환(캔버스 크롭) 사용 여부.
 *
 * 2026-09-02 현재 꺼둔 상태다. 가로 프레임을 9:16으로 잘라내면 화면은
 * 세로가 되지만 화각이 크게 잘려나가 "확대된" 영상이 되고, 이건 원하는
 * 결과가 아니다. 필요한 건 애초에 카메라가 세로로 잡히는 것이다.
 *
 * 자세한 내용과 다음에 시도할 것들: memory/mobile-portrait-camera-issue.md
 * 다시 실험하려면 이 값을 true로 바꾸면 된다.
 */
const ENABLE_PORTRAIT_CROP = false;

export function useCamera({ videoRef, canvasRef }: UseCameraOptions) {
  const t = useTranslations('camera');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [facing, setFacing] = useState<Facing>('user');
  const [micOn, setMicOn] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [usingCrop, setUsingCrop] = useState(false);

  // 원본 카메라와 마이크는 따로 관리한다.
  // 전/후면 전환 시 비디오만 다시 잡으면 오디오가 끊기지 않는다.
  const videoSourceRef = useRef<MediaStream | null>(null);
  const audioSourceRef = useRef<MediaStream | null>(null);

  const rafRef = useRef<number | null>(null);
  const outputRef = useRef<MediaStream | null>(null);

  // open()이 겹치지 않게 하기 위한 상태. facing은 ref로도 들고 있어야
  // open의 기본 인자 때문에 콜백이 매번 새로 만들어지는 걸 피할 수 있다.
  const facingRef = useRef<Facing>(facing);
  const inFlightRef = useRef<{
    facing: Facing;
    promise: Promise<MediaStream | null>;
  } | null>(null);

  useEffect(() => {
    facingRef.current = facing;
  }, [facing]);

  const stopPipeline = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    outputRef.current?.getVideoTracks().forEach((t) => t.stop());
    outputRef.current = null;
  }, []);

  const stopAll = useCallback(() => {
    stopPipeline();
    videoSourceRef.current?.getTracks().forEach((t) => t.stop());
    videoSourceRef.current = null;
    audioSourceRef.current?.getTracks().forEach((t) => t.stop());
    audioSourceRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, [stopPipeline, videoRef]);

  /** 화면에 보이는 video에서 캔버스로 9:16 가운데 잘라 그리는 루프를 건다 */
  const startCropLoop = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return null;

    canvas.width = TARGET_W;
    canvas.height = TARGET_H;

    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);

    const draw = () => {
      const v = videoRef.current;
      if (v && v.videoWidth && v.videoHeight) {
        const { videoWidth: vw, videoHeight: vh } = v;

        // 가운데 기준으로 9:16이 되도록 잘라낼 영역
        let sw: number;
        let sh: number;
        if (vw / vh > TARGET_AR) {
          sh = vh; // 소스가 더 넓다 → 좌우를 자른다
          sw = vh * TARGET_AR;
        } else {
          sw = vw; // 소스가 더 길다 → 위아래를 자른다
          sh = vw / TARGET_AR;
        }

        ctx.drawImage(
          v,
          (vw - sw) / 2,
          (vh - sh) / 2,
          sw,
          sh,
          0,
          0,
          TARGET_W,
          TARGET_H,
        );
      }
      rafRef.current = requestAnimationFrame(draw);
    };
    draw();

    // 30fps로 캡처. captureStream은 캔버스가 갱신될 때마다 프레임을 내보낸다.
    outputRef.current = canvas.captureStream(30);
    return outputRef.current;
  }, [videoRef, canvasRef]);

  const runOpen = useCallback(
    async (nextFacing: Facing) => {
      setStarting(true);
      setError(null);

      if (typeof navigator === 'undefined' || !navigator.mediaDevices) {
        setError(t('insecureContext'));
        setStarting(false);
        return null;
      }

      try {
        // 마이크는 처음 한 번만 잡는다
        if (!audioSourceRef.current) {
          audioSourceRef.current = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
          });
        }
        audioSourceRef.current
          .getAudioTracks()
          .forEach((t) => (t.enabled = micOn));

        // 이전 카메라를 "완전히" 놓아준 뒤에 새로 요청한다.
        //
        // iOS는 캡처 세션이 살아 있는 상태에서 getUserMedia가 또 들어오면
        // 방향을 무시하고 가로로 스왑된 트랙을 돌려준다. 정지 후 재요청해야
        // 기기 방향을 다시 읽는다. 순서를 뒤집으면(먼저 열고 나중에 정지)
        // 세로 방송이 통째로 깨진다.
        stopPipeline();
        if (videoSourceRef.current) {
          videoSourceRef.current.getTracks().forEach((t) => t.stop());
          videoSourceRef.current = null;
          if (videoRef.current) videoRef.current.srcObject = null;
          await sleep(CAMERA_RELEASE_MS);
        }

        const nextVideo = await acquireVideo(nextFacing);
        videoSourceRef.current = nextVideo;

        // 화면에 보이는 video에 물린다 — 여기서 실제 디코딩이 일어난다
        const el = videoRef.current;
        if (el) {
          el.srcObject = nextVideo;
          el.muted = true;
          el.playsInline = true;
          await el.play().catch(() => {});
          await waitForFrame(el, FRAME_WAIT_MS);
        }

        const s = nextVideo.getVideoTracks()[0]?.getSettings() ?? {};
        const sw = s.width ?? 0;
        const sh = s.height ?? 0;
        // 세로로 왔으면 그걸로 끝이다. 9:16이든 3:4든 손대지 않는다 —
        // 기기가 준 화각을 잘라낼 이유가 없다.
        const alreadyPortrait = sw > 0 && sh > 0 && sw < sh;

        let output: MediaStream;

        if (alreadyPortrait) {
          // 기기가 세로로 줬다 — 원본 그대로 송출한다
          stopPipeline();
          output = new MediaStream(nextVideo.getVideoTracks());
          setUsingCrop(false);
        } else if (!ENABLE_PORTRAIT_CROP) {
          // 크롭을 끈 상태 — 카메라가 준 프레임을 그대로 내보낸다.
          // 가로로 나가지만 확대되거나 잘리지 않는다.
          stopPipeline();
          output = new MediaStream(nextVideo.getVideoTracks());
          setUsingCrop(false);
        } else {
          const cropped = el && el.videoWidth > 0 ? startCropLoop() : null;
          const track = cropped?.getVideoTracks()[0];

          if (track && track.readyState === 'live') {
            output = new MediaStream([track]);
            setUsingCrop(true);
          } else {
            // 디코딩이 안 되는 환경 — 원본이라도 내보낸다.
            // 가로로 나가지만 방송이 아예 안 되는 것보다는 낫다.
            console.warn('[Camera] 세로 변환 실패 — 원본 트랙으로 대체');
            stopPipeline();
            output = new MediaStream(nextVideo.getVideoTracks());
            setUsingCrop(false);
          }
        }

        audioSourceRef.current
          .getAudioTracks()
          .forEach((t) => output.addTrack(t));

        setStream(output);
        setFacing(nextFacing);
        return output;
      } catch (err) {
        setError(describeError(err, t));
        return null;
      } finally {
        setStarting(false);
      }
    },
    [micOn, startCropLoop, stopPipeline, videoRef, t],
  );

  /**
   * 카메라 열기. 두 번이 겹치지 않도록 직렬화한다.
   *
   * StrictMode 이중 마운트, 버튼 연타, flip 중 재진입 — 어느 쪽이든
   * getUserMedia가 동시에 두 번 들어가면 iOS가 가로로 스왑된 트랙을 준다.
   * 같은 카메라 요청이 이미 진행 중이면 그 결과를 나눠 쓰고,
   * 다른 카메라면 앞의 것이 끝난 뒤에 이어서 연다.
   */
  const open = useCallback(
    (nextFacing: Facing = facingRef.current): Promise<MediaStream | null> => {
      const settle = (promise: Promise<MediaStream | null>) => {
        const entry = { facing: nextFacing, promise };
        inFlightRef.current = entry;
        promise.finally(() => {
          if (inFlightRef.current === entry) inFlightRef.current = null;
        });
        return promise;
      };

      const current = inFlightRef.current;
      if (!current) return settle(runOpen(nextFacing));
      if (current.facing === nextFacing) return current.promise;

      return settle(
        current.promise.catch(() => null).then(() => runOpen(nextFacing)),
      );
    },
    [runOpen],
  );

  const flip = useCallback(
    async () => open(facing === 'user' ? 'environment' : 'user'),
    [facing, open],
  );

  const toggleMic = useCallback(() => {
    setMicOn((prev) => {
      const next = !prev;
      audioSourceRef.current
        ?.getAudioTracks()
        .forEach((t) => (t.enabled = next));
      return next;
    });
  }, []);

  const close = useCallback(() => {
    stopAll();
    setStream(null);
    setUsingCrop(false);
  }, [stopAll]);

  useEffect(() => stopAll, [stopAll]);

  return {
    stream,
    facing,
    micOn,
    error,
    starting,
    usingCrop,
    open,
    flip,
    toggleMic,
    close,
  };
}

/**
 * 카메라를 한 번 요청한다. 방향은 기기에 맡긴다.
 *
 * **세로 해상도를 요구하면 안 된다.** 모바일 카메라는 임의 비율을 지원하지
 * 않는다. `1080×1920` 같은 세로 값을 넣으면 기기는 그걸 가로로 스왑해서
 * "충족했다"고 답한다 — 에러도 나지 않는다.
 * (실측: exact 1080×1920 → 1920×1080, exact 720×1280 → 1280×720)
 *
 * 올바른 방법은 **표준 가로 해상도(1280×720)를 요청하고 방향은 기기가
 * 정하게 두는 것**이다. 폰을 세로로 들면 기기가 720×1280으로 돌려준다.
 * https://developers.snap.com/camera-kit/integrate-sdk/web/guides/web-considerations
 *
 * 호출 직전에 이전 트랙이 반드시 정지되어 있어야 한다 (runOpen 참고).
 */
function acquireVideo(facing: Facing): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: facing,
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30 },
    },
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 비디오가 실제로 프레임을 내보내기 시작할 때까지 기다린다 */
function waitForFrame(el: HTMLVideoElement, timeoutMs: number): Promise<void> {
  if (el.videoWidth > 0) return Promise.resolve();

  return new Promise((resolve) => {
    const done = () => {
      el.removeEventListener('loadedmetadata', check);
      el.removeEventListener('resize', check);
      clearInterval(poll);
      clearTimeout(timer);
      resolve();
    };
    const check = () => {
      if (el.videoWidth > 0) done();
    };

    el.addEventListener('loadedmetadata', check);
    el.addEventListener('resize', check);
    const poll = setInterval(check, 100);
    const timer = setTimeout(done, timeoutMs);
  });
}

/**
 * getUserMedia 예외를 사용자가 다음에 무엇을 할지 알 수 있는 문구로.
 *
 * `err.name`은 브라우저가 정한 값이라 번역하지 않고, 그 이름에 대응하는
 * 안내만 사전에서 꺼낸다. 모르는 이름은 원본을 괄호로 남긴다 — 버그 제보를
 * 받을 때 이게 유일한 단서다.
 */
function describeError(
  err: unknown,
  t: ReturnType<typeof useTranslations<'camera'>>,
): string {
  if (!(err instanceof Error)) return t('openFailed');

  switch (err.name) {
    case 'NotAllowedError':
      return t('permissionDenied');
    case 'NotFoundError':
      return t('noCamera');
    case 'NotReadableError':
      return t('inUse');
    case 'OverconstrainedError':
      return t('unsupportedResolution');
    default:
      return t('openFailedWithName', { name: err.name });
  }
}
