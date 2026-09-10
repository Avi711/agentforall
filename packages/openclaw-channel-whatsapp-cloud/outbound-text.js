export const TEXT_CHUNK_LIMIT = 4096;

// Meta caps a text at 4096 characters and the relay validates in UTF-16 units, so the chunks are measured the same way.
export function chunkText(text, limit = TEXT_CHUNK_LIMIT) {
  const chunks = [];
  let rest = text;
  while (rest.length > limit) {
    const window = rest.slice(0, safeEnd(rest, limit));
    const cut = bestCut(window);
    push(chunks, window.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  push(chunks, rest);
  return chunks;
}

export function truncateUnits(text, limit) {
  return text.length <= limit ? text : text.slice(0, safeEnd(text, limit));
}

// Never ends a slice between the two halves of a surrogate pair.
function safeEnd(text, limit) {
  const code = text.charCodeAt(limit - 1);
  return code >= 0xd800 && code <= 0xdbff ? limit - 1 : limit;
}

// A window of only whitespace has nothing to send.
function push(chunks, piece) {
  const trimmed = piece.trimEnd();
  if (trimmed) chunks.push(trimmed);
}

function bestCut(window) {
  for (const separator of ["\n\n", "\n", ". ", " "]) {
    const at = window.lastIndexOf(separator);
    if (at > window.length / 2) return at + separator.length;
  }
  return window.length;
}
