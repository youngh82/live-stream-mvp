export type StreamStatus = 'idle' | 'live' | 'ended';

export interface Stream {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  category: string | null;
  tags: string[];
  stream_key: string;
  status: StreamStatus;
  viewer_count: number;
  thumbnail_url: string | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
}
