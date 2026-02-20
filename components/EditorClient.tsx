"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { exportClipboard, exportJpg, exportPdf, exportPng } from "@/lib/export";
import type { ExportOptions } from "@/lib/export";
import type { LoadedTemplate } from "@/lib/templates";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type ColorMeta = { varName: string; label: string; defaultValue: string };
type Snapshot = { bodyHTML: string; colors: Record<string, string> };
type ProgressTarget = { valueEl: HTMLElement; fillEl: HTMLElement };
type SectionInfo = { el: HTMLElement; label: string; visible: boolean };
type PreviewMode = "desktop" | "tablet" | "mobile";
type FloatingImage = {
  id: string;
  src: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  naturalWidth: number;
  naturalHeight: number;
  aspectMode: "freeform" | "1:1" | "4:3" | "16:9";
};

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const MAX_HISTORY = 60;
const TEXT_SELECTORS = "h1,h2,h3,h4,h5,h6,p,span,strong,button,li,td,th";
const PREVIEW_WIDTHS: Record<PreviewMode, number> = { desktop: 1200, tablet: 768, mobile: 375 };
const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
const CURATED_FONTS = [
  "Default",
  "Inter",
  "Quicksand",
  "Crimson Pro",
  "Playfair Display",
  "Lato",
  "Space Grotesk",
  "IBM Plex Serif",
  "Orbitron",
  "Press Start 2P",
];

