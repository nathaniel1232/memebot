import { loadEnv } from "./env.js";

loadEnv();
const { startJ7Worker } = await import("./j7-worker.js");
await startJ7Worker();
