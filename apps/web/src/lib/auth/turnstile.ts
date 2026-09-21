"use client";
import { useCallback, useEffect, useRef } from "react";

interface TurnstileApi {
  render(container: HTMLElement, options: Record<string, unknown>): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
// Long enough for a person to finish an interactive challenge.
const TOKEN_WAIT_MS = 60_000;
const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

// Token the server rejects with MISSING_RESPONSE; the form maps that to a "reload" message.
const CAPTCHA_UNAVAILABLE = "";

let scriptPromise: Promise<TurnstileApi> | undefined;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  scriptPromise ??= new Promise<TurnstileApi>((resolve, reject) => {
    const fail = (reason: string) => {
      scriptPromise = undefined;
      reject(new Error(reason));
    };
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : fail("turnstile missing after load"));
    script.onerror = () => fail("turnstile failed to load");
    document.head.appendChild(script);
  });
  return scriptPromise;
}

// Callback ref, so the widget follows its container across screens; tokens are single-use, reset per submit.
export function useTurnstile() {
  const widget = useRef<{ id: string; node: HTMLElement } | null>(null);
  const token = useRef<string | null>(null);
  const failed = useRef(!SITE_KEY);
  const waiters = useRef<Array<(value: string) => void>>([]);

  const settle = useCallback((value: string) => {
    for (const resolve of waiters.current.splice(0)) resolve(value);
  }, []);

  const detach = useCallback(() => {
    if (widget.current) window.turnstile?.remove(widget.current.id);
    widget.current = null;
    token.current = null;
  }, []);

  const containerRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) {
        detach();
        return;
      }
      if (!SITE_KEY || widget.current?.node === node) return;
      detach();
      loadTurnstile()
        .then((api) => {
          if (!node.isConnected || widget.current) return;
          const id = api.render(node, {
            sitekey: SITE_KEY,
            appearance: "interaction-only",
            language: "he",
            "refresh-expired": "auto",
            callback: (value: string) => {
              failed.current = false;
              token.current = value;
              settle(value);
            },
            "expired-callback": () => {
              token.current = null;
            },
            "error-callback": () => {
              failed.current = true;
              settle(CAPTCHA_UNAVAILABLE);
            },
            "timeout-callback": () => settle(CAPTCHA_UNAVAILABLE),
          });
          widget.current = { id, node };
        })
        .catch((err: unknown) => {
          failed.current = true;
          settle(CAPTCHA_UNAVAILABLE);
          console.error("[turnstile]", err);
        });
    },
    [detach, settle],
  );

  useEffect(() => () => settle(CAPTCHA_UNAVAILABLE), [settle]);

  const getToken = useCallback((): Promise<string> => {
    if (token.current) return Promise.resolve(token.current);
    if (failed.current) return Promise.resolve(CAPTCHA_UNAVAILABLE);
    return new Promise<string>((resolve) => {
      const timer = setTimeout(() => resolve(CAPTCHA_UNAVAILABLE), TOKEN_WAIT_MS);
      waiters.current.push((value) => {
        clearTimeout(timer);
        resolve(value);
      });
    });
  }, []);

  const reset = useCallback(() => {
    token.current = null;
    if (widget.current) window.turnstile?.reset(widget.current.id);
  }, []);

  const captchaHeaders = useCallback(async () => ({ "x-captcha-response": await getToken() }), [getToken]);

  return { containerRef, captchaHeaders, reset };
}
