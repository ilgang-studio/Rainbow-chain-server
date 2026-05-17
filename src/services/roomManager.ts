import { randomUUID } from "node:crypto";
import { DEFAULT_BATTLE_CONFIG } from "../models/battle.js";
import type { Room, RoomPlayer } from "../models/room.js";
import type { BattleStatePayload, ItemSpawnedPayload, RoomStartPayload } from "../types/events.js";

export const rooms = new Map<string, Room>();

function createSeed(): number {
  return Math.floor(Math.random() * 2_147_483_647);
}

function toPublicPlayer(player: RoomPlayer) {
  return {
    guestId: player.guestId,
    nickname: player.nickname,
    isBot: player.isBot,
  };
}

function createInitialScore(players: readonly RoomPlayer[]): Record<string, number> {
  return Object.fromEntries(players.map((player) => [player.guestId, 0]));
}

export function createHumanRoom(playerA: RoomPlayer, playerB: RoomPlayer): Room {
  const players: [RoomPlayer, RoomPlayer] = [playerA, playerB];
  const room: Room = {
    roomId: randomUUID(),
    mode: "casual",
    players,
    seed: createSeed(),
    currentRound: 1,
    score: createInitialScore(players),
    roundState: "waiting",
    encounter: "pvp",
    createdAt: Date.now(),
    readyGuestIds: new Set<string>(),
    started: false,
    roundWinnerGuestId: null,
    matchWinnerGuestId: null,
    awayGuestIds: new Set<string>(),
    awayTimeouts: new Map<string, NodeJS.Timeout>(),
  };
  rooms.set(room.roomId, room);
  return room;
}

export function createAiFallbackRoom(player: RoomPlayer): Room {
  const players: [RoomPlayer, RoomPlayer] = [
    player,
    {
      guestId: `ai:${randomUUID()}`,
      nickname: "AI Opponent",
      isBot: true,
    },
  ];
  const room: Room = {
    roomId: randomUUID(),
    mode: "casual",
    players,
    seed: createSeed(),
    currentRound: 1,
    score: createInitialScore(players),
    roundState: "waiting",
    encounter: "ai",
    createdAt: Date.now(),
    readyGuestIds: new Set<string>(),
    started: false,
    roundWinnerGuestId: null,
    matchWinnerGuestId: null,
    awayGuestIds: new Set<string>(),
    awayTimeouts: new Map<string, NodeJS.Timeout>(),
  };
  rooms.set(room.roomId, room);
  return room;
}

export function getRoom(roomId: string): Room | undefined {
  return rooms.get(roomId);
}

export function removeRoom(roomId: string): void {
  rooms.delete(roomId);
}

export function removeGuestFromRooms(guestId: string): Room | undefined {
  for (const room of rooms.values()) {
    if (room.players.some((player) => player.guestId === guestId)) {
      rooms.delete(room.roomId);
      return room;
    }
  }
  return undefined;
}

export function markRoomReady(roomId: string, guestId: string): Room | undefined {
  const room = rooms.get(roomId);
  if (!room) return undefined;

  room.readyGuestIds.add(guestId);
  const requiredReadyCount = room.players.filter((player) => !player.isBot).length;
  if (room.readyGuestIds.size >= requiredReadyCount) {
    room.started = true;
  }
  return room;
}

export function createRematchRoom(existingRoom: Room): Room {
  const players = existingRoom.players.map((p) => ({ ...p })) as [RoomPlayer, RoomPlayer];
  const room: Room = {
    roomId: randomUUID(),
    mode: existingRoom.mode,
    players,
    seed: createSeed(),
    currentRound: 1,
    score: createInitialScore(players),
    roundState: "playing",
    encounter: existingRoom.encounter,
    createdAt: Date.now(),
    readyGuestIds: new Set<string>(),
    started: true,
    roundWinnerGuestId: null,
    matchWinnerGuestId: null,
    awayGuestIds: new Set<string>(),
    awayTimeouts: new Map<string, NodeJS.Timeout>(),
  };
  rooms.set(room.roomId, room);
  return room;
}

export function toRoomStartPayload(
  room: Room,
  initialBattleState: BattleStatePayload,
  initialItem: ItemSpawnedPayload | null,
): RoomStartPayload {
  return {
    roomId: room.roomId,
    seed: room.seed,
    currentSeed: room.seed,
    round: room.currentRound,
    roundState: room.roundState,
    encounter: room.encounter,
    score: { ...room.score },
    players: room.players.map(toPublicPlayer),
    battleConfig: DEFAULT_BATTLE_CONFIG,
    initialBattleState,
    initialItem,
    roundWinnerGuestId: room.roundWinnerGuestId,
    matchWinnerGuestId: room.matchWinnerGuestId,
  };
}
