// Meta message object -> what the agent reads; media is described, not fetched. Null = no turn.
const MEDIA_KINDS = new Set(["image", "video", "audio", "document", "sticker"]);
const SILENT_KINDS = new Set(["reaction", "system", "unsupported"]);

export function describeInbound(message) {
  if (typeof message?.type !== "string") return null;
  const type = message.type;
  if (SILENT_KINDS.has(type)) return null;
  switch (type) {
    case "text":
      return textOf(message.text?.body);
    case "button":
      return textOf(message.button?.text);
    case "interactive":
      return interactiveText(message.interactive);
    case "location":
      return locationText(message.location);
    case "contacts":
      return "[הלקוח שיתף איש קשר]";
    case "order":
      return orderText(message.order);
    case "request_welcome":
      return "[הלקוח פתח שיחה מפרסומת או מקישור. ברכו אותו והציעו עזרה]";
    default:
      if (MEDIA_KINDS.has(type)) return mediaText(type, message[type]);
      return "[הודעה מסוג שאינו נתמך]";
  }
}

// An empty body is nothing to answer; the row is acked without a turn.
function textOf(body) {
  return typeof body === "string" && body.trim() ? body : null;
}

function interactiveText(interactive) {
  const reply = interactive?.button_reply ?? interactive?.list_reply;
  return typeof reply?.title === "string" ? reply.title : "[בחירה]";
}

function locationText(location) {
  if (typeof location?.latitude !== "number" || typeof location?.longitude !== "number") return "[מיקום]";
  const name = typeof location.name === "string" ? ` ${location.name}` : "";
  return `[מיקום${name}: ${location.latitude}, ${location.longitude}]`;
}

function orderText(order) {
  const items = Array.isArray(order?.product_items) ? order.product_items.length : 0;
  return items > 0 ? `[הלקוח שלח הזמנה מהקטלוג: ${items} פריטים]` : "[הלקוח שלח הזמנה מהקטלוג]";
}

const MEDIA_LABEL = { image: "תמונה", video: "וידאו", audio: "הודעה קולית", document: "קובץ", sticker: "מדבקה" };

function mediaText(type, media) {
  const caption = typeof media?.caption === "string" && media.caption ? `: ${media.caption}` : "";
  const filename = typeof media?.filename === "string" ? ` ${media.filename}` : "";
  return `[${MEDIA_LABEL[type]}${filename}]${caption}`;
}
