/**
 * Renders the images in public/ that are drawn from the logo: the link-preview
 * card, app icons, and favicon.ico. Run `npm run images` after changing the
 * logo or the card's wording, and commit the results.
 */
import fs from "node:fs";
import { chromium, type Page } from "@playwright/test";
import { Mic, PhoneOff, Video, type LucideIcon } from "lucide-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const PUBLIC_DIR = new URL("../public/", import.meta.url);
const FONT = new URL(
  "../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
  import.meta.url,
);

// The design tokens from app/styles/global.css.
const BACKGROUND = "#0b0c0e";
const SURFACE = "#1b1d21";
const BORDER = "#25272c";
const TEXT = "#ececee";
const MUTED = "#a1a4ac";
const DANGER = "#e5484d";

/** The logo mark (the same drawing as app/components/logo.tsx), sized to `height`. */
function logo(height: number): string {
  return `<svg height="${height}" viewBox="0 0 32 35" fill="${TEXT}" aria-hidden="true">
    <path d="M20 29c8-6.915 12-12.582 12-17 0-6.627-5.373-12-12-12S8 5.373 8 12c0 4.418 4 10.085 12 17z"/>
    <path opacity="0.45" transform="matrix(1 0 0 -1 0 35)" d="M12 32c8-6.915 12-12.582 12-17 0-6.627-5.373-12-12-12S0 8.373 0 15c0 4.418 4 10.085 12 17z"/>
  </svg>`;
}

function icon(Icon: LucideIcon, size: number): string {
  return renderToStaticMarkup(createElement(Icon, { size, color: "currentColor" }));
}

function htmlPage(body: string, css: string): string {
  const font = fs.readFileSync(FONT).toString("base64");
  return `<!doctype html><html><head><style>
    @font-face { font-family: Inter; src: url(data:font/woff2;base64,${font}) format("woff2"); font-weight: 100 900; }
    * { box-sizing: border-box; margin: 0; }
    html, body { background: transparent; }
    body { font-family: Inter, sans-serif; color: ${TEXT}; }
    ${css}
  </style></head><body>${body}</body></html>`;
}

/** The link-preview card: 1200 × 630, the size Open Graph consumers expect. */
const PREVIEW = htmlPage(
  `<main>
    <div class="brand">${logo(52)}<span>Zipcall</span></div>
    <div class="bottom">
      <div>
        <h1>Video calls, straight from your browser.</h1>
        <p>Free, peer-to-peer, no sign-up.</p>
      </div>
      <div class="controls">
        <span class="control">${icon(Mic, 30)}</span>
        <span class="control">${icon(Video, 30)}</span>
        <span class="control leave">${icon(PhoneOff, 30)}</span>
      </div>
    </div>
  </main>`,
  `main { display: flex; flex-direction: column; justify-content: space-between; width: 1200px; height: 630px; padding: 76px 84px; background: ${BACKGROUND}; }
  .brand { display: flex; align-items: center; gap: 18px; font-size: 40px; font-weight: 600; letter-spacing: -0.02em; }
  .bottom { display: flex; align-items: flex-end; justify-content: space-between; gap: 48px; }
  h1 { max-width: 780px; font-size: 76px; font-weight: 650; line-height: 1.05; letter-spacing: -0.035em; }
  p { margin-top: 28px; color: ${MUTED}; font-size: 30px; letter-spacing: -0.01em; }
  .controls { display: flex; flex: none; gap: 14px; padding: 12px; border: 2px solid ${BORDER}; border-radius: 999px; }
  .control { display: grid; place-items: center; width: 72px; height: 72px; border-radius: 50%; background: ${SURFACE}; }
  .leave { width: 96px; border-radius: 999px; background: ${DANGER}; color: #fff; }`,
);

/**
 * The logo on a dark tile. `radius` rounds the corners (0 for platforms that
 * mask icons themselves); `scale` is the logo's height as a share of the tile.
 */
function tile(size: number, { radius, scale }: { radius: number; scale: number }): string {
  return htmlPage(
    `<div class="tile">${logo(Math.round(size * scale))}</div>`,
    `.tile { display: grid; place-items: center; width: ${size}px; height: ${size}px; border-radius: ${radius}px; background: ${BACKGROUND}; }`,
  );
}

async function render(page: Page, html: string, width: number, height: number): Promise<Buffer> {
  await page.setViewportSize({ width, height });
  await page.setContent(html);
  await page.evaluate("document.fonts.ready");
  return page.screenshot({ omitBackground: true });
}

/** An .ico holding one PNG image, which every browser since IE 11 reads. */
function ico(png: Buffer, size: number): Buffer {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // icon
  header.writeUInt16LE(1, 4); // one image
  header.writeUInt8(size, 6);
  header.writeUInt8(size, 7);
  header.writeUInt8(0, 8); // no palette
  header.writeUInt8(0, 9); // reserved
  header.writeUInt16LE(1, 10); // colour planes
  header.writeUInt16LE(32, 12); // bits per pixel
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(header.length, 18); // image data follows the header
  return Buffer.concat([header, png]);
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const write = (name: string, data: Buffer) => {
    fs.writeFileSync(new URL(name, PUBLIC_DIR), data);
    console.log(`Wrote public/${name}`);
  };

  write("og-image.png", await render(page, PREVIEW, 1200, 630));
  // Browsers and Android: rounded like the favicon.
  write("icon-192.png", await render(page, tile(192, { radius: 42, scale: 0.6 }), 192, 192));
  write("icon-512.png", await render(page, tile(512, { radius: 112, scale: 0.6 }), 512, 512));
  // Maskable: full bleed, with the logo inside the central safe zone.
  write(
    "icon-maskable-512.png",
    await render(page, tile(512, { radius: 0, scale: 0.46 }), 512, 512),
  );
  // iOS rounds the corners itself and shows transparency as black.
  write(
    "apple-touch-icon.png",
    await render(page, tile(180, { radius: 0, scale: 0.56 }), 180, 180),
  );
  write("favicon.ico", ico(await render(page, tile(32, { radius: 7, scale: 0.66 }), 32, 32), 32));
} finally {
  await browser.close();
}
