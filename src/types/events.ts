import type { PublicRoomPlayer } from "../models/room.js";

export interface QueueJoinPayload {
  mode: "casual";
  nickname: string;
  guestId: string;
}

export interface RoomReadyPayload {
  roomId: string;
}

export interface OpponentPayload {
  guestId: string;
  nickname: string;
}

export interface QueueJoinedPayload {
  joinedAt: number;
}

export interface QueueTickPayload {
  elapsed: number;
}

export interface QueueCancelledPayload {}

export interface MatchFoundPayload {
  roomId: string;
  opponent: OpponentPayload;
  isBot: false;
}

export interface MatchAiFallbackPayload {
  roomId: string;
  opponent: OpponentPayload;
  isBot: true;
}

export interface RoomStartPayload {
  roomId: string;
  seed: number;
  players: PublicRoomPlayer[];
}

export interface ErrorPayload {
  message: string;
}

// Game relay payloads — server relays as-is, no interpretation
export interface PlayerMovePayload {
  x: number;
  y: number;
  vx: number;
  vy: number;
  t: number;
}

export interface PlayerStatePayload {
  x: number;
  y: number;
  hp: number;
  score: number;
  t: number;
}

export interface ChainSpawnPayload {
  chainId: string;
  x: number;
  y: number;
  color: string;
  t: number;
}

export interface ChainWarningPayload {
  chainId: string;
  t: number;
}

export interface ItemPickupPayload {
  itemId: string;
  type: string;
  t: number;
}

export interface GameOverPayload {
  winnerGuestId: string | null;
  reason?: string;
}

export interface RoomEndPayload {
  winnerGuestId: string | null;
  reason?: string;
}

export interface RematchRequestPayload {
  roomId: string;
}

export interface RematchCancelPayload {
  roomId: string;
}

export interface RematchWaitingPayload {
  roomId: string;
}

export interface RematchAcceptedPayload {
  roomId: string;
}

export interface RematchTimeoutPayload {
  roomId: string;
}

export interface OpponentLeftPayload {
  roomId: string;
}

export interface ClientToServerEvents {
  "queue:join": (payload: QueueJoinPayload) => void;
  "queue:cancel": () => void;
  "room:ready": (payload: RoomReadyPayload) => void;
  "player:move": (payload: PlayerMovePayload) => void;
  "player:state": (payload: PlayerStatePayload) => void;
  "chain:spawn": (payload: ChainSpawnPayload) => void;
  "chain:warning": (payload: ChainWarningPayload) => void;
  "item:pickup": (payload: ItemPickupPayload) => void;
  "game:over": (payload: GameOverPayload) => void;
  "rematch:request": (payload: RematchRequestPayload) => void;
  "rematch:cancel": (payload: RematchCancelPayload) => void;
}

export interface ServerToClientEvents {
  "queue:joined": (payload: QueueJoinedPayload) => void;
  "queue:tick": (payload: QueueTickPayload) => void;
  "queue:cancelled": (payload: QueueCancelledPayload) => void;
  "match:found": (payload: MatchFoundPayload) => void;
  "match:ai_fallback": (payload: MatchAiFallbackPayload) => void;
  "room:start": (payload: RoomStartPayload) => void;
  "error": (payload: ErrorPayload) => void;
  "player:moved": (payload: PlayerMovePayload) => void;
  "player:state": (payload: PlayerStatePayload) => void;
  "chain:spawned": (payload: ChainSpawnPayload) => void;
  "chain:warning": (payload: ChainWarningPayload) => void;
  "item:picked": (payload: ItemPickupPayload) => void;
  "room:end": (payload: RoomEndPayload) => void;
  "rematch:waiting": (payload: RematchWaitingPayload) => void;
  "rematch:accepted": (payload: RematchAcceptedPayload) => void;
  "rematch:timeout": (payload: RematchTimeoutPayload) => void;
  "opponent:left": (payload: OpponentLeftPayload) => void;
}

export interface InterServerEvents {}

export interface SocketData {
  guestId?: string;
  roomId?: string;
}
