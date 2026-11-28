import { client } from "./client.ts";

/** The time between two reports to the diagnostics log of the server. */
const REPORT_INTERVAL_MS = 10_000;

/** How long the frame count runs at the end of each period. A constant count would itself keep the page busy. */
const FRAME_SAMPLE_MS = 1000;

/** Counts the frames of one second. A hidden window draws none, so the caller must not ask then. */
const measureFramesPerSecond = () =>
  new Promise<number>((resolve) => {
    const start = performance.now();
    let frames = 0;

    const count = (now: number) => {
      if (now - start >= FRAME_SAMPLE_MS) {
        resolve(Math.round((frames * 1000) / (now - start)));

        return;
      }

      frames++;
      requestAnimationFrame(count);
    };

    requestAnimationFrame(count);
  });

/**
 * Reports the load of this page to the diagnostics log of the server every few seconds: the open
 * server streams, the values that arrived, the long main-thread tasks and the frame rate. A slow
 * app then leaves a record that names the cause.
 */
export const startDiagnostics = () => {
  const clientName = crypto.randomUUID().slice(0, 8);
  let longTasks = 0;
  let longTaskMs = 0;

  // Only Chromium reports long tasks. Another browser reports zero.
  if (PerformanceObserver.supportedEntryTypes.includes("longtask")) {
    new PerformanceObserver((list) => {
      for (const task of list.getEntries()) {
        longTasks++;
        longTaskMs += Math.round(task.duration);
      }
    }).observe({ entryTypes: ["longtask"] });
  }

  const report = async () => {
    const hidden = document.visibilityState === "hidden";
    const framesPerSecond = hidden ? null : await measureFramesPerSecond();

    // A lost server gets no report. The next period reports again.
    await client
      .reportDiagnostics({
        client: clientName,
        userAgent: navigator.userAgent,
        hidden,
        ...client.readStreamCounts(),
        longTasks,
        longTaskMs,
        framesPerSecond,
      })
      .catch(() => {});
    longTasks = 0;
    longTaskMs = 0;
  };

  setInterval(() => void report(), REPORT_INTERVAL_MS);
};
