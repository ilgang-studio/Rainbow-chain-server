import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { createMatchmakingService } from "../services/matchmaking.js";
import { createRematchService } from "../services/rematch.js";
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
      origin: [
        "http://localhost:5173",
        "https://rainbow-chain.vercel.app",
      ],
      methods: ["GET", "POST"],
    },
  });

  const matchmaking = createMatchmakingService(io);
  const rematch = createRematchService(io);

  io.on("connection", (socket) => {
    registerSocketHandlers(socket, matchmaking, rematch);
  });

  return io;
}
