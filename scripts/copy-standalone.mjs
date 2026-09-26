// Copy static assets into the standalone output so `node .next/standalone/server.js` can serve them.
import { cpSync, existsSync } from "node:fs";

cpSync(".next/static", ".next/standalone/.next/static", { recursive: true });
if (existsSync("public")) {
  cpSync("public", ".next/standalone/public", { recursive: true });
}
console.log("Standalone assets copied.");
