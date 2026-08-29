import io, sys, os, math
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf8")
OUT = os.environ.get("OUT") or os.path.dirname(os.path.abspath(__file__))

PANEL_H = 640  # phone + 3-line caption
CSS = """
* { margin:0; padding:0; box-sizing:border-box; font-family:"Segoe UI","Heebo",system-ui,sans-serif; }
html, body { overflow:hidden; margin:0; }
.stage { position:relative; overflow:hidden; background:#FBF8F3; }
.grid .strip { display:flex; flex-wrap:wrap; justify-content:center; gap:40px 60px; position:absolute; top:150px; right:0; left:0; margin:0 auto; }
.col .strip { display:grid; grid-template-columns:270px; justify-content:center; gap:36px; position:absolute; top:190px; right:0; left:0; }
.col .head { right:40px; left:40px; flex-wrap:wrap; gap:10px 14px; }
.col .title { font-size:22px; }
.col .b1, .col .b2 { width:260px; height:200px; }
.blob { position:absolute; border-radius:55% 45% 60% 50%/50% 60% 45% 55%; opacity:.9; z-index:0; }
.b1 { width:380px; height:300px; top:-150px; }
.b2 { width:380px; height:300px; bottom:-150px; }
.head { position:absolute; top:44px; right:60px; left:60px; display:flex; align-items:center; gap:18px; z-index:2; }
.chip { display:inline-flex; align-items:center; gap:8px; padding:8px 18px; border-radius:999px; font-size:20px; font-weight:700; color:#fff; }
.chip.ios { background:#1c1c1e; }
.chip.and { background:#1d7f4c; }
.chip svg { width:22px; height:22px; fill:#fff; }
.title { font-size:26px; color:#2C1810; font-weight:600; }
.strip { z-index:2; }
.panel { width:270px; display:flex; flex-direction:column; align-items:center; gap:16px; }
.ph { position:relative; width:250px; height:540px; border:8px solid #2C1810; border-radius:38px; overflow:hidden; box-shadow:0 26px 50px -28px rgba(44,24,16,.4); background:#fff; }
.ph.ios { background:#f2f2f7; }
.ph.oui { background:#f2f2f5; }
.sb { display:flex; justify-content:space-between; padding:8px 18px 0; font-size:11px; font-weight:600; color:#111; direction:ltr; }
.cap { text-align:center; font-size:16.5px; line-height:1.45; color:#3d2b22; max-width:270px; }
.cap b { color:#2C1810; }
.num { display:inline-flex; width:26px; height:26px; border-radius:50%; background:#C7522A; color:#fff; font-size:15px; font-weight:700; align-items:center; justify-content:center; margin-inline-end:6px; vertical-align:middle; }
.hl { position:relative; box-shadow:0 0 0 3px #C7522A, 0 0 0 8px rgba(199,82,42,.2) !important; border-radius:12px; z-index:3; }
.hl.round { border-radius:999px; }
.pin { position:absolute; width:32px; height:32px; border-radius:50%; background:#C7522A; color:#fff; font-size:16px; font-weight:700; display:flex; align-items:center; justify-content:center; box-shadow:0 6px 14px -4px rgba(44,24,16,.45); z-index:6; top:-14px; inset-inline-end:-10px; }
/* iOS */
.ios .ltitle { font-size:24px; font-weight:700; color:#111; padding:10px 16px 6px; }
.ios .ntitle { font-size:15px; font-weight:600; color:#111; text-align:center; padding:8px 16px 4px; position:relative; }
.ios .ntitle .back { position:absolute; inset-inline-start:12px; top:6px; color:#0a84ff; font-size:15px; font-weight:400; }
.ios .grp { background:#fff; border-radius:12px; margin:8px 12px; }
.ios .row { display:flex; align-items:center; gap:10px; padding:9px 12px; font-size:13px; color:#111; border-bottom:1px solid #eeeef0; }
.ios .grp .row:last-child { border-bottom:none; }
.ios .ico { width:24px; height:24px; border-radius:6px; flex:none; display:flex; align-items:center; justify-content:center; font-size:12px; color:#fff; }
.ios .chev { margin-inline-start:auto; color:#c4c4c8; font-size:14px; }
.ios .val { margin-inline-start:auto; color:#8e8e93; font-size:12.5px; }
.ios .tabbar { position:absolute; bottom:12px; inset-inline:12px; height:56px; border-radius:999px; background:rgba(255,255,255,.72); backdrop-filter:blur(8px); border:1px solid rgba(0,0,0,.06); box-shadow:0 8px 24px rgba(0,0,0,.12); display:flex; align-items:center; justify-content:space-around; padding:0 6px; }
.ios .tab { display:flex; flex-direction:column; align-items:center; gap:2px; font-size:9.5px; color:#8e8e93; width:44px; }
.ios .tab .i { width:20px; height:20px; border-radius:6px; background:#c7c7cc; }
.ios .tab.on { color:#1d7f4c; }
.ios .tab.on .i { background:#1d7f4c; }
.ios .prof { display:flex; align-items:center; gap:10px; padding:12px; }
.ios .av { width:44px; height:44px; border-radius:50%; background:#E8DCC8; color:#5C4033; display:flex; align-items:center; justify-content:center; font-size:19px; }
.ios .prof b { font-size:15px; color:#111; display:block; }
.ios .prof small { color:#8e8e93; font-size:11px; }
.ios .arrow { margin-inline-start:auto; width:26px; height:26px; border-radius:50%; background:#e5e5ea; color:#3a3a3c; display:flex; align-items:center; justify-content:center; font-size:12px; }
.ios .tabs { position:absolute; bottom:0; inset-inline:0; height:58px; background:#f8f8f8; border-top:1px solid #e2e2e4; display:flex; align-items:center; justify-content:space-around; padding:0 4px 4px; }
.ios .tabs .tab { display:flex; flex-direction:column; align-items:center; gap:3px; font-size:9px; color:#8e8e93; width:44px; position:relative; }
.ios .tabs .tab .i { width:20px; height:20px; border-radius:6px; background:#c7c7cc; }
.ios .tabs .tab .me { width:22px; height:22px; border-radius:50%; background:#E8DCC8; border:2px solid #111; }
.ios .tabs .tab.on { color:#111; font-weight:600; }
.ios .tg { margin-inline-start:auto; width:34px; height:20px; border-radius:10px; background:#e9e9eb; position:relative; flex:none; }
.ios .tg:after { content:""; position:absolute; top:2px; inset-inline-start:2px; width:16px; height:16px; border-radius:50%; background:#fff; box-shadow:0 1px 3px rgba(0,0,0,.25); }
.ios .tg.on { background:#34c759; }
.ios .tg.on:after { inset-inline-start:auto; inset-inline-end:2px; }
.ios .sec { padding:10px 18px 3px; font-size:11px; color:#6d6d72; }
.ios .wahead { position:relative; padding:12px 14px 0; }
.ios .wahead .tools { display:flex; justify-content:space-between; color:#555; font-size:14px; }
.ios .wahead .bub { margin:6px auto 0; width:max-content; max-width:180px; background:#fff; border-radius:14px; padding:5px 10px; font-size:10.5px; color:#333; box-shadow:0 2px 6px rgba(0,0,0,.08); }
.ios .bigav { width:64px; height:64px; border-radius:50%; background:#E8DCC8; margin:8px auto 0; display:flex; align-items:center; justify-content:center; font-size:26px; color:#5C4033; }
.ios .waname { text-align:center; font-size:18px; font-weight:700; color:#111; margin-top:6px; display:flex; justify-content:center; align-items:center; gap:6px; }
.ios .waname .plus { color:#1d9a5b; font-size:15px; font-weight:400; }
.ios .cancel { position:absolute; top:30px; inset-inline-start:14px; color:#0a84ff; font-size:13px; }
.ios .bigt { text-align:center; font-size:19px; font-weight:800; color:#111; padding:0 20px; line-height:1.25; }
.ios .desc { text-align:center; font-size:11.5px; color:#333; padding:8px 20px 0; line-height:1.5; }
.ios .ant { text-align:center; color:#0a84ff; font-size:22px; margin-top:48px; font-weight:700; letter-spacing:-2px; }
.ios .acct { margin:10px 12px 0; background:#fff; border-radius:14px; }
.ios .acct .row { border-bottom:1px solid #eeeef0; }
.ios .acct .row:last-child { border-bottom:none; }
.ios .chk { margin-inline-start:auto; width:20px; height:20px; border-radius:50%; background:#25D366; color:#fff; font-size:12px; display:flex; align-items:center; justify-content:center; }
.ios .plus2 { width:26px; height:26px; border-radius:50%; background:#f0f0f2; color:#333; display:flex; align-items:center; justify-content:center; font-size:16px; flex:none; }
/* Android: WhatsApp (Material 3, 2026) */
.and .abar { display:flex; align-items:center; gap:12px; padding:12px 14px 8px; }
.and .abar .brand { font-size:19px; font-weight:700; color:#1d7f4c; }
.and .abar .icons { margin-inline-start:auto; display:flex; gap:12px; align-items:center; color:#3c3c3c; font-size:16px; }
.and .abar .ttl { font-size:18px; font-weight:600; color:#111; }
.and .abar .back { color:#3c3c3c; font-size:18px; }
.and .dots { width:26px; height:26px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:18px; color:#3c3c3c; }
.and .srch { margin:4px 12px 8px; height:30px; border-radius:999px; background:#f0f0f0; display:flex; align-items:center; gap:8px; padding:0 12px; font-size:12px; color:#666; }
.and .chips { display:flex; gap:6px; padding:0 12px 6px; }
.and .chips span { border:1px solid #ddd; border-radius:999px; padding:3px 9px; font-size:10.5px; color:#333; }
.and .chips span.on { background:#d9f0e0; border-color:#d9f0e0; color:#0b3d2e; }
.and .chat { display:flex; align-items:center; gap:10px; padding:8px 14px; }
.and .chat .av { width:38px; height:38px; border-radius:50%; background:#e6e0d4; flex:none; }
.and .chat .l1 { width:90px; height:9px; border-radius:4px; background:#ddd7cb; margin-bottom:6px; }
.and .chat .l2 { width:130px; height:8px; border-radius:4px; background:#ece7dd; }
.and .nav { position:absolute; bottom:0; inset-inline:0; height:64px; background:#fff; border-top:1px solid #eee; display:flex; align-items:center; justify-content:space-around; }
.and .nav .t { display:flex; flex-direction:column; align-items:center; gap:3px; font-size:10px; color:#444; }
.and .nav .t .i { width:40px; height:22px; border-radius:11px; background:transparent; display:flex; align-items:center; justify-content:center; }
.and .nav .t .i span { width:16px; height:16px; border-radius:4px; background:#8a8a8a; display:block; }
.and .nav .t.on .i { background:#d9f0e0; }
.and .nav .t.on .i span { background:#1d7f4c; }
.and .nav .t.on { color:#111; font-weight:600; }
.and .fab { position:absolute; bottom:80px; inset-inline-end:16px; width:48px; height:48px; border-radius:14px; background:#25D366; box-shadow:0 8px 16px -6px rgba(0,0,0,.35); }
.and .menu { position:absolute; top:52px; inset-inline-end:8px; width:172px; background:#fff; border-radius:14px; box-shadow:0 10px 30px rgba(0,0,0,.2); padding:6px 0; z-index:4; }
.and .menu .mi { padding:9px 16px; font-size:13px; color:#111; white-space:nowrap; }
.and .row { display:flex; align-items:center; gap:12px; padding:10px 14px; font-size:13.5px; color:#111; }
.and .row .ic { width:26px; height:26px; flex:none; display:flex; align-items:center; justify-content:center; font-size:15px; color:#555; }
.and .row small { display:block; color:#7a7466; font-size:11px; margin-top:1px; }
.and .sec { padding:10px 14px 2px; font-size:11px; color:#5b6b73; }
.and .wahead { height:118px; background:#f6f1e7 radial-gradient(circle at 20% 30%, #e9e1d0 0 2px, transparent 3px) 0 0/22px 22px; position:relative; }
.and .wahead .tools { position:absolute; top:10px; inset-inline:12px; display:flex; justify-content:space-between; font-size:15px; color:#333; }
.and .wahead .bub { position:absolute; top:26px; inset-inline:0; text-align:center; }
.and .wahead .bub span { background:#fff; border-radius:999px; padding:3px 12px; font-size:11px; color:#333; box-shadow:0 2px 6px rgba(0,0,0,.08); }
.and .waav { position:absolute; bottom:-30px; inset-inline:0; display:flex; justify-content:center; }
.and .waav span { width:74px; height:74px; border-radius:50%; background:#E8DCC8; border:3px solid #fff; display:flex; align-items:center; justify-content:center; font-size:30px; color:#5C4033; }
.and .waname { text-align:center; margin-top:34px; font-size:16px; color:#111; display:flex; justify-content:center; align-items:center; gap:6px; }
.and .waname .plus { color:#1d7f4c; font-size:15px; }
.and .oneui { text-align:center; padding:26px 14px 14px; font-size:22px; font-weight:700; color:#111; }
.and .ocard { background:#fff; border-radius:16px; margin:6px 10px; }
.and .ocard .row { border-bottom:1px solid #f0f0f2; padding:9px 12px; font-size:13px; }
.and .ocard .row:last-child { border-bottom:none; }
.and .ocard .ic { width:24px; height:24px; border-radius:50%; color:#fff; font-size:12px; }
.and .oav { width:36px; height:36px; border-radius:50%; background:#9db4ea; flex:none; }
.and .osearch { position:absolute; bottom:12px; inset-inline:30px; height:36px; border-radius:999px; background:#fff; box-shadow:0 4px 14px rgba(0,0,0,.12); display:flex; align-items:center; justify-content:center; gap:8px; font-size:13px; color:#333; }
.and .tg { margin-inline-start:auto; width:32px; height:18px; border-radius:9px; background:#c9c9cf; position:relative; flex:none; }
.and .tg:after { content:""; position:absolute; top:2px; inset-inline-start:2px; width:14px; height:14px; border-radius:50%; background:#fff; }
.and .tg.on { background:#3b7de0; }
.and .tg.on:after { inset-inline-start:auto; inset-inline-end:2px; }
.and .chev { margin-inline-start:auto; color:#999; font-size:13px; }
.and .optt { text-align:center; padding:0 18px; font-size:17px; font-weight:700; color:#111; line-height:1.35; }
.and .simic { width:36px; height:36px; margin:22px auto 12px; border:3px solid #3b7de0; border-radius:8px; position:relative; }
.and .simic:after { content:""; position:absolute; inset:9px; border:3px solid #3b7de0; border-radius:3px; }
.and .opt { margin:10px 16px 0; background:#f2f2f5; border-radius:999px; padding:12px 14px; font-size:12.5px; color:#111; display:flex; align-items:center; gap:10px; line-height:1.3; }
.and .opt .oi { width:20px; flex:none; text-align:center; font-size:15px; }
.and .bigt { padding:22px 18px 8px; font-size:19px; color:#333; text-align:center; }
.and .desc { padding:0 22px; font-size:11.5px; color:#555; text-align:center; line-height:1.55; }
.and .desc a { color:#1d7f4c; font-weight:700; }
.and .ctry { margin:18px 46px 0; border-bottom:2px solid #1d7f4c; padding:6px 4px; font-size:13.5px; text-align:center; color:#111; }
.and .next { position:absolute; bottom:16px; inset-inline:18px; height:38px; border-radius:999px; background:#e9e9e9; color:#9a9a9a; display:flex; align-items:center; justify-content:center; font-size:13px; }
.and .acct { margin:12px 12px 0; border:1.5px solid #e2e2e2; border-radius:14px; }
.and .acct .row { border-bottom:1px solid #eee; }
.and .acct .row:last-child { border-bottom:none; }
.and .chk { margin-inline-start:auto; width:22px; height:22px; border-radius:50%; background:#25D366; color:#fff; font-size:13px; display:flex; align-items:center; justify-content:center; }
.and .logout { color:#e11d48; }
/* shared */
.sheet { position:absolute; inset-inline:6px; bottom:6px; background:#fff; border-radius:18px; box-shadow:0 -8px 30px rgba(0,0,0,.2); padding:8px 0 12px; z-index:4; }
.sheet .grab { width:36px; height:4px; border-radius:2px; background:#d8d8d8; margin:0 auto 10px; }
.sheet .txt { padding:0 14px; font-size:11.5px; color:#333; line-height:1.5; }
.sheet .row { padding:10px 12px; font-size:13px; display:flex; align-items:center; gap:10px; color:#111; }
.sheet .plus { width:30px; height:30px; border-radius:50%; background:#eef0f2; color:#333; display:flex; align-items:center; justify-content:center; font-size:18px; flex:none; }
.dim { position:absolute; inset:0; background:rgba(0,0,0,.35); z-index:3; }
.verify { padding:22px 16px; text-align:center; }
.verify .t { font-size:14px; font-weight:600; color:#111; margin-bottom:6px; }
.verify .d { font-size:11px; color:#7a7466; line-height:1.5; margin-bottom:18px; }
.field { display:flex; gap:6px; direction:ltr; padding:6px 8px; }
.field .cc { width:62px; border-bottom:2px solid #1d7f4c; padding:6px 2px; font-size:13px; text-align:center; color:#111; }
.field .nm { flex:1; border-bottom:2px solid #1d7f4c; padding:6px 2px; font-size:13px; text-align:center; color:#111; letter-spacing:1px; }
.field .nm.empty { color:#8a8a8a; letter-spacing:0; direction:rtl; }
.note { margin:16px 12px 0; background:#FFF0E9; border:1.5px solid #C7522A; color:#2C1810; border-radius:12px; padding:9px 10px; font-size:11.5px; font-weight:600; text-align:center; line-height:1.45; }
.cam { position:absolute; inset:0; background:#1b1b1b; display:flex; align-items:center; justify-content:center; }
.cam .frame { width:150px; height:150px; position:relative; }
.cam .frame:before, .cam .frame:after, .cam .c1, .cam .c2 { content:""; position:absolute; width:28px; height:28px; border:4px solid #fff; }
.cam .frame:before { top:0; left:0; border-right:none; border-bottom:none; border-radius:8px 0 0 0; }
.cam .frame:after { top:0; right:0; border-left:none; border-bottom:none; border-radius:0 8px 0 0; }
.cam .c1 { bottom:0; left:0; border-right:none; border-top:none; border-radius:0 0 0 8px; }
.cam .c2 { bottom:0; right:0; border-left:none; border-top:none; border-radius:0 0 8px 0; }
.cam .qr { position:absolute; inset:30px; background:conic-gradient(#fff 0 25%, transparent 0 50%, #fff 0 75%, transparent 0) 0 0/16px 16px; opacity:.9; }
.cam .hint { position:absolute; bottom:70px; inset-inline:0; text-align:center; color:#fff; font-size:12px; }
.cam .top { position:absolute; top:0; inset-inline:0; padding:14px; color:#fff; font-size:13px; font-weight:600; text-align:center; }
.cam .tag { position:absolute; bottom:110px; inset-inline:0; display:flex; justify-content:center; }
.cam .tag span { background:#C7522A; color:#fff; font-size:11.5px; font-weight:700; padding:6px 12px; border-radius:999px; }
.cam .src { position:absolute; top:44px; inset-inline:0; text-align:center; color:#d9d3c7; font-size:11px; }
.ok { display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; gap:12px; }
.ok .ring { width:64px; height:64px; border-radius:50%; background:#25D366; color:#fff; font-size:34px; display:flex; align-items:center; justify-content:center; }
.ok .t { font-size:15px; font-weight:600; color:#111; }
.ok .d { font-size:11.5px; color:#7a7466; text-align:center; padding:0 20px; line-height:1.5; }
.laptop { width:120px; height:78px; margin:14px auto 8px; border:3px solid #c9c2b4; border-radius:10px; position:relative; background:#faf7f1; }
.laptop:after { content:""; position:absolute; inset-inline:-14px; bottom:-10px; height:8px; background:#c9c2b4; border-radius:0 0 8px 8px; }
.laptop .qr { width:52px; height:52px; margin:9px auto; background:conic-gradient(#2C1810 0 25%, transparent 0 50%, #2C1810 0 75%, transparent 0) 0 0/16px 16px; opacity:.85; }
.gbtn { display:inline-block; background:#25D366; color:#0b3d2e; font-weight:700; font-size:13px; border-radius:999px; padding:10px 22px; margin-top:10px; }
.center { padding:20px 16px; text-align:center; }
.center .t { font-size:14px; font-weight:600; color:#111; margin-bottom:6px; }
.center .d { font-size:11px; color:#7a7466; line-height:1.5; }
"""

