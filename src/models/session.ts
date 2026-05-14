import type { QueueMode } from "./queue.js";

export type SessionStatus = "idle" | "queueing" | "matched";

export interface Session {
  guestId: string;
  nickname: string;
  socketId: string;
  status: SessionStatus;
  mode?: QueueMode;
  roomId?: string;
  joinedAt?: number;
}
