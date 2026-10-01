import http from "node:http";
import { sendJson } from "./src/httpUtils.js";
import { handleRequest } from "./src/routes.js";

const port = Number(process.env.PORT || 3024);

const server = http.createServer(async (req, res) => {
  try {
    const handled = await handleRequest(req, res);
    if (handled === null) sendJson(res, 404, { error: "not_found" });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

server.listen(port, () => console.log(`Racing pigeon registry app listening on http://localhost:${port}`));
