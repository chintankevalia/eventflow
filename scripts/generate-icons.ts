/**
 * Builds raster favicon fallbacks from the vector brand marks in brand/.
 *   npm run icons:generate
 * Outputs to public/: favicon.ico (16/32/48, light mark), favicon-32.png, apple-touch-icon.png,
 * icon-192.png, icon-512.png. SVG favicons (light/dark aware) are used by modern browsers.
 */
import { readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const light = readFileSync("brand/favicon-light.svg");

async function png(
  svg: Buffer,
  size: number,
  { padding = 0, background }: { padding?: number; background?: string } = {},
) {
  const inner = Math.round(size * (1 - padding * 2));
  const mark = await sharp(svg, { density: 1200 }).resize(inner, inner).png().toBuffer();
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: background ?? { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: mark, gravity: "center" }])
    .png()
    .toBuffer();
}

/** ICO container holding PNG images (supported by all current browsers and Windows). */
function ico(images: { size: number; data: Buffer }[]) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const dir = Buffer.alloc(16 * images.length);
  let offset = 6 + dir.length;
  images.forEach(({ size, data }, i) => {
    const o = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, o);
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1);
    dir.writeUInt8(0, o + 2);
    dir.writeUInt8(0, o + 3);
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(data.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += data.length;
  });
  return Buffer.concat([header, dir, ...images.map((i) => i.data)]);
}

async function main() {
  const sizes = [16, 32, 48];
  const icoImages = await Promise.all(sizes.map(async (size) => ({ size, data: await png(light, size) })));
  writeFileSync("public/favicon.ico", ico(icoImages));
  writeFileSync("public/favicon-32.png", icoImages[1].data);
  // Home-screen icons sit on a white tile so the black ring stays visible on any wallpaper.
  writeFileSync("public/apple-touch-icon.png", await png(light, 180, { padding: 0.14, background: "#ffffff" }));
  writeFileSync("public/icon-192.png", await png(light, 192, { padding: 0.14, background: "#ffffff" }));
  writeFileSync("public/icon-512.png", await png(light, 512, { padding: 0.14, background: "#ffffff" }));
  // Email clients do not render SVG: 2x PNG of the light wordmark (shown at 132×21).
  writeFileSync(
    "public/brand/motadata-logo-email.png",
    await sharp(readFileSync("brand/motadata-logo-light.svg"), { density: 600 })
      .resize({ width: 264 })
      .png()
      .toBuffer(),
  );
  console.log("Icons written to public/");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
