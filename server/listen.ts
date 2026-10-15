// Listening and stopping without dropping requests.
//
// On the VM, systemd owns the port (control-scout.socket, written by
// deploy/oracle-vm-setup.sh) and hands the open socket to each server it
// starts. Through a deploy's restart the port therefore never closes: requests
// that arrive while the old server finishes and the new one starts wait in the
// socket's queue, instead of nginx answering 502 because nothing is listening.
// Elsewhere (Render, Docker, dev) the server opens the port itself.
import type { Server } from "node:http";

/**
 * The listening socket systemd passed in (socket activation: LISTEN_FDS, with
 * the first socket at fd 3), as a listen() target; null when the server was
 * started any other way. LISTEN_PID, when set, must be this process.
 */
export function systemdSocket(env: NodeJS.ProcessEnv = process.env, pid = process.pid): { fd: number } | null {
  const n = Number(env.LISTEN_FDS);
  if (!Number.isInteger(n) || n < 1) return null;
  if (env.LISTEN_PID && Number(env.LISTEN_PID) !== pid) return null;
  return { fd: 3 };
}

/**
 * On SIGTERM (systemd stop or restart, a Render deploy): stop taking new
 * connections, let the requests already in progress finish (at most
 * `graceMs`), then exit. With socket activation, closing here closes only this
 * process's copy of the socket; systemd keeps it open for the next server.
 */
export function drainOnSigterm(server: () => Server | null, log: (m: string) => void, graceMs = 10_000) {
  process.once("SIGTERM", () => {
    const s = server();
    if (!s) process.exit(0);
    log("stopping: finishing requests in progress");
    s.close(() => process.exit(0));
    s.closeIdleConnections();
    setTimeout(() => { log("stopping: requests still open after the grace period, exiting"); process.exit(0); }, graceMs).unref();
  });
}
