// TCP forwarder: listen on the PC's Tailscale IP and forward to the
// local DeepSeek Harness Web GUI (bound to 127.0.0.1:3080).
// Only devices inside the tailnet can reach the listen address, so the
// unauthenticated GUI is not exposed to the LAN.
//
// Usage: node tailscale_forward.js <listenIP> [listenPort] [targetPort]
// listenIP is REQUIRED (your PC's Tailscale IP); there is no hardcoded default
// so a public copy of this file never leaks a real tailnet address.
"use strict";

const net = require("net");

const LISTEN_HOST = process.argv[2];
const LISTEN_PORT = Number(process.argv[3] || 3080);
const TARGET_HOST = "127.0.0.1";
const TARGET_PORT = Number(process.argv[4] || 3080);

if (!LISTEN_HOST) {
  console.error("usage: node tailscale_forward.js <listenIP> [listenPort] [targetPort]");
  process.exit(2);
}

const server = net.createServer((client) => {
  const upstream = net.connect({ host: TARGET_HOST, port: TARGET_PORT }, () => {
    client.pipe(upstream);
    upstream.pipe(client);
  });
  client.on("error", () => upstream.destroy());
  upstream.on("error", () => client.destroy());
});

server.on("error", (err) => {
  console.error("tailscale_forward: fatal:", err.message);
  process.exit(1);
});

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  console.log(
    "tailscale_forward: listening on " +
      LISTEN_HOST + ":" + LISTEN_PORT +
      " -> " + TARGET_HOST + ":" + TARGET_PORT
  );
});
