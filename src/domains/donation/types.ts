export interface Donation {
  id: string;
  stream_id: string;
  sender_id: string;
  receiver_id: string;
  amount: number;
  message: string | null;
  created_at: string;
}

export interface DonationWithUsers extends Donation {
  sender: { nickname: string; avatar_url: string | null };
  receiver: { nickname: string; avatar_url: string | null };
}

export type DonationTier = 'basic' | 'highlight' | 'special';

export function getDonationTier(amount: number): DonationTier {
  if (amount >= 5000) return 'special';
  if (amount >= 500) return 'highlight';
  return 'basic';
}

export const DONATION_PRESETS = [100, 500, 1000, 5000, 10000] as const;

export const POINT_PACKAGES = [
  { points: 1000, price: 1000, label: '1,000P' },
  { points: 3000, price: 3000, label: '3,000P' },
  { points: 5000, price: 5000, label: '5,000P' },
  { points: 10000, price: 10000, label: '10,000P' },
  { points: 30000, price: 30000, label: '30,000P' },
] as const;

/**
 * 후원 알림 발행 채널.
 *
 * /api/donation/send 가 DB 커밋 후 발행하고, 채팅 서버가 구독해서
 * 해당 방송 room에 전달한다. 클라이언트는 발행 권한이 없다 (H-01).
 */
export const DONATION_EVENTS_CHANNEL = 'donation:events';

export interface DonationEvent {
  donationId: string;
  streamId: string;
  senderId: string;
  nickname: string;
  avatarUrl: string | null;
  amount: number;
  message: string | null;
}
