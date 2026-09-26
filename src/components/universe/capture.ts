/**
 * Scene screenshot registry (F3).
 * Each mounted scene registers a capturer that renders one fresh frame and
 * returns the canvas as a PNG data-url. The header's camera button calls
 * takeScreenshot(); the active scene (if any) answers.
 */

export type SceneCapturer = () => string | null;

let activeCapturer: SceneCapturer | null = null;

export function registerCapturer(fn: SceneCapturer | null): void {
  activeCapturer = fn;
}

export function takeScreenshot(): string | null {
  if (!activeCapturer) return null;
  try {
    return activeCapturer();
  } catch {
    return null;
  }
}

export function downloadDataUrl(dataUrl: string, filename: string): void {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
