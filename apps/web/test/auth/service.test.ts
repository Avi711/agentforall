import { test } from "node:test";
import assert from "node:assert/strict";
import { AuthService } from "../../src/lib/auth/service";
import type { AuthRepository } from "../../src/lib/auth/repository";
import type { OutgoingEmail } from "../../src/lib/email/client";

function setup(send: (email: OutgoingEmail) => Promise<void> = async () => {}) {
  const hits = new Map<string, number>();
  const repo = {
    countHit: async (key: string) => {
      hits.set(key, (hits.get(key) ?? 0) + 1);
      return hits.get(key) ?? 0;
    },
  } as unknown as AuthRepository;
  const delivered: string[] = [];
  const service = new AuthService(repo, async (email) => {
    await send(email);
    delivered.push(email.subject);
  });
  return { service, delivered, hits };
}

const mail = (to = "owner@example.com"): OutgoingEmail => ({ to, subject: "s", html: "h", text: "t" });

test("each kind of mail gets its own hourly budget per inbox, so one kind cannot starve another", async () => {
  const { service, delivered } = setup();

  for (let i = 0; i < 7; i++) await service.deliver("verify-email", mail());
  await service.deliver("reset-password", mail());

  assert.equal(delivered.length, 6);
});

test("the cap is per inbox, whatever the address casing", async () => {
  const { service, delivered } = setup();

  for (let i = 0; i < 5; i++) await service.deliver("verify-email", mail("Owner@Example.com"));
  await service.deliver("verify-email", mail("owner@example.com "));
  await service.deliver("verify-email", mail("someone@example.com"));

  assert.equal(delivered.length, 6);
});

test("the password-changed notice is never capped", async () => {
  const { service, delivered, hits } = setup();

  for (let i = 0; i < 8; i++) await service.deliver("password-changed", mail());

  assert.equal(delivered.length, 8);
  assert.equal(hits.size, 0);
});

test("a failed send is logged without the address and never thrown", async () => {
  const logged: unknown[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => logged.push(args);
  try {
    const { service } = setup(async () => {
      throw new Error("Invalid `to`: owner@example.com");
    });
    await service.deliver("reset-password", mail());
  } finally {
    console.error = original;
  }

  assert.equal(logged.length, 1);
  assert.doesNotMatch(JSON.stringify(logged), /owner@example\.com/);
});
