import React, { useState, useRef, useEffect, useCallback } from "react";
import { Upload, Download, Loader2, Square, Circle, Hexagon, Triangle, Diamond } from "lucide-react";

// ---------- design tokens (app chrome) ----------
const INK = "#20241F";
const PAPER = "#EDEEE7";
const PANEL = "#FBFBF8";
const LINE = "#D7D2C0";
const MUSTARD = "#C79A2B";
const TEAL = "#2F6E6A";

// ---------- fixed 24-colour kit (sampled from the supplied reference chart) ----------
const FIXED_PALETTE_RAW = [
  ["1", "Black", "#111111"],
  ["2", "White", "#FFFFFF"],
  ["3", "Black Grey", "#828282"],
  ["4", "Light Grey", "#C8C7C9"],
  ["5", "Dark Red", "#88262A"],
  ["6", "Red", "#C63436"],
  ["7", "Dark Orange", "#D0783E"],
  ["8", "Light Orange", "#E2AE3F"],
  ["9", "Yellow", "#EDF04F"],
  ["A", "Dark Green", "#3C6E4A"],
  ["B", "Bright Green", "#71B453"],
  ["C", "Yellow Green", "#C0D94B"],
  ["D", "Dark Blue", "#36438B"],
  ["E", "Medium Blue", "#5077B7"],
  ["F", "Sky Blue", "#82B0DE"],
  ["H", "Light Blue", "#CCE3F6"],
  ["J", "Dark Purple", "#6E2380"],
  ["K", "Dark Pink", "#97478E"],
  ["L", "Pink", "#DFACC8"],
  ["M", "Violet", "#9B91C1"],
  ["N", "Dark Brown", "#79562E"],
  ["P", "Light Brown", "#AF8D62"],
  ["Q", "Tan", "#D8BE8A"],
  ["R", "Cream", "#D2C2AE"],
];

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const FIXED_PALETTE = FIXED_PALETTE_RAW.map(([code, name, hex]) => ({ code, name, hex, rgb: hexToRgb(hex) }));

function contrastText(rgb) {
  const [r, g, b] = rgb;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? "#20241F" : "#FFFFFF";
}
// number exports are strictly monochrome (black / white / grey) — always white text
function numberColor(_hex) {
  return "#FFFFFF";
}
// "redmean" perceptual distance — better than plain Euclidean RGB for matching
function redmean(a, b) {
  const rmean = (a[0] + b[0]) / 2;
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return (2 + rmean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rmean) / 256) * db * db;
}
function nearestPaletteIndex(rgb) {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < FIXED_PALETTE.length; i++) {
    const d = redmean(rgb, FIXED_PALETTE[i].rgb);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

// triangle (point-up) point ratios within a unit square cell
const TRIANGLE_POINTS = [[0.5, 0], [1, 1], [0, 1]];
const TRIANGLE_CLIP = `polygon(${TRIANGLE_POINTS.map(([x, y]) => `${x * 100}% ${y * 100}%`).join(", ")})`;
function shapeStyle(shape) {
  if (shape === "triangle") return { clipPath: TRIANGLE_CLIP };
  return {};
}

// ---------- true tessellating lattices ----------

// isometric: 60/120 rhombus lattice. Rhombi tile with zero gaps only when
// alternate rows are offset by half a width AND rows are spaced by a single
// triangle-height (not a full rhombus-height) — otherwise neighbours only
// touch at a single corner point, leaving diamond-shaped holes.
const ISO_TRI_H = Math.sqrt(3) / 2;
function isoCenter(col, row, w) {
  const th = w * ISO_TRI_H;
  const cx = col * w + (row % 2 === 1 ? w / 2 : 0) + w / 2;
  const cy = row * th + th;
  return { cx, cy, th };
}
function isoPoints(cx, cy, w, th) {
  return { top: [cx, cy - th], right: [cx + w / 2, cy], bottom: [cx, cy + th], left: [cx - w / 2, cy] };
}

// hexagon: flat-top honeycomb, alternating column offset
function hexLayout(w) {
  const R = w / 2, width = 2 * R, height = Math.sqrt(3) * R;
  return { R, width, height, horizSpacing: width * 0.75, vertSpacing: height };
}
function hexCenter(col, row, w) {
  const { R, height, horizSpacing, vertSpacing } = hexLayout(w);
  const cx = col * horizSpacing + R;
  const cy = row * vertSpacing + (col % 2 === 1 ? vertSpacing / 2 : 0) + height / 2;
  return { cx, cy };
}
function hexPoints(cx, cy, R) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i);
    pts.push([cx + R * Math.cos(angle), cy + R * Math.sin(angle)]);
  }
  return pts;
}