APPLE = '<svg viewBox="0 0 24 24"><path d="M16.4 12.7c0-2.5 2-3.7 2.1-3.8-1.2-1.7-3-1.9-3.6-2-1.5-.2-3 .9-3.8.9-.8 0-2-.9-3.3-.9-1.7 0-3.3 1-4.2 2.5-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.6 1.3-.1 1.8-.8 3.3-.8s2 .8 3.3.8c1.4 0 2.3-1.3 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9-.1 0-2.8-1.1-2.8-4.1zM14 5.4c.7-.8 1.2-2 1-3.1-1 0-2.2.7-2.9 1.5-.6.7-1.2 1.9-1 3 1.1.1 2.2-.6 2.9-1.4z"/></svg>'
ANDROID = '<svg viewBox="0 0 24 24"><path d="M17.5 8.3l1.6-2.8c.1-.2 0-.4-.1-.5-.2-.1-.4 0-.5.1l-1.6 2.9c-1.3-.6-2.7-.9-4.3-.9s-3 .3-4.3.9L6.7 5.1c-.1-.2-.3-.2-.5-.1-.2.1-.2.3-.1.5l1.6 2.8C4.9 9.8 3 12.6 3 15.8h18c0-3.2-1.9-6-4.5-7.5zM8 13.2c-.5 0-.9-.4-.9-.9s.4-.9.9-.9.9.4.9.9-.4.9-.9.9zm8 0c-.5 0-.9-.4-.9-.9s.4-.9.9-.9.9.4.9.9-.4.9-.9.9z"/></svg>'

