# Blog figures: dedicated-whatsapp-number

`gen.py` writes the step-by-step screen mockups (HTML) for `/blog/dedicated-whatsapp-number`.
Regenerate when WhatsApp/iOS/One UI move a menu:

1. `OUT=<dir> python gen.py` → 12 HTML pages (`*-grid.html` 1200 wide, `*-col.html` 640 wide; height follows the panel count, read it from `.stage`).
2. Serve the folder (`python -m http.server 8765`) and screenshot each page at its `.stage` size (Playwright, `scale: css`).
3. `sharp(...).webp({ quality: 86 })` → `apps/web/public/blog/dedicated-whatsapp-number/<name>-{grid,col}.webp`, then copy the new sizes into the `<Figure>` props in the MDX.

Grid is the article-column image; col is the `<picture>` source for ≤640px. Android screens are traced from real August 2026 screenshots
(One UI 8 Settings/חיבורים/מנהל SIM, WhatsApp Material 3 menu, Settings, חשבון, add-account sheet, number entry); iOS follows WhatsApp iOS 26 / iOS Cellular.
