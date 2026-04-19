interface FbqAdvancedMatching {
  em?: string;
  ph?: string;
  fn?: string;
  ln?: string;
  ct?: string;
  st?: string;
  zp?: string;
  country?: string;
  db?: string;
  ge?: string;
  external_id?: string;
}

interface FbqTrackOptions {
  eventID?: string;
}

interface FbqFunction {
  (command: "init", pixelId: string, advancedMatching?: FbqAdvancedMatching): void;
  (
    command: "track" | "trackCustom",
    eventName: string,
    parameters?: Record<string, unknown>,
    options?: FbqTrackOptions,
  ): void;
  callMethod?: (...args: unknown[]) => void;
  queue?: unknown[];
  loaded?: boolean;
  version?: string;
}

interface Window {
  fbq?: FbqFunction;
}
