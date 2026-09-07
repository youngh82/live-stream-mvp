'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

interface UseStreamLifecycleOptions {
  streamId: string;
  onStreamEnd?: () => void;
}

interface UseStreamLifecycleReturn {
  isEnded: boolean;
  isVisible: boolean;
}

export function useStreamLifecycle({
  streamId,
  onStreamEnd,
}: UseStreamLifecycleOptions): UseStreamLifecycleReturn {
  const [isEnded, setIsEnded] = useState(false);
  const [isVisible, setIsVisible] = useState(true);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

  // Poll stream status
  useEffect(() => {
    async function checkStatus() {
      try {
        const res = await fetch(`/api/stream/${streamId}`);
        if (!res.ok) return;
        const { data } = await res.json();
        if (data?.status === 'ended') {
          setIsEnded(true);
          onStreamEnd?.();
        }
      } catch {
        // Silently fail - will retry on next poll
      }
    }

    pollIntervalRef.current = setInterval(checkStatus, 5000);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [streamId, onStreamEnd]);

  // Page visibility handling
  const handleVisibilityChange = useCallback(() => {
    setIsVisible(document.visibilityState === 'visible');
  }, []);

  useEffect(() => {
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [handleVisibilityChange]);

  return { isEnded, isVisible };
}
