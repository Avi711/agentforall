import { test } from "node:test";
import assert from "node:assert/strict";
import type Docker from "dockerode";
import { createDockerClient } from "../src/services/docker-container-runtime.js";

// The plain forms must not pick up the runner shell's Docker settings.
delete process.env.DOCKER_HOST;
delete process.env.DOCKER_TLS_VERIFY;
delete process.env.DOCKER_CERT_PATH;

// @types/dockerode leaves the modem opaque; docker-modem keeps these as own fields.
interface ModemFields {
  protocol?: string;
  host?: string;
  port?: number;
  socketPath?: string;
  ca?: Buffer;
  cert?: Buffer;
  key?: Buffer;
}
const modem = (docker: Docker): ModemFields => docker.modem as unknown as ModemFields;

const tls = { ca: Buffer.from("ca"), cert: Buffer.from("cert"), key: Buffer.from("key") };

test("the TLS form dials the worker over https on 2376 with the client identity on the modem", () => {
  const docker = modem(createDockerClient({ host: "10.10.0.7", tls }));
  assert.equal(docker.protocol, "https");
  assert.equal(docker.host, "10.10.0.7");
  assert.equal(docker.port, 2376);
  assert.equal(docker.ca, tls.ca);
  assert.equal(docker.cert, tls.cert);
  assert.equal(docker.key, tls.key);
});

test("the plain forms stay as they were: tcp host, socket path, or the default socket", () => {
  const tcp = modem(createDockerClient({ dockerHost: "docker-proxy", dockerPort: 2375 }));
  assert.equal(tcp.protocol, "http");
  assert.equal(tcp.host, "docker-proxy");
  assert.equal(tcp.port, 2375);
  assert.equal(tcp.ca, undefined);
  const socket = modem(createDockerClient({ dockerSocketPath: "/var/run/docker.sock" }));
  assert.equal(socket.socketPath, "/var/run/docker.sock");
});
