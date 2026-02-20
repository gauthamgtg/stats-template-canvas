"use client";

export type ExportOptions = {
  scale?: number;
  background?: "auto" | "white" | "transparent";
  jpegQuality?: number;
};

const DEFAULT_OPTIONS: Required<ExportOptions> = {
  scale: 2,
  background: "auto",
  jpegQuality: 1,
};

type ExportTarget = HTMLElement;

async function captureToCanvas(target: ExportTarget, opts: ExportOptions = {}) {
  const { scale, background } = { ...DEFAULT_OPTIONS, ...opts };
  const html2canvas = (await import("html2canvas")).default;

  let backgroundColor: string | null = null;
  if (background === "white") backgroundColor = "#ffffff";
  else if (background === "transparent") backgroundColor = null;

  return html2canvas(target, {
    useCORS: true,
    allowTaint: true,
    scale,
    logging: false,
    backgroundColor,
  });
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export async function exportPng(target: ExportTarget, baseName: string, opts?: ExportOptions) {
  const canvas = await captureToCanvas(target, opts);
  const filename = `${baseName}.png`;
  canvas.toBlob((blob) => blob && downloadBlob(blob, filename), "image/png", 1);
}

export async function exportJpg(target: ExportTarget, baseName: string, opts?: ExportOptions) {
  const merged = { ...DEFAULT_OPTIONS, ...opts };
  const canvas = await captureToCanvas(target, opts);
  const filename = `${baseName}.jpg`;
  canvas.toBlob((blob) => blob && downloadBlob(blob, filename), "image/jpeg", merged.jpegQuality);
}

export async function exportPdf(target: ExportTarget, baseName: string, opts?: ExportOptions) {
  const canvas = await captureToCanvas(target, opts);
  const filename = `${baseName}.pdf`;
  const { jsPDF } = await import("jspdf");

  const width = canvas.width;
  const height = canvas.height;
  const pdf = new jsPDF({
    orientation: width > height ? "landscape" : "portrait",
    unit: "px",
    format: [width, height],
  });
  pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, width, height);
  pdf.save(filename);
}

export async function exportClipboard(target: ExportTarget, opts?: ExportOptions): Promise<boolean> {
  const canvas = await captureToCanvas(target, opts);
  return new Promise((resolve) => {
    canvas.toBlob(async (blob) => {
      if (!blob) { resolve(false); return; }
      try {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        resolve(true);
      } catch {
        resolve(false);
      }
    }, "image/png", 1);
  });
}
