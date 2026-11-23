import assert from "node:assert/strict";
import { once } from "node:events";
import { after, before, test } from "node:test";

let server;
let endpoint;

before(async () => {
  process.env.PORT = "0";
  ({ server } = await import("./server.mjs"));
  if (!server.listening) await once(server, "listening");
  endpoint = `http://127.0.0.1:${server.address().port}/api/triage`;
});

after(async () => {
  if (server?.listening) {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});

function post(body) {
  return fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    signal: AbortSignal.timeout(3_000),
  });
}

test("HTTP 400 для некорректного ввода", async (t) => {
  for (const body of ["", "{", "null", "{}", '{"text":123}', '{"text":""}', '{"text":" \\t\\n "}']) {
    await t.test(JSON.stringify(body), async () => {
      const response = await post(body);
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { status: "invalid_input" });
    });
  }
});

test("Тема и черновик для корректного ввода", async (t) => {
  const samples = [
    ["  Когда будет доставка?  ", "delivery"],
    ["Какая цена?", "pricing"],
    ["Подскажите часы работы", "other"],
  ];
  for (const [text, topic] of samples) {
    await t.test(topic, async () => {
      const response = await post(JSON.stringify({ text }));
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        status: "ready",
        topic,
        draft: "Спасибо за обращение. Уточним детали заявки.",
      });
    });
  }
});

test("Ручной разбор при сбое имитатора", async (t) => {
  for (const text of ["[timeout]", "[error]", "[bad-json]", "[bad-topic]", "[empty-draft]"]) {
    await t.test(text, async () => {
      const startedAt = performance.now();
      const response = await post(JSON.stringify({ text }));
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { status: "manual_review", topic: null, draft: null });
      if (text === "[timeout]") {
        // Запас на HTTP и планировщик. Сам имитатор ждёт 1200 мс.
        const elapsed = performance.now() - startedAt;
        assert.ok(elapsed < 900, `Ответ пришёл за ${Math.round(elapsed)} мс`);
      }
    });
  }
});
