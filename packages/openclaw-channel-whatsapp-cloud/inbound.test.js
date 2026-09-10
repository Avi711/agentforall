import { test } from "node:test";
import assert from "node:assert/strict";
import { describeInbound } from "./inbound.js";

test("text and interactive replies become the customer's words", () => {
  assert.equal(describeInbound({ type: "text", text: { body: "יש מקום מחר?" } }), "יש מקום מחר?");
  assert.equal(describeInbound({ type: "button", button: { text: "כן" } }), "כן");
  assert.equal(describeInbound({ type: "interactive", interactive: { list_reply: { title: "שעה 10:00" } } }), "שעה 10:00");
});

test("media is described with its caption", () => {
  const image = { type: "image", image: { id: "m1", caption: "זה הדגם" } };
  assert.equal(describeInbound(image), "[תמונה]: זה הדגם");
  assert.equal(describeInbound({ type: "document", document: { id: "d1", filename: "invoice.pdf" } }), "[קובץ invoice.pdf]");
  assert.equal(describeInbound({ type: "audio", audio: { id: "a1" } }), "[הודעה קולית]");
});

test("an empty text and a payload without a type get no turn at all", () => {
  assert.equal(describeInbound({ type: "text", text: { body: "" } }), null);
  assert.equal(describeInbound({ type: "text", text: { body: "   " } }), null);
  assert.equal(describeInbound({ type: "button", button: {} }), null);
  assert.equal(describeInbound({}), null);
  assert.equal(describeInbound(undefined), null);
});

test("locations, orders and unknown types are described in Hebrew; reactions and system notices get no turn", () => {
  assert.equal(describeInbound({ type: "location", location: { latitude: 32.1, longitude: 34.8, name: "Cafe" } }), "[מיקום Cafe: 32.1, 34.8]");
  assert.equal(describeInbound({ type: "reaction", reaction: { emoji: "👍" } }), null);
  assert.equal(describeInbound({ type: "system", system: { body: "user changed number" } }), null);
  assert.equal(describeInbound({ type: "unsupported" }), null);
  assert.equal(describeInbound({ type: "order", order: { product_items: [{}, {}] } }), "[הלקוח שלח הזמנה מהקטלוג: 2 פריטים]");
  assert.match(describeInbound({ type: "request_welcome" }), /ברכו אותו/);
  assert.equal(describeInbound(null), null);
  assert.equal(describeInbound({ type: "nfm_reply" }), "[הודעה מסוג שאינו נתמך]");
});
