import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { createBattleService } from "../services/battle.js";
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

  const battle = createBattleService(io);
  const matchmaking = createMatchmakingService(io, battle);
  const rematch = createRematchService(io, battle);

  io.on("connection", (socket) => {
    registerSocketHandlers(socket, matchmaking, rematch, battle);
  });

  return io;
}
