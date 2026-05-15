import { createServer } from "node:http";
import { createApp } from "./app.js";
import { setupSocket } from "./socket/index.js";

const port = Number(process.env.PORT || 3000);
const app = createApp();
const server = createServer(app);

setupSocket(server);

server.listen(port, "0.0.0.0", () => {
  console.log(`Rainbow Chain server listening on http://0.0.0.0:${port}`);
});
