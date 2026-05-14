import type { Socket } from "socket.io";
import type {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from "../types/events.js";
import type { MatchmakingService } from "../services/matchmaking.js";

type ServerSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

export function registerSocketHandlers(
  socket: ServerSocket,
  matchmaking: MatchmakingService,
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
    matchmaking.disconnect(socket);
  });

  // Game relay — forward to the other player in the same room, no processing
  socket.on("player:move", (payload) => {
    const { roomId } = socket.data;
    if (!roomId) return;
    socket.to(roomId).emit("player:moved", payload);
  });

  socket.on("player:state", (payload) => {
    const { roomId } = socket.data;
    if (!roomId) return;
    socket.to(roomId).emit("player:state", payload);
  });

  socket.on("chain:spawn", (payload) => {
    const { roomId } = socket.data;
    if (!roomId) return;
    socket.to(roomId).emit("chain:spawned", payload);
  });

  socket.on("chain:warning", (payload) => {
    const { roomId } = socket.data;
    if (!roomId) return;
    socket.to(roomId).emit("chain:warning", payload);
  });

  socket.on("item:pickup", (payload) => {
    const { roomId } = socket.data;
    if (!roomId) return;
    socket.to(roomId).emit("item:picked", payload);
  });

  socket.on("game:over", (payload) => {
    const { roomId } = socket.data;
    if (!roomId) return;
    socket.to(roomId).emit("room:end", payload);
  });
}
