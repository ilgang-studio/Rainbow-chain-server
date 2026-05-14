export type QueueMode = "casual";

export interface QueueEntry {
  guestId: string;
  nickname: string;
  socketId: string;
  mode: QueueMode;
  joinedAt: number;
}