def pin(n, extra=""):
    return f'<span class="pin" style="{extra}">{n}</span>'

def page(kind, title, panels, out, blobs=("#C7522A", "#8FAE94")):
    for layout in ("grid", "col"):
        render(kind, title, panels, out.replace(".html", f"-{layout}.html"), blobs, layout)

def render(kind, title, panels, out, blobs, layout):
    chip_cls = "ios" if kind == "ios" else "and"
    chip_txt = "iPhone" if kind == "ios" else "Android"
    icon = APPLE if kind == "ios" else ANDROID
    b1, b2 = blobs
    n = len(panels)
    if layout == "grid":
        cols = 2 if n <= 4 else 3
        size = f"width:1200px; height:{150 + math.ceil(n / cols) * 665}px;"
        strip_style = f"max-width:{cols * 270 + (cols - 1) * 60}px;"
    else:
        size = f"width:640px; height:{190 + n * PANEL_H + (n - 1) * 36}px;"
        strip_style = ""
    strip = "".join(
        f'<div class="panel"><div class="ph {chip_cls} {extra}">{body}</div><p class="cap"><span class="num">{i+1}</span>{cap}</p></div>'
        for i, (body, cap, *rest) in enumerate(panels) for extra in [rest[0] if rest else ""]
    )
    html = f"""<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><style>{CSS}</style></head><body>
<div class="stage {layout}" style="{size}">
<div class="blob b1" style="background:{b1}; inset-inline-end:-130px;"></div>
<div class="blob b2" style="background:{b2}; inset-inline-start:-130px;"></div>
<div class="head"><span class="chip {chip_cls}">{icon}{chip_txt}</span><span class="title">{title}</span></div>
<div class="strip" style="{strip_style}">{strip}</div>
</div>
</body></html>"""
    with open(os.path.join(OUT, out), "w", encoding="utf8") as f:
        f.write(html)
    print("wrote", out)

