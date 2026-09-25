export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.hasAttribute("data-reduced-motion");
}

export function countTo(from: number, to: number, durationMs: number, onValue: (value: number) => void): () => void {
  let frame = 0;
  let startedAt: number | null = null;
  const step = (now: number) => {
    startedAt ??= now;
    const progress = durationMs > 0 ? Math.min(1, (now - startedAt) / durationMs) : 1;
    onValue(Math.round(from + (to - from) * (1 - (1 - progress) ** 3)));
    if (progress < 1) frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
  return () => cancelAnimationFrame(frame);
}
