import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const names = [
  'story-01-intro', 'story-02-wolt', 'story-03-doctor',
  'story-04-gym', 'story-05-openclaw', 'story-06-anniversary',
  'story-07-crypto', 'story-08-shopping', 'story-09-cta',
  'story-10-ad-viral'
];

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1080, height: 1920 },
    deviceScaleFactor: 2
  });
  const page = await context.newPage();

  const htmlPath = path.join(__dirname, 'social-stories.html');
  await page.goto(`file:///${htmlPath.replace(/\\/g, '/')}`);
  await page.waitForTimeout(2000);

  // Hide labels and reset body styling
  await page.evaluate(() => {
    document.querySelectorAll('.story-label').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.story').forEach(el => {
      el.style.borderRadius = '0';
      el.style.boxShadow = 'none';
    });
    document.body.style.padding = '0';
    document.body.style.margin = '0';
    document.body.style.gap = '0';
    document.body.style.background = 'transparent';
  });

  const stories = await page.$$('.story');

  for (let i = 0; i < stories.length; i++) {
    const outputPath = path.join(__dirname, `${names[i]}.png`);
    await stories[i].screenshot({ path: outputPath, type: 'png' });
    console.log(`Exported ${names[i]}.png (2160x3840 @2x)`);
  }

  await browser.close();
  console.log('\nDone! All stories exported at 1080x1920 (9:16) with 2x retina = 2160x3840px');
}

main().catch(console.error);