IOS_SB = '<div class="sb"><span>9:41</span><span>●●● ⌔ ▮</span></div>'
AND_SB = '<div class="sb"><span>12:30</span><span>▲ ▮</span></div>'
NAME = "דנה כהן"
NUM = "+972 5X-XXX-XXXX"
AND_MENU = ["קבוצה חדשה", "רשימות תפוצה", "מכשירים מקושרים", "מסומנים בכוכב", "סימון שכל ההודעות נקראו", "הגדרות"]

def ios_tabs(on="chats", pin_me=None):
    tabs = [("עדכונים", "updates"), ("שיחות", "calls"), ("קהילות", "comm"), ("צ'אטים", "chats"), ("את/ה", "me")]
    out = '<div class="tabs">'
    for t, k in tabs:
        active = "on" if k == on else ""
        if k == "me":
            icon = '<span class="me ' + ("hl round" if pin_me else "") + '"></span>'
            p = pin(pin_me, "top:-24px; inset-inline-end:-2px;") if pin_me else ""
        else:
            icon = '<span class="i"></span>'; p = ""
        out += f'<div class="tab {active}">{icon}{t}{p}</div>'
    return out + '</div>'

def and_nav():
    return ('<div class="nav">'
            '<div class="t on"><span class="i"><span></span></span>צ\'אטים</div>'
            '<div class="t"><span class="i"><span></span></span>עדכונים</div>'
            '<div class="t"><span class="i"><span></span></span>קהילות</div>'
            '<div class="t"><span class="i"><span></span></span>שיחות</div></div>')

