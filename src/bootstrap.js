import { loadEnv } from "./env.js";

loadEnv();
await import("./server.js");
const { config } = await import("./config.js");
if (config.j7BrowserWorkerEnabled && config.j7BrowserEngine !== "extension") {
  const { startJ7Worker } = await import("./j7-worker.js");
  await startJ7Worker().catch((error) => console.error(`J7 watcher failed: ${error.message}`));
}
