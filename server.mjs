import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { classify } from "./mock-ai.mjs";

const html = await readFile(new URL("./index.html", import.meta.url));
const topics = new Set(["delivery", "pricing", "other"]);

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function handleTriage(request, response) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString("utf8");
  let input;
  try {
    input = JSON.parse(body);
  } catch {
    return json(response, 400, { status: "invalid_input" });
  }

  const text = input?.text;
  if (typeof text !== "string" || !text.trim()) {
    return json(response, 400, { status: "invalid_input" });
  }

  let result;
  try {
    const signal = AbortSignal.timeout(300);
    result = JSON.parse(await classify(text.trim(), { signal }));
  } catch {
    result = null;
  }

  const { topic, draft } = result ?? {};
  if (topics.has(topic) && typeof draft === "string" && draft.trim()) {
    return json(response, 200, { status: "ready", topic, draft });
  }
  return json(response, 200, { status: "manual_review", topic: null, draft: null });
}

export const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(html);
    return;
  }
  if (request.method !== "POST" || request.url !== "/api/triage") {
    return json(response, 404, { status: "not_found" });
  }
  try {
    await handleTriage(request, response);
  } catch {
    json(response, 500, { status: "server_error" });
  }
}).listen(Number(process.env.PORT || 3000), "127.0.0.1");