def and_chats(hl_item=None, pin_n=1):
    body = (AND_SB + '<div class="abar"><span class="brand">WhatsApp</span><span class="icons">📷<span class="dots">⋮</span></span></div>'
            '<div class="srch">🔍 חיפוש…</div>'
            '<div class="chips"><span class="on">הכל</span><span>לא נקראו</span><span>מועדפים</span><span>קבוצות</span></div>'
            + "".join('<div class="chat"><div class="av"></div><div><div class="l1"></div><div class="l2"></div></div></div>' for _ in range(6))
            + '<div class="fab"></div>' + and_nav())
    if hl_item:
        body += '<div class="menu">' + "".join(
            f'<div class="mi {"hl" if m==hl_item else ""}" style="{"margin:4px 8px;" if m==hl_item else ""}">{m}{pin(pin_n) if m==hl_item else ""}</div>' for m in AND_MENU) + '</div>'
    return body

def and_wa_settings(hl=None, pin_n=2, name=NAME, sub=None):
    rows = [("👑", "מינויים", "סקירת הטבות הפרימיום"), ("💻", "מכשירים מקושרים", "שימוש ב-WhatsApp במכשירים אחרים"),
            ("🔑", "חשבון", "התראות אבטחה, שינוי המספר"), ("🔒", "פרטיות", "חשבונות חסומים, הודעות נעלמות"),
            ("📋", "רשימות", "ניהול אנשים וקבוצות"), ("💬", "צ'אטים", "היסטוריית הצ'אטים, גיבוי")]
    return (AND_SB + '<div class="wahead"><div class="tools"><span>✎ ▦ 🔍</span><span>→</span></div><div class="bub"><span>עסוק/ה</span></div><div class="waav"><span>ד</span></div></div>'
            f'<div class="waname"><span>{name}</span><span class="plus">⊕</span></div>'
            + (f'<div style="text-align:center;font-size:11px;color:#7a7466;margin-top:2px">{sub}</div>' if sub else '')
            + '<div style="height:8px"></div>'
            + "".join(f'<div class="row {"hl" if t==hl else ""}" style="{"margin:3px 6px;" if t==hl else ""}"><span class="ic">{ic}</span><div>{t}<small>{s}</small></div>{pin(pin_n) if t==hl else ""}</div>' for ic, t, s in rows))

def and_account(hl=False, pin_n=3):
    return (AND_SB + '<div class="abar"><span class="back">→</span><span class="ttl">חשבון</span><span class="icons"><span class="dots">⋮</span></span></div>'
            f'<div class="row {"hl" if hl else ""}" style="{"margin:3px 6px;" if hl else ""}"><span class="ic">👤<sup style="font-size:9px">+</sup></span><div>הוספת חשבון</div>{pin(pin_n) if hl else ""}</div>'
            '<div class="sec">התחברות ואבטחה</div>'
            '<div class="row"><span class="ic">🔑</span><div>מפתחות גישה</div></div><div class="row"><span class="ic">✉</span><div>כתובת אימייל</div></div>'
            '<div class="row"><span class="ic">🔒</span><div>אימות דו-שלבי</div></div><div class="row"><span class="ic">🛡</span><div>התראות אבטחה</div></div>'
            '<div class="sec">החשבון שלך</div>'
            '<div class="row"><span class="ic">@</span><div>שם משתמש</div></div><div class="row"><span class="ic">📞</span><div>שינוי מספר הטלפון</div></div>'
            '<div class="row logout"><span class="ic logout">⇥</span><div>התנתקות</div></div>')

def and_add_sheet(pin_n=4):
    return ('<div class="dim"></div><div class="sheet"><div class="grab"></div>'
            '<div class="txt">כדי לעבור בקלות בין החשבונות שלך, אפשר להוסיף חשבון WhatsApp אחר.</div>'
            f'<div class="acct"><div class="row"><span class="oav" style="background:#E8DCC8"></span><div><b>{NAME}</b><small style="display:block;color:#7a7466;font-size:11px" dir="ltr">{NUM}</small></div><span class="chk">✓</span></div>'
            f'<div class="row hl" style="margin:4px 8px;"><span class="plus">＋</span><b>הוספת חשבון WhatsApp</b>{pin(pin_n)}</div></div></div>')

def and_number(pin_n=5):
    return (AND_SB + '<div class="abar"><span class="back">→</span><span class="icons"><span class="dots">⋮</span></span></div>'
            '<div class="bigt">צריך להזין מספר טלפון</div>'
            '<div class="desc">WhatsApp צריכה לאמת את מספר הטלפון שלך. <a>מה המספר שלי?</a></div>'
            '<div class="ctry">ישראל ▾</div>'
            f'<div class="field hl" style="margin:10px 34px 0;border-radius:10px;"><div class="cc">+ 972</div><div class="nm empty">מספר טלפון</div>{pin(pin_n, "top:-16px; inset-inline-end:auto; inset-inline-start:-10px;")}</div>'
            '<div class="note">כאן מזינים את המספר החדש —<br>לא את המספר האישי שלכם!</div>'
            '<div class="next">הבא</div>')

