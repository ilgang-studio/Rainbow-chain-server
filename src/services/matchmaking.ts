import type { Server, Socket } from "socket.io";
import type { QueueEntry } from "../models/queue.js";
import type { RoomPlayer } from "../models/room.js";
import type { Session } from "../models/session.js";
import {
  createAiFallbackRoom,
  createHumanRoom,
  getRoom,
  markRoomReady,
  removeGuestFromRooms,
  rooms,
  toRoomStartPayload,
} from "./roomManager.js";
import { getAuthorizedRoomForSocket } from "./roomAccess.js";
import type {
  ClientToServerEvents,
  InterServerEvents,
  MatchAiFallbackPayload,
  MatchFoundPayload,
  QueueJoinPayload,
  ServerToClientEvents,
  SocketData,
} from "../types/events.js";
import type { BattleService } from "./battle.js";

type SocketServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type ServerSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

const AI_FALLBACK_MS = 20_000;

export const sessions = new Map<string, Session>();
export const queue: QueueEntry[] = [];

const fallbackTimeouts = new Map<string, NodeJS.Timeout>();
const queueTickIntervals = new Map<string, NodeJS.Timeout>();

function sanitizeNickname(value: string): string {
  return value.trim().slice(0, 8);
}

function generateGuestNickname(): string {
  return `Guest_${Math.floor(10 + Math.random() * 90)}`;
}

function emitError(socket: ServerSocket, message: string): void {
  socket.emit("error", { message });
}

function getSocket(io: SocketServer, socketId: string): ServerSocket | undefined {
  return io.sockets.sockets.get(socketId);
}

function removeQueueEntry(guestId: string): QueueEntry | undefined {
  const index = queue.findIndex((entry) => entry.guestId === guestId);
  if (index === -1) return undefined;
  return queue.splice(index, 1)[0];
}

function clearQueueTimers(guestId: string): void {
  const fallbackTimer = fallbackTimeouts.get(guestId);
  if (fallbackTimer) {
    clearTimeout(fallbackTimer);
    fallbackTimeouts.delete(guestId);
  }

  const tickTimer = queueTickIntervals.get(guestId);
  if (tickTimer) {
    clearInterval(tickTimer);
    queueTickIntervals.delete(guestId);
  }
}

function startQueueTick(io: SocketServer, entry: QueueEntry): void {
  clearQueueTimers(entry.guestId);
  const socket = getSocket(io, entry.socketId);
  socket?.emit("queue:tick", { elapsed: 0 });

  const tickTimer = setInterval(() => {
    const currentSocket = getSocket(io, entry.socketId);
    if (!currentSocket) {
      clearQueueTimers(entry.guestId);
      return;
    }
    const elapsed = Math.min(20, Math.floor((Date.now() - entry.joinedAt) / 1000));
    currentSocket.emit("queue:tick", { elapsed });
  }, 1000);

  queueTickIntervals.set(entry.guestId, tickTimer);
}

function attachHumanSocketsToRoom(io: SocketServer, roomId: string, players: RoomPlayer[]): void {
  for (const player of players) {
    if (player.isBot || !player.socketId) continue;
    const socket = getSocket(io, player.socketId);
    if (!socket) {
      console.warn(`[room:join] socket not found for player ${player.guestId} (socketId: ${player.socketId})`);
      continue;
    }
    socket.join(roomId);
    socket.data.roomId = roomId;
    console.log(`[room:join] ${player.guestId} joined room ${roomId} (socket: ${socket.id})`);
  }
}

function updateMatchedSession(guestId: string, roomId: string): void {
  const session = sessions.get(guestId);
  if (!session) return;
  session.status = "matched";
  session.roomId = roomId;
  delete session.joinedAt;
}

function createHumanMatch(
  io: SocketServer,
  first: QueueEntry,
  second: QueueEntry,
): void {
  clearQueueTimers(first.guestId);
  clearQueueTimers(second.guestId);

  const room = createHumanRoom(
    {
      guestId: first.guestId,
      nickname: first.nickname,
      socketId: first.socketId,
      isBot: false,
    },
    {
      guestId: second.guestId,
      nickname: second.nickname,
      socketId: second.socketId,
      isBot: false,
    },
  );

  attachHumanSocketsToRoom(io, room.roomId, room.players);
  updateMatchedSession(first.guestId, room.roomId);
  updateMatchedSession(second.guestId, room.roomId);

  console.log(`[match:found] room ${room.roomId} created — players: ${first.guestId}, ${second.guestId}`);

  const firstSocket = getSocket(io, first.socketId);
  const secondSocket = getSocket(io, second.socketId);

  const payloadForFirst: MatchFoundPayload = {
    roomId: room.roomId,
    opponent: {
      guestId: second.guestId,
      nickname: second.nickname,
    },
    isBot: false,
  };

  const payloadForSecond: MatchFoundPayload = {
    roomId: room.roomId,
    opponent: {
      guestId: first.guestId,
      nickname: first.nickname,
    },
    isBot: false,
  };

  firstSocket?.emit("match:found", payloadForFirst);
  secondSocket?.emit("match:found", payloadForSecond);
}

function createAiFallbackMatch(io: SocketServer, entry: QueueEntry): void {
  removeQueueEntry(entry.guestId);
  clearQueueTimers(entry.guestId);

  const room = createAiFallbackRoom({
    guestId: entry.guestId,
    nickname: entry.nickname,
    socketId: entry.socketId,
    isBot: false,
  });

  attachHumanSocketsToRoom(io, room.roomId, room.players);
  updateMatchedSession(entry.guestId, room.roomId);

  const socket = getSocket(io, entry.socketId);
  if (!socket) return;

  const payload: MatchAiFallbackPayload = {
    roomId: room.roomId,
    opponent: {
      guestId: room.players[1].guestId,
      nickname: room.players[1].nickname,
    },
    isBot: true,
  };

  socket.emit("match:ai_fallback", payload);
}

