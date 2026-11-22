import { runServer } from "./http.ts";

const host = process.env.RELAY_HOST ?? "127.0.0.1";
const running = await runServer({
  host, port: Number(process.env.RELAY_PORT ?? 2567), database: process.env.RELAY_DB,
  latency: Number(process.env.RELAY_LATENCY_MS ?? 0),
});
console.log("Relay room server listening on " + host + ":" + running.port);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await running.stop();
}
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
