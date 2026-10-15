import type { Rect } from '@archboard/contracts';
import { IMAGE_HALF } from './image-layout.js';

const BADGE_WIDTH = 184;
const BADGE_HEIGHT = 48;
const FOOTER_HEIGHT = 72;
const FOOTER_INSET = 12;
const REFERENCE_WIDTH = 1600;
const MAX_SCALE = 2;

interface ImageBranding {
  readonly bounds: Rect;
  readonly badge: Rect;
  readonly scale: number;
}

export function layoutImageBranding(content: Rect, margin: number): ImageBranding {
  // Keep attribution readable when a wide diagram is viewed at a smaller size.
  const scale = Math.min(MAX_SCALE, Math.max(1, content.width / REFERENCE_WIDTH));
  const bounds = {
    ...content,
    width: Math.max(content.width, BADGE_WIDTH * scale + IMAGE_HALF * margin),
    height: content.height + FOOTER_HEIGHT * scale,
  };
  return {
    bounds,
    scale,
    badge: {
      x: bounds.x + bounds.width - margin - BADGE_WIDTH * scale,
      y: content.y + content.height + FOOTER_INSET * scale,
      width: BADGE_WIDTH * scale,
      height: BADGE_HEIGHT * scale,
    },
  };
}

export function renderImageBranding(
  branding: ImageBranding,
  palette: { card: string; text: string; muted: string; edge: string; brand: string },
): string {
  // Reproduce the existing three-block BrandMark using controlled SVG primitives.
  return (
    `<g id="archboard-watermark" aria-label="Made with Archboard" transform="translate(${branding.badge.x} ${branding.badge.y}) scale(${branding.scale})">` +
    `<rect width="${BADGE_WIDTH}" height="${BADGE_HEIGHT}" rx="10" fill="${palette.card}" stroke="${palette.edge}" stroke-opacity="0.3"/>` +
    `<rect x="12" y="12" width="11" height="11" rx="3" fill="${palette.brand}"/>` +
    `<rect x="25" y="12" width="11" height="11" rx="3" fill="none" stroke="${palette.brand}" stroke-opacity="0.6"/>` +
    `<rect x="12" y="25" width="24" height="11" rx="3" fill="${palette.text}" fill-opacity="0.85"/>` +
    `<text x="48" y="20" font-family="Arial, Helvetica, sans-serif" font-size="11" fill="${palette.muted}">Made with</text>` +
    `<text x="48" y="36" font-family="Arial, Helvetica, sans-serif" font-size="16" font-weight="600" fill="${palette.brand}">Archboard</text></g>`
  );
}
