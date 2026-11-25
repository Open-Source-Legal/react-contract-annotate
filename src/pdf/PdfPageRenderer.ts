/**
 * Renders one PDF page onto one canvas, cancelling a render still in progress
 * before starting the next. Ported from OpenContracts' `PDFPageRenderer`
 * (`renderers/pdf/PDF.tsx`, 98286cabf); its unused `onError` constructor
 * argument is dropped.
 */
import type {
  PDFPageProxy,
  RenderTask,
} from "pdfjs-dist/types/src/display/api";

/** Message of the error a render rejects with once it has been cancelled. */
const RENDERING_CANCELLED = "Rendering cancelled";

/**
 * True for the rejection of a cancelled render: the renderer's own, or
 * pdf.js' `RenderingCancelledException` ("Rendering cancelled, page N").
 * Cancelling is routine (zoom changes, pages leaving the virtual window), so
 * callers ignore these.
 */
export function isRenderingCancelled(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "RenderingCancelledException" ||
      error.message.includes(RENDERING_CANCELLED))
  );
}

export class PdfPageRenderer {
  private currentRenderTask?: RenderTask;
  private isCancelled: boolean = false;

  constructor(
    readonly page: PDFPageProxy,
    readonly canvas: HTMLCanvasElement
  ) {}

  cancelCurrentRender() {
    this.isCancelled = true;

    if (this.currentRenderTask === undefined) {
      return;
    }

    try {
      // Cancel immediately without waiting for promise
      this.currentRenderTask.cancel();
      this.currentRenderTask = undefined;

      // Clear the canvas to provide immediate visual feedback
      const ctx = this.canvas.getContext("2d");
      if (ctx) {
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      }
    } catch (err) {
      // Silently ignore cancellation errors
      if (!isRenderingCancelled(err)) {
        console.warn("Issue cancelling render", err);
      }
    }
  }

  render(scale: number): Promise<void> {
    // Reset cancellation flag for new render
    this.isCancelled = false;

    const viewport = this.page.getViewport({ scale });

    this.canvas.height = viewport.height;
    this.canvas.width = viewport.width;

    if (this.canvas.getContext("2d") === null) {
      throw new Error("No canvas context");
    }

    // Don't start new render if already cancelled
    if (this.isCancelled) {
      return Promise.reject(new Error(RENDERING_CANCELLED));
    }

    const task = this.page.render({
      canvas: this.canvas,
      viewport,
    });
    this.currentRenderTask = task;
    // A cancelled task settles after the next render has started; it must
    // not forget that render, or the render after it could not cancel it.
    const settle = () => {
      if (this.currentRenderTask === task) this.currentRenderTask = undefined;
    };

    // Wrap the promise to handle cancellation
    return task.promise.then(
      () => {
        settle();
        if (this.isCancelled) {
          throw new Error(RENDERING_CANCELLED);
        }
      },
      (err) => {
        settle();
        throw err;
      }
    );
  }

  rescaleAndRender(scale: number): Promise<void> {
    this.cancelCurrentRender();
    return this.render(scale);
  }
}
