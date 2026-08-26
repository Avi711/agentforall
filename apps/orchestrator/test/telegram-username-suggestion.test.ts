import { test } from "node:test";
import assert from "node:assert/strict";
import { suggestedUsernamePrefix } from "../src/services/telegram/managed-bot-linker.js";

test("a latin display name becomes the handle the owner sees", () => {
  assert.equal(suggestedUsernamePrefix("Alfred"), "alfred");
  assert.equal(suggestedUsernamePrefix("Ada Lovelace"), "adalovelace");
  assert.equal(suggestedUsernamePrefix("Jarvis-2"), "jarvis2");
});

// Telegram usernames are Latin-only, so most of our users land here.
test("a name with no usable latin characters keeps the brand prefix", () => {
  assert.equal(suggestedUsernamePrefix("אלפרד"), "agentforall");
  assert.equal(suggestedUsernamePrefix("עוזר אישי"), "agentforall");
  assert.equal(suggestedUsernamePrefix(""), "agentforall");
});

test("a name too short to recognize keeps the brand prefix", () => {
  assert.equal(suggestedUsernamePrefix("Jo"), "agentforall");
  assert.equal(suggestedUsernamePrefix("א J"), "agentforall");
});

test("a leading digit is dropped: telegram wants the name to start with a letter", () => {
  assert.equal(suggestedUsernamePrefix("7Sages"), "sages");
  assert.equal(suggestedUsernamePrefix("42"), "agentforall");
});

test("a name already ending in bot does not produce bot_bot", () => {
  assert.equal(suggestedUsernamePrefix("Robot"), "robot");
  assert.equal(suggestedUsernamePrefix("Helperbot"), "helper");
});

// prefix + "_" + 8 hex + "_bot" must stay inside Telegram's 32-character limit.
test("the prefix stays short enough for the full username to be legal", () => {
  const longest = suggestedUsernamePrefix("Extraordinarily Long Assistant Name");
  assert.equal(longest, "extraordinar");
  assert.equal(`${longest}_1a2b3c4d_bot`.length, 25);
  assert.ok(`${longest}_1a2b3c4d_bot`.length <= 32);
});
