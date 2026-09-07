export type UserRole = 'viewer' | 'streamer';

export interface User {
  id: string;
  nickname: string;
  avatar_url: string | null;
  role: UserRole;
  point_balance: number;
  created_at: string;
  updated_at: string;
}
