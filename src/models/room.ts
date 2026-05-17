import type { QueueMode } from "./queue.js";
import type { BattleState } from "./battle.js";

export type RoundState = "waiting" | "playing" | "round_end" | "match_end";
export type EncounterType = "pvp" | "ai";

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
  currentRound: number;
  score: Record<string, number>;
  roundState: RoundState;
  encounter: EncounterType;
  createdAt: number;
  readyGuestIds: Set<string>;
  started: boolean;
  roundWinnerGuestId: string | null;
  matchWinnerGuestId: string | null;
  awayGuestIds: Set<string>;
  awayTimeouts: Map<string, NodeJS.Timeout>;
  nextRoundTimeout?: NodeJS.Timeout;
  battle?: BattleState;
}
