# Agent For All — Session Summary (updated 2026-04-16, session 4)

## Project Vision

**Agent For All** makes [OpenClaw](https://github.com/openclaw) — an open-source AI agent framework — accessible to everyone. Not just developers. Not just tech companies. *Everyone.*

A doctor who needs a secretary that never sleeps. A parent who forgets anniversaries. A freelancer drowning in WhatsApp tabs. A shop owner who wants a daily sales summary at 9pm.

We wrap OpenClaw in a friendly WhatsApp/Telegram interface, host it on a private encrypted server, and let people name their bot whatever they want — שלומי, ג'ארוויס, אלפרד. It's *their* agent.

**Open source at the core**: The engine is transparent. No hidden algorithms. No data harvesting. Users can inspect the code themselves. We believe AI assistants should be owned, not rented.

**Target audience**: Israeli entrepreneurs, freelancers, doctors, lawyers, small business owners, busy parents — anyone who'd benefit from a personal secretary but can't afford one.

---

## What we built

### Monorepo structure (npm workspaces)
```
agent-forall/
├── apps/
│   ├── web/              # Next.js 16.2 landing page (Hebrew RTL)
│   └── orchestrator/     # Fastify backend (OpenClaw instance manager)
├── packages/
│   └── db/               # Shared Drizzle 0.45 schema (Supabase PostgreSQL)
├── brand/                # Logo PNGs, social posts, stories, comparison HTML
├── infra/                # Terraform (GCP deployment - unchanged)
└── package.json          # workspace root
```

### Landing page (apps/web)
- **Stack**: Next.js 16.2.3, Tailwind 4.2.2, Drizzle 0.45.2, Heebo font
- **Design**: Warm Mediterranean palette (cream, terracotta, sage, espresso) — NOT generic blue SaaS
- **Language**: Hebrew RTL, mobile-first
- **Sections**: Hero → Safety disclaimer → Features (WhatsApp conversation examples) → How it works → Testimonials → Lead form → FAQ → Footer
- **Lead form**: Name, email, phone, platform selector (WhatsApp/Telegram/Both with eSIM note), interest chips
- **API**: POST /api/leads → Supabase PostgreSQL with rate limiting, duplicate email protection, Zod validation
- **Admin panel**: `/admin` — password-protected lead dashboard with stats, table, CSV export, delete
  - API: GET/DELETE /api/admin/leads with Bearer token auth
  - Password configurable via `ADMIN_PASSWORD` env var
- **Security**: CSP headers (Meta Pixel domains whitelisted, unsafe-eval removed), X-Frame-Options, rate limiting, singleton DB pool, no secrets in git
- **Favicon**: SVG icon — espresso rounded square with white "A" and terra accent dot
- **Meta Pixel**: Integrated via `MetaPixel.tsx`, fires PageView on load + Lead event on form submit

### Navbar + Footer logo
- **Wordmark**: `AgentforAll` — Option 3 (looser tracking, -0.02em)
- "Agent" extrabold espresso, "for" normal weight lighter color, "All" extrabold terra
- Consistent across navbar and footer

### Brand assets (brand/)
- Profile pic PNGs at 2048px, 800px, 400px, 170px in 4 variants (v4-espresso chosen for social)
- **22 Social media posts** (1080×1350 4:5 portrait at 2× = 2160×2700px):
  - Source: `brand/social-posts.html` — Export: `brand/export-posts.mjs`
  - **Original 9**: Intro, budget, morning briefing, calendar, why WhatsApp, price monitoring, family, research, CTA
  - **Professional 4**: Doctor (פלורנס), business manager (ג'ארוויס), lawyer (אלפרד), small business (אביגדור)
  - **Explainers 2**: OpenClaw open source, privacy & data ownership
  - **Trading 2**: Crypto alerts (באפט), stock portfolio + auto-buy (באפט)
  - **Funny/sassy 5**: Anniversary save (ברוכי), ChatGPT vs Agent, Wolt roast (שלומי), gym accountability (ג'ארוויס), late night shopping block (אלפרד)
  - Each WhatsApp post has a personalized bot name showing users can name their agent
- **9 Instagram stories** (1080×1920 9:16 at 2× = 2160×3840px):
  - Source: `brand/social-stories.html` — Export: `brand/export-stories.mjs`
  - Dedicated story-optimized versions with bigger text, full vertical space, link sticker area
  - Intro, Wolt, Doctor, Gym, OpenClaw, Anniversary, Crypto, Shopping, CTA
- PNGs not committed to git (*.png in .gitignore)

### Social media — published & scheduled (session 3, 2026-04-14)
- **6 posts published now** (FB + IG): Intro, Doctor, Wolt, Gym, Morning, OpenClaw
- **16 posts scheduled over 4 days** (Apr 15–18, 4/day at 10:00, 13:00, 17:00, 20:00):
  - Apr 15: Budget, ChatGPT vs, Shopping, Why WhatsApp
  - Apr 16: Calendar, Price, Business, Privacy
  - Apr 17: Family, Research, Lawyer, Crypto
  - Apr 18: Small biz, Stocks, Anniversary, CTA (finale)
- **9 stories published** (FB + IG): All 9 story versions uploaded in 3 batches
- **Highlights** (to be created from Instagram app): מה זה?, רופאים, כסף, חיים, הצטרפו

### Design iterations (session 3)
- Fonts bumped ~15% across all post types (bubbles 27→30px, headers 48→54px, explainer h1 72→80px, body 34→38px)
- Logo moved to left side (more room since not stacked above headline)
- Header height optimized: tight top padding (24px), comfortable bottom (42px), minimal logo-to-headline gap (2px)
- Doctor post title changed: "המזכירה שלא הולכת הביתה" → "המזכירה שלא נחה"
- Multiple test uploads to Instagram for mobile review before finalizing

### Database (packages/db)
- Connected to **Supabase** (Frankfurt eu-central-1)
- Tables: `instances` (existing), `leads` (new)
- Drizzle migrations generated and pushed

### Orchestrator (apps/orchestrator)
- Moved from root to apps/orchestrator/
- Imports updated to use @agent-forall/db shared package
- Dockerfile needs updating for monorepo (not blocking — not deploying yet)

### Meta Business Suite (2026-04-14)
- **Business Portfolio**: "Agent For All" (business_id: 1586169975794890) — contains FB page + Instagram account
- **Facebook Page**: "Agent For All" (page_id: 1123533370833805, asset_id in MBS URLs) — Software Company, v4-espresso profile pic
- **Instagram**: @agentforall_il — connected to Facebook page, v4-espresso profile pic
- **Meta Pixel**: ID `803144279101703`, fires PageView + Lead events
- **MBS URL pattern**: `business.facebook.com/latest/home?asset_id=1123533370833805&business_id=1586169975794890`

### Remotion Video Project — `D:\Projects\remotion-vid` (session 4, 2026-04-16)
- **Purpose**: Create animated Reel ads using React-based video framework
- **Stack**: Remotion 4.0.445, React 19, TypeScript, Tailwind v4, @remotion/google-fonts (Heebo)
- **Key files**:
  - `src/AgentForAllReel.tsx` — Main composition (the published Reel)
  - `src/Root.tsx` — Composition registry (also has PhoneComparison, DemoReel for Compledio)
  - `remotion.config.ts` — Webpack config + Tailwind + xxhash64 hash workaround
  - `public/shaul-thumbnail.jpg` — Kan 11 "הבוט של שאול" thumbnail
  - `public/agentforall-logo.png` — Brand logo
  - `out/AgentForAllReel.mp4` — Rendered video (2.5MB, 16s)
  - `out/AgentForAllReel-thumbnail.jpg` — Still at frame 90 for thumbnail
- **AgentForAllReel composition** (480 frames, 30fps, 1080×1920):
  - Layout: Cream bg (#FBF8F3), top section with Kan 11 thumbnail + Hebrew text hierarchy, phone mockup at bottom
  - Hook: "כולם מדברים על בוט, סוכן, עוזר אישי?" → quote from Shaul → "אמרו לכם שזה מסובך?" → "אתם יכולים ליצור אחד. בדקות."
  - Phone: 440×880 WhatsApp chat mockup, agent "ג׳ארוויס 🤖" with personality
  - Chat scenario: User asks to plan family weekend → agent checks calendars, books Dead Sea hotel ₪1,200, messages wife, adds calendar+fuel reminder, finds Druze restaurant, closes with "שבת שלום!"
  - Animations: spring() entrance with staggered delays, frame-based interpolate() for chat scrolling
  - 700px dead zone spacer at bottom for Reel UI overlay
  - CTA: "הגיבו ״בוט״ או השאירו פרטים לרשימת ההמתנה"
- **KNOWN BUG**: Node.js 22 + webpack WASM hash crash (`TypeError: Cannot read properties of undefined (reading 'length')` in wasm-hash.js). Intermittent. `npx remotion render` more reliable than `npx remotion studio`. Workaround: `hashFunction: 'xxhash64'` in config + clear `node_modules/.cache`
- **Render command**: `npx remotion render AgentForAllReel --output=out/AgentForAllReel.mp4`
- **Still command**: `npx remotion still AgentForAllReel --frame=90 --output=out/AgentForAllReel-thumbnail.jpg`

### First Reel Ad — Published (session 4, 2026-04-16)
- **Published to**: Facebook Reels + Instagram Reels + Facebook Story (via Meta Business Suite)
- **Video**: AgentForAllReel.mp4 (16s, 1080×1920)
- **Thumbnail**: Custom still at frame 90 (all text visible + phone with first chat message)
- **Audio**: "Ser Campeao" by Tinho Menezes (from Meta's free audio library)
- **Caption** (no hashtags — user preference):
  ```
  כולם מדברים על סוכני AI — אבל מי באמת בנה אחד?

  תארגן לי סופ״ש עם המשפחה 👉 תוך שניות הוא בודק יומנים, מזמין צימר, מודיע לאשתי, ומוסיף תזכורת תדלוק.

  זה לא ChatGPT.
  זה סוכן אישי שחי בוואטסאפ שלכם.

  הגיבו ״בוט״ או השאירו פרטים ונחזור אליכם 👇

  🔗 agentforall.co.il
  ```
- **Settings**: Public, closed captions ON, remixing allowed, no paid boost yet
- **Publishing flow**: Used Playwright MCP plugin → Meta Business Suite → Create Reel
  - Files must be copied to `D:\Projects\agent-forall\` first (Playwright sandbox restriction)
  - Playwright MCP tools: browser_navigate, browser_click, browser_snapshot, browser_file_upload, browser_type, browser_wait_for

## Deployed to
- **GitHub**: https://github.com/Avi711/agentforall (pushed)
- **Vercel**: Domain connected, DATABASE_URL configured
- **Supabase**: Database live, leads table ready
- **Domain**: agentforall.co.il (connected)

## What's left

### Immediate
- [ ] Add `ADMIN_PASSWORD` (strong) to Vercel env vars
- [ ] Add `NEXT_PUBLIC_META_PIXEL_ID=803144279101703` to Vercel env vars → redeploy
- [ ] Complete Meta Pixel setup wizard (after deploy — needs to detect PageView)
- [ ] Reset Supabase password (it was shared in chat)
- [ ] Create Instagram highlights from published stories
- [ ] Boost the published Reel as a paid ad (set up targeting: Israel, Hebrew, 25-55, interests in AI/tech/productivity)
- [ ] Create more Reel variations (different use cases: doctor, business owner, crypto trader)
- [ ] Monitor Reel engagement and iterate on content

### Soon after
- [ ] Fix orchestrator Dockerfile for monorepo builds
- [ ] Add Google Analytics or Vercel Analytics
- [ ] A/B test different hero copy
- [ ] Add Hebrew Open Graph image for social sharing
- [ ] Set up email forwarding for hello@agentforall.co.il
- [ ] Verify Instagram account in Meta Business Suite
- [ ] Claim domain in Meta Business Suite (for better ad performance)

### Design & Content Preferences (learned session 4)
- **No "2024 AI slop"** — avoid dark gradients, generic tech aesthetics. Use clean cream backgrounds with bold typography
- **No camera** — Avraimi doesn't want to appear on camera. Use text/animation/mockups only
- **No hashtags** on social media captions
- **Don't change code without being asked** — if user asks "is this optimal?", answer first, don't change
- **Don't guess values** — research platform specs (dead zones, safe areas) and calculate optimal values
- **Hebrew RTL** — all user-facing content is Hebrew, right-to-left
- **WhatsApp chat mockups** are the primary creative format — show real agent power, not basic ChatGPT-level stuff
- **Agent personality** — bot responses should have humor/personality (emoji, slang, sass like "אמרתי לך 😏")

### Later (after validation)
- [ ] Build full dashboard in apps/web (user management, instance control)
- [ ] Move orchestrator from Docker to Kubernetes
- [ ] Implement actual agent provisioning flow (QR code, eSIM setup)
- [ ] Payment integration
