import type { ProvisioningStage } from "../orchestrator/types";

export type CreationStep = "registering" | "uploading" | "restoring" | "booting" | "starting" | "healthcheck";

export interface CreationTimelineEntry {
  id: CreationStep;
  // null when the start was never observed (step already under way before this view mounted).
  startedAt: number | null;
  endedAt: number | null;
}

export interface ProvisioningEvent {
  stage: ProvisioningStage;
  // Epoch milliseconds, server clock.
  at: number;
}

export interface CreationStepSpec {
  id: CreationStep;
  label: string;
  hint: string;
  // Share of the progress this step owns; inside a step progress eases toward the ceiling
  // at the pace of `typicalSeconds`, but only the real milestone completes it.
  weight: number;
  typicalSeconds: number;
}

const FRESH_STEPS: CreationStepSpec[] = [
  { id: "registering", label: "שומרים את הסוכן", hint: "רושמים את הסוכן ומקצים לו מפתח מודל", weight: 12, typicalSeconds: 3 },
  { id: "booting", label: "מקצים סביבה פרטית", hint: "יוצרים לסוכן קונטיינר משלו", weight: 13, typicalSeconds: 3 },
  { id: "starting", label: "מפעילים את הסוכן", hint: "הקונטיינר עולה ו־OpenClaw נטען", weight: 15, typicalSeconds: 3 },
  { id: "healthcheck", label: "בדיקת תקינות", hint: "מחכים שהסוכן יענה בפעם הראשונה", weight: 60, typicalSeconds: 18 },
];

const RESTORE_STEPS: CreationStepSpec[] = [
  { id: "uploading", label: "מעלים את קובץ הגיבוי", hint: "הקובץ נשלח לשרת בחלקים", weight: 30, typicalSeconds: 30 },
  { id: "restoring", label: "משחזרים את הגיבוי", hint: "רושמים את הסוכן ומצמידים אליו את הגיבוי", weight: 10, typicalSeconds: 4 },
  { id: "booting", label: "מקצים סביבה פרטית", hint: "יוצרים לסוכן קונטיינר משלו", weight: 10, typicalSeconds: 3 },
  { id: "starting", label: "מפעילים את הסוכן", hint: "משחזרים את המצב לתוך הקונטיינר ומעלים אותו", weight: 15, typicalSeconds: 8 },
  { id: "healthcheck", label: "בדיקת תקינות", hint: "מחכים שהסוכן יענה בפעם הראשונה", weight: 35, typicalSeconds: 18 },
];

// The active step never reads as more than this much done; only the real milestone completes it.
export const IN_STEP_CAP = 0.9;

// Union by stage, ascending: a poll can only add knowledge, never take it away.
export function mergeHistory(known: ProvisioningEvent[], incoming: ProvisioningEvent[]): ProvisioningEvent[] {
  const byStage = new Map(known.map((e) => [e.stage, e] as const));
  for (const event of incoming) if (!byStage.has(event.stage)) byStage.set(event.stage, event);
  return [...byStage.values()].sort((a, b) => a.at - b.at);
}

export function creationSteps(restoring: boolean): CreationStepSpec[] {
  return restoring ? RESTORE_STEPS : FRESH_STEPS;
}

export interface TimelineInput {
  // Steps the client itself performed (register / upload / restore), with client timestamps.
  local: CreationTimelineEntry[];
  // Stages the orchestrator recorded, server timestamps, ascending.
  history: ProvisioningEvent[];
  // Client time at which the orchestrator row was known to exist; used if `reserved` is absent.
  rowKnownAt: number | null;
  // Client time the bot was seen `running`, if the final `running` event was not observed.
  readyAt: number | null;
}

// Container-side steps start and end on server events, so their durations are exact and a
// late poll can never skip one. The first server step starts when the row was reserved.
export function buildTimeline(input: TimelineInput): CreationTimelineEntry[] {
  const at = (stage: ProvisioningStage): number | null =>
    input.history.find((e) => e.stage === stage)?.at ?? null;
  const reserved = at("reserved") ?? input.rowKnownAt;
  const containerCreated = at("container_created");
  const started = at("started");
  const running = at("running") ?? input.readyAt;

  const entries: CreationTimelineEntry[] = [...input.local];
  if (reserved === null && containerCreated === null && started === null && running === null) {
    return entries;
  }
  entries.push({ id: "booting", startedAt: reserved, endedAt: containerCreated ?? started ?? running });
  if (containerCreated !== null || started !== null || running !== null) {
    entries.push({ id: "starting", startedAt: containerCreated, endedAt: started ?? running });
  }
  if (started !== null || running !== null) {
    entries.push({ id: "healthcheck", startedAt: started, endedAt: running });
  }
  return entries;
}

export function resolvePercent(
  steps: CreationStepSpec[],
  activeIndex: number,
  secondsInStep: number,
  uploadPercent: number | null,
): number {
  if (activeIndex < 0) return 0;
  const floor = steps.slice(0, activeIndex).reduce((sum, s) => sum + s.weight, 0);
  const active = steps[activeIndex];
  if (!active) return Math.min(100, floor);
  const fraction =
    active.id === "uploading" && uploadPercent !== null
      ? Math.min(1, Math.max(0, uploadPercent / 100))
      : 1 - Math.exp(-Math.max(0, secondsInStep) / active.typicalSeconds);
  return Math.round(floor + active.weight * Math.min(IN_STEP_CAP, fraction));
}
