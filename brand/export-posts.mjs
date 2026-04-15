import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const names = [
  'post-01-intro', 'post-02-budget', 'post-03-morning',
  'post-04-calendar', 'post-05-whywhatsapp', 'post-06-price',
  'post-07-family', 'post-08-research',
  'post-10-doctor', 'post-11-business', 'post-12-lawyer', 'post-13-smallbiz',
  'post-14-openclaw', 'post-15-privacy',
  'post-16-crypto', 'post-17-stocks',
  'post-18-anniversary', 'post-19-chatgpt-vs-agent',
  'post-20-wolt', 'post-21-gym', 'post-22-shopping',
  'post-09-cta',
  'post-23-ad-viral'
];

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1080, height: 1350 },
    deviceScaleFactor: 2
  });
  const page = await context.newPage();

  const htmlPath = path.join(__dirname, 'social-posts.html');
  await page.goto(`file:///${htmlPath.replace(/\\/g, '/')}`);
  await page.waitForTimeout(2000);

  // Hide labels, titles, reset body styling, and remove border-radius for clean edges
  await page.evaluate(() => {
    document.querySelectorAll('.post-label').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.section-title').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.post').forEach(el => {
      el.style.borderRadius = '0';
      el.style.boxShadow = 'none';
    });
    document.body.style.padding = '0';
    document.body.style.margin = '0';
    document.body.style.gap = '0';
    document.body.style.background = 'transparent';
  });

  const posts = await page.$$('.post');

  for (let i = 0; i < posts.length; i++) {
    const outputPath = path.join(__dirname, `${names[i]}.png`);
    await posts[i].screenshot({ path: outputPath, type: 'png' });
    console.log(`Exported ${names[i]}.png (2160x2700 @2x)`);
  }

  await browser.close();
  console.log('\nDone! All 9 posts exported at 1080x1350 (4:5) with 2x retina = 2160x2700px');
}

main().catch(console.error);