def ios_chats(pin_me=None):
    return (IOS_SB + '<div class="ltitle">צ\'אטים</div>'
            + "".join('<div class="chat" style="display:flex;align-items:center;gap:10px;padding:9px 14px;"><div style="width:40px;height:40px;border-radius:50%;background:#e6e0d4;flex:none"></div><div><div style="width:90px;height:9px;border-radius:4px;background:#ddd7cb;margin-bottom:6px"></div><div style="width:130px;height:8px;border-radius:4px;background:#ece7dd"></div></div></div>' for _ in range(6))
            + ios_tabs("chats", pin_me))

def ios_profile(hl=None, pin_n=2):
    g1 = ["מינויים", "רשימות", "הודעות בתפוצה רחבה", "הודעות מסומנות בכוכב", "מכשירים מקושרים"]; g2 = ["חשבון", "פרטיות"]
    def rows(items):
        return "".join(f'<div class="row {"hl" if t == hl else ""}" style="{"margin:3px 6px;" if t == hl else ""}">{t}<span class="chev">‹</span>{pin(pin_n) if t == hl else ""}</div>' for t in items)
    return (IOS_SB + '<div class="wahead"><div class="tools"><span>✎ ▦</span><span>🔍</span></div><div class="bub">היי! אפשר לדבר איתי ב-WhatsApp.</div></div>'
            f'<div class="bigav">ד</div><div class="waname"><span>{NAME}</span><span class="plus">⊕</span></div>'
            f'<div class="grp">{rows(g1)}</div><div class="grp">{rows(g2)}</div>' + ios_tabs("me"))

def ios_account(hl=False, pin_n=3):
    def r(t): return f'<div class="row">{t}<span class="chev">‹</span></div>'
    return (IOS_SB + '<div class="ntitle"><span class="back" style="inset-inline-start:auto;inset-inline-end:12px;color:#111">‹</span>חשבון</div>'
            f'<div class="grp {"hl" if hl else ""}" style="{"margin:8px 12px;" if hl else ""}">{r("הוספת חשבון")}{pin(pin_n) if hl else ""}</div>'
            '<div class="sec">התחברות ואבטחה</div><div class="grp">' + r("מפתחות גישה") + r("כתובת האימייל") + r("אימות דו-שלבי") + r("התראות אבטחה") + '</div>'
            '<div class="sec">החשבון שלך</div><div class="grp">' + r("שם משתמש") + r("שינוי מספר הטלפון") + r("בקשת פרטי חשבון") + r("מחיקת החשבון") + '</div>' + ios_tabs("me"))

def ios_add_sheet(pin_n=4):
    return ('<div class="dim"></div><div class="sheet" style="background:#f2f2f7;"><div class="grab"></div>'
            f'<div class="acct"><div class="row"><span class="av" style="width:34px;height:34px;font-size:15px;">ד</span><div><b style="font-size:13px;display:block">{NAME}</b><small style="color:#8e8e93;font-size:11px" dir="ltr">{NUM}</small></div><span class="chk">✓</span></div>'
            f'<div class="row hl" style="margin:4px 8px;background:#fff;"><span class="plus2">＋</span><b>הוספת חשבון WhatsApp</b>{pin(pin_n)}</div></div>'
            '<div class="sec">פרופילים אחרים</div><div class="acct"><div class="row"><span class="plus2">＋</span>הוספה של קישור לאינסטגרם</div></div></div>')

def verify_panel(kind, n=4):
    head = ('<div class="ntitle">אימות המספר</div>' if kind == "ios" else '<div class="abar"><span class="back">→</span><span class="ttl">הזינו את מספר הטלפון</span></div>')
    return ((IOS_SB if kind=="ios" else AND_SB) + head +
            '<div class="verify"><div class="t">הזינו את מספר הטלפון החדש</div><div class="d">וואטסאפ תשלח SMS עם קוד אימות למספר הזה</div>'
            '<div class="field hl" style="border-radius:10px;"><div class="cc">+972</div><div class="nm">55 123 4567</div>' + pin(n, "top:-16px; inset-inline-end:auto; inset-inline-start:-10px;") + '</div></div>'
            '<div class="note">המספר החדש —<br>לא המספר האישי שלכם!</div>')

SCAN_CARRIER = ('<div class="cam"><div class="top">סריקת קוד ה-eSIM</div><div class="src">✉ הקוד שקיבלתם מחברת הסלולר במייל / SMS</div><div class="frame"><div class="qr"></div><span class="c1"></span><span class="c2"></span></div><div class="tag"><span>קוד מהספק — בהגדרות הטלפון</span></div><div class="hint">כוונו את המצלמה לקוד</div></div>')
SCAN_DASH = ('<div class="cam"><div class="top">סריקה מתוך וואטסאפ</div><div class="src">💻 הקוד מופיע במסך המחשב, בלוח הבקרה</div><div class="frame"><div class="qr"></div><span class="c1"></span><span class="c2"></span></div><div class="tag"><span>הקוד של Agent For All — לא של הספק</span></div><div class="hint">כוונו את המצלמה למסך</div></div>')
DONE = ('<div class="ok"><div class="ring">✓</div><div class="t">הסוכן מחובר</div><div class="d">מעכשיו כותבים לו מהוואטסאפ <b>האישי</b> שלכם, כמו לכל איש קשר</div></div>')