// circle: tightest hex-packed circles, alternating row offset — tangent neighbours, no gaps
function circleLayout(w) {
  const R = w / 2;
  return { R, hSpace: 2 * R, vSpace: R * Math.sqrt(3) };
}
function circleCenter(col, row, w) {
  const { R, hSpace, vSpace } = circleLayout(w);
  const cx = col * hSpace + (row % 2 === 1 ? R : 0) + R;
  const cy = row * vSpace + R;
  return { cx, cy, R };
}

function gridPixelDims(shape, cols, rows, w) {
  if (shape === "isometric") { const th = w * ISO_TRI_H; return { gw: cols * w + w / 2, gh: (rows + 1) * th }; }
  if (shape === "hexagon") { const { height, vertSpacing } = hexLayout(w); return { gw: cols * w * 0.75 + w, gh: rows * vertSpacing + vertSpacing / 2 + height }; }
  if (shape === "circle") { const { R, hSpace, vSpace } = circleLayout(w); return { gw: (cols - 1) * hSpace + 3 * R, gh: (rows - 1) * vSpace + 2 * R }; }
  return { gw: cols * w, gh: rows * w };
}

// ============ canvas (PNG) drawing ============
function drawCellToCanvas(ctx, x, y, size, shape, mode, p) {
  ctx.save();
  ctx.beginPath();
  if (shape === "triangle") {
    const pts = TRIANGLE_POINTS.map(([px, py]) => [x + px * size, y + py * size]);
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
  } else {
    ctx.rect(x + 0.5, y + 0.5, size - 1, size - 1);
  }
  if (mode === "color") {
    ctx.fillStyle = p.hex; ctx.fill();
    ctx.lineWidth = 0.5; ctx.strokeStyle = "rgba(255,255,255,0.12)"; ctx.stroke();
  } else {
    ctx.fillStyle = "#000000"; ctx.fill();
    ctx.lineWidth = Math.max(1, size * 0.03); ctx.strokeStyle = "rgba(255,255,255,0.4)"; ctx.stroke();
  }
  ctx.restore();

  if (mode === "number" && p.code !== "2") {
    const cy = shape === "triangle" ? y + size * 0.62 : y + size / 2 + size * 0.02;
    const fontScale = shape === "triangle" ? 0.32 : 0.42;
    ctx.fillStyle = numberColor(p.hex);
    ctx.font = `bold ${Math.round(size * fontScale)}px ui-monospace, monospace`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(p.code, x + size / 2, cy);
  }
}
function drawIsoCellToCanvas(ctx, cx, cy, w, mode, p) {
  const th = w * ISO_TRI_H;
  const { top, right, bottom, left } = isoPoints(cx, cy, w, th);
  ctx.beginPath();
  ctx.moveTo(top[0], top[1]); ctx.lineTo(right[0], right[1]); ctx.lineTo(bottom[0], bottom[1]); ctx.lineTo(left[0], left[1]);
  ctx.closePath();
  if (mode === "color") {
    ctx.fillStyle = p.hex; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = "rgba(255,255,255,0.15)"; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(left[0], left[1]); ctx.lineTo(right[0], right[1]); ctx.stroke();
  } else {
    ctx.fillStyle = "#000000"; ctx.fill();
    ctx.lineWidth = Math.max(1, w * 0.025); ctx.strokeStyle = "rgba(255,255,255,0.4)"; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(left[0], left[1]); ctx.lineTo(right[0], right[1]); ctx.stroke();
    if (p.code !== "2") {
      ctx.fillStyle = numberColor(p.hex);
      ctx.font = `bold ${Math.round(w * 0.32)}px ui-monospace, monospace`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(p.code, cx, cy);
    }
  }
}
function drawHexCellToCanvas(ctx, cx, cy, R, mode, p) {
  const pts = hexPoints(cx, cy, R * 0.98);
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  if (mode === "color") {
    ctx.fillStyle = p.hex; ctx.fill();
    ctx.lineWidth = 0.5; ctx.strokeStyle = "rgba(255,255,255,0.15)"; ctx.stroke();
  } else {
    ctx.fillStyle = "#000000"; ctx.fill();
    ctx.lineWidth = Math.max(1, R * 0.05); ctx.strokeStyle = "rgba(255,255,255,0.4)"; ctx.stroke();
    if (p.code !== "2") {
      ctx.fillStyle = numberColor(p.hex);
      ctx.font = `bold ${Math.round(R * 0.62)}px ui-monospace, monospace`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(p.code, cx, cy);
    }
  }
}
function drawCircleCellToCanvas(ctx, cx, cy, R, mode, p) {
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  if (mode === "color") {
    ctx.fillStyle = p.hex; ctx.fill();
    ctx.lineWidth = 0.5; ctx.strokeStyle = "rgba(255,255,255,0.15)"; ctx.stroke();
  } else {
    ctx.fillStyle = "#000000"; ctx.fill();
    ctx.lineWidth = Math.max(1, R * 0.05); ctx.strokeStyle = "rgba(255,255,255,0.4)"; ctx.stroke();
    if (p.code !== "2") {
      ctx.fillStyle = numberColor(p.hex);
      ctx.font = `bold ${Math.round(R * 0.62)}px ui-monospace, monospace`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(p.code, cx, cy);
    }
  }
}

