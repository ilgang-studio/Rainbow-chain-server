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
import { toRoomStartPayload } from "./roomManager.js";
import type {
  BattleStatePayload,
  ChainSpawnPayload,
  ChainWarningPayload,
  ClientToServerEvents,
  GameOverClaimPayload,
  InterServerEvents,
  ItemPickupRequestPayload,
  ItemPickedPayload,
  ItemSpawnedPayload,
  MatchEndPayload,
  PlayerAwayPayload,
  PlayerBackPayload,
  PlayerStatePayload,
  RoundEndPayload,
  ServerToClientEvents,
  SocketData,
} from "../types/events.js";

type SocketServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type ServerSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

const DEFAULT_HP = 3;
const MATCH_WIN_SCORE = 2;
const NEXT_ROUND_DELAY_MS = 2_000;
const AWAY_TIMEOUT_MS = 10_000;
const SPAWN_MARGIN = 96;

export interface BattleService {
  startRoom: (
    roomId: string,
    options?: { emitInitialEvents?: boolean; advanceRound?: boolean; startEvent?: "round:start" | null },
  ) => { initialBattleState: BattleStatePayload; initialItem: ItemSpawnedPayload | null } | null;
  disposeRoom: (roomId: string) => void;
  syncPlayerState: (socket: ServerSocket, payload: PlayerStatePayload) => void;
  handlePlayerAway: (socket: ServerSocket, payload: PlayerAwayPayload) => void;
  handlePlayerBack: (socket: ServerSocket, payload: PlayerBackPayload) => void;
  handleItemPickup: (socket: ServerSocket, payload: ItemPickupRequestPayload) => void;
  castChain: (socket: ServerSocket) => void;
  handleGameOverClaim: (socket: ServerSocket, payload: GameOverClaimPayload) => void;
  handleDisconnect: (roomId: string, guestId: string) => void;
  getBattleState: (roomId: string) => BattleStatePayload | null;
  getCurrentItemSpawn: (roomId: string) => ItemSpawnedPayload | null;
}

function createSeed(): number {
  return Math.floor(Math.random() * 2_147_483_647);
}

