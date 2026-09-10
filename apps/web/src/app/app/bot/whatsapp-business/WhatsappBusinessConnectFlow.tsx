"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";
import { PendingLink } from "@/app/app/Pending";
import { UNEXPECTED_ERROR_HE } from "@/lib/messages.he";
import { COEXISTENCE_FEATURE_TYPE, parseSignupMessage } from "@/lib/whatsapp-cloud/signup-message";
import { isEmbeddedSignupOrigin } from "@/lib/whatsapp-cloud/signup-origin";

const SDK_URL = "https://connect.facebook.net/en_US/sdk.js";
const CODE_REJECTED_HE = "החיבור לא הושלם בזמן. לחצו שוב על החיבור — נפתח את החלון של Meta מחדש.";
const CANCELLED_HE = "החלון של Meta נסגר לפני שהחיבור הושלם. אפשר לנסות שוב בכל רגע.";
const POPUP_BLOCKED_HE = "הדפדפן חסם את החלון של Meta. אפשרו חלונות קופצים לאתר ונסו שוב.";
const PIN_REQUIRED_HE =
  "למספר הזה כבר מוגדר קוד אימות דו-שלבי ב-WhatsApp (6 ספרות). הזינו אותו למטה ולחצו שוב על החיבור.";
const PIN_PATTERN = /^\d{6}$/;
const SDK_FAILED_HE = "לא הצלחנו לטעון את החלון של Meta. בדקו חוסם פרסומות או נסו בדפדפן אחר.";
const TOKEN_INVALID_HE = "החיבור ל-Meta פג. לחצו על החיבור כדי לחבר את המספר מחדש.";
const META_DOWN_HE = "Meta לא זמינה כרגע. נסו שוב בעוד כמה דקות.";
const BOT_NOT_READY_HE = "הסוכן עדיין מוקם. נסו שוב בעוד דקה.";
const NO_NUMBER_HE = "החלון של Meta נסגר בלי לבחור מספר טלפון. פתחו אותו שוב ובחרו מספר לחיבור.";
const SYNC_PENDING_HE =
  "המספר מחובר, אבל Meta לא השלימה את העברת אנשי הקשר וההיסטוריה מהאפליקציה. לחצו שוב על החיבור תוך 24 שעות, אחרת Meta תנתק את המספר.";
const MODE_MISMATCH_HE =
  "סוג המספר לא תואם לבחירה. אם המספר פעיל באפליקציית WhatsApp Business בחרו ״המספר שכבר עובד באפליקציה״, ואחרת ״מספר חדש״, ונסו שוב.";
// Meta sends the ids by window message and the code by callback, in no fixed order.
const IDS_GRACE_MS = 5_000;

interface MetaSettings {
  appId: string;
  configId: string;
  apiVersion: string;
}

type Phase =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "popup" }
  | { kind: "connecting" }
  | { kind: "connected"; displayPhoneNumber: string | null; verifiedName: string | null }
  | { kind: "unavailable" }
  | { kind: "error"; message: string; needsPin?: boolean };

type NumberMode = "coexistence" | "new_number";

interface SignupIds {
  wabaId: string;
  phoneNumberId?: string;
  businessId?: string;
  coexistence: boolean;
}

interface FbLoginResponse {
  authResponse?: { code?: string } | null;
  status?: string;
}

interface FbSdk {
  init(params: { appId: string; version: string; xfbml: boolean; cookie: boolean }): void;
  login(
    callback: (response: FbLoginResponse) => void,
    params: {
      config_id: string;
      response_type: "code";
      override_default_response_type: true;
      extras: { setup: Record<string, never>; sessionInfoVersion: "3"; featureType?: typeof COEXISTENCE_FEATURE_TYPE };
    },
  ): void;
}

type FbWindow = Window & { FB?: FbSdk; fbAsyncInit?: () => void };

