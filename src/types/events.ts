import type { EncounterType, PublicRoomPlayer, RoundState } from "../models/room.js";
import type { BattleConfig, BattleStatus, ChainType } from "../models/battle.js";

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
  currentSeed: number;
  round: number;
  roundState: RoundState;
  encounter: EncounterType;
  score: Record<string, number>;
  players: PublicRoomPlayer[];
  battleConfig: BattleConfig;
  initialBattleState: BattleStatePayload;
  initialItem: ItemSpawnedPayload | null;
  roundWinnerGuestId: string | null;
  matchWinnerGuestId: string | null;
}

export interface RoundStartPayload extends RoomStartPayload {}

export interface ErrorPayload {
  message: string;
}

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

export interface BattlePlayerSnapshot {
  guestId: string;
  x: number;
  y: number;
  hp: number;
  score: number;
  heldChainType: ChainType | null;
  alive: boolean;
}

export interface BattleItemSnapshot {
  itemId: string;
  chainType: ChainType;
  x: number;
  y: number;
  active: boolean;
  respawnAt: number | null;
  pickedByGuestId: string | null;
}

export interface BattleStatePayload {
  roomId: string;
  round: number;
  roundState: RoundState;
  seed: number;
  score: Record<string, number>;
  status: BattleStatus;
  players: BattlePlayerSnapshot[];
  item: BattleItemSnapshot | null;
  winnerGuestId: string | null;
  roundWinnerGuestId: string | null;
  matchWinnerGuestId: string | null;
  reason?: string;
  serverTime: number;
}

export interface ItemPickupRequestPayload {
  itemId: string;
  t: number;
}

export interface ItemSpawnedPayload {
  itemId: string;
  chainType: ChainType;
  x: number;
  y: number;
  spawnedAt: number;
}

export interface ItemPickedPayload {
  itemId: string;
  pickedByGuestId: string;
  chainType: ChainType;
  respawnAt: number;
}

export interface ChainCastPayload {
  dx: number;
  dy: number;
  t: number;
}

export interface ChainRequestPayload {
  t: number;
}

export interface ChainWarningPayload {
  chainId: string;
  ownerGuestId: string;
  chainType: ChainType;
  originX: number;
  originY: number;
  dx: number;
  dy: number;
  warningAt: number;
  fireAt: number;
}

export interface ChainSpawnPayload extends ChainWarningPayload {
  firedAt: number;
}

export interface GameOverClaimPayload {
  winnerGuestId: string | null;
  reason?: string;
}

export interface RoomEndPayload {
  winnerGuestId: string | null;
  reason?: string;
}

export interface RoundEndPayload {
  roomId: string;
  round: number;
  winnerGuestId: string | null;
  loserGuestId: string | null;
  score: Record<string, number>;
  reason?: string;
}

export interface MatchEndPayload {
  roomId: string;
  winnerGuestId: string | null;
  score: Record<string, number>;
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

export interface PlayerAwayPayload {
  roomId: string;
}

export interface PlayerBackPayload {
  roomId: string;
}

export interface PlayerAwayNoticePayload {
  playerId: string;
  timeout: number;
}

export interface PlayerBackNoticePayload {
  playerId: string;
}

export interface ClientToServerEvents {
  "queue:join": (payload: QueueJoinPayload) => void;
  "queue:cancel": () => void;
  "room:ready": (payload: RoomReadyPayload) => void;
  "player:move": (payload: PlayerMovePayload) => void;
  "player:state": (payload: PlayerStatePayload) => void;
  "player:away": (payload: PlayerAwayPayload) => void;
  "player:back": (payload: PlayerBackPayload) => void;
  "chain:cast": (payload: ChainCastPayload) => void;
  "chain:request": (payload: ChainRequestPayload) => void;
  "item:pickup": (payload: ItemPickupRequestPayload) => void;
  "game:over": (payload: GameOverClaimPayload) => void;
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
  "round:start": (payload: RoundStartPayload) => void;
  "error": (payload: ErrorPayload) => void;
  "battle:state": (payload: BattleStatePayload) => void;
  "player:moved": (payload: PlayerMovePayload) => void;
  "player:state": (payload: PlayerStatePayload) => void;
  "player:away": (payload: PlayerAwayNoticePayload) => void;
  "player:back": (payload: PlayerBackNoticePayload) => void;
  "item:spawned": (payload: ItemSpawnedPayload) => void;
  "chain:spawned": (payload: ChainSpawnPayload) => void;
  "chain:warning": (payload: ChainWarningPayload) => void;
  "item:picked": (payload: ItemPickedPayload) => void;
  "round:end": (payload: RoundEndPayload) => void;
  "match:end": (payload: MatchEndPayload) => void;
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
