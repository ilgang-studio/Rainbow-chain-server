import { getRoom } from "./roomManager.js";
import type { Room } from "../models/room.js";
import type { SocketData } from "../types/events.js";

export interface RoomScopedSocket {
  data: Pick<SocketData, "guestId" | "roomId">;
}

export interface AuthorizedRoomAccess {
  guestId: string;
  room: Room;
  roomId: string;
}

export function getAuthorizedRoomForSocket(
  socket: RoomScopedSocket,
  requestedRoomId?: string,
): AuthorizedRoomAccess | { error: string } {
  const guestId = socket.data.guestId?.trim();
  if (!guestId) {
    return { error: "No guest session found for this socket." };
  }

  const socketRoomId = socket.data.roomId?.trim();
  const normalizedRequestedRoomId = requestedRoomId?.trim();
  const roomId = normalizedRequestedRoomId || socketRoomId;
  if (!roomId) {
    return { error: "No room is assigned to this socket." };
  }

  if (socketRoomId && normalizedRequestedRoomId && socketRoomId !== normalizedRequestedRoomId) {
    return { error: "Room mismatch for this socket." };
  }

  const room = getRoom(roomId);
  if (!room) {
    return { error: "Room not found." };
  }

  if (!room.players.some((player) => player.guestId === guestId)) {
    return { error: "Socket is not a member of this room." };
  }

  return { guestId, room, roomId };
}