function startFallbackTimer(io: SocketServer, entry: QueueEntry): void {
  if (fallbackTimeouts.has(entry.guestId)) return;

  const fallbackTimer = setTimeout(() => {
    const stillWaiting = queue.find((queueEntry) => queueEntry.guestId === entry.guestId);
    if (!stillWaiting) return;
    createAiFallbackMatch(io, stillWaiting);
  }, AI_FALLBACK_MS);

  fallbackTimeouts.set(entry.guestId, fallbackTimer);
}

function ensureQueueProgress(io: SocketServer): void {
  while (queue.length >= 2) {
    const first = queue.shift();
    const second = queue.shift();
    if (!first || !second) return;
    createHumanMatch(io, first, second);
  }

  if (queue.length === 1) {
    const [waitingEntry] = queue;
    startQueueTick(io, waitingEntry);
    startFallbackTimer(io, waitingEntry);
  }
}

function cancelQueueByGuestId(io: SocketServer, guestId: string, shouldEmit: boolean): void {
  const removedEntry = removeQueueEntry(guestId);
  clearQueueTimers(guestId);

  const session = sessions.get(guestId);
  if (session) {
    session.status = "idle";
    delete session.mode;
    delete session.joinedAt;
  }

  if (shouldEmit && removedEntry) {
    const socket = getSocket(io, removedEntry.socketId);
    socket?.emit("queue:cancelled", {});
  }
}

export interface MatchmakingService {
  joinQueue: (socket: ServerSocket, payload: QueueJoinPayload) => void;
  cancelQueue: (socket: ServerSocket, shouldEmit?: boolean) => void;
  markReady: (socket: ServerSocket, roomId: string) => void;
  disconnect: (socket: ServerSocket) => void;
}

export function createMatchmakingService(io: SocketServer, battle: BattleService): MatchmakingService {
  return {
    joinQueue(socket, payload) {
      if (payload.mode !== "casual") {
        emitError(socket, "Only casual queue is available in this MVP.");
        return;
      }

      const guestId = payload.guestId.trim();
      if (!guestId) {
        emitError(socket, "guestId is required.");
        return;
      }

      const existingSession = sessions.get(guestId);
      if (existingSession?.roomId) {
        emitError(socket, "This guest is already assigned to a room.");
        return;
      }

      cancelQueueByGuestId(io, guestId, false);

      const nickname = sanitizeNickname(payload.nickname) || generateGuestNickname();
      const joinedAt = Date.now();
      socket.data.guestId = guestId;

      sessions.set(guestId, {
        guestId,
        nickname,
        socketId: socket.id,
        status: "queueing",
        mode: "casual",
        joinedAt,
      });

      queue.push({
        guestId,
        nickname,
        socketId: socket.id,
        mode: "casual",
        joinedAt,
      });

      socket.emit("queue:joined", { joinedAt });
      ensureQueueProgress(io);
    },

    cancelQueue(socket, shouldEmit = true) {
      const guestId = socket.data.guestId;
      if (!guestId) return;
      cancelQueueByGuestId(io, guestId, shouldEmit);
    },

    markReady(socket, roomId) {
      const guestId = socket.data.guestId;
      if (!guestId) {
        emitError(socket, "No guest session found for this socket.");
        return;
      }

      const session = sessions.get(guestId);
      if (!session || session.roomId !== roomId) {
        emitError(socket, "Room mismatch for room:ready.");
        return;
      }

      const access = getAuthorizedRoomForSocket(socket, roomId);
      if ("error" in access) {
        emitError(socket, access.error);
        return;
      }

      const wasStarted = getRoom(roomId)?.started ?? false;
      const room = markRoomReady(roomId, guestId);
      if (!room) {
        emitError(socket, "Room not found.");
        return;
      }

      const humanCount = room.players.filter((p) => !p.isBot).length;
      console.log(`[room:ready] ${guestId} ready in room ${roomId} (${room.readyGuestIds.size}/${humanCount})`);

      if (!wasStarted && room.started) {
        const roundStart = battle.startRoom(roomId, { emitInitialEvents: false });
        if (!roundStart) {
          emitError(socket, "Failed to initialize battle state.");
          return;
        }

        const payload = toRoomStartPayload(room, roundStart.initialBattleState, roundStart.initialItem);
        console.log(`[room:start] emitting to room ${roomId}, players:`, room.players.map((p) => `${p.guestId}(${p.socketId})`).join(", "));

        // Direct emission per player — more reliable than io.to(roomId) which depends on room membership state
        for (const player of room.players) {
          if (player.isBot || !player.socketId) continue;
          const playerSocket = getSocket(io, player.socketId);
          if (!playerSocket) {
            console.warn(`[room:start] socket not found for player ${player.guestId} (socketId: ${player.socketId})`);
            continue;
          }
          playerSocket.emit("room:start", payload);
          console.log(`[room:start] emitted to ${player.guestId}`);
        }

        console.log(`[round:start] room=${roomId} round=${room.currentRound} seed=${room.seed} score=${JSON.stringify(room.score)}`);
      }
    },

    disconnect(socket) {
      const guestId = socket.data.guestId;
      if (!guestId) return;

      cancelQueueByGuestId(io, guestId, false);

      const session = sessions.get(guestId);
      if (session?.roomId) {
        battle.handleDisconnect(session.roomId, guestId);
        const removedRoom = removeGuestFromRooms(guestId);
        if (removedRoom) {
          battle.disposeRoom(removedRoom.roomId);
        }
      }

      sessions.delete(guestId);
    },
  };
}

export { rooms };
