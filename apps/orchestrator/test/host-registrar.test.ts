import { test } from "node:test";
import assert from "node:assert/strict";
import type { FastifyBaseLogger } from "fastify";
import { HostNotAllowedError, UpstreamUnavailableError } from "../src/domain/errors.js";
import { HostRegistrar } from "../src/services/host-registrar.js";
import type { HostRepository } from "../src/storage/host-repository.js";
import { createGoogleIdTokenVerifier } from "../src/services/google-identity.js";

const NOW_S = 1_800_000_000;
const WORKERS = new Map([["1234567890123456789", "agent-forall-vm"]]);

type Registration = [string, string, number | undefined];

function claims(overrides: Record<string, unknown> = {}) {
  return {
    iat: NOW_S - 10,
    email: "worker@example-project.iam.gserviceaccount.com",
    email_verified: true,
    google: { compute_engine: { instance_id: "1234567890123456789" } },
    ...overrides,
  };
}

function harness(payload: unknown | Error) {
  const registered: Registration[] = [];
  const warnings: string[] = [];
  const repo = {
    register: async (id: string, address: string, memoryMb?: number) => void registered.push([id, address, memoryMb]),
  } as unknown as HostRepository;
  const logger = {
    info: () => undefined,
    warn: (fields: { reason: string }) => void warnings.push(fields.reason),
  } as unknown as FastifyBaseLogger;
  const verify = async () => {
    if (payload instanceof Error) throw payload;
    return payload;
  };
  const attached: Registration[] = [];
  const onRegistered = (hostId: string, address: string, memoryMb?: number) => void attached.push([hostId, address, memoryMb]);
  const registrar = new HostRegistrar(repo, verify, WORKERS, logger, onRegistered, () => NOW_S * 1000);
  return { registrar, registered, attached, warnings };
}

test("a fresh token from a listed instance registers that host's address and notifies the callback", async () => {
  const { registrar, registered, attached } = harness(claims());
  await registrar.register("token", "10.10.0.4");
  assert.deepEqual(registered, [["agent-forall-vm", "10.10.0.4", undefined]]);
  assert.deepEqual(attached, [["agent-forall-vm", "10.10.0.4", undefined]]);
});

test("a reported memory size reaches the repository and the callback unchanged", async () => {
  const { registrar, registered, attached } = harness(claims());
  await registrar.register("token", "10.10.0.4", 32_089);
  assert.deepEqual(registered, [["agent-forall-vm", "10.10.0.4", 32_089]]);
  assert.deepEqual(attached, [["agent-forall-vm", "10.10.0.4", 32_089]]);
});

test("rejections: unknown instance, stale token, unverified email, missing claims, library refusal", async () => {
  const cases: Array<[unknown | Error, string]> = [
    [claims({ google: { compute_engine: { instance_id: "1" } } }), "instance is not in the worker set"],
    [claims({ iat: NOW_S - 301 }), "token older than 5 minutes"],
    [claims({ email_verified: false }), "token lacks the expected claims"],
    [{ iat: NOW_S, email: "x" }, "token lacks the expected claims"],
    [new Error("Wrong recipient, payload audience != requiredAudience"), "Wrong recipient, payload audience != requiredAudience"],
  ];
  for (const [payload, reason] of cases) {
    const { registrar, registered, attached, warnings } = harness(payload);
    await assert.rejects(registrar.register("token", "10.10.0.4"), HostNotAllowedError);
    assert.deepEqual(registered, []);
    assert.deepEqual(attached, []);
    assert.deepEqual(warnings, [reason]);
  }
});

test("a certificate fetch failure is upstream trouble, not a rejected host", async () => {
  const { registrar, warnings } = harness(new UpstreamUnavailableError("google certs"));
  await assert.rejects(registrar.register("token", "10.10.0.4"), UpstreamUnavailableError);
  assert.deepEqual(warnings, []);
});

test("the google verifier maps only certificate fetch failures to upstream errors", async () => {
  const failing = (message: string) => ({
    verifyIdToken: async () => {
      throw new Error(message);
    },
  });
  await assert.rejects(
    createGoogleIdTokenVerifier("aud", failing("Failed to retrieve verification certificates: ECONNRESET"))("t"),
    UpstreamUnavailableError,
  );
  await assert.rejects(createGoogleIdTokenVerifier("aud", failing("Invalid token signature: eyJhbGciOi.secret"))("t"), {
    message: "Invalid token signature",
  });
  const ok = createGoogleIdTokenVerifier("aud", { verifyIdToken: async () => ({ getPayload: () => claims() }) });
  assert.deepEqual(await ok("t"), claims());
});
