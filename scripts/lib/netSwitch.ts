// The phone's network, switchable (offline checks): every request the browser makes — the page's and the service
// worker's own, which Playwright's context.setOffline() doesn't reach — goes through this local proxy. "online"
// forwards it; "offline" drops each connection at once (Wi-Fi and data off) and cuts the ones already open
// (a live stream). Plain http (a local server: launch Chromium with proxyBypass "<-loopback>" so localhost goes
// through it too) and https (CONNECT tunnels) both.
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { connect as tcpConnect, type Socket } from "node:net";

export interface NetSwitch { port: number; offline(): void; online(): void; isOnline(): boolean; close(): Promise<void> }

export async function startNetSwitch(): Promise<NetSwitch> {
  let up = true;
  const open = new Set<Socket>();
  const track = (s: Socket) => { open.add(s); s.on("close", () => open.delete(s)); };
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (!up) { req.socket.destroy(); return; }
    let url: URL;
    try { url = new URL(req.url ?? ""); } catch { res.writeHead(400).end(); return; }
    const fwd = httpRequest({ host: url.hostname, port: url.port || 80, path: url.pathname + url.search, method: req.method, headers: req.headers }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    });
    fwd.on("socket", track);
    fwd.on("error", () => req.socket.destroy());
    req.pipe(fwd);
  });
  server.on("connection", track);
  server.on("connect", (req: IncomingMessage, client: Socket) => {
    if (!up) { client.destroy(); return; }
    const [host, port] = (req.url ?? "").split(":");
    const upstream = tcpConnect({ host, port: Number(port) || 443 }, () => { client.write("HTTP/1.1 200 Connection Established\r\n\r\n"); upstream.pipe(client); client.pipe(upstream); });
    track(upstream);
    upstream.on("error", () => client.destroy());
    client.on("error", () => upstream.destroy());
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;
  return {
    port,
    offline() { up = false; for (const s of open) s.destroy(); open.clear(); },
    online() { up = true; },
    isOnline: () => up,
    close: () => new Promise<void>((r) => { for (const s of open) s.destroy(); server.close(() => r()); }),
  };
}