// ============ SVG string (export) markup ============
function svgCellMarkup(shape, col, row, w, mode, p) {
  const skip = p.code === "2";
  if (shape === "isometric") {
    const th = w * ISO_TRI_H;
    const { cx, cy } = isoCenter(col, row, w);
    const { top, right, bottom, left } = isoPoints(cx, cy, w, th);
    const pts = `${top[0]},${top[1]} ${right[0]},${right[1]} ${bottom[0]},${bottom[1]} ${left[0]},${left[1]}`;
    if (mode === "color") {
      return `<polygon points="${pts}" fill="${p.hex}" stroke="rgba(255,255,255,0.15)" stroke-width="0.5"/><line x1="${left[0]}" y1="${left[1]}" x2="${right[0]}" y2="${right[1]}" stroke="rgba(255,255,255,0.15)" stroke-width="0.5"/>`;
    }
    let s = `<polygon points="${pts}" fill="#000000" stroke="rgba(255,255,255,0.4)" stroke-width="0.75"/><line x1="${left[0]}" y1="${left[1]}" x2="${right[0]}" y2="${right[1]}" stroke="rgba(255,255,255,0.4)" stroke-width="0.75"/>`;
    if (!skip) s += `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle" font-size="${Math.max(6, w * 0.32)}" font-family="monospace" font-weight="700" fill="${numberColor(p.hex)}">${p.code}</text>`;
    return s;
  }
  if (shape === "hexagon") {
    const { cx, cy } = hexCenter(col, row, w);
    const { R } = hexLayout(w);
    const pts = hexPoints(cx, cy, R * 0.98).map(([x, y]) => `${x},${y}`).join(" ");
    if (mode === "color") return `<polygon points="${pts}" fill="${p.hex}" stroke="rgba(255,255,255,0.15)" stroke-width="0.5"/>`;
    let s = `<polygon points="${pts}" fill="#000000" stroke="rgba(255,255,255,0.4)" stroke-width="0.75"/>`;
    if (!skip) s += `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle" font-size="${Math.max(6, R * 0.62)}" font-family="monospace" font-weight="700" fill="${numberColor(p.hex)}">${p.code}</text>`;
    return s;
  }
  if (shape === "circle") {
    const { cx, cy, R } = circleCenter(col, row, w);
    if (mode === "color") return `<circle cx="${cx}" cy="${cy}" r="${R}" fill="${p.hex}" stroke="rgba(255,255,255,0.15)" stroke-width="0.5"/>`;
    let s = `<circle cx="${cx}" cy="${cy}" r="${R}" fill="#000000" stroke="rgba(255,255,255,0.4)" stroke-width="0.75"/>`;
    if (!skip) s += `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle" font-size="${Math.max(6, R * 0.62)}" font-family="monospace" font-weight="700" fill="${numberColor(p.hex)}">${p.code}</text>`;
    return s;
  }
  // square / triangle raster
  const x = col * w, y = row * w;
  let s;
  if (shape === "triangle") {
    const ptsStr = TRIANGLE_POINTS.map(([px, py]) => `${x + px * w},${y + py * w}`).join(" ");
    s = mode === "color"
      ? `<polygon points="${ptsStr}" fill="${p.hex}" stroke="rgba(255,255,255,0.12)" stroke-width="0.5"/>`
      : `<polygon points="${ptsStr}" fill="#000000" stroke="rgba(255,255,255,0.4)" stroke-width="0.75"/>`;
  } else {
    s = mode === "color"
      ? `<rect x="${x + 0.5}" y="${y + 0.5}" width="${w - 1}" height="${w - 1}" fill="${p.hex}" stroke="rgba(255,255,255,0.12)" stroke-width="0.5"/>`
      : `<rect x="${x + 0.5}" y="${y + 0.5}" width="${w - 1}" height="${w - 1}" fill="#000000" stroke="rgba(255,255,255,0.4)" stroke-width="0.75"/>`;
  }
  if (mode === "number" && !skip) {
    const cy = shape === "triangle" ? y + w * 0.62 : y + w / 2;
    const fs = shape === "triangle" ? w * 0.32 : w * 0.42;
    s += `<text x="${x + w / 2}" y="${cy}" text-anchor="middle" dominant-baseline="middle" font-size="${Math.max(6, fs)}" font-family="monospace" font-weight="700" fill="${numberColor(p.hex)}">${p.code}</text>`;
  }
  return s;
}

