// Tiny static server: apps/<app>/dist-web served under /<app>/ (calc, write, show), apps/portal at /
// and a stub /version.json (the deploy script writes the real one).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../apps");
const port = Number(process.env.E2E_PORT ?? 4173);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

// The same security headers as production: the policy is read from the nginx vhost (ADR 0009), so the
// local suite fails on anything the live CSP would block.
const vhost = fs.readFileSync(path.resolve(root, "../deploy/nginx/resuite.inceptum.at.conf"), "utf8");
const nginxVar = (name) => vhost.match(new RegExp(`set \\$${name} "([^"]*)";`))?.[1] ?? "";
const connect = nginxVar("csp_connect");
const securityHeaders = {
  "content-security-policy": nginxVar("csp").replaceAll("$csp_connect", connect),
  "permissions-policy": nginxVar("permissions_policy"),
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

http
  .createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const [, app, ...rest] = decodeURIComponent(url.pathname).split("/");
    if (app === "version.json" && rest.length === 0) {
      res.writeHead(200, { ...securityHeaders, "content-type": types[".json"] });
      res.end(JSON.stringify({ commit: "local", builtAt: new Date().toISOString() }));
      return;
    }
    const isApp = ["calc", "write", "show"].includes(app);
    const dist = isApp ? path.join(root, app, "dist-web") : path.join(root, "portal");
    let file = path.join(dist, ...(isApp ? rest : [app, ...rest]).filter((p) => p && p !== ".."));
    if (!file.startsWith(dist)) return void res.writeHead(403).end();
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!fs.existsSync(file)) return void res.writeHead(404).end("not found");
    res.writeHead(200, { ...securityHeaders, "content-type": types[path.extname(file)] ?? "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  })
  .listen(port, "127.0.0.1", () => console.log(`e2e server on http://127.0.0.1:${port}/ (portal, calc, write, show)`));
