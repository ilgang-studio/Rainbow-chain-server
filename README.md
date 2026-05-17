# Rainbow-chain-server

## Environment Variables

The following environment variables are required. See `.env.example` for a template.

| Variable | Required | Description |
|---|---|---|
| `SOCKET_JWT_SECRET` | **Yes** | Secret used to sign/verify Socket.IO JWTs. |

> **Render deployment**: Go to your service → *Environment* → *Add Environment Variable* and set `SOCKET_JWT_SECRET` to a long random string (e.g. `openssl rand -hex 32`). Without this variable, `POST /auth/socket-guest` returns `500 {"error":"SERVER_CONFIG_MISSING"}`.

## Socket JWT Auth

Socket.IO connections require a JWT signed with `SOCKET_JWT_SECRET` or `JWT_SECRET`.

Accepted token sources:

- `socket.auth.token`
- `Authorization: Bearer <token>`

Required JWT claims:

- `sub` or `guestId`

Optional JWT claims:

- `nickname`
