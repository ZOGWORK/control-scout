# Test fixture for listen.test.ts: does what systemd does for control-scout.socket.
# It owns a listening socket for its whole life and hands it (fd 3, LISTEN_FDS=1)
# to one server at a time. A "restart" line on stdin stops the current server
# with SIGTERM, waits for it to exit, and starts a new one on the same socket:
# the same steps as `systemctl restart control-scout`.
#
#   python3 listen.owner.py <port> <command...>
import os, signal, socket, subprocess, sys

port, cmd = int(sys.argv[1]), sys.argv[2:]
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(("127.0.0.1", port))
s.listen(4096)
os.dup2(s.fileno(), 3)
os.set_inheritable(3, True)

def start():
    p = subprocess.Popen(cmd, pass_fds=(3,), env={**os.environ, "LISTEN_FDS": "1"})
    print(f"started {p.pid}", flush=True)
    return p

server = start()
for line in sys.stdin:
    if line.strip() == "restart":
        server.send_signal(signal.SIGTERM)
        code = server.wait()
        print(f"stopped {code}", flush=True)
        server = start()
server.terminate()
