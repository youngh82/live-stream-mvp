export type ChatMessageType = 'message' | 'system' | 'donation';

export interface ChatMessage {
  id: string;
  stream_id: string;
  user_id: string;
  content: string;
  type: ChatMessageType;
  created_at: string;
}

// Real-time chat message (via WebSocket, not persisted)
export interface LiveChatMessage {
  id: string;
  userId: string;
  nickname: string;
  avatarUrl: string | null;
  content: string;
  type: ChatMessageType;
  createdAt: string;
}

// Socket.io event payloads
export interface ChatJoinPayload {
  streamId: string;
}

export interface ChatSendPayload {
  streamId: string;
  content: string;
}

export interface ChatViewerCountPayload {
  count: number;
}

export interface ChatErrorPayload {
  message: string;
}

export interface ChatSystemPayload {
  content: string;
  type: 'system';
}
