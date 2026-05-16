export const CHAIN_TYPES = ["red", "blue", "green", "yellow"] as const;

export type ChainType = (typeof CHAIN_TYPES)[number];
export type BattleStatus = "idle" | "active" | "ended";

export interface BattleConfig {
  worldWidth: number;
  worldHeight: number;
  itemPickupRadius: number;
  itemRespawnMs: number;
  chainWarningMs: number;
  chainHitRadius: number;
  chainRange: number;
}

export const DEFAULT_BATTLE_CONFIG: BattleConfig = {
  worldWidth: 1280,
  worldHeight: 720,
  itemPickupRadius: 72,
  itemRespawnMs: 5_000,
  chainWarningMs: 700,
  chainHitRadius: 64,
  chainRange: 1_280,
};

export interface Vector2 {
  x: number;
  y: number;
}

export interface BattlePlayerState extends Vector2 {
  guestId: string;
  hp: number;
  score: number;
  heldChainType: ChainType | null;
  alive: boolean;
  lastUpdateAt: number;
}

export interface BattleItemState extends Vector2 {
  itemId: string;
  chainType: ChainType;
  active: boolean;
  spawnedAt: number;
  respawnAt: number | null;
  pickedByGuestId: string | null;
}

export interface BattleChainState {
  chainId: string;
  ownerGuestId: string;
  chainType: ChainType;
  origin: Vector2;
  direction: Vector2;
  warningAt: number;
  fireAt: number;
  fired: boolean;
}

export interface BattleState {
  status: BattleStatus;
  rngState: number;
  players: Record<string, BattlePlayerState>;
  currentItem: BattleItemState | null;
  chainHistory: BattleChainState[];
  winnerGuestId: string | null;
  endReason?: string;
  respawnTimeout?: NodeJS.Timeout;
  chainTimeouts: Map<string, NodeJS.Timeout>;
}