function nextRandom(state: BattleState): number {
  let t = state.rngState += 0x6d2b79f5;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
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

function createPlayerState(room: Room, guestId: string, index: number): BattlePlayerState {
  return {
    guestId,
    x: index === 0 ? DEFAULT_BATTLE_CONFIG.worldWidth * 0.25 : DEFAULT_BATTLE_CONFIG.worldWidth * 0.75,
    y: DEFAULT_BATTLE_CONFIG.worldHeight * 0.5,
    hp: DEFAULT_HP,
    score: room.score[guestId] ?? 0,
    heldChainType: null,
    alive: true,
    lastUpdateAt: Date.now(),
  };
}

function createBattleState(room: Room): BattleState {
  const players = Object.fromEntries(
    room.players.map((player, index) => [player.guestId, createPlayerState(room, player.guestId, index)]),
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

function toBattleStatePayload(room: Room): BattleStatePayload {
  const battle = room.battle;
  if (!battle) {
    return {
      roomId: room.roomId,
      round: room.currentRound,
      roundState: room.roundState,
      seed: room.seed,
      score: { ...room.score },
      status: "idle",
      players: [],
      item: null,
      winnerGuestId: null,
      roundWinnerGuestId: room.roundWinnerGuestId,
      matchWinnerGuestId: room.matchWinnerGuestId,
      serverTime: Date.now(),
    };
  }

  return {
    roomId: room.roomId,
    round: room.currentRound,
    roundState: room.roundState,
    seed: room.seed,
    score: { ...room.score },
    status: battle.status,
    players: Object.values(battle.players).map((player) => ({
      guestId: player.guestId,
      x: player.x,
      y: player.y,
      hp: player.hp,
      score: room.score[player.guestId] ?? 0,
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
    roundWinnerGuestId: room.roundWinnerGuestId,
    matchWinnerGuestId: room.matchWinnerGuestId,
    reason: battle.endReason,
    serverTime: Date.now(),
  };
}

function createRandomItem(battle: BattleState): BattleItemState {
  const chainIndex = Math.floor(nextRandom(battle) * CHAIN_TYPES.length);
  const chainType = CHAIN_TYPES[chainIndex] ?? CHAIN_TYPES[0];

  return {
    itemId: randomUUID(),
    chainType,
    x: SPAWN_MARGIN + nextRandom(battle) * (DEFAULT_BATTLE_CONFIG.worldWidth - SPAWN_MARGIN * 2),
    y: SPAWN_MARGIN + nextRandom(battle) * (DEFAULT_BATTLE_CONFIG.worldHeight - SPAWN_MARGIN * 2),
    active: true,
    spawnedAt: Date.now(),
    respawnAt: null,
    pickedByGuestId: null,
  };
}

function createRandomEnemyLaneChain(room: Room, ownerGuestId: string, chainType: ChainType): BattleChainState | null {
  const battle = room.battle;
  if (!battle) return null;

  const ownerIndex = room.players.findIndex((player) => player.guestId === ownerGuestId);
  const fallbackTargetIndex = ownerIndex === 0 ? 1 : 0;
  const targetPlayer = room.players.find((player) => player.guestId !== ownerGuestId) ?? room.players[fallbackTargetIndex];
  if (!targetPlayer) return null;

  const targetIndex = room.players.findIndex((player) => player.guestId === targetPlayer.guestId);
  const laneLeft = targetIndex <= 0 ? 0 : DEFAULT_BATTLE_CONFIG.worldWidth / 2;
  const laneRight = laneLeft + DEFAULT_BATTLE_CONFIG.worldWidth / 2;
  const laneTop = 0;
  const laneBottom = DEFAULT_BATTLE_CONFIG.worldHeight;
  const inset = SPAWN_MARGIN;
  const useVertical = nextRandom(battle) < 0.5;

  let origin: Vector2;
  let direction: Vector2;

  if (useVertical) {
    const x = laneLeft + inset + nextRandom(battle) * ((laneRight - laneLeft) - inset * 2);
    const fromTop = nextRandom(battle) < 0.5;
    origin = { x, y: fromTop ? laneTop : laneBottom };
    direction = { x: 0, y: fromTop ? 1 : -1 };
  } else {
    const y = laneTop + inset + nextRandom(battle) * ((laneBottom - laneTop) - inset * 2);
    const fromLeft = nextRandom(battle) < 0.5;
    origin = { x: fromLeft ? laneLeft : laneRight, y };
    direction = { x: fromLeft ? 1 : -1, y: 0 };
  }

  return {
    chainId: randomUUID(),
    ownerGuestId,
    chainType,
    origin,
    direction,
    warningAt: Date.now(),
    fireAt: Date.now() + DEFAULT_BATTLE_CONFIG.chainWarningMs,
    fired: false,
  };
}

export function createBattleService(io: SocketServer): BattleService {
  const awayTimeouts = new Map<string, NodeJS.Timeout>();

  function awayKey(roomId: string, guestId: string): string {
    return `${roomId}:${guestId}`;
  }

  function emitError(socket: ServerSocket, message: string): void {
    socket.emit("error", { message });
  }

  function emitBattleState(room: Room): void {
    io.to(room.roomId).emit("battle:state", toBattleStatePayload(room));
  }

  function ensureActiveRoom(roomId: string): Room | undefined {
    const room = getRoom(roomId);
    if (!room?.battle || room.roundState !== "playing" || room.battle.status !== "active") return undefined;
    return room;
  }

  function clearAwayTimer(roomId: string, guestId: string): void {
    const key = awayKey(roomId, guestId);
    const timeout = awayTimeouts.get(key);
    if (timeout) {
      clearTimeout(timeout);
      awayTimeouts.delete(key);
    }
  }

  function clearAwayTimersForRoom(roomId: string): void {
    for (const [key, timeout] of awayTimeouts.entries()) {
      if (!key.startsWith(`${roomId}:`)) continue;
      clearTimeout(timeout);
      awayTimeouts.delete(key);
    }
  }

  function clearBattleTimers(room: Room): void {
    const battle = room.battle;
    if (battle?.respawnTimeout) {
      clearTimeout(battle.respawnTimeout);
      delete battle.respawnTimeout;
    }

    for (const timeout of battle?.chainTimeouts.values() ?? []) {
      clearTimeout(timeout);
    }
    battle?.chainTimeouts.clear();

    if (room.nextRoundTimeout) {
      clearTimeout(room.nextRoundTimeout);
      delete room.nextRoundTimeout;
    }

    clearAwayTimersForRoom(room.roomId);
  }

  function syncBattleScores(room: Room): void {
    if (!room.battle) return;

    for (const player of Object.values(room.battle.players)) {
      player.score = room.score[player.guestId] ?? 0;
    }
  }

  function initializeRound(room: Room, options?: { advanceRound?: boolean }): {
    initialBattleState: BattleStatePayload;
    initialItem: ItemSpawnedPayload | null;
  } {
    clearBattleTimers(room);

    if (options?.advanceRound) {
      room.currentRound += 1;
      room.seed = createSeed();
    }

    room.roundState = "playing";
    room.roundWinnerGuestId = null;
    room.matchWinnerGuestId = null;
    room.battle = createBattleState(room);
    room.battle.currentItem = createRandomItem(room.battle);

    return {
      initialBattleState: toBattleStatePayload(room),
      initialItem: toItemSpawnedPayload(room.battle.currentItem),
    };
  }

  function logRoundStart(room: Room): void {
    console.log(
      `[round:start] room=${room.roomId} round=${room.currentRound} seed=${room.seed} score=${JSON.stringify(room.score)}`,
    );
  }

  function emitRoundStart(room: Room): void {
    const initialBattleState = toBattleStatePayload(room);
    const initialItem = toItemSpawnedPayload(room.battle?.currentItem ?? null);
    const payload = toRoomStartPayload(room, initialBattleState, initialItem);
    io.to(room.roomId).emit("round:start", payload);
    logRoundStart(room);
  }

  function spawnItem(room: Room): void {
    const battle = room.battle;
    if (!battle || room.roundState !== "playing" || battle.status !== "active") return;

    const item = createRandomItem(battle);
    battle.currentItem = item;

    const payload = toItemSpawnedPayload(item);
    if (!payload) return;

    io.to(room.roomId).emit("item:spawned", payload);
    emitBattleState(room);
  }

  function scheduleItemRespawn(room: Room): void {
    const battle = room.battle;
    if (!battle || room.roundState !== "playing" || battle.status !== "active") return;

    if (battle.respawnTimeout) {
      clearTimeout(battle.respawnTimeout);
    }

    battle.respawnTimeout = setTimeout(() => {
      spawnItem(room);
    }, DEFAULT_BATTLE_CONFIG.itemRespawnMs);
  }

  function scheduleNextRound(room: Room): void {
    room.nextRoundTimeout = setTimeout(() => {
      const currentRoom = getRoom(room.roomId);
      if (!currentRoom || currentRoom.roundState === "match_end") return;

      initializeRound(currentRoom, { advanceRound: true });
      emitRoundStart(currentRoom);
    }, NEXT_ROUND_DELAY_MS);
  }

  function concludeMatch(room: Room, winnerGuestId: string | null, reason: string): void {
    room.roundState = "match_end";
    room.matchWinnerGuestId = winnerGuestId;
    syncBattleScores(room);
    emitBattleState(room);

    const payload: MatchEndPayload = {
      roomId: room.roomId,
      winnerGuestId,
      score: { ...room.score },
      reason,
    };

    io.to(room.roomId).emit("match:end", payload);
    io.to(room.roomId).emit("room:end", { winnerGuestId, reason });
    console.log(
      `[match:end] room=${room.roomId} winner=${winnerGuestId ?? "none"} score=${JSON.stringify(room.score)} reason=${reason}`,
    );
  }

  function finishRound(room: Room, winnerGuestId: string | null, reason: string, source: string): void {
    if (room.roundState !== "playing") {
      console.log(`[duplicate ignored] room=${room.roomId} round=${room.currentRound} source=${source}`);
      return;
    }

    room.roundState = "round_end";
    room.roundWinnerGuestId = winnerGuestId;

    const battle = room.battle;
    if (battle) {
      battle.status = "ended";
      battle.winnerGuestId = winnerGuestId;
      battle.endReason = reason;
    }

    clearBattleTimers(room);

    if (winnerGuestId && winnerGuestId in room.score) {
      room.score[winnerGuestId] += 1;
    }
    syncBattleScores(room);

    const loserGuestId = room.players.find((player) => player.guestId !== winnerGuestId)?.guestId ?? null;
    const payload: RoundEndPayload = {
      roomId: room.roomId,
      round: room.currentRound,
      winnerGuestId,
      loserGuestId,
      score: { ...room.score },
      reason,
    };

    io.to(room.roomId).emit("round:end", payload);
    emitBattleState(room);
    console.log(
      `[round:end] room=${room.roomId} round=${room.currentRound} winner=${winnerGuestId ?? "none"} score=${JSON.stringify(room.score)} reason=${reason}`,
    );

    if (winnerGuestId && (room.score[winnerGuestId] ?? 0) >= MATCH_WIN_SCORE) {
      concludeMatch(room, winnerGuestId, reason);
      return;
    }

    scheduleNextRound(room);
  }

  function resolveChainHit(room: Room, chain: BattleChainState): void {
    const battle = room.battle;
    if (!battle || room.roundState !== "playing" || battle.status !== "active") return;

    const owner = battle.players[chain.ownerGuestId];
    if (!owner) return;

    for (const target of Object.values(battle.players)) {
      if (target.guestId === owner.guestId || !target.alive) continue;

      const hitDistance = pointToRayDistance(target, chain.origin, chain.direction);
      if (hitDistance > DEFAULT_BATTLE_CONFIG.chainHitRadius) continue;

      target.hp = Math.max(0, target.hp - 1);
      target.alive = target.hp > 0;

      if (!target.alive) {
        finishRound(room, owner.guestId, "chain-hit", "chain-hit");
        return;
      }
    }

    emitBattleState(room);
  }

  function fireChain(room: Room, chain: BattleChainState): void {
    const battle = room.battle;
    if (!battle || room.roundState !== "playing" || battle.status !== "active") return;

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
    console.log(
      `[chain:spawned] room=${room.roomId} round=${room.currentRound} chain=${chain.chainId} owner=${chain.ownerGuestId} type=${chain.chainType}`,
    );
    resolveChainHit(room, chain);
  }

  return {
    startRoom(roomId, options) {
      const room = getRoom(roomId);
      if (!room) return null;

      const initialized = initializeRound(room, { advanceRound: options?.advanceRound });

      if (options?.emitInitialEvents) {
        if (initialized.initialItem) {
          io.to(room.roomId).emit("item:spawned", initialized.initialItem);
        }
        emitBattleState(room);
      }

      if (options?.startEvent === "round:start") {
        emitRoundStart(room);
      }

      return initialized;
    },

    disposeRoom(roomId) {
      const room = getRoom(roomId);
      if (!room) return;
      clearBattleTimers(room);
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
        score: room.score[guestId] ?? 0,
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

    handlePlayerAway(socket, payload) {
      const roomId = socket.data.roomId;
      const guestId = socket.data.guestId;
      if (!roomId || !guestId || payload.roomId !== roomId) return;

      const room = getRoom(roomId);
      if (!room || room.roundState !== "playing") return;

      const key = awayKey(roomId, guestId);
      if (awayTimeouts.has(key)) return;

      io.to(roomId).emit("player:away", { playerId: guestId, timeout: AWAY_TIMEOUT_MS / 1000 });
      console.log(`[player:away] room=${roomId} player=${guestId} timeout=${AWAY_TIMEOUT_MS}`);

      const timeout = setTimeout(() => {
        awayTimeouts.delete(key);

        const currentRoom = getRoom(roomId);
        if (!currentRoom || currentRoom.roundState !== "playing") return;

        const winnerGuestId = currentRoom.players.find((player) => player.guestId !== guestId)?.guestId ?? null;
        finishRound(currentRoom, winnerGuestId, "away-timeout", "player:away-timeout");
      }, AWAY_TIMEOUT_MS);

      awayTimeouts.set(key, timeout);
    },

    handlePlayerBack(socket, payload) {
      const roomId = socket.data.roomId;
      const guestId = socket.data.guestId;
      if (!roomId || !guestId || payload.roomId !== roomId) return;

      const room = getRoom(roomId);
      if (!room || room.roundState !== "playing") return;

      const key = awayKey(roomId, guestId);
      if (!awayTimeouts.has(key)) return;

      clearAwayTimer(roomId, guestId);
      io.to(roomId).emit("player:back", { playerId: guestId });
      console.log(`[player:back] room=${roomId} player=${guestId}`);
    },

    castChain(socket) {
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

      const chainType = player.heldChainType;
      player.heldChainType = null;
      const chain = createRandomEnemyLaneChain(room, guestId, chainType);
      if (!chain) {
        player.heldChainType = chainType;
        emitError(socket, "Failed to create enemy arena chain.");
        return;
      }

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

    handleGameOverClaim(socket, payload) {
      const roomId = socket.data.roomId;
      if (!roomId) return;

      const room = getRoom(roomId);
      if (!room) return;

      if (room.roundState !== "playing") {
        console.log(`[duplicate ignored] room=${roomId} round=${room.currentRound} source=game:over`);
        return;
      }

      const winnerGuestId = payload.winnerGuestId;
      if (winnerGuestId && !room.players.some((player) => player.guestId === winnerGuestId)) {
        emitError(socket, "Invalid winner for game:over.");
        return;
      }

      finishRound(room, winnerGuestId, payload.reason ?? "client-game-over", "game:over");
    },

    handleDisconnect(roomId, guestId) {
      const room = getRoom(roomId);
      if (!room) return;

      clearAwayTimer(roomId, guestId);
      clearBattleTimers(room);

      const opponent = room.players.find((player) => player.guestId !== guestId && !player.isBot);
      if (!opponent) return;

      room.roundState = "match_end";
      room.roundWinnerGuestId = opponent.guestId;
      room.matchWinnerGuestId = opponent.guestId;
      syncBattleScores(room);

      io.to(roomId).emit("opponent:left", { roomId });
      io.to(roomId).emit("match:end", {
        roomId,
        winnerGuestId: opponent.guestId,
        score: { ...room.score },
        reason: "opponent-left",
      });
      io.to(roomId).emit("room:end", { winnerGuestId: opponent.guestId, reason: "opponent-left" });
      console.log(
        `[match:end] room=${roomId} winner=${opponent.guestId} score=${JSON.stringify(room.score)} reason=opponent-left`,
      );
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
