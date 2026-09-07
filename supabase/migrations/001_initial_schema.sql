-- ============================================
-- Live Stream MVP - Initial Schema
-- ============================================

-- Custom types
CREATE TYPE user_role AS ENUM ('viewer', 'streamer');
CREATE TYPE stream_status AS ENUM ('idle', 'live', 'ended');
CREATE TYPE chat_message_type AS ENUM ('message', 'system', 'donation');

-- ============================================
-- Users
-- ============================================
CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nickname TEXT UNIQUE NOT NULL,
  avatar_url TEXT,
  role user_role DEFAULT 'viewer' NOT NULL,
  point_balance INTEGER DEFAULT 0 NOT NULL CHECK (point_balance >= 0),
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- ============================================
-- Streams
-- ============================================
CREATE TABLE streams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT,
  tags TEXT[] DEFAULT '{}',
  stream_key TEXT UNIQUE NOT NULL,
  status stream_status DEFAULT 'idle' NOT NULL,
  viewer_count INTEGER DEFAULT 0 NOT NULL,
  thumbnail_url TEXT,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- ============================================
-- Donations
-- ============================================
CREATE TABLE donations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_id UUID NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL CHECK (amount > 0),
  message TEXT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- ============================================
-- Chat Messages (archiving, realtime via Redis)
-- ============================================
CREATE TABLE chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_id UUID NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  type chat_message_type DEFAULT 'message' NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- ============================================
-- Indexes
-- ============================================
CREATE INDEX idx_streams_live_feed ON streams (status, viewer_count DESC);
CREATE INDEX idx_streams_user ON streams (user_id);
CREATE INDEX idx_donations_stream ON donations (stream_id, created_at DESC);
CREATE INDEX idx_chat_messages_stream ON chat_messages (stream_id, created_at);

-- ============================================
-- Row Level Security
-- ============================================

-- Users
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users are viewable by everyone"
  ON users FOR SELECT
  USING (true);

CREATE POLICY "Users can update own profile"
  ON users FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON users FOR INSERT
  WITH CHECK (auth.uid() = id);

-- Streams
ALTER TABLE streams ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Streams are viewable by everyone"
  ON streams FOR SELECT
  USING (true);

CREATE POLICY "Streamers can insert own streams"
  ON streams FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Streamers can update own streams"
  ON streams FOR UPDATE
  USING (auth.uid() = user_id);

-- Donations
ALTER TABLE donations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own donations"
  ON donations FOR SELECT
  USING (auth.uid() = sender_id OR auth.uid() = receiver_id);

CREATE POLICY "Users can insert donations"
  ON donations FOR INSERT
  WITH CHECK (auth.uid() = sender_id);

-- Chat Messages
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Chat messages are viewable by everyone"
  ON chat_messages FOR SELECT
  USING (true);

CREATE POLICY "Authenticated users can send messages"
  ON chat_messages FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- ============================================
-- Auto-update updated_at trigger
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
