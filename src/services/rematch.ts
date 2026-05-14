import type { Server, Socket } from "socket.io";
import { getRoom, createRematchRoom, removeRoom, toRoomStartPayload } from "./roomManager.js";
import { sessions } from "./matchmaking.js";
import type {
  ClientToServerEvents,
  InterServerEvents,
  RematchCancelPayload,
  RematchRequestPayload,
  ServerToClientEvents,
  SocketData,
} from "../types/events.js";

type SocketServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type ServerSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

const REMATCH_TIMEOUT_MS = 30_000;

export interface RematchService {
  requestRematch: (socket: ServerSocket, payload: RematchRequestPayload) => void;
  cancelRematch: (socket: ServerSocket, payload: RematchCancelPayload) => void;
  handleDisconnect: (socket: ServerSocket) => void;
}

export function createRematchService(io: SocketServer): RematchService {
  // roomId -> Set of guestIds who requested rematch
  const rematchRequests = new Map<string, Set<string>>();
  // roomId -> cleanup timeout handle
  const rematchTimeouts = new Map<string, NodeJS.Timeout>();

  function getSocket(socketId: string): ServerSocket | undefined {
    return io.sockets.sockets.get(socketId);
  }

  function clearRematchState(roomId: string): void {
    const timeout = rematchTimeouts.get(roomId);
    if (timeout) clearTimeout(timeout);
    rematchTimeouts.delete(roomId);
    rematchRequests.delete(roomId);
  }

  function notifyOpponentLeft(roomId: string, excludeGuestId: string): void {
    const room = getRoom(roomId);
    if (!room) return;
    for (const player of room.players) {
      if (player.isBot || player.guestId === excludeGuestId || !player.socketId) continue;
      getSocket(player.socketId)?.emit("opponent:left", { roomId });
      console.log(`[opponent:left] notified ${player.guestId} (room ${roomId})`);
    }
  }

  return {
    requestRematch(socket, { roomId }) {
      const guestId = socket.data.guestId;
      if (!guestId) return;

      const room = getRoom(roomId);
      if (!room) return;

      const humanPlayers = room.players.filter((p) => !p.isBot);
      if (!humanPlayers.some((p) => p.guestId === guestId)) return;

      if (!rematchRequests.has(roomId)) {
        rematchRequests.set(roomId, new Set());
      }
      const requests = rematchRequests.get(roomId)!;
      if (requests.has(guestId)) return;

      requests.add(guestId);
      console.log(`[rematch:request] ${guestId} in room ${roomId} (${requests.size}/${humanPlayers.length})`);

      if (requests.size >= humanPlayers.length) {
        // Both players requested — start rematch
        clearRematchState(roomId);
        removeRoom(roomId);

        const newRoom = createRematchRoom(room);
        const payload = toRoomStartPayload(newRoom);
        console.log(`[rematch:accepted] new room ${newRoom.roomId} seed ${newRoom.seed}`);

        for (const player of newRoom.players) {
          if (player.isBot || !player.socketId) continue;
          const playerSocket = getSocket(player.socketId);
          if (!playerSocket) {
            console.warn(`[rematch:accepted] socket not found for ${player.guestId}`);
            continue;
          }
          playerSocket.join(newRoom.roomId);
          playerSocket.data.roomId = newRoom.roomId;

          const session = sessions.get(player.guestId);
          if (session) session.roomId = newRoom.roomId;

          playerSocket.emit("rematch:accepted", { roomId: newRoom.roomId });
          playerSocket.emit("room:start", payload);
          console.log(`[rematch:accepted] room:start sent to ${player.guestId}`);
        }
      } else {
        // Waiting for the other player
        socket.emit("rematch:waiting", { roomId });

        if (!rematchTimeouts.has(roomId)) {
          const timeout = setTimeout(() => {
            clearRematchState(roomId);
            for (const player of humanPlayers) {
              if (!player.socketId) continue;
              getSocket(player.socketId)?.emit("rematch:timeout", { roomId });
            }
            console.log(`[rematch:timeout] room ${roomId}`);
          }, REMATCH_TIMEOUT_MS);
          rematchTimeouts.set(roomId, timeout);
        }
      }
    },

    cancelRematch(socket, { roomId }) {
      const guestId = socket.data.guestId;
      if (!guestId) return;

      const requests = rematchRequests.get(roomId);
      if (!requests?.has(guestId)) return;

      clearRematchState(roomId);
      notifyOpponentLeft(roomId, guestId);
      console.log(`[rematch:cancel] ${guestId} cancelled in room ${roomId}`);
    },

    handleDisconnect(socket) {
      const { guestId, roomId } = socket.data;
      if (!guestId || !roomId) return;
      if (!rematchRequests.has(roomId)) return; // not in rematch phase

      clearRematchState(roomId);
      notifyOpponentLeft(roomId, guestId);
    },
  };
}