const SAVE_KEY = (id: string) => `template-editor-${id}`;
const COPY_KEY_PREFIX = (id: string) => `template-editor-copy-${id}-`;
function getCopyKeys(templateId: string): string[] {
  if (typeof window === "undefined") return [];
  const keys: string[] = [];
  const prefix = COPY_KEY_PREFIX(templateId);
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    if (key?.startsWith(prefix)) keys.push(key);
  }
  return keys.sort((a, b) => b.localeCompare(a));
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function makeLabel(varName: string) {
  return varName
    .replace(/^--/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function decodeHtmlEntities(str: string) {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function parseTemplateHtml(html: string) {
  const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  const head = headMatch?.[1] ?? "";
  const bodyMatch = html.match(/<body([^>]*)>([\s\S]*?)<\/body>/i);
  const bodyAttrs = bodyMatch?.[1] ?? "";
  const bodyHTML = bodyMatch?.[2] ?? "";
  const bodyClassMatch = bodyAttrs.match(/class=["']([^"']+)["']/i);
  const bodyClass = bodyClassMatch?.[1] ?? "min-h-screen p-6 md:p-12";

  const styleTags = Array.from(head.matchAll(/<style([^>]*)>([\s\S]*?)<\/style>/gi));
  const hasTailwindStyle = styleTags.some((m) =>
    (m[1] ?? "").toLowerCase().includes("text/tailwindcss")
  );
  const styles = styleTags
    .map((m) => m[2] ?? "")
    .join("\n")
    .replace(/\bbody\b(?=\s*\{)/g, "[data-template-body]");

  const links = Array.from(
    head.matchAll(/<link[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi)
  )
    .map((match) => decodeHtmlEntities(match[1]))
    .filter(Boolean);

  const inlineScripts = Array.from(
    head.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi)
  )
    .map((match) => (match[1] ?? "").trim())
    .filter(Boolean);

  const colorMeta: ColorMeta[] = [];
  const colorRegex = /(--[a-zA-Z0-9_-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g;
  const seen = new Set<string>();
  for (const match of styles.matchAll(colorRegex)) {
    const varName = match[1];
    const defaultValue = match[2];
    if (seen.has(varName)) continue;
    seen.add(varName);
    colorMeta.push({ varName, label: makeLabel(varName), defaultValue });
  }

  const initialColors = Object.fromEntries(
    colorMeta.map((c) => [c.varName, c.defaultValue])
  );

  return {
    styles,
    bodyClass,
    bodyHTML,
    colorMeta,
    initialColors,
    links,
    inlineScripts,
    hasTailwindStyle,
  };
}

function areSnapshotsEqual(a: Snapshot | undefined, b: Snapshot) {
  if (!a) return false;
  if (a.bodyHTML !== b.bodyHTML) return false;
  const aKeys = Object.keys(a.colors);
  const bKeys = Object.keys(b.colors);
  if (aKeys.length !== bKeys.length) return false;
  return bKeys.every((key) => a.colors[key] === b.colors[key]);
}

/** Sync grid-based demographic (or similar) bars: when the value cell contains a percentage, set the bar column span to match. */
function syncDemographicBars(container: HTMLElement) {
  const rows = container.querySelectorAll(".grid.grid-cols-12");
  rows.forEach((row) => {
    const children = Array.from(row.children) as HTMLElement[];
    if (children.length !== 2) return;
    const [barCell, valueCell] = children;
    const valueText = (valueCell.textContent ?? "").trim();
    const match = valueText.match(/^(\d+(?:\.\d+)?)\s*%?\s*$/);
    if (!match) return;
    const pct = Math.min(100, Math.max(0, parseFloat(match[1])));
    const barCols = Math.round(12 * pct / 100);
    const valueCols = 12 - barCols;
    if (barCols < 1 || valueCols < 1) return;
    barCell.className = barCell.className.replace(/\bcol-span-\d+/g, `col-span-${barCols}`);
    valueCell.className = valueCell.className.replace(/\bcol-span-\d+/g, `col-span-${valueCols}`);
  });
}

function detectSections(container: HTMLElement): SectionInfo[] {
  const main = container.querySelector("main");
  const target = main ?? container;
  const result: SectionInfo[] = [];

  Array.from(target.children).forEach((child, idx) => {
    const el = child as HTMLElement;
    const heading = el.querySelector("h1, h2, h3, h4, span.uppercase");
    let label = heading?.textContent?.trim().slice(0, 30) || "";
    if (!label) {
      const tag = el.tagName.toLowerCase();
      if (tag === "header") label = "Header";
      else if (tag === "footer") label = "Footer";
      else if (tag === "section") label = "Section";
      else label = `Block ${idx + 1}`;
    }
    result.push({ el, label, visible: el.style.display !== "none" });
  });

  const footer = container.querySelector("footer");
  if (footer && !result.some((s) => s.el === footer)) {
    result.push({
      el: footer as HTMLElement,
      label: "Footer",
      visible: (footer as HTMLElement).style.display !== "none",
    });
  }

  return result;
}

function detectPieChart(container: HTMLElement) {
  const svgs = container.querySelectorAll("svg");
  for (const svg of svgs) {
    const paths = svg.querySelectorAll("path[stroke-dasharray]");
    if (paths.length === 2) {
      const first = paths[0] as SVGPathElement;
      const second = paths[1] as SVGPathElement;
      const dashA = first.getAttribute("stroke-dasharray");
      if (dashA) {
        const val = parseFloat(dashA.split(",")[0]);
        if (val > 0 && val <= 100) {
          return { svg, first, second, value: val };
        }
      }
    }
  }
  return null;
}

/** Find all pie chart SVGs in the container (same structure as detectPieChart). */
function detectAllPieCharts(container: HTMLElement): Array<{ svg: SVGElement; first: SVGPathElement; second: SVGPathElement; value: number }> {
  const results: Array<{ svg: SVGElement; first: SVGPathElement; second: SVGPathElement; value: number }> = [];
  const svgs = container.querySelectorAll("svg");
  for (const svg of svgs) {
    const paths = svg.querySelectorAll("path[stroke-dasharray]");
    if (paths.length === 2) {
      const first = paths[0] as SVGPathElement;
      const second = paths[1] as SVGPathElement;
      const dashA = first.getAttribute("stroke-dasharray");
      if (dashA) {
        const val = parseFloat(dashA.split(",")[0]);
        if (val > 0 && val <= 100) {
          results.push({ svg, first, second, value: val });
        }
      }
    }
  }
  return results;
}

/* ------------------------------------------------------------------ */
/*  Floating Image Overlay                                             */
/* ------------------------------------------------------------------ */

function FloatingImageOverlay({
  img,
  isEditMode,
  zoom,
  onUpdate,
  onDelete,
}: {
  img: FloatingImage;
  isEditMode: boolean;
  zoom: number;
  onUpdate: (id: string, patch: Partial<FloatingImage>) => void;
  onDelete: (id: string) => void;
}) {
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const resizeRef = useRef<{ startX: number; startY: number; origW: number; origH: number } | null>(null);

  const outerRef = useRef<HTMLDivElement>(null);

  const onPointerDownMove = (e: React.PointerEvent) => {
    if (!isEditMode) return;
    e.preventDefault();
    e.stopPropagation();
    outerRef.current?.setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: img.x, origY: img.y };
  };

  const getAspectRatio = () => {
    if (img.aspectMode === "freeform") return null;
    if (img.aspectMode === "1:1") return 1;
    if (img.aspectMode === "4:3") return 4 / 3;
    if (img.aspectMode === "16:9") return 16 / 9;
    return img.naturalWidth / img.naturalHeight;
  };

  const onPointerMoveHandler = (e: React.PointerEvent) => {
    if (dragRef.current) {
      const dx = (e.clientX - dragRef.current.startX) / zoom;
      const dy = (e.clientY - dragRef.current.startY) / zoom;
      onUpdate(img.id, { x: dragRef.current.origX + dx, y: dragRef.current.origY + dy });
    }
    if (resizeRef.current) {
      const dx = (e.clientX - resizeRef.current.startX) / zoom;
      const dy = (e.clientY - resizeRef.current.startY) / zoom;
      const ratio = getAspectRatio();
      let newW = Math.max(20, resizeRef.current.origW + dx);
      let newH = Math.max(20, resizeRef.current.origH + dy);
      if (ratio !== null) {
        if (Math.abs(dx) >= Math.abs(dy)) newH = newW / ratio;
        else newW = newH * ratio;
      }
      onUpdate(img.id, { width: newW, height: newH });
    }
  };

  const onPointerUp = () => {
    dragRef.current = null;
    resizeRef.current = null;
  };

  const onPointerDownResize = (e: React.PointerEvent) => {
    if (!isEditMode) return;
    e.preventDefault();
    e.stopPropagation();
    outerRef.current?.setPointerCapture(e.pointerId);
    resizeRef.current = { startX: e.clientX, startY: e.clientY, origW: img.width, origH: img.height };
  };

  /* Outer wrapper: no transform so toolbar and resize handle stay upright; move/up here so resize works */
  return (
    <div
      ref={outerRef}
      className={`floating-image-outer ${isEditMode ? "floating-image-edit" : ""}`}
      style={{
        left: img.x,
        top: img.y,
        width: img.width,
        height: img.height,
      }}
      onPointerMove={onPointerMoveHandler}
      onPointerUp={onPointerUp}
    >
      {/* Toolbar above image (does not rotate) */}
      {isEditMode && (
        <div className="floating-image-toolbar" onPointerDown={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="floating-image-delete"
            onClick={() => onDelete(img.id)}
            title="Remove image"
            aria-label="Remove image"
          >
            &times;
          </button>
          <button
            type="button"
            className="floating-image-toolbar-btn"
            onClick={() => onUpdate(img.id, { rotation: (img.rotation + 90) % 360 })}
            title="Rotate 90°"
            aria-label="Rotate image 90 degrees"
          >
            ↻ 90°
          </button>
          <select
            className="floating-image-toolbar-select"
            value={img.aspectMode}
            onChange={(e) => onUpdate(img.id, { aspectMode: e.target.value as FloatingImage["aspectMode"] })}
            title="Aspect ratio"
            aria-label="Aspect ratio"
          >
            <option value="freeform">Freeform</option>
            <option value="1:1">1:1</option>
            <option value="4:3">4:3</option>
            <option value="16:9">16:9</option>
          </select>
        </div>
      )}
      {/* Rotated content: only the image (move/up handled by outer so capture works) */}
      <div
        className="floating-image-inner"
        style={{ transform: `rotate(${img.rotation}deg)` }}
        onPointerDown={onPointerDownMove}
      >
        <img src={img.src} alt="" draggable={false} />
      </div>
      {isEditMode && (
        <div
          className="floating-image-resize"
          onPointerDown={onPointerDownResize}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Floating Text Toolbar (reference: horizontal bar, light grey)     */
/* ------------------------------------------------------------------ */

const FONT_SIZE_MIN = 10;
const FONT_SIZE_MAX = 72;
const FONT_SIZE_STEP = 2;

export type SelectionFormat = {
  fontSize: number;
  fontFamily: string;
  color: string;
};

function parseRgbOrHex(cssColor: string): string {
  if (!cssColor || cssColor.startsWith("#")) return cssColor || "#000000";
  const m = cssColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!m) return "#000000";
  const hex = [Number(m[1]), Number(m[2]), Number(m[3])]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
  return `#${hex}`;
}

function TextToolbar({
  position,
  onFormat,
  onFontSizeStep,
  initialFormat,
  onFontFamilyChange,
  fonts,
}: {
  position: { x: number; y: number };
  onFormat: (cmd: string, value?: string) => void;
  onFontSizeStep?: (delta: number) => void;
  initialFormat: SelectionFormat | null;
  onFontFamilyChange: (font: string) => void;
  fonts: string[];
}) {
  const defaultFormat: SelectionFormat = {
    fontSize: 16,
    fontFamily: "Default",
    color: "#000000",
  };
  const format = initialFormat ?? defaultFormat;
  const [fontSize, setFontSize] = useState(format.fontSize);
  const [fontFamily, setFontFamily] = useState(format.fontFamily);
  const [color, setColor] = useState(format.color);
  const [fontDropdownOpen, setFontDropdownOpen] = useState(false);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const [caseMenuOpen, setCaseMenuOpen] = useState(false);
  const [alignMenuOpen, setAlignMenuOpen] = useState(false);
  const toolbarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setFontSize(format.fontSize);
    setFontFamily(format.fontFamily);
    setColor(format.color);
  }, [format.fontSize, format.fontFamily, format.color]);

  const bold = typeof document !== "undefined" && document.queryCommandState?.("bold");
  const italic = typeof document !== "undefined" && document.queryCommandState?.("italic");
  const underline = typeof document !== "undefined" && document.queryCommandState?.("underline");
  const strike = typeof document !== "undefined" && document.queryCommandState?.("strikeThrough");

  const applySize = useCallback(
    (n: number) => {
      const size = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, n));
      setFontSize(size);
      onFormat("fontSize", `${size}px`);
    },
    [onFormat]
  );

  useEffect(() => {
    const close = (e: MouseEvent) => {
      const target = e.target as Node;
      if (toolbarRef.current && !toolbarRef.current.contains(target)) {
        setFontDropdownOpen(false);
        setColorPickerOpen(false);
        setAlignMenuOpen(false);
        setCaseMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <div
      ref={toolbarRef}
      className="text-toolbar-wrap text-toolbar-wrap--light"
      style={{ left: position.x, top: position.y }}
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      role="toolbar"
      aria-label="Text formatting"
    >
      <div className="text-toolbar text-toolbar--light">
        {/* Font family dropdown */}
        <div className="text-toolbar-font-wrap">
          <button
            type="button"
            className="text-toolbar-font-btn"
            onMouseDown={(e) => { e.preventDefault(); setFontDropdownOpen((o) => !o); }}
            title="Font family"
            aria-label="Font family"
            aria-expanded={fontDropdownOpen}
          >
            {fontFamily || "Default"}
          </button>
          {fontDropdownOpen && (
            <div className="text-toolbar-dropdown">
              {fonts.map((f) => (
                <button
                  key={f}
                  type="button"
                  className="text-toolbar-dropdown-item"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setFontFamily(f);
                    onFontFamilyChange(f);
                    setFontDropdownOpen(false);
                  }}
                >
                  {f}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Font size: [-] [number] [+] — use step so each selection uses its own current size */}
        <div className="text-toolbar-size-control">
          <button
            type="button"
            className="text-toolbar-size-btn"
            onMouseDown={(e) => {
              e.preventDefault();
              if (onFontSizeStep) onFontSizeStep(-FONT_SIZE_STEP);
              else applySize(fontSize - FONT_SIZE_STEP);
            }}
            title="Decrease size"
            aria-label="Decrease font size"
          >
            −
          </button>
          <span className="text-toolbar-size-value" aria-live="polite">
            {fontSize}
          </span>
          <button
            type="button"
            className="text-toolbar-size-btn"
            onMouseDown={(e) => {
              e.preventDefault();
              if (onFontSizeStep) onFontSizeStep(FONT_SIZE_STEP);
              else applySize(fontSize + FONT_SIZE_STEP);
            }}
            title="Increase size"
            aria-label="Increase font size"
          >
            +
          </button>
        </div>

        {/* Text color */}
        <div className="text-toolbar-color-wrap">
          <button
            type="button"
            className="text-toolbar-btn text-toolbar-btn--icon"
            onMouseDown={(e) => { e.preventDefault(); setColorPickerOpen((o) => !o); }}
            title="Text color"
            aria-label="Text color"
            aria-expanded={colorPickerOpen}
          >
            <span className="text-toolbar-icon-a">A</span>
            <span className="text-toolbar-underline" />
          </button>
          {colorPickerOpen && (
            <div className="text-toolbar-color-panel">
              <input
                type="color"
                value={color}
                onMouseDown={(e) => e.stopPropagation()}
                onChange={(e) => {
                  const v = e.target.value;
                  setColor(v);
                  onFormat("foreColor", v);
                  setColorPickerOpen(false);
                }}
                className="text-toolbar-color-input"
                title="Pick color"
              />
              {["#000000", "#374151", "#dc2626", "#2563eb", "#059669"].map((hex) => (
                <button
                  key={hex}
                  type="button"
                  className="text-toolbar-color-swatch"
                  style={{ background: hex }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setColor(hex);
                    onFormat("foreColor", hex);
                    setColorPickerOpen(false);
                  }}
                  title={hex}
                />
              ))}
            </div>
          )}
        </div>

        {/* Bold, Italic, Underline, Strikethrough */}
        <button
          type="button"
          className={`text-toolbar-btn ${bold ? "text-toolbar-btn--active" : ""}`}
          onMouseDown={(e) => { e.preventDefault(); onFormat("bold"); }}
          title="Bold"
          aria-label="Bold"
        >
          <strong>B</strong>
        </button>
        <button
          type="button"
          className={`text-toolbar-btn ${italic ? "text-toolbar-btn--active" : ""}`}
          onMouseDown={(e) => { e.preventDefault(); onFormat("italic"); }}
          title="Italic"
          aria-label="Italic"
        >
          <em>I</em>
        </button>
        <button
          type="button"
          className={`text-toolbar-btn ${underline ? "text-toolbar-btn--active" : ""}`}
          onMouseDown={(e) => { e.preventDefault(); onFormat("underline"); }}
          title="Underline"
          aria-label="Underline"
        >
          <u>U</u>
        </button>
        <button
          type="button"
          className={`text-toolbar-btn ${strike ? "text-toolbar-btn--active" : ""}`}
          onMouseDown={(e) => { e.preventDefault(); onFormat("strikeThrough"); }}
          title="Strikethrough"
          aria-label="Strikethrough"
        >
          <s>S</s>
        </button>

        {/* Case dropdown */}
        <div className="text-toolbar-case-wrap">
          <button
            type="button"
            className="text-toolbar-btn text-toolbar-btn--icon"
            onMouseDown={(e) => { e.preventDefault(); setCaseMenuOpen((o) => !o); }}
            title="Change case"
            aria-label="Change case"
            aria-expanded={caseMenuOpen}
          >
            <span className="text-toolbar-icon-case">aA</span>
          </button>
          {caseMenuOpen && (
            <div className="text-toolbar-dropdown text-toolbar-case-panel">
              <button type="button" className="text-toolbar-dropdown-item" onMouseDown={(e) => { e.preventDefault(); onFormat("transformCase", "uppercase"); setCaseMenuOpen(false); }}>UPPERCASE</button>
              <button type="button" className="text-toolbar-dropdown-item" onMouseDown={(e) => { e.preventDefault(); onFormat("transformCase", "lowercase"); setCaseMenuOpen(false); }}>lowercase</button>
              <button type="button" className="text-toolbar-dropdown-item" onMouseDown={(e) => { e.preventDefault(); onFormat("transformCase", "capitalize"); setCaseMenuOpen(false); }}>Title Case</button>
            </div>
          )}
        </div>

        {/* Alignment */}
        <div className="text-toolbar-align-wrap">
          <button
            type="button"
            className="text-toolbar-btn text-toolbar-btn--icon"
            onMouseDown={(e) => { e.preventDefault(); setAlignMenuOpen((o) => !o); }}
            title="Alignment"
            aria-label="Alignment"
            aria-expanded={alignMenuOpen}
          >
            <svg className="text-toolbar-icon-align-svg" viewBox="0 0 16 12" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M1 2h14M1 6h10M1 10h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
          {alignMenuOpen && (
            <div className="text-toolbar-align-panel">
              <button type="button" onMouseDown={(e) => { e.preventDefault(); onFormat("justifyLeft"); setAlignMenuOpen(false); }}>Left</button>
              <button type="button" onMouseDown={(e) => { e.preventDefault(); onFormat("justifyCenter"); setAlignMenuOpen(false); }}>Center</button>
              <button type="button" onMouseDown={(e) => { e.preventDefault(); onFormat("justifyRight"); setAlignMenuOpen(false); }}>Right</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Toast                                                              */
/* ------------------------------------------------------------------ */

function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2500);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div className="toast" role="status" aria-live="polite" aria-atomic="true">
      {message}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Element toolbar (delete / copy / paste)                            */
/* ------------------------------------------------------------------ */

function ElementToolbar({
  selectedRef,
  selectionTick,
  onDelete,
  onCopy,
  onPaste,
  onClear,
}: {
  selectedRef: React.RefObject<HTMLElement | null>;
  selectionTick: number;
  onDelete: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onClear: () => void;
}) {
  const el = selectedRef.current;
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  return (
    <div
      className="element-toolbar"
      style={{
        position: "fixed",
        left: rect.left + rect.width / 2,
        top: rect.top - 8,
        transform: "translate(-50%, -100%)",
        zIndex: 9999,
      }}
    >
      <button type="button" onClick={onDelete} title="Delete element">
        Delete
      </button>
      <button type="button" onClick={onCopy} title="Copy element">
        Copy
      </button>
      <button type="button" onClick={onPaste} title="Paste element">
        Paste
      </button>
      <button type="button" onClick={onClear} title="Clear selection">
        ✕
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Resize handles for text placeholder (8 points: corners + edges)   */
/* ------------------------------------------------------------------ */

const HANDLE_POSITIONS = [
  { id: "nw", x: 0, y: 0, cursor: "nwse-resize" },
  { id: "n", x: 0.5, y: 0, cursor: "ns-resize" },
  { id: "ne", x: 1, y: 0, cursor: "nesw-resize" },
  { id: "e", x: 1, y: 0.5, cursor: "ew-resize" },
  { id: "se", x: 1, y: 1, cursor: "nwse-resize" },
  { id: "s", x: 0.5, y: 1, cursor: "ns-resize" },
  { id: "sw", x: 0, y: 1, cursor: "nesw-resize" },
  { id: "w", x: 0, y: 0.5, cursor: "ew-resize" },
] as const;

const HANDLE_SIZE_CORNER = 10;
const HANDLE_SIZE_EDGE_W = 12;
const HANDLE_SIZE_EDGE_H = 8;

function ResizeHandles({ target, onCommit }: { target: HTMLElement | null; onCommit: () => void }) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const resizingRef = useRef<{
    handle: string;
    startX: number;
    startY: number;
    startW: number;
    startH: number;
    startLeft: number;
    startTop: number;
    startTransform: string;
  } | null>(null);

  useLayoutEffect(() => {
    if (!target) return;
    const update = () => {
      if (!target || !document.contains(target)) return;
      if (resizingRef.current) return;
      setRect(target.getBoundingClientRect());
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(target);
    const raf = requestAnimationFrame(update);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [target]);

  const runResize = useCallback(
    (clientX: number, clientY: number) => {
      const r = resizingRef.current;
      if (!r || !target) return;
      const el = target;
      const dx = clientX - r.startX;
      const dy = clientY - r.startY;
      let w = r.startW;
      let h = r.startH;
      let tx = 0;
      let ty = 0;
      const hh = r.handle;
      if (hh === "e" || hh === "ne" || hh === "se") w = Math.max(20, r.startW + dx);
      if (hh === "w" || hh === "nw" || hh === "sw") {
        w = Math.max(20, r.startW - dx);
        tx = dx;
      }
      if (hh === "s" || hh === "se" || hh === "sw") h = Math.max(14, r.startH + dy);
      if (hh === "n" || hh === "nw" || hh === "ne") {
        h = Math.max(14, r.startH - dy);
        ty = dy;
      }
      el.style.display = "inline-block";
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
      el.style.transform = `translate(${tx}px, ${ty}px)`;
      setRect(el.getBoundingClientRect());
    },
    [target]
  );

  const onHandlePointerDown = useCallback(
    (e: React.PointerEvent, id: string) => {
      e.preventDefault();
      e.stopPropagation();
      if (!target) return;
      const r = target.getBoundingClientRect();
      const style = getComputedStyle(target);
      const currentW = parseFloat(style.width) || r.width;
      const currentH = parseFloat(style.height) || r.height;
      resizingRef.current = {
        handle: id,
        startX: e.clientX,
        startY: e.clientY,
        startW: currentW,
        startH: currentH,
        startLeft: r.left,
        startTop: r.top,
        startTransform: (target as HTMLElement).style.transform || "",
      };
      const onMove = (e2: PointerEvent) => {
        runResize(e2.clientX, e2.clientY);
      };
      const onUp = () => {
        resizingRef.current = null;
        onCommit();
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
      };
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp, { once: true });
    },
    [target, runResize, onCommit]
  );

  if (!target || !rect || !document.contains(target)) return null;

  const isEdge = (pos: (typeof HANDLE_POSITIONS)[number]) =>
    pos.id === "n" || pos.id === "e" || pos.id === "s" || pos.id === "w";

  return (
    <div
      className="resize-handles-outline"
      style={{
        position: "fixed",
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        pointerEvents: "none",
        boxSizing: "border-box",
      }}
      aria-hidden
    >
      <div
        className="resize-handles-outline-border"
        style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
      />
      {HANDLE_POSITIONS.map(({ id, x, y, cursor }) => {
        const edge = isEdge({ id, x, y, cursor });
        const isVerticalEdge = id === "n" || id === "s";
        const w = edge ? (isVerticalEdge ? HANDLE_SIZE_EDGE_W : HANDLE_SIZE_EDGE_H) : HANDLE_SIZE_CORNER;
        const h = edge ? (isVerticalEdge ? HANDLE_SIZE_EDGE_H : HANDLE_SIZE_EDGE_W) : HANDLE_SIZE_CORNER;
        return (
          <div
            key={id}
            className={`resize-handle ${edge ? "resize-handle-oval" : "resize-handle-circle"}`}
            data-handle={id}
            style={{
              position: "absolute",
              left: x === 0 ? 0 : x === 1 ? rect.width - w : (rect.width - w) / 2,
              top: y === 0 ? 0 : y === 1 ? rect.height - h : (rect.height - h) / 2,
              width: w,
              height: h,
              marginLeft: x === 0.5 ? -w / 2 : 0,
              marginTop: y === 0.5 ? -h / 2 : 0,
              cursor,
              pointerEvents: "auto",
            }}
            onPointerDown={(e) => onHandlePointerDown(e, id)}
          />
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Export Settings Dialog                                              */
/* ------------------------------------------------------------------ */

function ExportSettingsDialog({
  options,
  onChange,
  onClose,
}: {
  options: ExportOptions;
  onChange: (o: ExportOptions) => void;
  onClose: () => void;
}) {
  return (
    <div className="export-dialog-backdrop" onClick={onClose}>
      <div className="export-dialog" onClick={(e) => e.stopPropagation()}>
        <h4>Export Settings</h4>
        <label>
          Scale
          <select
            value={options.scale ?? 2}
            onChange={(e) => onChange({ ...options, scale: Number(e.target.value) })}
          >
            <option value={1}>1x</option>
            <option value={2}>2x (Default)</option>
            <option value={3}>3x</option>
          </select>
        </label>
        <label>
          Background
          <select
            value={options.background ?? "auto"}
            onChange={(e) =>
              onChange({
                ...options,
                background: e.target.value as ExportOptions["background"],
              })
            }
          >
            <option value="auto">Auto</option>
            <option value="white">White</option>
            <option value="transparent">Transparent (PNG only)</option>
          </select>
        </label>
        <label>
          JPEG Quality
          <input
            type="range"
            min={50}
            max={100}
            value={(options.jpegQuality ?? 1) * 100}
            onChange={(e) =>
              onChange({ ...options, jpegQuality: Number(e.target.value) / 100 })
            }
          />
          <span>{Math.round((options.jpegQuality ?? 1) * 100)}%</span>
        </label>
        <button type="button" className="editor-btn" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  MAIN COMPONENT                                                     */
/* ================================================================== */

export default function EditorClient({ template }: { template: LoadedTemplate }) {
  const parsed = useMemo(() => parseTemplateHtml(template.html), [template.html]);

  /* --- Core state ------------------------------------------------- */
  const [bodyHTML, setBodyHTML] = useState(parsed.bodyHTML);
  const [colorValues, setColorValues] = useState<Record<string, string>>(parsed.initialColors);
  const [isEditMode, setIsEditMode] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [popover, setPopover] = useState<{
    open: boolean;
    x: number;
    y: number;
    value: number;
  }>({ open: false, x: 0, y: 0, value: 0 });

  /* --- P2: Tailwind lazy loading ---------------------------------- */
  const [tailwindReady, setTailwindReady] = useState(false);

  /* --- F1: Font override ------------------------------------------ */
  const [fontOverride, setFontOverride] = useState("Default");

  /* --- F2: Zoom --------------------------------------------------- */
  const [zoom, setZoom] = useState(1);

  /* --- F4: Section toggles ---------------------------------------- */
  const [sections, setSections] = useState<SectionInfo[]>([]);

  /* --- F5: Pie chart ---------------------------------------------- */
  const [pieValue, setPieValue] = useState<number | null>(null);

  /* --- F7: Save/load toast ---------------------------------------- */
  const [toast, setToast] = useState<string | null>(null);
  const [hasSavedState, setHasSavedState] = useState(false);
  /* --- Save as copy / Load copy ------------------------------------ */
  const [copyKeysVersion, setCopyKeysVersion] = useState(0);

  /* --- Project name (export filename) ----------------------------- */
  const [projectName, setProjectName] = useState(template.name);

  /* --- F9: Export settings ---------------------------------------- */
  const [exportOpts, setExportOpts] = useState<ExportOptions>({ scale: 2, background: "auto", jpegQuality: 1 });
  const [showExportSettings, setShowExportSettings] = useState(false);

  /* --- F10: Responsive preview ------------------------------------ */
  const [previewMode, setPreviewMode] = useState<PreviewMode>("desktop");

  /* --- F11: Text toolbar ------------------------------------------ */
  const [textToolbar, setTextToolbar] = useState<{ x: number; y: number } | null>(null);
  const [selectionFormat, setSelectionFormat] = useState<SelectionFormat | null>(null);
  const [resizeTarget, setResizeTarget] = useState<HTMLElement | null>(null);
  const textToolbarRangeRef = useRef<Range | null>(null);
  const multiSelectedEditablesRef = useRef<Set<HTMLElement>>(new Set());

  /* --- Marquee selection (drag to select like Canva) ----------------- */
  const [marquee, setMarquee] = useState<{ startX: number; startY: number; endX: number; endY: number } | null>(null);
  const marqueeRectRef = useRef<{ startX: number; startY: number; endX: number; endY: number } | null>(null);

  /* --- F12: Background override ----------------------------------- */
  const [bgOverride, setBgOverride] = useState("");

  /* --- Floating images -------------------------------------------- */
  const [floatingImages, setFloatingImages] = useState<FloatingImage[]>([]);

  /* --- Element selection (delete / copy / paste) ------------------- */
  const selectedElementRef = useRef<HTMLElement | null>(null);
  const [selectionTick, setSelectionTick] = useState(0);
  const copiedElementHtmlRef = useRef<string>("");

  /* --- Refs ------------------------------------------------------- */
  const previewRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const lastBodyHTMLSyncedRef = useRef<string | null>(null);
  const historyRef = useRef<Snapshot[]>([]);
  const historyIndexRef = useRef(-1);
  const [, refreshHistoryUi] = useState(0);
  const skipPushRef = useRef(false);
  const colorTimerRef = useRef<number | null>(null);
  const progressTargetRef = useRef<ProgressTarget | null>(null);
  const saveTimerRef = useRef<number | null>(null);

  /* --- Derived ---------------------------------------------------- */
  const historyIndex = historyIndexRef.current;
  const canUndo = historyIndex > 0;
  const canRedo = historyIndex >= 0 && historyIndex < historyRef.current.length - 1;

  const cssVarStyle = useMemo(() => {
    const styles: Record<string, string> = {};
    Object.entries(colorValues).forEach(([key, value]) => {
      styles[key] = value;
    });
    return styles as React.CSSProperties;
  }, [colorValues]);

  const canvasWidth = PREVIEW_WIDTHS[previewMode];

  /* ---------------------------------------------------------------- */
  /*  History management                                               */
  /* ---------------------------------------------------------------- */

  const pushSnapshot = useCallback(
    (snapshot: Snapshot) => {
      if (skipPushRef.current) return;
      const base = historyRef.current.slice(0, historyIndexRef.current + 1);
      if (areSnapshotsEqual(base[base.length - 1], snapshot)) return;

      base.push(snapshot);
      if (base.length > MAX_HISTORY) base.shift();

      historyRef.current = base;
      historyIndexRef.current = base.length - 1;
      refreshHistoryUi((v) => v + 1);

      /* F7: auto-save */
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(() => {
        try {
          localStorage.setItem(
            SAVE_KEY(template.id),
            JSON.stringify({ bodyHTML: snapshot.bodyHTML, colors: snapshot.colors })
          );
        } catch { /* quota exceeded — ignore */ }
      }, 1000);
    },
    [template.id]
  );

  const commitFromDom = useCallback(() => {
    const body = bodyRef.current;
    if (body) syncDemographicBars(body);
    const nextBody = body?.innerHTML ?? bodyHTML;
    pushSnapshot({ bodyHTML: nextBody, colors: { ...colorValues } });
    setBodyHTML(nextBody);
    lastBodyHTMLSyncedRef.current = nextBody;
  }, [bodyHTML, colorValues, pushSnapshot]);

  const restoreSnapshot = useCallback((snapshot: Snapshot) => {
    skipPushRef.current = true;
    setBodyHTML(snapshot.bodyHTML);
    setColorValues(snapshot.colors);
    setTimeout(() => { skipPushRef.current = false; }, 0);
  }, []);

  const undo = useCallback(() => {
    if (historyIndexRef.current <= 0) return;
    historyIndexRef.current -= 1;
    restoreSnapshot(historyRef.current[historyIndexRef.current]);
    refreshHistoryUi((v) => v + 1);
  }, [restoreSnapshot]);

  const redo = useCallback(() => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    historyIndexRef.current += 1;
    restoreSnapshot(historyRef.current[historyIndexRef.current]);
    refreshHistoryUi((v) => v + 1);
  }, [restoreSnapshot]);

  const resetColors = useCallback(() => {
    setColorValues(parsed.initialColors);
    setTimeout(() => commitFromDom(), 0);
  }, [parsed.initialColors, commitFromDom]);

  /* ---------------------------------------------------------------- */
  /*  Export handlers                                                   */
  /* ---------------------------------------------------------------- */

  const baseName = useMemo(
    () =>
      (projectName || template.name)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "template",
    [projectName, template.name]
  );

  const onExport = useCallback(
    async (type: "png" | "jpg" | "pdf" | "clipboard") => {
      const target = previewRef.current;
      if (!target) return;
      setIsBusy(true);
      try {
        if (type === "png") await exportPng(target, baseName, exportOpts);
        if (type === "jpg") await exportJpg(target, baseName, exportOpts);
        if (type === "pdf") await exportPdf(target, baseName, exportOpts);
        if (type === "clipboard") {
          const ok = await exportClipboard(target, exportOpts);
          setToast(ok ? "Copied to clipboard!" : "Clipboard copy failed");
        }
      } finally {
        setIsBusy(false);
      }
    },
    [baseName, exportOpts]
  );

  const saveAsNewTemplate = useCallback(() => {
    const body = bodyRef.current;
    const currentBody = body?.innerHTML ?? bodyHTML;
    const styleType = parsed.hasTailwindStyle ? "text/tailwindcss" : "text/css";
    let stylesWithColors = parsed.styles;
    for (const [varName, value] of Object.entries(colorValues)) {
      const re = new RegExp(`(${varName}\\s*:\\s*)(#[0-9a-fA-F]{3,8}|[^;]+)(;)`, "g");
      stylesWithColors = stylesWithColors.replace(re, `$1${value}$3`);
    }
    const linkTags = parsed.links
      .map((href) => `<link rel="stylesheet" href="${href.replace(/"/g, "&quot;")}" />`)
      .join("\n");
    const title = (projectName || template.name).replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const fullHtml = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>${title}</title>
${linkTags}
<style type="${styleType}">${stylesWithColors}</style>
</head>
<body class="${(parsed.bodyClass || "min-h-screen p-6 md:p-12").replace(/"/g, "&quot;")}">
${currentBody}
</body></html>`;
    const blob = new Blob([fullHtml], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${baseName}.html`;
    a.click();
    URL.revokeObjectURL(url);
    setToast("Saved as new template");
  }, [bodyHTML, colorValues, parsed, projectName, template.name, baseName]);

  /* ---------------------------------------------------------------- */
  /*  F1: Font change handler                                          */
  /* ---------------------------------------------------------------- */

  const applyFontOverride = useCallback((font: string) => {
    setFontOverride(font);
    const body = bodyRef.current;
    if (!body) return;
    if (font === "Default") {
      body.style.removeProperty("font-family");
    } else {
      body.style.fontFamily = `'${font}', sans-serif`;
    }
  }, []);

  /* ---------------------------------------------------------------- */
  /*  F2: Zoom handlers                                                */
  /* ---------------------------------------------------------------- */

  const zoomIn = useCallback(() => {
    setZoom((z) => {
      const next = ZOOM_STEPS.find((s) => s > z);
      return next ?? z;
    });
  }, []);

  const zoomOut = useCallback(() => {
    setZoom((z) => {
      const prev = [...ZOOM_STEPS].reverse().find((s) => s < z);
      return prev ?? z;
    });
  }, []);

  /* ---------------------------------------------------------------- */
  /*  F3: Image upload handler                                         */
  /* ---------------------------------------------------------------- */

  const handleImageClick = useCallback(
    (img: HTMLImageElement) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          img.src = reader.result as string;
          setTimeout(() => commitFromDom(), 0);
        };
        reader.readAsDataURL(file);
      };
      input.click();
    },
    [commitFromDom]
  );

  /* ---------------------------------------------------------------- */
  /*  F5: Pie chart update                                             */
  /* ---------------------------------------------------------------- */

  const updatePieChart = useCallback(
    (val: number) => {
      setPieValue(val);
      const body = bodyRef.current;
      if (!body) return;
      const charts = detectAllPieCharts(body);
      if (charts.length === 0) return;

      for (const chart of charts) {
        chart.first.setAttribute("stroke-dasharray", `${val}, 100`);
        chart.second.setAttribute("stroke-dasharray", `${100 - val}, 100`);
        chart.second.setAttribute("stroke-dashoffset", `-${val}`);

        const demoSection =
          chart.svg.closest('[class*="col-span"]') ??
          chart.svg.closest('[class*="space-y"]') ??
          chart.svg.closest("div")?.parentElement?.parentElement;

        if (demoSection) {
          const allSpans = demoSection.querySelectorAll<HTMLElement>("span");
          const percentSpans = Array.from(allSpans).filter((s) =>
            /^\s*\d+\s*%\s*$/.test(s.textContent?.trim() ?? "")
          );
          if (percentSpans.length >= 1) percentSpans[0].textContent = `${val}%`;
          if (percentSpans.length >= 2) percentSpans[1].textContent = `${val}%`;
          if (percentSpans.length >= 3) percentSpans[2].textContent = `${100 - val}%`;
        }
      }

      setTimeout(() => commitFromDom(), 0);
    },
    [commitFromDom]
  );

  /* ---------------------------------------------------------------- */
  /*  F11: Text formatting                                             */
  /* ---------------------------------------------------------------- */

  const getFormatFromSelection = useCallback(() => {
    const sel = document.getSelection();
    const savedRange = textToolbarRangeRef.current;
    const range = (sel?.rangeCount ? sel.getRangeAt(0) : savedRange) ?? null;
    if (!range) return null;
    let node: Node = range.startContainer;
    if (node.nodeType === Node.TEXT_NODE) {
      node = node.parentElement as HTMLElement;
    } else if (node.nodeType === Node.ELEMENT_NODE && range.startOffset < node.childNodes.length) {
      const child = node.childNodes[range.startOffset];
      if (child?.nodeType === Node.ELEMENT_NODE) node = child;
    }
    const el = node as HTMLElement | null;
    if (!el || typeof getComputedStyle === "undefined" || !document.contains(el)) return null;
    const style = getComputedStyle(el);
    const fontSizeStr = style.fontSize || "";
    const fontSize = Math.round(parseFloat(fontSizeStr)) || 16;
    let fontFamily = (style.fontFamily || "Default").trim();
    const firstComma = fontFamily.indexOf(",");
    if (firstComma !== -1) fontFamily = fontFamily.slice(0, firstComma).trim().replace(/^["']|["']$/g, "");
    if (!fontFamily) fontFamily = "Default";
    const color = parseRgbOrHex(style.color || "#000000");
    return { fontSize, fontFamily, color };
  }, []);

  const getFontSizeFromRange = useCallback((range: Range): number => {
    let node: Node = range.startContainer;
    if (node.nodeType === Node.TEXT_NODE) {
      node = node.parentElement as HTMLElement;
    } else if (node.nodeType === Node.ELEMENT_NODE && range.startOffset < node.childNodes.length) {
      const child = node.childNodes[range.startOffset];
      if (child?.nodeType === Node.ELEMENT_NODE) node = child;
    }
    const el = node as HTMLElement;
    const style = typeof getComputedStyle !== "undefined" ? getComputedStyle(el) : null;
    const fontSizeStr = style?.fontSize || "";
    return Math.round(parseFloat(fontSizeStr)) || 16;
  }, []);

  const applyToSelection = useCallback(
    (wrap: (range: Range) => void) => {
      const sel = document.getSelection();
      const savedRange = textToolbarRangeRef.current;
      const range = (sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : savedRange) ?? null;
      if (!range || range.collapsed) return;
      try {
        if (savedRange && (!sel || !sel.rangeCount || sel.getRangeAt(0).collapsed)) {
          sel?.removeAllRanges();
          sel?.addRange(savedRange);
        }
        const r = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : range;
        wrap(r);
        textToolbarRangeRef.current = null;
      } catch {
        /* ignore */
      }
    },
    []
  );

  const applyFormatToRange = useCallback((r: Range, cmd: string, value?: string) => {
    if (cmd === "fontSize" && value) {
      const fragment = r.cloneContents();
      const div = document.createElement("div");
      div.appendChild(fragment);
      const span = document.createElement("span");
      span.style.fontSize = value;
      span.innerHTML = div.innerHTML;
      r.deleteContents();
      r.insertNode(span);
    } else if (cmd === "fontName" && value) {
      const fragment = r.cloneContents();
      const div = document.createElement("div");
      div.appendChild(fragment);
      const span = document.createElement("span");
      span.style.fontFamily = value === "Default" ? "" : `'${value}', sans-serif`;
      span.innerHTML = div.innerHTML;
      r.deleteContents();
      r.insertNode(span);
    } else if (cmd === "transformCase" && value) {
      const text = r.toString();
      const transformed =
        value === "uppercase"
          ? text.toUpperCase()
          : value === "lowercase"
            ? text.toLowerCase()
            : text.replace(/\b\w/g, (c) => c.toUpperCase());
      const textNode = document.createTextNode(transformed);
      r.deleteContents();
      r.insertNode(textNode);
    }
  }, []);

  const onFormat = useCallback(
    (cmd: string, value?: string) => {
      const body = bodyRef.current;
      if (body) {
        pushSnapshot({ bodyHTML: body.innerHTML, colors: { ...colorValues } });
      }
      const multiSet = multiSelectedEditablesRef.current;
      const applyToOneRange = (r: Range) => {
        if (cmd === "fontSize" && value) {
          const fragment = r.cloneContents();
          const div = document.createElement("div");
          div.appendChild(fragment);
          const span = document.createElement("span");
          span.style.fontSize = value;
          span.innerHTML = div.innerHTML;
          r.deleteContents();
          r.insertNode(span);
          r.setStartBefore(span);
          r.setEndAfter(span);
          document.getSelection()?.removeAllRanges();
          document.getSelection()?.addRange(r);
        } else if (cmd === "fontName" && value) {
          const fragment = r.cloneContents();
          const div = document.createElement("div");
          div.appendChild(fragment);
          const span = document.createElement("span");
          span.style.fontFamily = value === "Default" ? "" : `'${value}', sans-serif`;
          span.innerHTML = div.innerHTML;
          r.deleteContents();
          r.insertNode(span);
          r.setStartBefore(span);
          r.setEndAfter(span);
          document.getSelection()?.removeAllRanges();
          document.getSelection()?.addRange(r);
        } else if (cmd === "transformCase" && value) {
          const text = r.toString();
          const transformed =
            value === "uppercase"
              ? text.toUpperCase()
              : value === "lowercase"
                ? text.toLowerCase()
                : text.replace(/\b\w/g, (c) => c.toUpperCase());
          const textNode = document.createTextNode(transformed);
          r.deleteContents();
          r.insertNode(textNode);
          r.setStartBefore(textNode);
          r.setEndAfter(textNode);
          document.getSelection()?.removeAllRanges();
          document.getSelection()?.addRange(r);
        }
      };

      if (cmd === "fontSize" || cmd === "fontName" || cmd === "transformCase") {
        const sel = document.getSelection();
        const savedRange = textToolbarRangeRef.current;
        const primaryRange = (sel?.rangeCount ? sel.getRangeAt(0) : savedRange) ?? null;
        const primaryEditable = primaryRange?.startContainer?.nodeType === Node.TEXT_NODE
          ? (primaryRange.startContainer as Node).parentElement?.closest?.("[data-editable='true']")
          : (primaryRange?.startContainer as HTMLElement)?.closest?.("[data-editable='true']");

        if (primaryRange && !primaryRange.collapsed) {
          if (savedRange && (!sel || !sel.rangeCount || sel.getRangeAt(0).collapsed)) {
            sel?.removeAllRanges();
            sel?.addRange(savedRange);
          }
          const r = sel?.rangeCount ? sel.getRangeAt(0) : primaryRange;
          if (r) applyToOneRange(r);
        }

        multiSet.forEach((el) => {
          if (!body?.contains(el)) {
            multiSet.delete(el);
            el.classList.remove("text-placeholder-multi-selected");
            return;
          }
          if (el === primaryEditable && primaryRange && !primaryRange.collapsed) return;
          const range = document.createRange();
          range.selectNodeContents(el);
          applyFormatToRange(range, cmd, value);
        });
      } else {
        const execCommands = ["justifyLeft", "justifyCenter", "justifyRight", "foreColor", "bold", "italic", "underline", "strikeThrough"];
        if (multiSet.size > 1 && execCommands.includes(cmd)) {
          const first = multiSet.values().next().value as HTMLElement | undefined;
          if (first && body?.contains(first)) {
            const r = document.createRange();
            r.selectNodeContents(first);
            const execSel = document.getSelection();
            execSel?.removeAllRanges();
            execSel?.addRange(r);
          }
        }
        document.execCommand(cmd, false, value);
      }
      const nextFormat = getFormatFromSelection();
      if (nextFormat) setSelectionFormat(nextFormat);
      const sel = document.getSelection();
      if (sel?.rangeCount) {
        textToolbarRangeRef.current = sel.getRangeAt(0).cloneRange();
      }
    },
    [applyFormatToRange, getFormatFromSelection, colorValues, pushSnapshot]
  );

  const onFontSizeStep = useCallback(
    (delta: number) => {
      const body = bodyRef.current;
      if (body) pushSnapshot({ bodyHTML: body.innerHTML, colors: { ...colorValues } });
      const multiSet = multiSelectedEditablesRef.current;
      const sel = document.getSelection();
      const savedRange = textToolbarRangeRef.current;
      const primaryRange = (sel?.rangeCount ? sel.getRangeAt(0) : savedRange) ?? null;
      const primaryEditable =
        primaryRange?.startContainer?.nodeType === Node.TEXT_NODE
          ? (primaryRange.startContainer as Node).parentElement?.closest?.("[data-editable='true']")
          : (primaryRange?.startContainer as HTMLElement)?.closest?.("[data-editable='true']");

      const applySizeToRange = (r: Range, sizePx: string) => {
        applyFormatToRange(r, "fontSize", sizePx);
      };

      if (primaryRange && !primaryRange.collapsed) {
        if (savedRange && (!sel || !sel.rangeCount || sel.getRangeAt(0).collapsed)) {
          sel?.removeAllRanges();
          sel?.addRange(savedRange);
        }
        const r = sel?.rangeCount ? sel.getRangeAt(0) : primaryRange;
        if (r) {
          const current = getFontSizeFromRange(r);
          const next = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, current + delta));
          const fragment = r.cloneContents();
          const div = document.createElement("div");
          div.appendChild(fragment);
          const span = document.createElement("span");
          span.style.fontSize = `${next}px`;
          span.innerHTML = div.innerHTML;
          r.deleteContents();
          r.insertNode(span);
          r.setStartBefore(span);
          r.setEndAfter(span);
          document.getSelection()?.removeAllRanges();
          document.getSelection()?.addRange(r);
        }
      }

      multiSet.forEach((el) => {
        if (!body?.contains(el)) {
          multiSet.delete(el);
          el.classList.remove("text-placeholder-multi-selected");
          return;
        }
        if (el === primaryEditable && primaryRange && !primaryRange.collapsed) return;
        const range = document.createRange();
        range.selectNodeContents(el);
        const current = getFontSizeFromRange(range);
        const next = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, current + delta));
        applySizeToRange(range, `${next}px`);
      });

      const nextFormat = getFormatFromSelection();
      if (nextFormat) setSelectionFormat(nextFormat);
      const s = document.getSelection();
      if (s?.rangeCount) textToolbarRangeRef.current = s.getRangeAt(0).cloneRange();
    },
    [applyFormatToRange, getFormatFromSelection, colorValues, pushSnapshot, getFontSizeFromRange]
  );

  /* ---------------------------------------------------------------- */
  /*  F12: Background override                                         */
  /* ---------------------------------------------------------------- */

  const applyBgOverride = useCallback((value: string) => {
    setBgOverride(value);
    const body = bodyRef.current;
    if (!body) return;
    if (!value) {
      body.style.removeProperty("background");
      body.style.removeProperty("background-color");
      body.style.removeProperty("background-image");
    } else {
      body.style.background = value;
    }
  }, []);

  /* ---------------------------------------------------------------- */
  /*  Floating image handlers                                          */
  /* ---------------------------------------------------------------- */

  const addFloatingImage = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const imgEl = new Image();
        imgEl.onload = () => {
          const maxDim = 300;
          const scale = Math.min(maxDim / imgEl.naturalWidth, maxDim / imgEl.naturalHeight, 1);
          const newImg: FloatingImage = {
            id: `fimg-${Date.now()}`,
            src: reader.result as string,
            x: 50,
            y: 50,
            width: imgEl.naturalWidth * scale,
            height: imgEl.naturalHeight * scale,
            rotation: 0,
            naturalWidth: imgEl.naturalWidth,
            naturalHeight: imgEl.naturalHeight,
            aspectMode: "freeform",
          };
          setFloatingImages((prev) => [...prev, newImg]);
        };
        imgEl.src = reader.result as string;
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }, []);

  const updateFloatingImage = useCallback((id: string, patch: Partial<FloatingImage>) => {
    setFloatingImages((prev) =>
      prev.map((img) => (img.id === id ? { ...img, ...patch } : img))
    );
  }, []);

  const deleteFloatingImage = useCallback((id: string) => {
    setFloatingImages((prev) => prev.filter((img) => img.id !== id));
  }, []);

  /* ---------------------------------------------------------------- */
  /*  Element selection: delete / copy / paste                         */
  /* ---------------------------------------------------------------- */

  const clearElementSelection = useCallback(() => {
    if (selectedElementRef.current) {
      selectedElementRef.current.classList.remove("element-selected");
      selectedElementRef.current = null;
      setSelectionTick((t) => t + 1);
    }
  }, []);

  const deleteSelectedElement = useCallback(() => {
    const el = selectedElementRef.current;
    if (!el || !bodyRef.current?.contains(el)) return;
    const parent = el.parentElement;
    if (!parent) return;
    parent.removeChild(el);
    selectedElementRef.current = null;
    setSelectionTick((t) => t + 1);
    commitFromDom();
  }, [commitFromDom]);

  const copySelectedElement = useCallback(() => {
    const el = selectedElementRef.current;
    if (!el) return;
    copiedElementHtmlRef.current = el.outerHTML;
  }, []);

  const pasteElement = useCallback(() => {
    const html = copiedElementHtmlRef.current;
    if (!html || !bodyRef.current) return;
    const container = document.createElement("div");
    container.innerHTML = html;
    const newNode = container.firstElementChild as HTMLElement;
    if (!newNode) return;
    newNode.classList.remove("element-selected");
    const insertAfter = selectedElementRef.current;
    if (insertAfter?.nextSibling) {
      insertAfter.parentElement?.insertBefore(newNode, insertAfter.nextSibling);
    } else if (insertAfter?.parentElement) {
      insertAfter.parentElement.appendChild(newNode);
    } else {
      bodyRef.current.appendChild(newNode);
    }
    commitFromDom();
  }, [commitFromDom]);

  const onBodyPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!isEditMode || !bodyRef.current) return;
      const target = e.target as HTMLElement;
      if (!bodyRef.current.contains(target) || target === bodyRef.current) return;
      if ((e.metaKey || e.ctrlKey) && e.button === 0) {
        const editable = target.closest<HTMLElement>("[data-editable='true']");
        if (editable) {
          e.preventDefault();
          const set = multiSelectedEditablesRef.current;
          if (set.has(editable)) {
            set.delete(editable);
            editable.classList.remove("text-placeholder-multi-selected");
          } else {
            set.add(editable);
            editable.classList.add("text-placeholder-multi-selected");
          }
          if (set.size > 0) {
            const first = Array.from(set)[0];
            const range = document.createRange();
            range.selectNodeContents(first);
            textToolbarRangeRef.current = range.cloneRange();
            const rect = first.getBoundingClientRect();
            setTextToolbar({ x: rect.left + rect.width / 2, y: rect.top - 48 });
            setSelectionFormat(getFormatFromSelection());
            setResizeTarget(first);
          } else {
            setTextToolbar(null);
            setSelectionFormat(null);
            setResizeTarget(null);
            textToolbarRangeRef.current = null;
          }
          return;
        }
        e.preventDefault();
        selectedElementRef.current?.classList.remove("element-selected");
        selectedElementRef.current = target;
        target.classList.add("element-selected");
        setSelectionTick((t) => t + 1);
      }
    },
    [isEditMode, getFormatFromSelection]
  );

  const onBodyKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isEditMode) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedElementRef.current && !document.activeElement?.closest("input, textarea, [contenteditable=true]")) {
          e.preventDefault();
          deleteSelectedElement();
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "c") {
        if (selectedElementRef.current) copySelectedElement();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "v") {
        if (copiedElementHtmlRef.current) {
          e.preventDefault();
          pasteElement();
        }
      }
      if (e.key === "Escape") clearElementSelection();
    },
    [isEditMode, deleteSelectedElement, copySelectedElement, pasteElement, clearElementSelection]
  );

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    body.addEventListener("keydown", onBodyKeyDown as unknown as (e: Event) => void);
    return () => body.removeEventListener("keydown", onBodyKeyDown as unknown as (e: Event) => void);
  }, [onBodyKeyDown]);

  /* ================================================================ */
  /*  Effects                                                          */
  /* ================================================================ */

  /* P2: Lazily load Tailwind CDN ----------------------------------- */
  useEffect(() => {
    const existing = document.querySelector(
      'script[src*="cdn.tailwindcss.com"]'
    );
    if (existing) {
      setTailwindReady(true);
      return;
    }

    const script = document.createElement("script");
    script.src =
      "https://cdn.tailwindcss.com?plugins=forms,typography,container-queries";
    script.onload = () => setTailwindReady(true);
    script.onerror = () => setTailwindReady(true); // proceed anyway
    document.head.appendChild(script);
  }, []);

  /* Init state on template change ---------------------------------- */
  useEffect(() => {
    setBodyHTML(parsed.bodyHTML);
    setColorValues(parsed.initialColors);
    lastBodyHTMLSyncedRef.current = null;
    historyRef.current = [];
    historyIndexRef.current = -1;
    setFontOverride("Default");
    setBgOverride("");
    setPieValue(null);
    const initial: Snapshot = {
      bodyHTML: parsed.bodyHTML,
      colors: { ...parsed.initialColors },
    };
    pushSnapshot(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template.id]);

  /* F7: Check for saved state -------------------------------------- */
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SAVE_KEY(template.id));
      setHasSavedState(!!saved);
    } catch {
      setHasSavedState(false);
    }
  }, [template.id]);

  const restoreSavedState = useCallback(() => {
    try {
      const raw = localStorage.getItem(SAVE_KEY(template.id));
      if (!raw) return;
      const saved = JSON.parse(raw) as Snapshot;
      setBodyHTML(saved.bodyHTML);
      setColorValues(saved.colors);
      pushSnapshot(saved);
      setHasSavedState(false);
      setToast("Previous edits restored");
    } catch { /* ignore */ }
  }, [template.id, pushSnapshot]);

  const clearSavedState = useCallback(() => {
    try { localStorage.removeItem(SAVE_KEY(template.id)); } catch { /* ignore */ }
    setHasSavedState(false);
  }, [template.id]);

  const resetToOriginal = useCallback(() => {
    setBodyHTML(parsed.bodyHTML);
    setColorValues(parsed.initialColors);
    setFontOverride("Default");
    setBgOverride("");
    setProjectName(template.name);
    clearSavedState();
    const initial: Snapshot = { bodyHTML: parsed.bodyHTML, colors: { ...parsed.initialColors } };
    pushSnapshot(initial);
    setToast("Reset to original");
  }, [parsed.bodyHTML, parsed.initialColors, clearSavedState, pushSnapshot, template.name]);

  type CopySnapshot = Snapshot & { savedAt?: number };
  const saveAsCopy = useCallback(() => {
    const nextBody = bodyRef.current?.innerHTML ?? bodyHTML;
    const snapshot: CopySnapshot = { bodyHTML: nextBody, colors: { ...colorValues }, savedAt: Date.now() };
    const key = `${COPY_KEY_PREFIX(template.id)}${snapshot.savedAt}`;
    try {
      localStorage.setItem(key, JSON.stringify(snapshot));
      setCopyKeysVersion((v) => v + 1);
      setToast("Saved as copy");
    } catch {
      setToast("Failed to save copy");
    }
  }, [template.id, bodyHTML, colorValues]);

  const copyKeys = useMemo(
    () => (typeof window !== "undefined" ? getCopyKeys(template.id) : []),
    [template.id, copyKeysVersion]
  );

  const loadCopy = useCallback(
    (storageKey: string) => {
      try {
        const raw = localStorage.getItem(storageKey);
        if (!raw) return;
        const saved = JSON.parse(raw) as CopySnapshot;
        setBodyHTML(saved.bodyHTML);
        setColorValues(saved.colors);
        pushSnapshot({ bodyHTML: saved.bodyHTML, colors: saved.colors });
        setToast("Copy loaded");
      } catch { /* ignore */ }
    },
    [pushSnapshot]
  );

  /* Inject stylesheet links ---------------------------------------- */
  useEffect(() => {
    if (!parsed.links.length) return;
    const injected: HTMLLinkElement[] = [];
    parsed.links.forEach((href) => {
      const key = `template-link:${href}`;
      if (document.head.querySelector(`link[data-template-head='${key}']`)) return;
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      link.setAttribute("data-template-head", key);
      document.head.appendChild(link);
      injected.push(link);
    });
    return () => { injected.forEach((link) => link.remove()); };
  }, [parsed.links]);

  /* Inject inline scripts (must wait for Tailwind CDN) -------------- */
  useEffect(() => {
    if (!tailwindReady || !parsed.inlineScripts.length) return;
    const scripts: HTMLScriptElement[] = [];
    parsed.inlineScripts.forEach((code, index) => {
      const script = document.createElement("script");
      script.setAttribute("data-template-inline", `${template.id}-${index}`);
      script.text = code;
      document.head.appendChild(script);
      scripts.push(script);
    });
    const tw = (window as Window & { tailwind?: { refresh?: () => void } }).tailwind;
    if (tw?.refresh) tw.refresh();
    return () => { scripts.forEach((s) => s.remove()); };
  }, [parsed.inlineScripts, template.id, tailwindReady]);

  /* P4: Keyboard shortcuts (fixed deps) ---------------------------- */
  useEffect(() => {
    const onKeydown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const isMeta = event.ctrlKey || event.metaKey;

      if (key === "a" && isMeta && isEditMode) {
        const active = document.activeElement as HTMLElement | null;
        const editable = active?.closest?.("[data-editable='true']") as HTMLElement | null;
        if (editable) {
          event.preventDefault();
          const sel = window.getSelection();
          if (!sel) return;
          const range = document.createRange();
          range.selectNodeContents(editable);
          sel.removeAllRanges();
          sel.addRange(range);
        }
        return;
      }

      if (!isMeta) return;
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if ((key === "z" && event.shiftKey) || key === "y") {
        event.preventDefault();
        redo();
      } else if (key === "=" || key === "+") {
        event.preventDefault();
        zoomIn();
      } else if (key === "-") {
        event.preventDefault();
        zoomOut();
      }
    };
    document.addEventListener("keydown", onKeydown);
    return () => document.removeEventListener("keydown", onKeydown);
  }, [undo, redo, zoomIn, zoomOut, isEditMode]);

  /* Sync bodyHTML to DOM ------------------------------------------- */
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    if (lastBodyHTMLSyncedRef.current !== bodyHTML) {
      body.innerHTML = bodyHTML;
      lastBodyHTMLSyncedRef.current = bodyHTML;
    }
  }, [bodyHTML, tailwindReady]);

  /* Refresh Tailwind after template content is in the DOM ---------- */
  useEffect(() => {
    if (!tailwindReady) return;
    const tw = (window as Window & { tailwind?: { refresh?: () => void } }).tailwind;
    if (tw?.refresh) {
      tw.refresh();
      const timer = setTimeout(() => tw.refresh?.(), 200);
      return () => clearTimeout(timer);
    }
  }, [tailwindReady, bodyHTML]);

  /* Setup editable elements ---------------------------------------- */
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;

    if (!isEditMode) {
      body.querySelectorAll<HTMLElement>("[data-editable='true']").forEach((el) => {
        el.removeAttribute("contenteditable");
        el.removeAttribute("data-editable");
      });
      return;
    }

    const setupEditable = () => {
      if (!body.hasChildNodes() || body.children.length === 0) return;

      /* Text elements */
      const editableEls = body.querySelectorAll<HTMLElement>(TEXT_SELECTORS);
      editableEls.forEach((el) => {
        const text = el.textContent?.trim();
        if (!text) return;
        const insideBlock =
          (el.tagName === "SPAN" || el.tagName === "STRONG") &&
          el.closest("h1, h2, h3, h4, h5, h6, p");
        if (insideBlock) return;
        el.setAttribute("contenteditable", "true");
        el.setAttribute("data-editable", "true");
        el.setAttribute("data-element-id", `el-${Math.random().toString(36).slice(2, 9)}`);
      });

      /* Stat / metric divs (e.g. demographic bar values, data-metric numbers) */
      const statPattern = /^\s*[\d,.]+\s*%?\s*$/;
      body.querySelectorAll<HTMLElement>("div.data-metric, div[data-stat]").forEach((el) => {
        const text = el.textContent?.trim();
        if (!text) return;
        if (!statPattern.test(text) && !el.hasAttribute("data-stat")) return;
        if (el.hasAttribute("data-editable")) return;
        el.setAttribute("contenteditable", "true");
        el.setAttribute("data-editable", "true");
        el.setAttribute("data-element-id", `el-${Math.random().toString(36).slice(2, 9)}`);
      });

      /* Progress bars */
      const progressBars = body.querySelectorAll<HTMLElement>(".thin-progress-bar");
      progressBars.forEach((bar, index) => {
        const row = bar.previousElementSibling;
        if (!row) return;
        const spans = Array.from(row.querySelectorAll<HTMLElement>("span"));
        const valueSpan = spans.find((span) =>
          /^\s*\d+\s*%?\s*$/.test(span.textContent?.trim() ?? "")
        );
        const fill = bar.querySelector<HTMLElement>(".thin-progress-fill");
        if (!valueSpan || !fill) return;
        const fillId = `progress-fill-${index}`;
        fill.dataset.progressFillId = fillId;
        valueSpan.dataset.progressFillId = fillId;
        valueSpan.setAttribute("data-progress-value", "true");
      });

      /* F3: Image click handlers */
      body.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
        img.style.cursor = "pointer";
        img.title = "Click to replace image";
      });

      /* F4: Detect sections */
      setSections(detectSections(body));

      /* F5: Detect pie chart */
      const chart = detectPieChart(body);
      if (chart && pieValue === null) {
        setPieValue(chart.value);
      }
    };

    setupEditable();
    const raf = requestAnimationFrame(() => setupEditable());
    const retry = window.setTimeout(() => setupEditable(), 100);

    const onBlur = (event: FocusEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("[data-editable='true']")) commitFromDom();
    };

    const onInput = () => {
      const active = document.activeElement as HTMLElement | null;
      if (active?.closest?.(".grid.grid-cols-12") && active?.closest?.("[data-editable='true']"))
        syncDemographicBars(body);
    };

    const onEditableMouseDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const editable = target.closest<HTMLElement>("[data-editable='true']");
      if (!editable || event.ctrlKey || event.metaKey) return;
      /* Select-all only when clicking on the placeholder border (edge); otherwise allow normal text selection. */
      const borderMargin = 8;
      const r = editable.getBoundingClientRect();
      const x = event.clientX - r.left;
      const y = event.clientY - r.top;
      const onBorder =
        x <= borderMargin ||
        x >= r.width - borderMargin ||
        y <= borderMargin ||
        y >= r.height - borderMargin;
      if (!onBorder) return;
      const sel = window.getSelection();
      if (!sel) return;
      const alreadyFullSelection =
        sel.rangeCount > 0 &&
        (() => {
          const r = sel.getRangeAt(0);
          if (!editable.contains(r.startContainer) || !editable.contains(r.endContainer))
            return false;
          const all = document.createRange();
          all.selectNodeContents(editable);
          return r.toString() === all.toString();
        })();
      if (!alreadyFullSelection) {
        event.preventDefault();
        multiSelectedEditablesRef.current.forEach((el) => {
          el.classList.remove("text-placeholder-multi-selected");
        });
        multiSelectedEditablesRef.current.clear();
        const range = document.createRange();
        range.selectNodeContents(editable);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    };

    body.addEventListener("mousedown", onEditableMouseDown, true);

    const onMarqueeMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!body.contains(target)) return;
      if (target.closest("[data-editable='true']")) return;
      if (target.closest("img")) return;
      if (e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startY = e.clientY;
      marqueeRectRef.current = { startX, startY, endX: startX, endY: startY };
      setMarquee(marqueeRectRef.current);
      const onMove = (e2: MouseEvent) => {
        marqueeRectRef.current = marqueeRectRef.current
          ? { ...marqueeRectRef.current, endX: e2.clientX, endY: e2.clientY }
          : null;
        setMarquee(marqueeRectRef.current);
      };
      const onUp = () => {
        const rect = marqueeRectRef.current;
        marqueeRectRef.current = null;
        setMarquee(null);
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        if (!rect || !bodyRef.current) return;
        const left = Math.min(rect.startX, rect.endX);
        const right = Math.max(rect.startX, rect.endX);
        const top = Math.min(rect.startY, rect.endY);
        const bottom = Math.max(rect.startY, rect.endY);
        const editables = bodyRef.current.querySelectorAll<HTMLElement>("[data-editable='true']");
        const hit: HTMLElement[] = [];
        editables.forEach((el) => {
          const r = el.getBoundingClientRect();
          if (!(r.right < left || r.left > right || r.bottom < top || r.top > bottom)) hit.push(el);
        });
        if (hit.length > 0) {
          multiSelectedEditablesRef.current.forEach((el) => el.classList.remove("text-placeholder-multi-selected"));
          multiSelectedEditablesRef.current.clear();
          hit.forEach((el) => {
            multiSelectedEditablesRef.current.add(el);
            el.classList.add("text-placeholder-multi-selected");
          });
          const first = hit[0];
          const range = document.createRange();
          range.selectNodeContents(first);
          textToolbarRangeRef.current = range.cloneRange();
          const r = first.getBoundingClientRect();
          setTextToolbar({ x: r.left + r.width / 2, y: r.top - 48 });
          setResizeTarget(first);
          setTimeout(() => setSelectionFormat(getFormatFromSelection()), 0);
        } else {
          /* Click outside / marquee with no hit: clear toolbar and resize */
          multiSelectedEditablesRef.current.forEach((el) => el.classList.remove("text-placeholder-multi-selected"));
          multiSelectedEditablesRef.current.clear();
          setTextToolbar(null);
          setResizeTarget(null);
        }
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    };
    body.addEventListener("mousedown", onMarqueeMouseDown, true);

    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;

      /* F3: Image upload on click */
      if (target.tagName === "IMG") {
        event.preventDefault();
        handleImageClick(target as HTMLImageElement);
        return;
      }

      /* Progress bar popover */
      const valueEl = target.closest<HTMLElement>("[data-progress-value='true']");
      if (!valueEl) return;
      const fillId = valueEl.dataset.progressFillId;
      if (!fillId) return;
      const fillEl = body.querySelector<HTMLElement>(
        `.thin-progress-fill[data-progress-fill-id='${fillId}']`
      );
      if (!fillEl) return;
      const current =
        Number.parseInt((valueEl.textContent ?? "").replace(/[^\d]/g, ""), 10) || 0;
      const rect = valueEl.getBoundingClientRect();
      progressTargetRef.current = { valueEl, fillEl };
      setPopover({ open: true, x: rect.left, y: rect.bottom + 8, value: current });
    };

    body.addEventListener("blur", onBlur, true);
    body.addEventListener("input", onInput, true);
    body.addEventListener("click", onClick);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(retry);
      body.removeEventListener("blur", onBlur, true);
      body.removeEventListener("input", onInput, true);
      body.removeEventListener("mousedown", onEditableMouseDown, true);
      body.removeEventListener("mousedown", onMarqueeMouseDown, true);
      body.removeEventListener("click", onClick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodyHTML, isEditMode, tailwindReady]);

  /* F11: Selection change listener for text toolbar */
  useEffect(() => {
    if (!isEditMode) {
      setTextToolbar(null);
      return;
    }

    const onSelectionChange = () => {
      const sel = window.getSelection();
      const focusInToolbar = document.activeElement?.closest?.(".text-toolbar-wrap");
      const savedRange = textToolbarRangeRef.current;

      if (!sel || !sel.rangeCount) {
        if (focusInToolbar && savedRange && document.contains(savedRange.startContainer)) {
          try {
            sel.removeAllRanges();
            sel.addRange(savedRange);
          } catch {
            setTextToolbar(null);
            setSelectionFormat(null);
            setResizeTarget(null);
            textToolbarRangeRef.current = null;
            multiSelectedEditablesRef.current.forEach((el) => el.classList.remove("text-placeholder-multi-selected"));
            multiSelectedEditablesRef.current.clear();
          }
          return;
        }
        if (!focusInToolbar) {
          setTextToolbar(null);
          setSelectionFormat(null);
          setResizeTarget(null);
          textToolbarRangeRef.current = null;
          multiSelectedEditablesRef.current.forEach((el) => el.classList.remove("text-placeholder-multi-selected"));
          multiSelectedEditablesRef.current.clear();
        }
        return;
      }
      const range = sel.getRangeAt(0);
      const anchor = sel.anchorNode;
      const parent =
        anchor instanceof HTMLElement ? anchor : anchor?.parentElement;
      if (!parent?.closest("[data-editable='true']")) {
        if (focusInToolbar && savedRange && document.contains(savedRange.startContainer)) {
          try {
            sel.removeAllRanges();
            sel.addRange(savedRange);
          } catch {
            setTextToolbar(null);
            setSelectionFormat(null);
            setResizeTarget(null);
            textToolbarRangeRef.current = null;
            multiSelectedEditablesRef.current.forEach((el) => el.classList.remove("text-placeholder-multi-selected"));
            multiSelectedEditablesRef.current.clear();
          }
          return;
        }
        if (!focusInToolbar) {
          setTextToolbar(null);
          setSelectionFormat(null);
          setResizeTarget(null);
          textToolbarRangeRef.current = null;
          multiSelectedEditablesRef.current.forEach((el) => el.classList.remove("text-placeholder-multi-selected"));
          multiSelectedEditablesRef.current.clear();
        }
        return;
      }
      textToolbarRangeRef.current = range.cloneRange();
      const rect = range.getBoundingClientRect();
      setTextToolbar({ x: rect.left + rect.width / 2, y: rect.top - 48 });
      setSelectionFormat(getFormatFromSelection());
      const editable = parent?.closest("[data-editable='true']") as HTMLElement | null;
      setResizeTarget(editable ?? null);
    };

    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, [isEditMode, getFormatFromSelection]);

  /* ---------------------------------------------------------------- */
  /*  Inline handlers                                                  */
  /* ---------------------------------------------------------------- */

  const applyProgressValue = () => {
    const target = progressTargetRef.current;
    if (!target) return;
    const safeValue = Math.max(0, Math.min(100, popover.value || 0));
    target.valueEl.textContent = `${safeValue}%`;
    target.fillEl.style.width = `${safeValue}%`;
    setPopover((prev) => ({ ...prev, open: false }));
    commitFromDom();
  };

  const onColorInput = (varName: string, value: string) => {
    setColorValues((prev) => ({ ...prev, [varName]: value }));
    if (colorTimerRef.current) window.clearTimeout(colorTimerRef.current);
    colorTimerRef.current = window.setTimeout(() => {
      const nextBody = bodyRef.current?.innerHTML ?? bodyHTML;
      pushSnapshot({
        bodyHTML: nextBody,
        colors: { ...colorValues, [varName]: value },
      });
    }, 350);
  };

  const toggleSection = (idx: number) => {
    setSections((prev) => {
      const next = [...prev];
      const item = next[idx];
      if (!item) return prev;
      const willHide = item.visible;
      item.el.style.display = willHide ? "none" : "";
      next[idx] = { ...item, visible: !willHide };
      setTimeout(() => commitFromDom(), 0);
      return next;
    });
  };

  /* ================================================================ */
  /*  Render                                                           */
  /* ================================================================ */

  /* Announce mode changes to screen readers */
  const modeAnnouncerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = modeAnnouncerRef.current;
    if (el) el.textContent = isEditMode ? "Edit mode" : "Preview mode";
  }, [isEditMode]);

  return (
    <div className="editor-shell">
      {/* Screen reader announcements (toast, mode, exporting) */}
      <div ref={modeAnnouncerRef} className="sr-only" aria-live="polite" aria-atomic="true" />
      {/* F7: Saved state banner */}
      {hasSavedState && (
        <div className="saved-state-banner">
          <span>You have unsaved edits from a previous session.</span>
          <button type="button" className="editor-btn accent" onClick={restoreSavedState}>
            Restore
          </button>
          <button type="button" className="editor-btn" onClick={clearSavedState}>
            Dismiss
          </button>
        </div>
      )}

      {/* Topbar */}
      <header className="editor-topbar">
        <div className="editor-left">
          <Link className="editor-btn" href="/" aria-label="Back to gallery">
            Back
          </Link>
          <span className="editor-mode-toggle-wrap" role="group" aria-label="Editor mode">
            <span className="editor-mode-label">Mode</span>
            <span className="editor-mode-toggle">
              <button
                type="button"
                className={`editor-mode-btn ${isEditMode ? "editor-mode-btn-active" : ""}`}
                onClick={() => setIsEditMode(true)}
                aria-pressed={isEditMode}
                aria-label="Edit mode"
              >
                Edit
              </button>
              <button
                type="button"
                className={`editor-mode-btn ${!isEditMode ? "editor-mode-btn-active" : ""}`}
                onClick={() => setIsEditMode(false)}
                aria-pressed={!isEditMode}
                aria-label="Preview mode"
              >
                Read
              </button>
            </span>
          </span>
          <label className="editor-project-name-wrap" title="Export filename">
            <span className="editor-project-name-label">Project</span>
            <input
              type="text"
              className="editor-project-name-input"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder={template.name}
              aria-label="Project name (export filename)"
            />
          </label>
          <button className="editor-btn" onClick={undo} disabled={!isEditMode || !canUndo} type="button" aria-label="Undo">
            Undo
          </button>
          <button className="editor-btn" onClick={redo} disabled={!isEditMode || !canRedo} type="button" aria-label="Redo">
            Redo
          </button>

          {/* F2: Zoom controls */}
          <span className="editor-zoom-wrap" role="group" aria-label="Zoom">
            <button className="editor-btn" onClick={zoomOut} type="button" disabled={zoom <= ZOOM_STEPS[0]} aria-label="Zoom out">
              &minus;
            </button>
            <span className="editor-zoom-label">{Math.round(zoom * 100)}%</span>
            <button className="editor-btn" onClick={zoomIn} type="button" disabled={zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]} aria-label="Zoom in">
              +
            </button>
          </span>

          {/* F10: Responsive preview */}
          <span className="editor-preview-modes" role="group" aria-label="Preview width">
            {(["mobile", "tablet", "desktop"] as PreviewMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                className={`editor-mode-btn ${previewMode === mode ? "editor-mode-btn-active" : ""}`}
                onClick={() => setPreviewMode(mode)}
                title={`${mode} (${PREVIEW_WIDTHS[mode]}px)`}
                aria-label={`${mode} view (${PREVIEW_WIDTHS[mode]}px)`}
              >
                {mode === "mobile" ? "📱" : mode === "tablet" ? "📟" : "🖥"}
              </button>
            ))}
          </span>
        </div>
        <div className="editor-right">
          {/* Reset to original template */}
          <button
            className="editor-btn"
            onClick={() => {
              if (window.confirm("Reset to original template? All unsaved changes will be lost.")) {
                resetToOriginal();
              }
            }}
            type="button"
            title="Reset to original template"
            aria-label="Reset to original template"
          >
            Reset
          </button>
          {/* Add floating image */}
          <button
            className="editor-btn"
            onClick={addFloatingImage}
            type="button"
            title="Add image overlay"
            disabled={!isEditMode}
            aria-label="Add image overlay"
          >
            Add Image
          </button>
          {/* F9: Export settings */}
          <button
            className="editor-btn editor-btn-icon"
            onClick={() => setShowExportSettings(true)}
            type="button"
            title="Export settings"
            aria-label="Export settings"
          >
            ⚙
          </button>
          {/* Export feedback: announce and show state */}
          {isBusy && (
            <span className="editor-export-status" aria-live="polite" aria-busy="true">
              <span className="editor-export-spinner" aria-hidden="true" />
              Exporting…
            </span>
          )}
          {/* F6: Copy to clipboard */}
          <button className="editor-btn accent" onClick={() => onExport("clipboard")} disabled={isBusy} type="button" aria-label="Copy to clipboard">
            Copy
          </button>
          <button className="editor-btn accent" onClick={() => onExport("png")} disabled={isBusy} type="button" aria-label="Export as PNG">
            PNG
          </button>
          <button className="editor-btn accent" onClick={() => onExport("jpg")} disabled={isBusy} type="button" aria-label="Export as JPG">
            JPG
          </button>
          <button className="editor-btn accent" onClick={() => onExport("pdf")} disabled={isBusy} type="button" aria-label="Export as PDF">
            PDF
          </button>
        </div>
      </header>

      {/* Main area: canvas first for tab order (toolbar → canvas → sidebar) */}
      <div className="editor-main">
        {/* Canvas (first for keyboard tab order) */}
        <main className="canvas-wrap" id="editor-canvas" aria-label="Template canvas">
          {!tailwindReady ? (
            <div className="editor-skeleton">
              <div className="skeleton-bar skeleton-bar-lg" />
              <div className="skeleton-bar" />
              <div className="skeleton-grid">
                <div className="skeleton-card" />
                <div className="skeleton-card" />
                <div className="skeleton-card" />
                <div className="skeleton-card" />
              </div>
              <div className="skeleton-bar" />
              <div className="skeleton-bar skeleton-bar-sm" />
              <p className="sidebar-muted" style={{ textAlign: "center", marginTop: 16 }}>
                Loading template engine...
              </p>
            </div>
          ) : (
            <div
              className={`canvas ${isEditMode ? "canvas-edit" : "canvas-read"}`}
              ref={previewRef}
              style={{ ...cssVarStyle, width: canvasWidth, transform: `scale(${zoom})`, transformOrigin: "top center" }}
            >
              {parsed.hasTailwindStyle ? (
                <style type="text/tailwindcss" dangerouslySetInnerHTML={{ __html: parsed.styles }} />
              ) : (
                <style dangerouslySetInnerHTML={{ __html: parsed.styles }} />
              )}
              <div
                ref={bodyRef}
                data-template-body=""
                className={`template-body ${parsed.bodyClass || "min-h-screen p-6 md:p-12"}`}
                onPointerDown={onBodyPointerDown}
              />
              {floatingImages.map((fimg) => (
                <FloatingImageOverlay
                  key={fimg.id}
                  img={fimg}
                  isEditMode={isEditMode}
                  zoom={zoom}
                  onUpdate={updateFloatingImage}
                  onDelete={deleteFloatingImage}
                />
              ))}
            </div>
          )}
        </main>

        {/* Sidebar */}
        <aside className="sidebar" aria-label="Editor options">
          {/* Colors */}
          <details open>
            <summary className="sidebar-heading">Colors</summary>
            {parsed.colorMeta.length === 0 ? (
              <p className="sidebar-muted">
                No root CSS color variables found in this template.
              </p>
            ) : (
              parsed.colorMeta.map((color) => (
                <div key={color.varName} className="color-row">
                  <label htmlFor={color.varName}>{color.label}</label>
                  <input
                    id={color.varName}
                    type="color"
                    value={colorValues[color.varName] ?? color.defaultValue}
                    onInput={(e) =>
                      onColorInput(color.varName, (e.target as HTMLInputElement).value)
                    }
                    aria-label={color.label}
                  />
                </div>
              ))
            )}
            <button className="editor-btn" onClick={resetColors} style={{ marginTop: 8 }} type="button">
              Reset Colors
            </button>
          </details>

          {/* F1: Font picker */}
          <details open>
            <summary className="sidebar-heading">Typography</summary>
            <div className="sidebar-field">
              <label htmlFor="font-picker">Font Family</label>
              <select
                id="font-picker"
                value={fontOverride}
                onChange={(e) => applyFontOverride(e.target.value)}
                className="sidebar-select"
              >
                {CURATED_FONTS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>
          </details>

          {/* F12: Background */}
          <details>
            <summary className="sidebar-heading">Background</summary>
            <div className="sidebar-field">
              <label htmlFor="bg-override">CSS Background</label>
              <input
                id="bg-override"
                type="text"
                placeholder="e.g. #f0f0f0 or linear-gradient(...)"
                value={bgOverride}
                onChange={(e) => applyBgOverride(e.target.value)}
                className="sidebar-input"
              />
              {bgOverride && (
                <button
                  className="editor-btn"
                  onClick={() => applyBgOverride("")}
                  type="button"
                  style={{ marginTop: 4 }}
                >
                  Reset Background
                </button>
              )}
            </div>
          </details>

          {/* F4: Section toggles */}
          {sections.length > 0 && (
            <details>
              <summary className="sidebar-heading">Sections</summary>
              {sections.map((sec, idx) => (
                <label key={idx} className="sidebar-checkbox">
                  <input
                    type="checkbox"
                    checked={sec.visible}
                    onChange={() => toggleSection(idx)}
                  />
                  <span>{sec.label}</span>
                </label>
              ))}
            </details>
          )}

          {/* F5: Pie chart */}
          {pieValue !== null && (
            <details>
              <summary className="sidebar-heading">Demographics Chart</summary>
              <div className="sidebar-field">
                <label htmlFor="pie-slider">
                  Primary: {pieValue}% / Secondary: {100 - pieValue}%
                </label>
                <input
                  id="pie-slider"
                  type="range"
                  min={0}
                  max={100}
                  value={pieValue}
                  onChange={(e) => updatePieChart(Number(e.target.value))}
                />
              </div>
            </details>
          )}

          {/* Save as copy / Save as new template / Load copy */}
          <details>
            <summary className="sidebar-heading">Save</summary>
            <p className="sidebar-muted" style={{ marginBottom: 8 }}>
              Save as copy (browser) or download as a new HTML template file.
            </p>
            <button className="editor-btn accent" onClick={saveAsCopy} type="button" style={{ width: "100%", marginBottom: 6 }} aria-label="Save current edits as a new copy">
              Save as copy
            </button>
            <button className="editor-btn accent" onClick={saveAsNewTemplate} type="button" style={{ width: "100%", marginBottom: 8 }} aria-label="Save as new template (download HTML)">
              Save as new template
            </button>
            {copyKeys.length > 0 && (
              <div className="sidebar-field">
                <label htmlFor="load-copy-select">Load a copy</label>
                <select
                  id="load-copy-select"
                  className="sidebar-select"
                  value=""
                  onChange={(e) => {
                    const k = e.target.value;
                    if (k) loadCopy(k);
                    e.target.value = "";
                  }}
                  aria-label="Load a saved copy"
                >
                  <option value="">Choose a copy…</option>
                  {copyKeys.map((key) => {
                    try {
                      const raw = typeof window !== "undefined" ? localStorage.getItem(key) : null;
                      const data = raw ? (JSON.parse(raw) as CopySnapshot) : null;
                      const label = data?.savedAt ? new Date(data.savedAt).toLocaleString() : key;
                      return (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      );
                    } catch {
                      return <option key={key} value={key}>{key}</option>;
                    }
                  })}
                </select>
              </div>
            )}
          </details>

          {/* F7: Reset to original */}
          <div style={{ marginTop: "auto", paddingTop: 16 }}>
            <button
              className="editor-btn"
              onClick={() => {
                if (window.confirm("Reset to original template? All unsaved changes will be lost.")) {
                  resetToOriginal();
                }
              }}
              type="button"
              style={{ width: "100%" }}
            >
              Reset to Original
            </button>
          </div>
        </aside>
      </div>

      {/* Progress bar popover */}
      {popover.open && (
        <div className="progress-popover" style={{ left: popover.x, top: popover.y }}>
          <label style={{ fontSize: 12, color: "var(--app-text-muted)" }}>
            Value (%)
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="number"
              min={0}
              max={100}
              value={popover.value}
              onChange={(e) =>
                setPopover((prev) => ({
                  ...prev,
                  value: Number.parseInt(e.target.value || "0", 10),
                }))
              }
            />
            <button className="editor-btn accent" onClick={applyProgressValue} type="button">
              Apply
            </button>
          </div>
        </div>
      )}

      {/* F11: Text formatting toolbar */}
      {textToolbar && isEditMode && (
        <TextToolbar
          position={textToolbar}
          onFormat={onFormat}
          onFontSizeStep={onFontSizeStep}
          initialFormat={selectionFormat}
          onFontFamilyChange={(font) => onFormat("fontName", font)}
          fonts={CURATED_FONTS}
        />
      )}

      {/* Resize handles for selected text placeholder */}
      {isEditMode && resizeTarget && (
        <ResizeHandles target={resizeTarget} onCommit={commitFromDom} />
      )}

      {/* Marquee selection rectangle */}
      {marquee && (
        <div
          className="marquee-selection"
          style={{
            position: "fixed",
            left: Math.min(marquee.startX, marquee.endX),
            top: Math.min(marquee.startY, marquee.endY),
            width: Math.abs(marquee.endX - marquee.startX),
            height: Math.abs(marquee.endY - marquee.startY),
            border: "2px dashed #6366f1",
            backgroundColor: "rgba(99, 102, 241, 0.1)",
            pointerEvents: "none",
            zIndex: 60,
          }}
          aria-hidden
        />
      )}

      {/* Element selection toolbar (Ctrl+Click to select, then Delete/Copy/Paste) */}
      {isEditMode && (
        <ElementToolbar
          selectedRef={selectedElementRef}
          selectionTick={selectionTick}
          onDelete={deleteSelectedElement}
          onCopy={copySelectedElement}
          onPaste={pasteElement}
          onClear={clearElementSelection}
        />
      )}

      {/* F9: Export settings dialog */}
      {showExportSettings && (
        <ExportSettingsDialog
          options={exportOpts}
          onChange={setExportOpts}
          onClose={() => setShowExportSettings(false)}
        />
      )}

      {/* Toast notification */}
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  );
}
