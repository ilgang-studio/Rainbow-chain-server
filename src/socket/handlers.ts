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

type ServerSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

export function registerSocketHandlers(
  socket: ServerSocket,
  matchmaking: MatchmakingService,
  rematch: RematchService,
  battle: BattleService,
): void {
  socket.on("queue:join", (payload) => {
    matchmaking.joinQueue(socket, payload);
  });

  socket.on("queue:cancel", () => {
    matchmaking.cancelQueue(socket);
  });

  socket.on("room:ready", ({ roomId }) => {
    matchmaking.markReady(socket, roomId);
  });

  socket.on("disconnect", () => {
    // rematch first: needs room lookup before matchmaking removes the room
    rematch.handleDisconnect(socket);
    matchmaking.disconnect(socket);
  });

  socket.on("rematch:request", (payload) => {
    rematch.requestRematch(socket, payload);
  });

  socket.on("rematch:cancel", (payload) => {
    rematch.cancelRematch(socket, payload);
  });

  // Game relay — forward to the other player in the same room, no processing
  socket.on("player:move", (payload) => {
    const { roomId } = socket.data;
    if (!roomId) return;
    socket.to(roomId).emit("player:moved", payload);
  });

  socket.on("player:state", (payload) => {
    battle.syncPlayerState(socket, payload);
  });

  socket.on("player:away", (payload) => {
    battle.handlePlayerAway(socket, payload);
  });

  socket.on("player:back", (payload) => {
    battle.handlePlayerBack(socket, payload);
  });

  socket.on("chain:cast", () => {
    battle.castChain(socket);
  });

  socket.on("chain:request", () => {
    battle.castChain(socket);
  });

  socket.on("item:pickup", (payload) => {
    battle.handleItemPickup(socket, payload);
  });

  socket.on("game:over", (payload) => {
    battle.handleGameOverClaim(socket, payload);
  });
}
