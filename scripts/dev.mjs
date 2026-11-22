import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const lan = process.argv.includes("--lan");
const host = lan ? "0.0.0.0" : "127.0.0.1";
const env = { ...process.env, RELAY_HOST: host };
const children = [
  spawn(process.execPath, ["packages/server/src/index.ts"], { cwd: root, env, stdio: "inherit" }),
  spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--config", "packages/web/vite.config.ts", "--host", host], { cwd: root, env, stdio: "inherit" }),
];
function stop() {
  for (const child of children) if (child.exitCode === null && !child.killed) child.kill();
}
for (const child of children) {
  child.once("error", (error) => { console.error(error.message); process.exitCode = 1; stop(); });
  child.once("exit", (code) => { process.exitCode ??= code ?? 0; stop(); });
}
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
