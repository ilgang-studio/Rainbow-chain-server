# Rainbow-chain-server

## Socket JWT Auth

Socket.IO connections require a JWT signed with `SOCKET_JWT_SECRET` or `JWT_SECRET`.

Accepted token sources:

- `socket.auth.token`
- `Authorization: Bearer <token>`

Required JWT claims:

- `sub` or `guestId`

Optional JWT claims:

- `nickname`