export default function MosaicGenerator() {
  const [imageSrc, setImageSrc] = useState(null);
  const [imgDims, setImgDims] = useState(null);
  const [gridCols, setGridCols] = useState(50);
  const [view, setView] = useState("color");
  const [shape, setShape] = useState("square");
  const [cellPx, setCellPx] = useState(14);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState(null);
  const fileInputRef = useRef(null);
  const imgElRef = useRef(null);

  const handleFile = useCallback((file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const src = e.target.result;
      const img = new window.Image();
      img.onload = () => {
        imgElRef.current = img;
        setImgDims({ w: img.naturalWidth, h: img.naturalHeight });
        setImageSrc(src);
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  }, []);

  const process = useCallback(() => {
    const img = imgElRef.current;
    if (!img || !imgDims) return;
    setProcessing(true);
    setTimeout(() => {
      const cols = gridCols;
      const rows = Math.max(1, Math.round(gridCols * (imgDims.h / imgDims.w)));
      const canvas = document.createElement("canvas");
      canvas.width = cols; canvas.height = rows;
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, cols, rows);
      const data = ctx.getImageData(0, 0, cols, rows).data;

      const assignments = new Array(cols * rows);
      const counts = new Array(FIXED_PALETTE.length).fill(0);
      for (let i = 0; i < cols * rows; i++) {
        const rgb = [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]];
        const idx = nearestPaletteIndex(rgb);
        assignments[i] = idx;
        counts[idx]++;
      }
      const palette = FIXED_PALETTE
        .map((p, i) => ({ ...p, count: counts[i] }))
        .filter((p) => p.count > 0);

      setResult({ cols, rows, assignments, palette });
      setProcessing(false);
    }, 20);
  }, [gridCols, imgDims]);

  useEffect(() => {
    if (!imageSrc) return;
    const t = setTimeout(() => process(), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageSrc, gridCols]);

  const downloadPng = useCallback((mode) => {
    if (!result) return;
    const scale = 24;
    const canvas = document.createElement("canvas");
    const ctx0 = () => { const c = canvas.getContext("2d"); c.fillStyle = "#000000"; c.fillRect(0, 0, canvas.width, canvas.height); return c; };

    if (shape === "isometric") {
      const th = scale * ISO_TRI_H;
      canvas.width = Math.ceil(result.cols * scale + scale / 2);
      canvas.height = Math.ceil((result.rows + 1) * th);
      const ctx = ctx0();
      for (let y = 0; y < result.rows; y++) for (let x = 0; x < result.cols; x++) {
        const p = FIXED_PALETTE[result.assignments[y * result.cols + x]];
        const { cx, cy } = isoCenter(x, y, scale);
        drawIsoCellToCanvas(ctx, cx, cy, scale, mode, p);
      }
    } else if (shape === "hexagon") {
      const { R, height, vertSpacing } = hexLayout(scale);
      canvas.width = Math.ceil(result.cols * scale * 0.75 + scale);
      canvas.height = Math.ceil(result.rows * vertSpacing + vertSpacing / 2 + height);
      const ctx = ctx0();
      for (let y = 0; y < result.rows; y++) for (let x = 0; x < result.cols; x++) {
        const p = FIXED_PALETTE[result.assignments[y * result.cols + x]];
        const { cx, cy } = hexCenter(x, y, scale);
        drawHexCellToCanvas(ctx, cx, cy, R, mode, p);
      }
    } else if (shape === "circle") {
      const { R, hSpace, vSpace } = circleLayout(scale);
      canvas.width = Math.ceil((result.cols - 1) * hSpace + 3 * R);
      canvas.height = Math.ceil((result.rows - 1) * vSpace + 2 * R);
      const ctx = ctx0();
      for (let y = 0; y < result.rows; y++) for (let x = 0; x < result.cols; x++) {
        const p = FIXED_PALETTE[result.assignments[y * result.cols + x]];
        const { cx, cy } = circleCenter(x, y, scale);
        drawCircleCellToCanvas(ctx, cx, cy, R, mode, p);
      }
    } else {
      canvas.width = result.cols * scale;
      canvas.height = result.rows * scale;
      const ctx = ctx0();
      for (let y = 0; y < result.rows; y++) for (let x = 0; x < result.cols; x++) {
        const p = FIXED_PALETTE[result.assignments[y * result.cols + x]];
        drawCellToCanvas(ctx, x * scale, y * scale, scale, shape, mode, p);
      }
    }

    const url = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url; a.download = mode === "number" ? "mosaic-numbers.png" : "mosaic-color.png";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }, [result, shape]);

  const downloadSvg = useCallback((mode) => {
    if (!result) return;
    const w = cellPx;
    const { gw, gh } = gridPixelDims(shape, result.cols, result.rows, w);

    let cells = "";
    for (let y = 0; y < result.rows; y++) {
      for (let x = 0; x < result.cols; x++) {
        const p = FIXED_PALETTE[result.assignments[y * result.cols + x]];
        cells += svgCellMarkup(shape, x, y, w, mode, p);
      }
    }

    const used = result.palette;
    const legendCols = 4, boxW = 172, boxH = 30, gapY = 8;
    const legendRows = Math.ceil(used.length / legendCols);
    const legendW = legendCols * boxW;
    const legendH = legendRows * (boxH + gapY);
    let legend = "";
    used.forEach((p, i) => {
      const cx = i % legendCols, ry = Math.floor(i / legendCols);
      const lx = cx * boxW, ly = ry * (boxH + gapY);
      const swatchFill = mode === "number" ? "#333333" : p.hex;
      const swatchText = mode === "number" ? "#FFFFFF" : contrastText(p.rgb);
      legend += `<g transform="translate(${lx},${ly})">
        <rect x="0" y="0" width="26" height="26" rx="6" fill="${swatchFill}" stroke="rgba(255,255,255,0.25)"/>
        <text x="13" y="14" text-anchor="middle" dominant-baseline="middle" font-size="11" font-family="monospace" font-weight="700" fill="${swatchText}">${p.code}</text>
        <text x="34" y="14" font-size="12" font-family="ui-sans-serif,system-ui,sans-serif" font-weight="600" fill="#FFFFFF" dominant-baseline="middle">${p.name}</text>
      </g>`;
    });

    const pad = 20, gap = 28;
    const totalW = Math.ceil(Math.max(gw, legendW) + pad * 2);
    const totalH = Math.ceil(gh + gap + legendH + pad * 2);

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}">
<rect x="0" y="0" width="100%" height="100%" fill="#000000"/>
<g transform="translate(${pad},${pad})">${cells}</g>
<g transform="translate(${pad},${pad + gh + gap})">${legend}</g>
</svg>`;

    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = mode === "number" ? "mosaic-numbers.svg" : "mosaic-color.svg";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [result, shape, cellPx]);

  const showNumbers = view === "number" && cellPx >= 15;
  const inset = shape === "square" ? 0 : Math.max(1, Math.round(cellPx * 0.07));
  const innerSize = cellPx - inset * 2;
  const isLattice = shape === "isometric" || shape === "hexagon" || shape === "circle";

  return (
    <div style={{ background: PAPER, minHeight: "100%", color: INK, fontFamily: "ui-sans-serif, system-ui, sans-serif" }} className="w-full flex flex-col lg:flex-row gap-0">
      {/* control rail */}
      <div style={{ background: PANEL, borderRight: `1px solid ${LINE}` }} className="lg:w-72 w-full flex-shrink-0 p-5 flex flex-col gap-6">
        <div>
          <div style={{ letterSpacing: "0.14em", fontSize: 11, color: TEAL, fontWeight: 700 }} className="uppercase mb-1">Mosaic Studio</div>
          <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.01em" }}>Image → Color-by-Number</div>
        </div>

        <div>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
          <button
            onClick={() => fileInputRef.current?.click()}
            style={{ background: INK, color: PAPER }}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-sm text-sm font-semibold hover:opacity-90 transition"
          >
            <Upload size={16} />
            {imageSrc ? "Replace image" : "Upload image"}
          </button>
        </div>

        {imageSrc && (
          <>
            <div className="flex flex-col gap-2">
              <label style={{ fontSize: 11, letterSpacing: "0.08em" }} className="uppercase font-semibold flex justify-between">
                <span>Grid width</span>
                <span style={{ fontFamily: "ui-monospace, monospace", color: TEAL }}>{gridCols} cols</span>
              </label>
              <input type="range" min={15} max={100} step={1} value={gridCols} onChange={(e) => setGridCols(Number(e.target.value))} />
            </div>

            <div className="flex flex-col gap-2">
              <label style={{ fontSize: 11, letterSpacing: "0.08em" }} className="uppercase font-semibold flex justify-between">
                <span>Zoom</span>
                <span style={{ fontFamily: "ui-monospace, monospace", color: TEAL }}>{cellPx}px</span>
              </label>
              <input type="range" min={4} max={32} step={1} value={cellPx} onChange={(e) => setCellPx(Number(e.target.value))} />
            </div>

            <div className="flex flex-col gap-2">
              <label style={{ fontSize: 11, letterSpacing: "0.08em" }} className="uppercase font-semibold">Cell shape</label>
              <div style={{ border: `1px solid ${LINE}` }} className="flex rounded-sm overflow-hidden">
                {[
                  { key: "square", Icon: Square },
                  { key: "circle", Icon: Circle },
                  { key: "hexagon", Icon: Hexagon },
                  { key: "triangle", Icon: Triangle },
                  { key: "isometric", Icon: Diamond },
                ].map(({ key, Icon }) => (
                  <button key={key} onClick={() => setShape(key)} title={key}
                    style={{ flex: 1, padding: "8px 0", display: "flex", justifyContent: "center", background: shape === key ? MUSTARD : "transparent" }}>
                    <Icon size={15} color={INK} />
                  </button>
                ))}
              </div>
              {isLattice && <div style={{ fontSize: 10, color: "#8A8676" }}>Offset lattice — cells packed edge-to-edge.</div>}
            </div>

            <div className="flex flex-col gap-2">
              <label style={{ fontSize: 11, letterSpacing: "0.08em" }} className="uppercase font-semibold">View</label>
              <div style={{ border: `1px solid ${LINE}` }} className="flex rounded-sm overflow-hidden">
                {["color", "number"].map((v) => (
                  <button key={v} onClick={() => setView(v)}
                    style={{ flex: 1, padding: "8px 0", fontSize: 12, fontWeight: 600, textTransform: "capitalize", background: view === v ? MUSTARD : "transparent", color: INK }}>
                    {v}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <label style={{ fontSize: 11, letterSpacing: "0.08em" }} className="uppercase font-semibold">Download PNG</label>
              <button onClick={() => downloadPng("color")} disabled={!result}
                style={{ border: `1px solid ${INK}`, color: INK }}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-sm text-sm font-semibold hover:bg-black/5 transition disabled:opacity-40">
                <Download size={15} /> Color PNG
              </button>
              <button onClick={() => downloadPng("number")} disabled={!result}
                style={{ border: `1px solid ${INK}`, color: INK }}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-sm text-sm font-semibold hover:bg-black/5 transition disabled:opacity-40">
                <Download size={15} /> Number PNG
              </button>
            </div>

            <div className="flex flex-col gap-2">
              <label style={{ fontSize: 11, letterSpacing: "0.08em" }} className="uppercase font-semibold">Download SVG</label>
              <button onClick={() => downloadSvg("color")} disabled={!result}
                style={{ border: `1px solid ${TEAL}`, color: TEAL }}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-sm text-sm font-semibold hover:bg-black/5 transition disabled:opacity-40">
                <Download size={15} /> Color SVG
              </button>
              <button onClick={() => downloadSvg("number")} disabled={!result}
                style={{ border: `1px solid ${TEAL}`, color: TEAL }}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-sm text-sm font-semibold hover:bg-black/5 transition disabled:opacity-40">
                <Download size={15} /> Number SVG
              </button>
            </div>

            {result && (
              <div style={{ fontSize: 11, color: "#6B6B60", lineHeight: 1.6 }}>
                {result.cols} × {result.rows} cells · {result.palette.length} of 24 colors used
              </div>
            )}
          </>
        )}
      </div>

      {/* main area */}
      <div className="flex-1 flex flex-col min-w-0">
        {!imageSrc ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 p-10 text-center">
            <div onClick={() => fileInputRef.current?.click()}
              style={{ border: `2px dashed ${LINE}`, color: "#8A8676" }}
              className="w-full max-w-md py-16 rounded-md flex flex-col items-center gap-3 cursor-pointer hover:border-current transition">
              <Upload size={28} />
              <div style={{ fontSize: 14 }}>Click to upload an image</div>
              <div style={{ fontSize: 12 }}>PNG or JPG, any size</div>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-auto p-6 flex items-start justify-center" style={{ background: "#141412" }}>
            <div className="relative inline-block">
              {processing && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60 z-10">
                  <Loader2 className="animate-spin" style={{ color: MUSTARD }} size={28} />
                </div>
              )}

              {result && shape === "isometric" && (() => {
                const w = cellPx, th = w * ISO_TRI_H;
                const svgW = result.cols * w + w / 2, svgH = (result.rows + 1) * th;
                const showNum = view === "number" && cellPx >= 15;
                return (
                  <svg width={svgW} height={svgH} viewBox={`0 0 ${svgW} ${svgH}`} style={{ background: "#000", display: "block" }}>
                    {result.assignments.map((idx, i) => {
                      const p = FIXED_PALETTE[idx];
                      const col = i % result.cols, row = (i - col) / result.cols;
                      const { cx, cy } = isoCenter(col, row, w);
                      const { top, right, bottom, left } = isoPoints(cx, cy, w, th);
                      const poly = `${top[0]},${top[1]} ${right[0]},${right[1]} ${bottom[0]},${bottom[1]} ${left[0]},${left[1]}`;
                      if (view === "color") {
                        return (
                          <g key={i}>
                            <polygon points={poly} fill={p.hex} stroke="rgba(255,255,255,0.15)" strokeWidth={0.5} />
                            <line x1={left[0]} y1={left[1]} x2={right[0]} y2={right[1]} stroke="rgba(255,255,255,0.15)" strokeWidth={0.5} />
                          </g>
                        );
                      }
                      return (
                        <g key={i}>
                          <polygon points={poly} fill="#000000" stroke="rgba(255,255,255,0.4)" strokeWidth={0.75} />
                          <line x1={left[0]} y1={left[1]} x2={right[0]} y2={right[1]} stroke="rgba(255,255,255,0.4)" strokeWidth={0.75} />
                          {showNum && p.code !== "2" && (
                            <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle"
                              fontSize={Math.max(6, w * 0.32)} fontFamily="ui-monospace, monospace" fontWeight="700" fill={numberColor(p.hex)}>
                              {p.code}
                            </text>
                          )}
                        </g>
                      );
                    })}
                  </svg>
                );
              })()}

              {result && shape === "hexagon" && (() => {
                const { R, height, vertSpacing } = hexLayout(cellPx);
                const svgW = result.cols * cellPx * 0.75 + cellPx;
                const svgH = result.rows * vertSpacing + vertSpacing / 2 + height;
                const showNum = view === "number" && cellPx >= 18;
                return (
                  <svg width={svgW} height={svgH} viewBox={`0 0 ${svgW} ${svgH}`} style={{ background: "#000", display: "block" }}>
                    {result.assignments.map((idx, i) => {
                      const p = FIXED_PALETTE[idx];
                      const col = i % result.cols, row = (i - col) / result.cols;
                      const { cx, cy } = hexCenter(col, row, cellPx);
                      const pts = hexPoints(cx, cy, R * 0.98);
                      const poly = pts.map(([x, y]) => `${x},${y}`).join(" ");
                      if (view === "color") return <polygon key={i} points={poly} fill={p.hex} stroke="rgba(255,255,255,0.15)" strokeWidth={0.5} />;
                      return (
                        <g key={i}>
                          <polygon points={poly} fill="#000000" stroke="rgba(255,255,255,0.4)" strokeWidth={0.75} />
                          {showNum && p.code !== "2" && (
                            <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle"
                              fontSize={Math.max(6, R * 0.62)} fontFamily="ui-monospace, monospace" fontWeight="700" fill={numberColor(p.hex)}>
                              {p.code}
                            </text>
                          )}
                        </g>
                      );
                    })}
                  </svg>
                );
              })()}

              {result && shape === "circle" && (() => {
                const { R, hSpace, vSpace } = circleLayout(cellPx);
                const svgW = (result.cols - 1) * hSpace + 3 * R;
                const svgH = (result.rows - 1) * vSpace + 2 * R;
                const showNum = view === "number" && cellPx >= 15;
                return (
                  <svg width={svgW} height={svgH} viewBox={`0 0 ${svgW} ${svgH}`} style={{ background: "#000", display: "block" }}>
                    {result.assignments.map((idx, i) => {
                      const p = FIXED_PALETTE[idx];
                      const col = i % result.cols, row = (i - col) / result.cols;
                      const { cx, cy } = circleCenter(col, row, cellPx);
                      if (view === "color") return <circle key={i} cx={cx} cy={cy} r={R} fill={p.hex} stroke="rgba(255,255,255,0.15)" strokeWidth={0.5} />;
                      return (
                        <g key={i}>
                          <circle cx={cx} cy={cy} r={R} fill="#000000" stroke="rgba(255,255,255,0.4)" strokeWidth={0.75} />
                          {showNum && p.code !== "2" && (
                            <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle"
                              fontSize={Math.max(6, R * 0.62)} fontFamily="ui-monospace, monospace" fontWeight="700" fill={numberColor(p.hex)}>
                              {p.code}
                            </text>
                          )}
                        </g>
                      );
                    })}
                  </svg>
                );
              })()}

              {result && !isLattice && (
                <div style={{ display: "grid", gridTemplateColumns: `repeat(${result.cols}, ${cellPx}px)`, background: "#000" }}>
                  {result.assignments.map((idx, i) => {
                    const p = FIXED_PALETTE[idx];
                    const inner = { width: innerSize, height: innerSize, ...shapeStyle(shape) };
                    if (view === "color") {
                      return (
                        <div key={i} style={{ width: cellPx, height: cellPx }} className="flex items-center justify-center">
                          <div style={{ ...inner, background: p.hex, outline: cellPx > 8 ? "0.5px solid rgba(255,255,255,0.10)" : "none" }} />
                        </div>
                      );
                    }
                    return (
                      <div key={i} style={{ width: cellPx, height: cellPx }} className="flex items-center justify-center">
                        <div style={{
                          ...inner, background: "#000",
                          border: "0.5px solid rgba(255,255,255,0.35)",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: Math.max(6, innerSize * (shape === "triangle" ? 0.32 : 0.42)),
                          fontFamily: "ui-monospace, monospace", fontWeight: 700,
                          color: numberColor(p.hex),
                        }}>
                          <span style={shape === "triangle" ? { transform: `translateY(${innerSize * 0.14}px)` } : undefined}>
                            {showNumbers && p.code !== "2" ? p.code : ""}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* palette legend */}
        {result && (
          <div style={{ borderTop: `1px solid ${LINE}`, background: PANEL }} className="p-4 flex flex-wrap gap-2 max-h-40 overflow-auto">
            {result.palette.map((p) => (
              <div key={p.code} style={{ border: `1px solid ${LINE}`, background: "#fff" }} className="flex items-center gap-2 pl-1.5 pr-2.5 py-1 rounded-full">
                <div style={{
                  width: 18, height: 18, borderRadius: 6, background: p.hex,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 9, fontWeight: 800, fontFamily: "ui-monospace, monospace",
                  color: contrastText(p.rgb), border: "1px solid rgba(0,0,0,0.15)",
                }}>
                  {p.code}
                </div>
                <span style={{ fontSize: 11, fontWeight: 600 }}>{p.name}</span>
                <span style={{ fontSize: 10, color: "#8A8676", fontFamily: "ui-monospace, monospace" }}>{p.hex}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