export function WhatsappBusinessConnectFlow({ botId, meta }: { botId: string; meta: MetaSettings | null }) {
  const [phase, setPhase] = useState<Phase>(meta ? { kind: "loading" } : { kind: "unavailable" });
  const [pin, setPin] = useState("");
  const [askPin, setAskPin] = useState(false);
  // Meta's popup decides the path, whatever the radio said: only a number that left the app can have a PIN.
  const [pinApplies, setPinApplies] = useState(false);
  // Most businesses already answer from the WhatsApp Business app; keeping it is the default.
  const [mode, setMode] = useState<NumberMode>("coexistence");
  // Ids arrive through a window message; the login callback delivers the code and may come first.
  const ids = useRef<SignupIds | null>(null);
  const idsWaiter = useRef<((ids: SignupIds | null) => void) | null>(null);
  const sdkFailed = useRef(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/bot/${botId}/whatsapp-cloud/status`, { cache: "no-store" })
      .then(async (res) => {
        const data: unknown = await res.json().catch(() => null);
        if (cancelled || !res.ok || !isView(data) || data.status !== "connected") return;
        if (data.health === "token_invalid" || data.syncPending === true) {
          setPhase({ kind: "error", message: data.syncPending === true ? SYNC_PENDING_HE : TOKEN_INVALID_HE });
          return;
        }
        setPhase({ kind: "connected", displayPhoneNumber: data.displayPhoneNumber, verifiedName: data.verifiedName });
      })
      .catch(() => {
        // Best effort; the connect button still works without the status.
      });
    return () => {
      cancelled = true;
    };
  }, [botId]);

  useEffect(() => {
    if (!meta) return;
    const onMessage = (event: MessageEvent) => {
      if (!isEmbeddedSignupOrigin(event.origin) || typeof event.data !== "string") return;
      const signup = parseSignupMessage(event.data);
      if (!signup) return;
      if (signup.kind === "finish") {
        const { kind: _kind, ...found } = signup;
        ids.current = found;
        idsWaiter.current?.(ids.current);
        return;
      }
      ids.current = null;
      idsWaiter.current?.(null);
      setPhase({ kind: "error", message: signup.kind === "cancel" ? CANCELLED_HE : NO_NUMBER_HE });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [meta]);

  const initSdk = useCallback(() => {
    if (!meta) return;
    const fb = (window as FbWindow).FB;
    if (!fb) return;
    fb.init({ appId: meta.appId, version: meta.apiVersion, xfbml: false, cookie: false });
    setPhase((current) => (current.kind === "loading" ? { kind: "ready" } : current));
  }, [meta]);

  useEffect(() => {
    if (!meta) return;
    const w = window as FbWindow;
    if (w.FB) initSdk();
    else w.fbAsyncInit = initSdk;
  }, [meta, initSdk]);

  // A PIN asked for one kind of number means nothing for the other.
  function chooseMode(next: NumberMode) {
    setMode(next);
    setAskPin(false);
    setPinApplies(false);
  }

  async function connect(code: string, signup: SignupIds) {
    setPhase({ kind: "connecting" });
    setPinApplies(!signup.coexistence);
    try {
      const res = await fetch(`/api/bot/${botId}/whatsapp-cloud/connect`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          code,
          wabaId: signup.wabaId,
          ...(signup.phoneNumberId ? { phoneNumberId: signup.phoneNumberId } : {}),
          ...(signup.businessId ? { businessId: signup.businessId } : {}),
          ...(signup.coexistence ? { coexistence: true } : PIN_PATTERN.test(pin) ? { pin } : {}),
        }),
      });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const needsPin = errorCode(data) === "pin_required";
        if (needsPin) setAskPin(true);
        setPhase({ kind: "error", message: needsPin ? PIN_REQUIRED_HE : errorMessage(res.status, data) });
        return;
      }
      if (!isView(data)) {
        setPhase({ kind: "error", message: UNEXPECTED_ERROR_HE });
        return;
      }
      if (data.syncPending === true) {
        setPhase({ kind: "error", message: SYNC_PENDING_HE });
        return;
      }
      setPhase({ kind: "connected", displayPhoneNumber: data.displayPhoneNumber, verifiedName: data.verifiedName });
    } catch {
      setPhase({ kind: "error", message: UNEXPECTED_ERROR_HE });
    }
  }

  function awaitIds(): Promise<SignupIds | null> {
    if (ids.current) return Promise.resolve(ids.current);
    return new Promise((resolve) => {
      const waiter = (value: SignupIds | null) => {
        clearTimeout(timer);
        if (idsWaiter.current === waiter) idsWaiter.current = null;
        resolve(value);
      };
      // A relaunch inside the grace window installs a new waiter; this timer must not clear that one.
      const timer = setTimeout(() => waiter(null), IDS_GRACE_MS);
      idsWaiter.current = waiter;
    });
  }

  function launch() {
    if (!meta) return;
    const fb = (window as FbWindow).FB;
    if (!fb) {
      setPhase({ kind: "error", message: sdkFailed.current ? SDK_FAILED_HE : POPUP_BLOCKED_HE });
      return;
    }
    ids.current = null;
    setPhase({ kind: "popup" });
    fb.login(
      (response) => {
        const code = response.authResponse?.code;
        if (!code) {
          setPhase((current) => (current.kind === "popup" ? { kind: "error", message: CANCELLED_HE } : current));
          return;
        }
        void awaitIds().then((signup) => {
          if (!signup) {
            setPhase((current) => (current.kind === "popup" ? { kind: "error", message: NO_NUMBER_HE } : current));
            return;
          }
          void connect(code, signup);
        });
      },
      {
        config_id: meta.configId,
        response_type: "code",
        override_default_response_type: true,
        extras: { setup: {}, sessionInfoVersion: "3", ...(mode === "coexistence" ? { featureType: COEXISTENCE_FEATURE_TYPE } : {}) },
      },
    );
  }

  if (phase.kind === "connected") {
    return <ConnectedPanel displayPhoneNumber={phase.displayPhoneNumber} verifiedName={phase.verifiedName} />;
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-sand-light p-5 sm:p-8 max-w-2xl">
      {meta ? (
        <Script
          src={SDK_URL}
          strategy="afterInteractive"
          onLoad={initSdk}
          onError={() => {
            sdkFailed.current = true;
            setPhase({ kind: "error", message: SDK_FAILED_HE });
          }}
        />
      ) : null}
      <p className="text-xs uppercase tracking-[0.22em] text-terra mb-3">WhatsApp Business</p>
      <h2 className="font-display text-xl sm:text-2xl text-espresso mb-3">מספר עסקי שהסוכן עונה בו ללקוחות שלכם</h2>

      {phase.kind === "unavailable" ? (
        <p className="text-sm text-espresso-light leading-relaxed">
          חיבור WhatsApp Business אינו זמין כרגע. חזרו{" "}
          <PendingLink href="/app" className="text-terra underline">
            לעמוד הבית
          </PendingLink>
          .
        </p>
      ) : (
        <div className="space-y-5">
          <fieldset className="space-y-3" disabled={phase.kind === "popup" || phase.kind === "connecting"}>
            <legend className="text-sm font-medium text-espresso mb-2">איזה מספר מחברים?</legend>
            <label className="flex gap-3 items-start text-sm text-espresso-light leading-relaxed cursor-pointer">
              <input
                type="radio"
                name="number-mode"
                className="mt-1"
                checked={mode === "coexistence"}
                onChange={() => chooseMode("coexistence")}
              />
              <span>
                <span className="text-espresso font-medium">המספר שכבר עובד באפליקציית WhatsApp Business</span>
                <br />
                האפליקציה נשארת אצלכם בטלפון והסוכן עונה לצידכם. כשאתם עונים ללקוח מהאפליקציה, הסוכן מפסיק לענות לו
                ל-24 שעות מההודעה האחרונה שלכם אליו, או עד שתבקשו ממנו בטלגרם לחזור. כבו באפליקציה את הודעת הפתיחה
                וההודעה בהיעדרות: הסוכן כבר עונה ללקוחות, והודעה אוטומטית עלולה להשתיק אותו.
              </span>
            </label>
            <label className="flex gap-3 items-start text-sm text-espresso-light leading-relaxed cursor-pointer">
              <input
                type="radio"
                name="number-mode"
                className="mt-1"
                checked={mode === "new_number"}
                onChange={() => chooseMode("new_number")}
              />
              <span>
                <span className="text-espresso font-medium">מספר חדש שלא מחובר לאפליקציה</span>
                <br />
                המספר חייב להיות פנוי: לא מחובר לאפליקציית WhatsApp או WhatsApp Business בטלפון.
              </span>
            </label>
          </fieldset>

          <ul className="text-sm text-espresso-light leading-relaxed space-y-2 list-disc pr-5">
            <li>מתחברים עם חשבון הפייסבוק של העסק. אם אין לעסק חשבון Meta Business, יוצרים אחד בתוך החלון.</li>
            <li>תשובות ללקוחות שכתבו לכם — בחינם. Meta מחייבת רק על הודעות שהעסק יוזם.</li>
          </ul>

          {phase.kind === "error" ? (
            <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">{phase.message}</p>
          ) : null}

          {askPin && pinApplies ? (
            <label className="block text-sm text-espresso-light">
              קוד אימות דו-שלבי של המספר
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                dir="ltr"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                className="mt-1 block w-40 rounded-lg border border-sand-light bg-cream px-3 py-2 font-mono text-espresso tracking-[0.3em]"
              />
            </label>
          ) : null}

          <button
            type="button"
            onClick={launch}
            disabled={
              phase.kind === "loading" ||
              phase.kind === "popup" ||
              phase.kind === "connecting" ||
              (askPin && pinApplies && !PIN_PATTERN.test(pin))
            }
            aria-busy={phase.kind === "popup" || phase.kind === "connecting"}
            className="inline-flex items-center justify-center rounded-full bg-espresso text-cream px-6 py-3 text-sm font-medium transition hover:bg-espresso/90 disabled:opacity-50"
          >
            {phase.kind === "loading"
              ? "טוען…"
              : phase.kind === "popup"
                ? "ממתין לחלון של Meta…"
                : phase.kind === "connecting"
                  ? "מחבר את המספר…"
                  : "חיבור המספר העסקי"}
          </button>
        </div>
      )}
    </div>
  );
}

function ConnectedPanel({ displayPhoneNumber, verifiedName }: { displayPhoneNumber: string | null; verifiedName: string | null }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-sand-light p-5 sm:p-8 max-w-2xl">
      <p className="text-xs uppercase tracking-[0.22em] text-terra mb-3">WhatsApp Business</p>
      <h2 className="font-display text-xl sm:text-2xl text-espresso mb-3">המספר העסקי מחובר</h2>
      <p className="text-sm text-espresso-light leading-relaxed">
        הסוכן עונה עכשיו ללקוחות ב-
        <span dir="ltr" className="font-mono text-espresso">
          {displayPhoneNumber ?? "המספר שחיברתם"}
        </span>
        {verifiedName ? ` בשם ${verifiedName}` : ""}. ללמד אותו מה לענות? כתבו לו בטלגרם כרגיל.
      </p>
      <PendingLink href="/app" className="mt-5 inline-block text-sm text-terra underline">
        חזרה לעמוד הבית
      </PendingLink>
    </div>
  );
}

function isView(
  value: unknown,
): value is { status: string; displayPhoneNumber: string | null; verifiedName: string | null; health: string | null; syncPending?: boolean } {
  return typeof value === "object" && value !== null && typeof (value as { status?: unknown }).status === "string";
}

function errorCode(data: unknown): string | null {
  const code = typeof data === "object" && data !== null ? (data as { error?: { code?: unknown } }).error?.code : undefined;
  return typeof code === "string" ? code : null;
}

function errorMessage(status: number, data: unknown): string {
  const code = errorCode(data);
  if (code === "signup_code_rejected") return CODE_REJECTED_HE;
  if (code === "meta_unavailable") return META_DOWN_HE;
  if (code === "bot_not_ready") return BOT_NOT_READY_HE;
  if (code === "number_mode_mismatch") return MODE_MISMATCH_HE;
  if (status === 409) return "המספר הזה כבר מחובר לסוכן אחר, או שלסוכן הזה כבר יש מספר עסקי.";
  if (status === 402) return "חיבור מספר עסקי זמין במנוי פעיל.";
  if (status === 503) return "חיבור WhatsApp Business אינו זמין כרגע. נסו שוב מאוחר יותר.";
  return UNEXPECTED_ERROR_HE;
}
