import type { QueueMode } from "./queue.js";

export interface RoomPlayer {
  guestId: string;
  nickname: string;
  isBot: boolean;
  socketId?: string;
}

export interface PublicRoomPlayer {
  guestId: string;
  nickname: string;
  isBot: boolean;
}

export interface Room {
  roomId: string;
  mode: QueueMode;
  players: [RoomPlayer, RoomPlayer];
  seed: number;
  createdAt: number;
  readyGuestIds: Set<string>;
  started: boolean;
}