# ── A. eSIM on iPhone (traced from real iOS screens)
page("ios", "שלב 1 · מוסיפים את המספר החדש כ-eSIM", [
    (IOS_SB + '<div class="ltitle">הגדרות</div>'
     f'<div class="grp"><div class="prof" style="padding:9px 12px"><span class="av" style="background:#8e8e93;color:#fff;font-size:15px">דכ</span><div><b style="font-size:14px">{NAME}</b><small>Apple ID, iCloud, מדיה ורכישות</small></div><span class="chev">‹</span></div></div>'
     '<div class="grp"><div class="row"><span class="ico" style="background:#ff9500">✈</span>מצב טיסה<span class="tg"></span></div>'
     '<div class="row"><span class="ico" style="background:#0a84ff">◉</span>רשת אלחוטית<span class="val">הבית</span></div>'
     '<div class="row"><span class="ico" style="background:#0a84ff">✱</span>Bluetooth<span class="val">פעיל</span></div>'
     '<div class="row hl" style="margin:3px 6px;"><span class="ico" style="background:#34c759">ψ</span>סלולרי<span class="chev">‹</span>' + pin(1) + '</div>'
     '<div class="row"><span class="ico" style="background:#34c759">⇅</span>נקודת גישה אישית<span class="chev">‹</span></div></div>'
     '<div class="grp"><div class="row"><span class="ico" style="background:#ff3b30">🔔</span>עדכונים<span class="chev">‹</span></div><div class="row"><span class="ico" style="background:#ff2d55">🔊</span>צלילים ורטט<span class="chev">‹</span></div></div>',
     'פותחים את <b>הגדרות</b> של האייפון ולוחצים על <b>סלולרי</b>'),
    (IOS_SB + '<div class="ntitle"><span class="back">‹ הגדרות</span>סלולרי</div>'
     '<div class="grp"><div class="row">נתונים סלולריים<span class="tg on"></span></div><div class="row">אפשרויות נתונים סלולריים<span class="val">נדידה כבוי ‹</span></div><div class="row">נקודת גישה אישית<span class="val">פעילה ‹</span></div></div>'
     '<div class="sec">המספר הראשי</div>'
     '<div class="grp"><div class="row">בחירת רשת<span class="val">אוטומטי ‹</span></div><div class="row">קוד PIN<span class="chev">‹</span></div><div class="row">יישומי SIM<span class="chev">‹</span></div></div>'
     '<div class="grp hl" style="margin:10px 12px;"><div class="row" style="color:#0a84ff;font-weight:600">הוספת eSIM</div>' + pin(2) + '</div>',
     'גוללים למטה ולוחצים על <b>הוספת eSIM</b>'),
    (IOS_SB + '<span class="cancel">ביטול</span><div class="ant">((·))</div><div class="bigt">הגדרת נתונים סלולריים</div>'
     '<div class="desc">באפשרותך להעביר מספר טלפון מ-iPhone סמוך, או לסרוק קוד QR שהתקבל מהמפעיל הסלולרי שלך.</div>'
     '<div style="text-align:center;color:#0a84ff;font-size:11.5px;margin-top:8px">לפרטים נוספים…</div>'
     '<div class="grp" style="margin-top:22px"><div class="row"><span style="color:#0a84ff">⇥</span>העברה מ-iPhone סמוך<span class="chev">‹</span></div>'
     '<div class="row hl" style="margin:3px 6px;"><span style="color:#0a84ff">▦</span>שימוש בקוד QR<span class="chev">‹</span>' + pin(3) + '</div></div>',
     'בוחרים <b>שימוש בקוד QR</b> — הקוד מגיע מהספק במייל או ב-SMS'),
    (SCAN_CARRIER, 'סורקים את <b>הקוד מהספק</b> (הגיע במייל/SMS); ה-eSIM מופעל תוך דקה'),
], "fig-esim-iphone.html", ("#8FAE94", "#C7522A"))

# ── B. eSIM on Samsung (One UI 8)
page("and", "שלב 1 · מוסיפים את המספר החדש כ-eSIM", [
    (AND_SB + '<div class="oneui">הגדרות</div>'
     f'<div class="ocard"><div class="row"><span class="oav"></span><div><b>{NAME}</b><small style="color:#3b6fd8">כניסה בטוחה ומהירה</small></div></div></div>'
     '<div class="ocard"><div class="row hl" style="margin:3px 6px;"><span class="ic" style="background:#3b7de0">◉</span><div>חיבורים</div>' + pin(1) + '</div>'
     '<div class="row"><span class="ic" style="background:#3b7de0">▭</span><div>מכשירים מחוברים</div></div></div>'
     '<div class="ocard"><div class="row"><span class="ic" style="background:linear-gradient(135deg,#3b7de0,#a855f7)">✦</span><div>Galaxy AI</div></div>'
     '<div class="row"><span class="ic" style="background:#7c5cff">◔</span><div>מצבים ושגרות</div></div>'
     '<div class="row"><span class="ic" style="background:#7c5cff">🔊</span><div>צלילים ורטט</div></div>'
     '<div class="row"><span class="ic" style="background:#f0885a">🔔</span><div>התראות</div></div></div>'
     '<div class="osearch">🔍 חיפוש</div>',
     'פותחים את <b>הגדרות</b> של הטלפון ולוחצים על <b>חיבורים</b>', "oui"),
    (AND_SB + '<div class="abar"><span class="back">›</span><span class="ttl">חיבורים</span></div>'
     '<div class="ocard"><div class="row"><div>Wi-Fi</div><span class="tg"></span></div><div class="row"><div>Bluetooth</div><span class="tg on"></span></div>'
     '<div class="row"><div>NFC ותשלומים ללא מגע</div><span class="tg on"></span></div></div>'
     '<div class="ocard"><div class="row"><div>מצב \'טיסה\'</div><span class="tg"></span></div></div>'
     '<div class="ocard"><div class="row hl" style="margin:3px 6px;"><div>מנהל SIM</div>' + pin(2) + '</div>'
     '<div class="row"><div>רשתות תקשורת סלולרית</div></div><div class="row"><div>שימוש בנתונים</div></div><div class="row"><div>נתב אלחוטי נייד וחיבור בין מכשירים</div></div></div>'
     '<div class="ocard"><div class="row"><div>הגדרות חיבור נוספות</div></div></div>',
     'לוחצים על <b>מנהל SIM</b>', "oui"),
    (AND_SB + '<div class="abar"><span class="back">›</span><span class="ttl">מנהל SIM</span></div>'
     '<div class="ocard"><div class="row"><span class="ic" style="background:#3b7de0">1</span><div>SIM 1<small>המספר האישי</small></div><span class="tg on"></span></div>'
     '<div class="row hl" style="margin:3px 6px;"><span class="ic" style="background:transparent;color:#1d9a5b;font-size:22px">＋</span><div>הוסף eSIM<small>הורד כרטיס eSIM על מנת להתחבר לרשתות סלולריות ללא כרטיס SIM פיזי.</small></div>' + pin(3) + '</div></div>'
     '<div class="sec">כרטיסי SIM מועדפים</div>'
     '<div class="ocard"><div class="row"><div>שיחות<small style="color:#3b6fd8">SIM 1</small></div></div><div class="row"><div>הודעות<small style="color:#3b6fd8">SIM 1</small></div></div></div>',
     'לוחצים על <b>הוסף eSIM</b>', "oui"),
    (AND_SB + '<div class="simic"></div><div class="optt">בחר כיצד להוסיף את eSIM שלך</div><div style="height:26px"></div>'
     '<div class="opt"><span class="oi" style="color:#3ddc84">🤖</span>העבר כרטיס SIM מטלפון Galaxy/Android</div>'
     '<div class="opt"><span class="oi"></span>העברת SIM מ-iPhone</div>'
     '<div class="opt hl round" style="margin-top:14px"><span class="oi" style="color:#3b7de0">▦</span><b>סרוק קוד QR</b>' + pin(4, "top:-14px; inset-inline-end:-4px;") + '</div>',
     'בוחרים <b>סרוק קוד QR</b>'),
    (SCAN_CARRIER, 'סורקים את <b>הקוד מהספק</b> (הגיע במייל/SMS); ה-eSIM מופעל תוך דקה'),
], "fig-esim-android.html", ("#C7522A", "#8FAE94"))

