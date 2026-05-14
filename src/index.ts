import { createServer } from "node:http";
import { createApp } from "./app.js";
import { setupSocket } from "./socket/index.js";

const port = Number(process.env.PORT ?? 3001);
const app = createApp();
const server = createServer(app);

setupSocket(server);

server.listen(port, () => {
  console.log(`Rainbow Chain server listening on http://localhost:${port}`);
});
