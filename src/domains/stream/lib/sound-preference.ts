/**
 * 피드 전체가 공유하는 소리 켜짐/꺼짐 상태.
 *
 * 브라우저는 음소거 상태가 아니면 자동재생을 차단하므로 첫 재생은 항상
 * 음소거로 시작한다. 사용자가 한 번 소리를 켜면 그 선택을 기억해서,
 * 다음 방송으로 스와이프할 때마다 다시 켜지 않아도 되게 한다.
 */

const KEY = 'feed:sound-on';

let soundOn: boolean | null = null;

export function isSoundOn(): boolean {
  if (soundOn === null) {
    try {
      soundOn = localStorage.getItem(KEY) === '1';
    } catch {
      // 시크릿 모드 등 저장소 접근이 막힌 환경
      soundOn = false;
    }
  }
  return soundOn;
}

export function setSoundOn(value: boolean): void {
  soundOn = value;
  try {
    localStorage.setItem(KEY, value ? '1' : '0');
  } catch {
    // 저장 실패는 무시 — 이번 세션 동안은 메모리 값으로 동작한다
  }
}
