import { z } from "zod";

const finiteNumber = z.number().finite();
const timestamp = z.number().finite().nonnegative();
const roomId = z.string().trim().min(1).max(128);
const guestId = z.string().trim().min(1).max(128);
const nickname = z.string().trim().min(1).max(32);

export const queueJoinSchema = z.object({
  mode: z.literal("casual"),
  nickname,
  guestId,
});

export const roomReadySchema = z.object({
  roomId,
});

export const playerMoveSchema = z.object({
  x: finiteNumber,
  y: finiteNumber,
  vx: finiteNumber,
  vy: finiteNumber,
  t: timestamp,
});

export const playerStateSchema = z.object({
  x: finiteNumber,
  y: finiteNumber,
  hp: finiteNumber,
  score: finiteNumber,
  t: timestamp,
});

export const roomOnlySchema = z.object({
  roomId,
});

export const chainCastSchema = z.object({
  dx: finiteNumber,
  dy: finiteNumber,
  t: timestamp,
});

export const chainRequestSchema = z.object({
  t: timestamp,
});

export const itemPickupSchema = z.object({
  itemId: z.string().trim().min(1).max(128),
  t: timestamp,
});

export const gameOverClaimSchema = z.object({
  winnerGuestId: z.string().trim().min(1).max(128).nullable(),
  reason: z.string().trim().min(1).max(128).optional(),
});

export const rematchRequestSchema = z.object({
  roomId,
});

export const rematchCancelSchema = z.object({
  roomId,
});

export function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "payload";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}
