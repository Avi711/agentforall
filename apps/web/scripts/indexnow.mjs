// Pings IndexNow (Bing, and through it Perplexity) after publishing content changes.
// Run: npm run -w @agent-forall/web indexnow

const HOST = "agentforall.co.il";
const KEY = "ed2620d6e461c77537b49b6f49ad020c";
const URLS = [
  `https://${HOST}/`,
  `https://${HOST}/privacy`,
  `https://${HOST}/terms`,
  `https://${HOST}/accessibility`,
];

const res = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "content-type": "application/json; charset=utf-8" },
  body: JSON.stringify({
    host: HOST,
    key: KEY,
    keyLocation: `https://${HOST}/${KEY}.txt`,
    urlList: URLS,
  }),
});

const body = await res.text();
console.log(`IndexNow: ${res.status} ${res.statusText}${body ? ` — ${body}` : ""}`);
if (!res.ok) process.exit(1);
