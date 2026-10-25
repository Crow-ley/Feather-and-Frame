// Builds the Foundry module and the standalone page from src/.
// Run with Node 18 or newer:  node build.mjs
// Output goes to dist/:
//   dist/feather-and-frame/        the module folder (copy into Data/modules to test)
//   dist/feather-and-frame.zip     the release zip for GitHub
//   dist/module.json               the release manifest for GitHub
//   dist/feather-and-frame.html    the standalone tool page
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const read = (p) => readFileSync(join(root, p));
const b64 = (p) => read(p).toString("base64");

const manifest = JSON.parse(read("module.json"));
const v = manifest.version;
const id = manifest.id;

// 1. The tool page. src/tool.html refers to its images as assets/<name>.
const ASSETS = { "assets/favicon.png": "image/png", "assets/discord-server.webp": "image/webp", "assets/discord-user.webp": "image/webp" };
const source = read("src/tool.html").toString();
for (const a of Object.keys(ASSETS)) if (!source.includes(`"${a}"`)) throw new Error(`src/tool.html doesn't use ${a}`);
const wrap = (body) => `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n</head>\n<body>\n${body}\n</body>\n</html>\n`;
// The standalone page has nowhere to load images from, so they are written in as base64.
let standalone = source;
for (const [a, type] of Object.entries(ASSETS)) standalone = standalone.split(`"${a}"`).join(`"data:${type};base64,${b64(a)}"`);

// 2. The module folder. The script and style names carry the version so Foundry never runs
//    a cached older copy. tool.html and the images are shipped as they are, readable.
const out = join(root, "dist", id);
rmSync(join(root, "dist"), { recursive: true, force: true });
for (const d of ["scripts", "styles", "assets"]) mkdirSync(join(out, d), { recursive: true });

writeFileSync(join(out, "scripts", `main-${v}.js`), read("src/main.js"));
writeFileSync(join(out, "styles", `ccs-${v}.css`), read("src/ccs.css"));
writeFileSync(join(out, "tool.html"), wrap(source));
for (const a of Object.keys(ASSETS)) writeFileSync(join(out, a), read(a));

const built = { ...manifest, esmodules: [`scripts/main-${v}.js`], styles: [`styles/ccs-${v}.css`] };
const manifestText = JSON.stringify(built, null, 2) + "\n";
writeFileSync(join(out, "module.json"), manifestText);
writeFileSync(join(root, "dist", "module.json"), manifestText);
writeFileSync(join(root, "dist", `${id}.html`), standalone);

// 3. The release zip, files at its root as Foundry expects. A small store-only zip writer
//    (no compression) so the build needs nothing beyond Node itself.
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
// Zip entries need a valid date; 1 January 2026 in the DOS format zip uses.
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else files.push({ name: relative(out, p).split("\\").join("/"), data: readFileSync(p) });
  }
};
walk(out);
const parts = [], central = [];
let offset = 0;
for (const f of files) {
  const name = Buffer.from(f.name), crc = crc32(f.data), size = f.data.length;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(DOS_DATE, 12);
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(size, 18); local.writeUInt32LE(size, 22);
  local.writeUInt16LE(name.length, 26);
  parts.push(local, name, f.data);
  const cen = Buffer.alloc(46);
  cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(DOS_DATE, 14);
  cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(size, 20); cen.writeUInt32LE(size, 24);
  cen.writeUInt16LE(name.length, 28); cen.writeUInt32LE(offset, 42);
  central.push(cen, name);
  offset += 30 + name.length + size;
}
const centralSize = central.reduce((n, b) => n + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);
writeFileSync(join(root, "dist", `${id}.zip`), Buffer.concat([...parts, ...central, end]));

console.log(`Built ${manifest.title} ${v}`);
for (const f of files) console.log(`  ${f.name}`);
console.log("Release files: dist/module.json and dist/" + id + ".zip");
