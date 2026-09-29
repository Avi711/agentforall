import { test } from "node:test";
import assert from "node:assert/strict";
import { browserHandoff } from "../../src/lib/auth/in-app-browser";

const LOGIN = "https://agentforall.co.il/login?redirect=%2Fapp";

const REFUSED_BY_GOOGLE = {
  instagramIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22F76 Instagram 393.1.0.36.70 (iPhone15,3; iOS 18_5; en_US; en; scale=3.00; 1290x2796; IABMV/1; 776538208) Safari/604.1)",
  instagramAndroid:
    "Mozilla/5.0 (Linux; Android 15; SM-S928B Build/AP3A.240905.015.A2; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/138.0.7204.63 Mobile Safari/537.36 Instagram 385.0.0.47.74 Android (35/15; 480dpi; 1080x2340; samsung; SM-S928B; e3q; qcom; he_IL; 750482123)",
  facebookIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22G100 Safari/604.1 MetaIAB Facebook",
  facebookIosLegacy:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/482.2.0.68.110;FBBV/658316928;FBDV/iPhone12,8;FBMD/iPhone;FBSN/iOS;FBSV/18.1;FBSS/2;FBCR/;FBID/phone;FBLC/en_US;FBOP/80]",
  facebookAndroid:
    "Mozilla/5.0 (Linux; Android 15; Pixel 9 Build/AP4A.250205.002; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/138.0.7204.63 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/520.0.0.38.101;]",
  tiktokIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari/604.1 musical_ly_41.9.0",
  tiktokAndroid:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/UQ1A.240105.004; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/121.0.6167.143 Mobile Safari/537.36 musical_ly_2023303040 JsSdk/1.0 NetType/WIFI Channel/googleplay AppName/musical_ly app_version/33.3.4 ByteLocale/en ByteFullLocale/en Region/US AppId/1233 Spark/1.5.0.5-alpha.2 AppVersion/33.3.4 BytedanceWebview/d8a21c6",
  linkedinIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 {useragents: [LinkedInApp]/9.30.1753",
};

const KEEP_GOOGLE_SIGN_IN = {
  safariIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
  chromeIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/138.0.7204.119 Mobile/15E148 Safari/604.1",
  firefoxIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/140.0 Mobile/15E148 Safari/605.1.15",
  ipadDesktopMode:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15",
  homeScreenAppIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  chromeAndroid:
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36",
  samsungInternet:
    "Mozilla/5.0 (Linux; Android 15; SAMSUNG SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36",
  chromeDesktop:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
  googleAppIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/375.0.772545411 Mobile/15E148 Safari/604.1",
  whatsappIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0.1 Mobile/15E148 Safari/604.1 [WAiOS/2.25.31]",
  whatsappAndroid:
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.124 Mobile Safari/537.36 [WA4A/2.25.32.75;]",
};

test("apps whose browser Google refuses get a handoff", () => {
  for (const [name, ua] of Object.entries(REFUSED_BY_GOOGLE)) {
    assert.notEqual(browserHandoff(ua, LOGIN), null, name);
  }
});

test("browsers and apps without a documented refusal keep the Google sign-in", () => {
  for (const [name, ua] of Object.entries(KEEP_GOOGLE_SIGN_IN)) {
    assert.equal(browserHandoff(ua, LOGIN), null, name);
  }
});

test("Instagram on iPhone hands off through its own external-browser link", () => {
  assert.equal(
    browserHandoff(REFUSED_BY_GOOGLE.instagramIos, LOGIN)?.href,
    "instagram://extbrowser/?url=https%3A%2F%2Fagentforall.co.il%2Flogin%3Fredirect%3D%252Fapp",
  );
});

test("Android apps hand off through an intent that falls back to the same page", () => {
  const expected =
    "intent://agentforall.co.il/login?redirect=%2Fapp#Intent;scheme=https;action=android.intent.action.VIEW;S.browser_fallback_url=https%3A%2F%2Fagentforall.co.il%2Flogin%3Fredirect%3D%252Fapp;end";
  assert.equal(browserHandoff(REFUSED_BY_GOOGLE.instagramAndroid, LOGIN)?.href, expected);
  assert.equal(browserHandoff(REFUSED_BY_GOOGLE.facebookAndroid, LOGIN)?.href, expected);
});

test("iPhone apps without a known handoff show only the menu steps", () => {
  for (const name of ["facebookIos", "facebookIosLegacy", "tiktokIos", "linkedinIos"] as const) {
    assert.deepEqual(browserHandoff(REFUSED_BY_GOOGLE[name], LOGIN), { url: LOGIN, href: null }, name);
  }
});
