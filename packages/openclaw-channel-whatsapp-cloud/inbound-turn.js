import { chunkText, truncateUnits } from "./outbound-text.js";
import { RelayError, errorLabel } from "./relay-client.js";
import { peerIdOf } from "./session-peer.js";

export const CHANNEL_ID = "whatsapp_cloud";
export const CHANNEL_LABEL = "WhatsApp Business";
const HUMAN_MODE = "human";
// Mirrors the orchestrator's OWNER_MESSAGE_MAX_CHARS; measured in UTF-16 units like the relay's validation.
const OWNER_FORWARD_MAX_CHARS = 3500;
const NO_TEXT_HE = "[הודעה ללא טקסט]";

// One agent turn per inbound customer message; the reply goes back through the relay.
export async function handleInbound({ cfg, account, relay, item, log, replies, runtime, dispatch }) {
  // Reactions, system notices and unsupported types are acked without a turn.
  if (item.text === null) return;
  // The turn already ran for this message; only its unsent chunks are left.
  if (replies.has(item.wamid)) return flushReplies(replies, relay, item, log);
  // No answer from the relay means no answer to the customer: the message stays unacked rather than reaching a bot the owner silenced.
  const conversation = await relay.conversation(item.from);
  if (conversation?.mode === HUMAN_MODE && (await forwardToOwner(relay, item, log))) return;
  relay.markRead(item.wamid, true).catch((err) => log?.warn?.(`read receipt failed: ${errorLabel(err)}`));
  await dispatch({
    runtime,
    cfg,
    channel: CHANNEL_ID,
    channelLabel: CHANNEL_LABEL,
    accountId: account.accountId,
    peer: { kind: "direct", id: peerIdOf(item.from) },
    senderId: peerIdOf(item.from),
    senderAddress: peerIdOf(item.from),
    recipientAddress: account.displayPhoneNumber ?? account.phoneNumberId,
    conversationLabel: item.profileName ? `${item.profileName} (${peerIdOf(item.from)})` : peerIdOf(item.from),
    rawBody: item.text,
    messageId: item.wamid,
    timestamp: Date.parse(item.timestamp) || Date.now(),
    // dmPolicy is "open" by construction; the orchestrator already decided who reaches this bot.
    inboundAccessAuthorized: true,
    deliver: async (payload) => {
      const text = payload.text ?? payload.fallbackText?.text;
      if (!text) return;
      // Meta can only quote the customer's own message; a model-invented reply target would be a 400.
      const replyToId = payload.replyToId === item.wamid ? item.wamid : undefined;
      replies.add(
        item.wamid,
        chunkText(text).map((chunk, i) => ({ to: item.from, text: chunk, replyToId: i === 0 ? replyToId : undefined, kind: "reply" })),
      );
      // A retryable failure stays queued; the check after dispatch fails the turn, so deliver itself never throws.
      await flushReplies(replies, relay, item, log).catch(() => {});
    },
    onRecordError: (err) => log?.warn?.(`whatsapp cloud record failed: ${errorLabel(err)}`),
    onDispatchError: (err, info) => log?.warn?.(`whatsapp cloud dispatch ${info?.kind ?? "turn"} failed: ${errorLabel(err)}`),
  });
  // The runtime swallows delivery errors; a reply still queued must fail the turn so the row comes back.
  if (replies.has(item.wamid)) throw new Error(`reply to ${item.wamid} not delivered; left for redelivery`);
}

// True when the owner has the message; false when the bot must answer after all; throws to hold the row.
async function forwardToOwner(relay, item, log) {
  let forwarded;
  try {
    forwarded = await relay.escalate(item.from, truncateUnits(item.text || NO_TEXT_HE, OWNER_FORWARD_MAX_CHARS), "forward");
  } catch (err) {
    if (isRetryableDelivery(err)) throw err;
    log?.warn?.(`whatsapp cloud forward of ${item.wamid} rejected: ${errorLabel(err)}`);
    return true;
  }
  if (forwarded.notified) return true;
  if (forwarded.fallbackToBot) return false;
  throw new Error("owner forward throttled; message left for redelivery");
}

// A rejected chunk is dropped with a warning; anything else stays queued and the caller decides.
async function flushReplies(replies, relay, item, log) {
  try {
    await replies.flush(item.wamid, (send) => relay.sendText(send));
  } catch (err) {
    if (isRetryableDelivery(err)) throw err;
    replies.forget(item.wamid);
    log?.warn?.(`whatsapp cloud reply to ${item.wamid} rejected: ${errorLabel(err)}`);
  }
}

export function isRetryableDelivery(err) {
  if (!(err instanceof RelayError)) return true;
  if (err.status === 409) return err.code === "CHANNEL_CREDENTIAL_INVALID";
  return err.status === 429 || err.status >= 500 || err.status === 0;
}
