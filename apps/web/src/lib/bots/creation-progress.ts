import type { ProvisioningStage } from "../orchestrator/types";

export type CreationStep = "registering" | "uploading" | "restoring" | "booting" | "starting" | "healthcheck";

export interface CreationTimelineEntry {
  id: CreationStep;
  // null when the step was already under way before this view mounted (page reload).
  startedAt: number | null;
  endedAt: number | null;
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

const STEP_ORDER: readonly CreationStep[] = ["registering", "uploading", "restoring", "booting", "starting", "healthcheck"];

// The active step never reads as more than this much done; only the real milestone completes it.
export const IN_STEP_CAP = 0.9;

export function creationSteps(restoring: boolean): CreationStepSpec[] {
  return restoring ? RESTORE_STEPS : FRESH_STEPS;
}

export function isLaterStep(candidate: CreationStep, than: CreationStep): boolean {
  return STEP_ORDER.indexOf(candidate) > STEP_ORDER.indexOf(than);
}

// Orchestrator stage → the client step that stage *starts*. Stages before the container
// exists map to nothing new: the client already shows "booting" once the row exists.
export function stepForStage(stage: ProvisioningStage | null | undefined): CreationStep | null {
  switch (stage) {
    case "container_created":
    case "backup_restored":
      return "starting";
    case "started":
      return "healthcheck";
    default:
      return null;
  }
}

// Reload mid-provisioning: earlier steps are known to be done, but their timings are gone.
export function timelineForStage(stage: ProvisioningStage | null | undefined): CreationTimelineEntry[] {
  const reached = stepForStage(stage) ?? "booting";
  const steps = FRESH_STEPS.map((s) => s.id);
  return steps.slice(0, steps.indexOf(reached) + 1).map((id) => ({ id, startedAt: null, endedAt: null }));
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
