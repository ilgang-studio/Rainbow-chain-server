import jwt from "jsonwebtoken";
import { z } from "zod";
import type { Socket } from "socket.io";
import type {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from "../types/events.js";

type ServerSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

const authTokenPayloadSchema = z.object({
  sub: z.string().trim().min(1).max(128).optional(),
  guestId: z.string().trim().min(1).max(128).optional(),
  nickname: z.string().trim().min(1).max(32).optional(),
}).refine((payload) => Boolean(payload.sub || payload.guestId), {
  message: "JWT must include sub or guestId.",
});

function getSocketJwtSecret(): string {
  const secret = process.env.SOCKET_JWT_SECRET ?? process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("Missing SOCKET_JWT_SECRET (or JWT_SECRET) for Socket.IO authentication.");
  }
  return secret;
}

function getHandshakeToken(socket: ServerSocket): string | null {
  const authToken = socket.handshake.auth?.token;
  if (typeof authToken === "string" && authToken.trim()) {
    return authToken.trim();
  }

  const headerValue = socket.handshake.headers.authorization;
  if (typeof headerValue === "string" && headerValue.startsWith("Bearer ")) {
    const token = headerValue.slice("Bearer ".length).trim();
    return token || null;
  }

  return null;
}

export function attachSocketJwtAuth(socket: ServerSocket): void {
  const token = getHandshakeToken(socket);
  if (!token) {
    throw new Error("Missing socket JWT. Provide auth.token or Authorization: Bearer <token>.");
  }

  const decoded = jwt.verify(token, getSocketJwtSecret());
  const parsed = authTokenPayloadSchema.safeParse(decoded);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Invalid socket JWT payload. ${message}`);
  }

  const guestId = parsed.data.guestId ?? parsed.data.sub;
  if (!guestId) {
    throw new Error("JWT guestId could not be resolved.");
  }

  socket.data.guestId = guestId;
  socket.data.nickname = parsed.data.nickname;
  socket.data.authSubject = parsed.data.sub ?? guestId;
  socket.data.authenticated = true;
}
