import * as pdfjsLib from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

export async function renderPdfToImages(
  file: File,
  onPage: (page: number, blob: Blob) => Promise<void>,
  scale = 2
) {
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;

  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
    const page = await pdf.getPage(pageNo);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas context unavailable");

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await page.render({ canvasContext: ctx, viewport }).promise;

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => {
        if (b) resolve(b);
        else reject(new Error("failed to create PNG blob"));
      }, "image/png");
    });

    await onPage(pageNo, blob);
    canvas.width = 1;
    canvas.height = 1;
  }
}
