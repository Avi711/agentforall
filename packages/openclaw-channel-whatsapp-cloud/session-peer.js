// Our plugin reports customers as +E.164; other channels use bare ids, which must never match.
const SESSION_PEER_PATTERN = /:direct:\+(\d{6,20})$/;

// Which customer a session belongs to comes from the session key OpenClaw minted, never from text.
export function customerOfSession(sessionKey) {
  const match = SESSION_PEER_PATTERN.exec(String(sessionKey ?? ""));
  return match ? match[1] : null;
}

// Second gate behind the orchestrator's tool policy: an owner-only tool refuses a customer's session outright.
export function assertOwnerSession(sessionKey) {
  if (customerOfSession(sessionKey) !== null) throw new Error("this tool is for the business owner, not for a customer conversation");
}

export function waIdOf(peerId) {
  return String(peerId).replace(/^\+/, "");
}

export function peerIdOf(waId) {
  return `+${waId}`;
}