# ── C. add account on Android (WhatsApp 2026)
page("and", "שלב 2 · פותחים חשבון וואטסאפ שני על המספר החדש", [
    (and_chats("הגדרות", 1), 'בוואטסאפ לוחצים על <b>⋮</b> (שלוש הנקודות למעלה) ובוחרים <b>הגדרות</b>'),
    (and_wa_settings("חשבון", 2), 'לוחצים על <b>חשבון</b>'),
    (and_account(True, 3), 'לוחצים על <b>הוספת חשבון</b> (השורה הראשונה)'),
    (and_account(False) + and_add_sheet(4), 'בחלון שנפתח לוחצים על <b>הוספת חשבון WhatsApp</b>'),
    (and_number(5), 'מזינים את <b>המספר החדש</b> ולוחצים <b>הבא</b>; קוד האימות מגיע ב-SMS ל-eSIM החדש'),
], "fig-add-android.html", ("#8FAE94", "#C7522A"))

# ── D. add account on iPhone (traced from real WhatsApp iOS screens)
page("ios", "שלב 2 · פותחים חשבון וואטסאפ שני על המספר החדש", [
    (ios_chats(pin_me=1), 'בוואטסאפ לוחצים על <b>את/ה</b> (הלשונית עם התמונה שלכם, בפינה)'),
    (ios_profile("חשבון", 2), 'לוחצים על <b>חשבון</b>'),
    (ios_account(True, 3), 'לוחצים על <b>הוספת חשבון</b> (השורה הראשונה)'),
    (ios_account(False) + ios_add_sheet(4), 'בחלון שנפתח לוחצים על <b>הוספת חשבון WhatsApp</b>'),
    (verify_panel("ios", 5), 'מזינים את <b>המספר החדש</b>; קוד האימות מגיע ב-SMS ל-eSIM החדש'),
], "fig-add-iphone.html", ("#C7522A", "#8FAE94"))

# ── E. link on Android
LINKED_BODY_AND = (AND_SB + '<div class="abar"><span class="back">→</span><span class="ttl">מכשירים מקושרים</span></div>'
    '<div class="center"><div class="laptop"><div class="qr"></div></div><div class="t">השתמשו ב-WhatsApp במכשירים אחרים</div><div class="d">סרקו את קוד ה-QR שמופיע בלוח הבקרה של Agent For All</div>'
    '<span class="gbtn hl round" style="position:relative;">קישור מכשיר' + pin(2, "top:-16px; inset-inline-end:-14px;") + '</span></div>')

page("and", "שלב 3 · מחברים את הסוכן — בוואטסאפ של המספר החדש", [
    (and_chats("מכשירים מקושרים", 1),
     'בחשבון של <b>המספר החדש</b>: לוחצים על <b>⋮</b> ובוחרים <b>מכשירים מקושרים</b>'),
    (LINKED_BODY_AND, 'לוחצים על <b>קישור מכשיר</b>'),
    (SCAN_DASH, 'סורקים את <b>הקוד שלנו</b> — זה שמופיע במסך המחשב, בלוח הבקרה של Agent For All'),
    (DONE, 'תוך כמה שניות הסטטוס בלוח הבקרה משתנה ל<b>מחובר</b>'),
], "fig-link-android.html", ("#8FAE94", "#C7522A"))

# ── F. link on iPhone
page("ios", "שלב 3 · מחברים את הסוכן — בוואטסאפ של המספר החדש", [
    (ios_profile("מכשירים מקושרים", 1), 'בחשבון של <b>המספר החדש</b>: לשונית <b>את/ה</b> ← <b>מכשירים מקושרים</b>'),
    (IOS_SB + '<div class="ntitle"><span class="back" style="inset-inline-start:auto;inset-inline-end:12px;color:#111">‹</span>מכשירים מקושרים</div>'
     '<div class="center"><div class="laptop"><div class="qr"></div></div><div class="t">השתמשו ב-WhatsApp במכשירים אחרים</div><div class="d">סרקו את קוד ה-QR שמופיע בלוח הבקרה של Agent For All</div>'
     '<span class="gbtn hl round" style="position:relative;">קישור מכשיר' + pin(2, "top:-16px; inset-inline-end:-14px;") + '</span></div>' + ios_tabs("me"),
     'לוחצים על <b>קישור מכשיר</b>'),
    (SCAN_DASH, 'סורקים את <b>הקוד שלנו</b> — זה שמופיע במסך המחשב, בלוח הבקרה של Agent For All'),
    (DONE, 'תוך כמה שניות הסטטוס בלוח הבקרה משתנה ל<b>מחובר</b>'),
], "fig-link-iphone.html", ("#C7522A", "#8FAE94"))
