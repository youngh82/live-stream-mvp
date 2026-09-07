'use client';

import { useEffect, useState, type RefObject } from 'react';

/**
 * 영상과 화면의 비율을 비교해 object-fit을 자동으로 고른다.
 *
 * 고정값으로 두면 늘 어느 한쪽이 깨진다:
 *   - cover 고정: 가로 영상을 세로 화면에 넣으면 크게 확대되고 좌우가 잘린다
 *   - contain 고정: 세로 영상을 세로 화면에서 보는데도 여백이 생긴다
 *
 * 그래서 둘의 비율 차이가 작을 때만(= 조금만 잘라내면 되는 상황) 채우고,
 * 크게 다르면 잘라내지 않고 전체를 보여준다. 카메라가 가로로 잡히든
 * 세로로 잡히든, 폰이든 데스크톱이든 알아서 맞는 쪽이 선택된다.
 */

// 세로 영상(0.5625)과 길쭉한 폰 화면(약 0.46)의 차이는 0.1 남짓 → 채운다
// 가로 영상(1.78)과 세로 화면의 차이는 1.3 이상 → 전체를 보여준다
const FILL_THRESHOLD = 0.35;

export function useVideoFit(
  ref: RefObject<HTMLVideoElement | null>,
): 'cover' | 'contain' {
  const [fit, setFit] = useState<'cover' | 'contain'>('contain');

  useEffect(() => {
    const video = ref.current;
    if (!video) return;

    const update = () => {
      const { videoWidth, videoHeight, clientWidth, clientHeight } = video;
      if (!videoWidth || !videoHeight || !clientWidth || !clientHeight) return;

      const videoAR = videoWidth / videoHeight;
      const boxAR = clientWidth / clientHeight;
      setFit(Math.abs(videoAR - boxAR) < FILL_THRESHOLD ? 'cover' : 'contain');
    };

    update();
    video.addEventListener('loadedmetadata', update);
    video.addEventListener('resize', update);
    window.addEventListener('resize', update);

    // 트랙이 교체되면(카메라 전환 등) resize 이벤트가 안 오는 브라우저가 있다
    const poll = setInterval(update, 1000);

    return () => {
      video.removeEventListener('loadedmetadata', update);
      video.removeEventListener('resize', update);
      window.removeEventListener('resize', update);
      clearInterval(poll);
    };
  }, [ref]);

  return fit;
}
