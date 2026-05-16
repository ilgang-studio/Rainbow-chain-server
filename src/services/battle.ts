import { randomUUID } from "node:crypto";
import type { Server, Socket } from "socket.io";
import type {
  BattleChainState,
  BattleItemState,
  BattlePlayerState,
  BattleState,
  ChainType,
  Vector2,
} from "../models/battle.js";
import { CHAIN_TYPES, DEFAULT_BATTLE_CONFIG } from "../models/battle.js";
import type { Room } from "../models/room.js";
import { getRoom } from "./roomManager.js";
import type {
  BattleStatePayload,
  ChainCastPayload,
  ChainSpawnPayload,
  ChainWarningPayload,
  ClientToServerEvents,
  InterServerEvents,
  ItemPickupRequestPayload,
  ItemPickedPayload,
  ItemSpawnedPayload,
  PlayerStatePayload,
  RoomEndPayload,
  ServerToClientEvents,
  SocketData,
} from "../types/events.js";

type SocketServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type ServerSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

const DEFAULT_HP = 3;
const SPAWN_MARGIN = 96;

export interface BattleService {
  startRoom: (roomId: string, options?: { emitInitialEvents?: boolean }) => void;
  disposeRoom: (roomId: string) => void;
  syncPlayerState: (socket: ServerSocket, payload: PlayerStatePayload) => void;
  handleItemPickup: (socket: ServerSocket, payload: ItemPickupRequestPayload) => void;
  castChain: (socket: ServerSocket, payload: ChainCastPayload) => void;
  handleGameOverClaim: (socket: ServerSocket) => void;
  getBattleState: (roomId: string) => BattleStatePayload | null;
  getCurrentItemSpawn: (roomId: string) => ItemSpawnedPayload | null;
}

function nextRandom(state: BattleState): number {
  let t = state.rngState += 0x6d2b79f5;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
}

function toBattleStatePayload(room: Room): BattleStatePayload {
  const battle = room.battle;
  if (!battle) {
    return {
      roomId: room.roomId,
      status: "idle",
      players: [],
      item: null,
      winnerGuestId: null,
      serverTime: Date.now(),
    };
  }

  return {
    roomId: room.roomId,
    status: battle.status,
    players: Object.values(battle.players).map((player) => ({
      guestId: player.guestId,
      x: player.x,
      y: player.y,
      hp: player.hp,
      score: player.score,
      heldChainType: player.heldChainType,
      alive: player.alive,
    })),
    item: battle.currentItem
      ? {
          itemId: battle.currentItem.itemId,
          chainType: battle.currentItem.chainType,
          x: battle.currentItem.x,
          y: battle.currentItem.y,
          active: battle.currentItem.active,
          respawnAt: battle.currentItem.respawnAt,
          pickedByGuestId: battle.currentItem.pickedByGuestId,
        }
      : null,
    winnerGuestId: battle.winnerGuestId,
    reason: battle.endReason,
    serverTime: Date.now(),
  };
}

function toItemSpawnedPayload(item: BattleItemState | null): ItemSpawnedPayload | null {
  if (!item || !item.active) return null;

  return {
    itemId: item.itemId,
    chainType: item.chainType,
    x: item.x,
    y: item.y,
    spawnedAt: item.spawnedAt,
  };
}

function normalizeDirection(dx: number, dy: number): Vector2 | null {
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length === 0) return null;
  return { x: dx / length, y: dy / length };
}

