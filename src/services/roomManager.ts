import { randomUUID } from "node:crypto";
import type { Room, RoomPlayer } from "../models/room.js";
import type { RoomStartPayload } from "../types/events.js";

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

export function createHumanRoom(playerA: RoomPlayer, playerB: RoomPlayer): Room {
  const room: Room = {
    roomId: randomUUID(),
    mode: "casual",
    players: [playerA, playerB],
    seed: createSeed(),
    createdAt: Date.now(),
    readyGuestIds: new Set<string>(),
    started: false,
  };
  rooms.set(room.roomId, room);
  return room;
}

export function createAiFallbackRoom(player: RoomPlayer): Room {
  const room: Room = {
    roomId: randomUUID(),
    mode: "casual",
    players: [
      player,
      {
        guestId: `ai:${randomUUID()}`,
        nickname: "AI Opponent",
        isBot: true,
      },
    ],
    seed: createSeed(),
    createdAt: Date.now(),
    readyGuestIds: new Set<string>(),
    started: false,
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

export function toRoomStartPayload(room: Room): RoomStartPayload {
  return {
    roomId: room.roomId,
    seed: room.seed,
    players: room.players.map(toPublicPlayer),
  };
}
