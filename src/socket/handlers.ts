import type { Socket } from "socket.io";
import type {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from "../types/events.js";
import type { MatchmakingService } from "../services/matchmaking.js";
import type { RematchService } from "../services/rematch.js";
import type { BattleService } from "../services/battle.js";
import { getAuthorizedRoomForSocket } from "../services/roomAccess.js";
import {
  chainCastSchema,
  chainRequestSchema,
  formatZodError,
  gameOverClaimSchema,
  itemPickupSchema,
  playerMoveSchema,
  playerStateSchema,
  queueJoinSchema,
  rematchCancelSchema,
  rematchRequestSchema,
  roomOnlySchema,
  roomReadySchema,
} from "./validation.js";
import type { z } from "zod";
import { createSocketRateLimiter } from "./rateLimit.js";

type ServerSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

function emitValidationError(socket: ServerSocket, eventName: string, message: string): void {
  socket.emit("error", { message: `Invalid ${eventName} payload. ${message}` });
}

function validatePayload<T extends z.ZodTypeAny>(
  socket: ServerSocket,
  eventName: string,
  schema: T,
  payload: unknown,
): z.infer<T> | null {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    emitValidationError(socket, eventName, formatZodError(parsed.error));
    return null;
  }

  return parsed.data;
}

function verifyRoomMembership(socket: ServerSocket, roomId?: string): boolean {
  const access = getAuthorizedRoomForSocket(socket, roomId);
  if ("error" in access) {
    socket.emit("error", { message: access.error });
    return false;
  }

  return true;
}

function emitRateLimitError(socket: ServerSocket, eventName: string): void {
  socket.emit("error", { message: `Rate limit exceeded for ${eventName}. Please slow down.` });
}

export function registerSocketHandlers(
  socket: ServerSocket,
  matchmaking: MatchmakingService,
  rematch: RematchService,
  battle: BattleService,
): void {
  const rateLimiter = createSocketRateLimiter();

  function guardRateLimit(eventName: string): boolean {
    if (rateLimiter.allow(eventName)) return true;
    emitRateLimitError(socket, eventName);
    return false;
  }

  socket.on("queue:join", (payload) => {
    if (!guardRateLimit("queue:join")) return;
    const parsed = validatePayload(socket, "queue:join", queueJoinSchema, payload);
    if (!parsed) return;
    matchmaking.joinQueue(socket, parsed);
  });

  socket.on("queue:cancel", () => {
    if (!guardRateLimit("queue:cancel")) return;
    matchmaking.cancelQueue(socket);
  });

  socket.on("room:ready", (payload) => {
    if (!guardRateLimit("room:ready")) return;
    const parsed = validatePayload(socket, "room:ready", roomReadySchema, payload);
    if (!parsed) return;
    matchmaking.markReady(socket, parsed.roomId);
  });

  socket.on("disconnect", () => {
    // rematch first: needs room lookup before matchmaking removes the room
    rematch.handleDisconnect(socket);
    matchmaking.disconnect(socket);
  });

  socket.on("rematch:request", (payload) => {
    if (!guardRateLimit("rematch:request")) return;
    const parsed = validatePayload(socket, "rematch:request", rematchRequestSchema, payload);
    if (!parsed) return;
    rematch.requestRematch(socket, parsed);
  });

  socket.on("rematch:cancel", (payload) => {
    if (!guardRateLimit("rematch:cancel")) return;
    const parsed = validatePayload(socket, "rematch:cancel", rematchCancelSchema, payload);
    if (!parsed) return;
    rematch.cancelRematch(socket, parsed);
  });

  // Game relay — forward to the other player in the same room, no processing
  socket.on("player:move", (payload) => {
    if (!guardRateLimit("player:move")) return;
    const parsed = validatePayload(socket, "player:move", playerMoveSchema, payload);
    if (!parsed) return;
    if (!verifyRoomMembership(socket)) return;
    const { roomId } = socket.data;
    if (!roomId) return;
    socket.to(roomId).emit("player:moved", parsed);
  });

  socket.on("player:state", (payload) => {
    if (!guardRateLimit("player:state")) return;
    const parsed = validatePayload(socket, "player:state", playerStateSchema, payload);
    if (!parsed) return;
    battle.syncPlayerState(socket, parsed);
  });

  socket.on("player:away", (payload) => {
    if (!guardRateLimit("player:away")) return;
    const parsed = validatePayload(socket, "player:away", roomOnlySchema, payload);
    if (!parsed) return;
    battle.handlePlayerAway(socket, parsed);
  });

  socket.on("player:back", (payload) => {
    if (!guardRateLimit("player:back")) return;
    const parsed = validatePayload(socket, "player:back", roomOnlySchema, payload);
    if (!parsed) return;
    battle.handlePlayerBack(socket, parsed);
  });

  socket.on("chain:cast", (payload) => {
    if (!guardRateLimit("chain:cast")) return;
    const parsed = validatePayload(socket, "chain:cast", chainCastSchema, payload);
    if (!parsed) return;
    battle.castChain(socket);
  });

  socket.on("chain:request", (payload) => {
    if (!guardRateLimit("chain:request")) return;
    const parsed = validatePayload(socket, "chain:request", chainRequestSchema, payload);
    if (!parsed) return;
    battle.castChain(socket);
  });

  socket.on("item:pickup", (payload) => {
    if (!guardRateLimit("item:pickup")) return;
    const parsed = validatePayload(socket, "item:pickup", itemPickupSchema, payload);
    if (!parsed) return;
    battle.handleItemPickup(socket, parsed);
  });

  socket.on("game:over", (payload) => {
    if (!guardRateLimit("game:over")) return;
    const parsed = validatePayload(socket, "game:over", gameOverClaimSchema, payload);
    if (!parsed) return;
    battle.handleGameOverClaim(socket, parsed);
  });
}