function distance(a: Vector2, b: Vector2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pointToRayDistance(point: Vector2, origin: Vector2, direction: Vector2): number {
  const px = point.x - origin.x;
  const py = point.y - origin.y;
  const projection = px * direction.x + py * direction.y;
  if (projection < 0 || projection > DEFAULT_BATTLE_CONFIG.chainRange) {
    return Number.POSITIVE_INFINITY;
  }

  const closestX = origin.x + direction.x * projection;
  const closestY = origin.y + direction.y * projection;
  return Math.hypot(point.x - closestX, point.y - closestY);
}

function createPlayerState(guestId: string, index: number): BattlePlayerState {
  return {
    guestId,
    x: index === 0 ? DEFAULT_BATTLE_CONFIG.worldWidth * 0.25 : DEFAULT_BATTLE_CONFIG.worldWidth * 0.75,
    y: DEFAULT_BATTLE_CONFIG.worldHeight * 0.5,
    hp: DEFAULT_HP,
    score: 0,
    heldChainType: null,
    alive: true,
    lastUpdateAt: Date.now(),
  };
}

function createBattleState(room: Room): BattleState {
  const players = Object.fromEntries(
    room.players.map((player, index) => [player.guestId, createPlayerState(player.guestId, index)]),
  ) as Record<string, BattlePlayerState>;

  return {
    status: "active",
    rngState: room.seed,
    players,
    currentItem: null,
    chainHistory: [],
    winnerGuestId: null,
    chainTimeouts: new Map<string, NodeJS.Timeout>(),
  };
}

export function createBattleService(io: SocketServer): BattleService {
  function emitBattleState(room: Room): void {
    io.to(room.roomId).emit("battle:state", toBattleStatePayload(room));
  }

  function emitError(socket: ServerSocket, message: string): void {
    socket.emit("error", { message });
  }

  function ensureActiveRoom(roomId: string): Room | undefined {
    const room = getRoom(roomId);
    if (!room?.battle || room.battle.status !== "active") return undefined;
    return room;
  }

  function clearBattleTimers(battle: BattleState): void {
    if (battle.respawnTimeout) {
      clearTimeout(battle.respawnTimeout);
      delete battle.respawnTimeout;
    }

    for (const timeout of battle.chainTimeouts.values()) {
      clearTimeout(timeout);
    }
    battle.chainTimeouts.clear();
  }

  function pickChainType(battle: BattleState): ChainType {
    const index = Math.floor(nextRandom(battle) * CHAIN_TYPES.length);
    return CHAIN_TYPES[index] ?? CHAIN_TYPES[0];
  }

  function spawnItem(room: Room): void {
    const battle = room.battle;
    if (!battle || battle.status !== "active") return;

    const item: BattleItemState = {
      itemId: randomUUID(),
      chainType: pickChainType(battle),
      x: SPAWN_MARGIN + nextRandom(battle) * (DEFAULT_BATTLE_CONFIG.worldWidth - SPAWN_MARGIN * 2),
      y: SPAWN_MARGIN + nextRandom(battle) * (DEFAULT_BATTLE_CONFIG.worldHeight - SPAWN_MARGIN * 2),
      active: true,
      spawnedAt: Date.now(),
      respawnAt: null,
      pickedByGuestId: null,
    };

    battle.currentItem = item;

    const payload = toItemSpawnedPayload(item);
    if (!payload) return;

    io.to(room.roomId).emit("item:spawned", payload);
    emitBattleState(room);
  }

  function scheduleItemRespawn(room: Room): void {
    const battle = room.battle;
    if (!battle || battle.status !== "active") return;

    if (battle.respawnTimeout) {
      clearTimeout(battle.respawnTimeout);
    }

    battle.respawnTimeout = setTimeout(() => {
      spawnItem(room);
    }, DEFAULT_BATTLE_CONFIG.itemRespawnMs);
  }

  function endBattle(room: Room, winnerGuestId: string | null, reason: string): void {
    const battle = room.battle;
    if (!battle || battle.status === "ended") return;

    battle.status = "ended";
    battle.winnerGuestId = winnerGuestId;
    battle.endReason = reason;
    clearBattleTimers(battle);

    const payload: RoomEndPayload = { winnerGuestId, reason };
    io.to(room.roomId).emit("room:end", payload);
    emitBattleState(room);
  }

  function resolveChainHit(room: Room, chain: BattleChainState): void {
    const battle = room.battle;
    if (!battle || battle.status !== "active") return;

    const owner = battle.players[chain.ownerGuestId];
    if (!owner) return;

    for (const target of Object.values(battle.players)) {
      if (target.guestId === owner.guestId || !target.alive) continue;

      const hitDistance = pointToRayDistance(target, chain.origin, chain.direction);
      if (hitDistance > DEFAULT_BATTLE_CONFIG.chainHitRadius) continue;

      target.hp = Math.max(0, target.hp - 1);
      target.alive = target.hp > 0;
      owner.score += 1;

      if (!target.alive) {
        endBattle(room, owner.guestId, "chain-hit");
        return;
      }
    }

    emitBattleState(room);
  }

  function fireChain(room: Room, chain: BattleChainState): void {
    const battle = room.battle;
    if (!battle || battle.status !== "active") return;

    chain.fired = true;
    const payload: ChainSpawnPayload = {
      chainId: chain.chainId,
      ownerGuestId: chain.ownerGuestId,
      chainType: chain.chainType,
      originX: chain.origin.x,
      originY: chain.origin.y,
      dx: chain.direction.x,
      dy: chain.direction.y,
      warningAt: chain.warningAt,
      fireAt: chain.fireAt,
      firedAt: Date.now(),
    };

    io.to(room.roomId).emit("chain:spawned", payload);
    battle.chainTimeouts.delete(chain.chainId);
    resolveChainHit(room, chain);
  }

  return {
    startRoom(roomId, options) {
      const room = getRoom(roomId);
      if (!room) return;

      if (room.battle) {
        clearBattleTimers(room.battle);
      }

      room.battle = createBattleState(room);
      const emitInitialEvents = options?.emitInitialEvents ?? true;

      if (emitInitialEvents) {
        emitBattleState(room);
      }

      if (emitInitialEvents) {
        spawnItem(room);
        return;
      }

      const battle = room.battle;
      if (!battle) return;

      const item: BattleItemState = {
        itemId: randomUUID(),
        chainType: pickChainType(battle),
        x: SPAWN_MARGIN + nextRandom(battle) * (DEFAULT_BATTLE_CONFIG.worldWidth - SPAWN_MARGIN * 2),
        y: SPAWN_MARGIN + nextRandom(battle) * (DEFAULT_BATTLE_CONFIG.worldHeight - SPAWN_MARGIN * 2),
        active: true,
        spawnedAt: Date.now(),
        respawnAt: null,
        pickedByGuestId: null,
      };

      battle.currentItem = item;
    },

    disposeRoom(roomId) {
      const room = getRoom(roomId);
      const battle = room?.battle;
      if (!battle) return;
      clearBattleTimers(battle);
    },

    syncPlayerState(socket, payload) {
      const roomId = socket.data.roomId;
      const guestId = socket.data.guestId;
      if (!roomId || !guestId) return;

      const room = ensureActiveRoom(roomId);
      if (!room) return;

      const player = room.battle?.players[guestId];
      if (!player || !player.alive) return;

      player.x = payload.x;
      player.y = payload.y;
      player.lastUpdateAt = Date.now();

      socket.to(roomId).emit("player:state", {
        ...payload,
        hp: player.hp,
        score: player.score,
      });
    },

    handleItemPickup(socket, payload) {
      const roomId = socket.data.roomId;
      const guestId = socket.data.guestId;
      if (!roomId || !guestId) return;

      const room = ensureActiveRoom(roomId);
      if (!room || !room.battle) return;

      const player = room.battle.players[guestId];
      const item = room.battle.currentItem;
      if (!player || !item?.active || item.itemId !== payload.itemId) return;

      if (player.heldChainType) {
        emitError(socket, "You are already holding a chain.");
        return;
      }

      if (distance(player, item) > DEFAULT_BATTLE_CONFIG.itemPickupRadius) {
        emitError(socket, "Item pickup rejected by server authority.");
        return;
      }

      item.active = false;
      item.pickedByGuestId = guestId;
      item.respawnAt = Date.now() + DEFAULT_BATTLE_CONFIG.itemRespawnMs;
      player.heldChainType = item.chainType;

      const response: ItemPickedPayload = {
        itemId: item.itemId,
        pickedByGuestId: guestId,
        chainType: item.chainType,
        respawnAt: item.respawnAt,
      };

      io.to(roomId).emit("item:picked", response);
      emitBattleState(room);
      scheduleItemRespawn(room);
    },

    castChain(socket, payload) {
      const roomId = socket.data.roomId;
      const guestId = socket.data.guestId;
      if (!roomId || !guestId) return;

      const room = ensureActiveRoom(roomId);
      if (!room || !room.battle) return;

      const player = room.battle.players[guestId];
      if (!player || !player.alive) return;

      if (!player.heldChainType) {
        emitError(socket, "No chain is equipped.");
        return;
      }

      const direction = normalizeDirection(payload.dx, payload.dy);
      if (!direction) {
        emitError(socket, "Invalid chain direction.");
        return;
      }

      const chainType = player.heldChainType;
      player.heldChainType = null;

      const chain: BattleChainState = {
        chainId: randomUUID(),
        ownerGuestId: guestId,
        chainType,
        origin: { x: player.x, y: player.y },
        direction,
        warningAt: Date.now(),
        fireAt: Date.now() + DEFAULT_BATTLE_CONFIG.chainWarningMs,
        fired: false,
      };

      room.battle.chainHistory.push(chain);

      const warning: ChainWarningPayload = {
        chainId: chain.chainId,
        ownerGuestId: chain.ownerGuestId,
        chainType: chain.chainType,
        originX: chain.origin.x,
        originY: chain.origin.y,
        dx: chain.direction.x,
        dy: chain.direction.y,
        warningAt: chain.warningAt,
        fireAt: chain.fireAt,
      };

      io.to(roomId).emit("chain:warning", warning);
      emitBattleState(room);

      const fireTimeout = setTimeout(() => {
        fireChain(room, chain);
      }, DEFAULT_BATTLE_CONFIG.chainWarningMs);

      room.battle.chainTimeouts.set(chain.chainId, fireTimeout);
    },

    handleGameOverClaim(socket) {
      const roomId = socket.data.roomId;
      if (!roomId) return;
      emitError(socket, "game:over is now server authoritative. Wait for room:end.");
    },

    getBattleState(roomId) {
      const room = getRoom(roomId);
      if (!room?.battle) return null;
      return toBattleStatePayload(room);
    },

    getCurrentItemSpawn(roomId) {
      const room = getRoom(roomId);
      return room?.battle ? toItemSpawnedPayload(room.battle.currentItem) : null;
    },
  };
}
