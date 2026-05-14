import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { createMatchmakingService } from "../services/matchmaking.js";
import { registerSocketHandlers } from "./handlers.js";
import type {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from "../types/events.js";

export function setupSocket(server: HttpServer) {
  const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  const matchmaking = createMatchmakingService(io);

  io.on("connection", (socket) => {
    registerSocketHandlers(socket, matchmaking);
  });

  return io;
}
