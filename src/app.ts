import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import { z } from "zod";

const guestSocketTokenSchema = z.object({
  guestId: z.string().trim().min(1).max(128),
  nickname: z.string().trim().min(1).max(32).optional(),
});

function getSocketJwtSecret(): string {
  const secret = process.env.SOCKET_JWT_SECRET ?? process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("Missing SOCKET_JWT_SECRET (or JWT_SECRET) for Socket.IO authentication.");
  }
  return secret;
}

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      service: "rainbow-chain-server",
      uptime: process.uptime(),
    });
  });

  app.post("/auth/socket-guest", (req, res) => {
    const parsed = guestSocketTokenSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: parsed.error.issues.map((issue) => issue.message).join("; "),
      });
    }

    const secret = getSocketJwtSecret();
    const token = jwt.sign(
      {
        sub: parsed.data.guestId,
        guestId: parsed.data.guestId,
        nickname: parsed.data.nickname,
      },
      secret,
      { expiresIn: "12h" },
    );

    return res.json({
      token,
      guestId: parsed.data.guestId,
      nickname: parsed.data.nickname ?? null,
    });
  });

  return app;
}
