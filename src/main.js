/* Feather & Frame (Foundry VTT v13+)
 * Opens the token tool inside Foundry and sends finished tokens straight to an actor. */

const ID = "feather-and-frame";
const TITLE = "Feather & Frame";

// Settings
Hooks.once("init", () => {
  const reg = (key, data) => game.settings.register(ID, key, { scope: "world", config: true, ...data });
  reg("allowPlayers", { name: "Let players conjure their own tokens", hint: "Players can open Feather & Frame for actors they own and update their token and portrait. Players without Foundry's Upload New Files permission (or Use File Browser, for wildcard sets) send their token to a GM, who approves it before anything is uploaded.", type: Boolean, default: false });
  reg("tokenFolder", { name: "Token upload folder", hint: "Folder inside your Foundry data where finished tokens are saved.", type: String, default: "tokens/conjured" });
  reg("portraitFolder", { name: "Portrait upload folder", hint: "Folder for portrait images.", type: String, default: "tokens/conjured/portraits" });
  reg("stdScale", { name: "Standard: token scale", type: Number, default: 1 });
  reg("stdCorrection", { name: "Standard: ring scale correction", type: Number, default: 1 });
  reg("bigScale", { name: "Big Chungus: token scale", hint: "Token scale enlarges the ring and the image together.", type: Number, default: 2 });
  reg("compendiumActors", { name: "Compendium actors", hint: "Lets GMs make tokens for actors stored in compendiums: drag one from a compendium onto the tool's actor box, or use the crow on its sheet. Sending changes the compendium entry, so the compendium has to be unlocked.", type: Boolean, default: true });
  reg("checkUpdates", { name: "Check GitHub for updates", hint: "Once per session, when a GM opens the window, ask GitHub whether a newer version is out. This sends one request to api.github.com and nothing else.", type: Boolean, default: true });
  reg("bigCorrection", { name: "Big Chungus: ring scale correction", hint: "Scale correction enlarges only the image inside the ring. Big Chungus images are drawn at half size, so 2 makes it fill the ring.", type: Number, default: 2 });
  game.settings.register(ID, "usePortrait", { scope: "client", config: false, type: Boolean, default: true });
  game.settings.register(ID, "updatePlaced", { scope: "client", config: false, type: Boolean, default: true });
  game.settings.register(ID, "saveEdits", { scope: "client", config: false, type: Boolean, default: true });
  game.settings.register(ID, "skipVersion", { scope: "client", config: false, type: String, default: "" });
});

// Helpers
const FP = () => foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
const fileSource = () => (globalThis.ForgeVTT?.usingTheForge ? "forgevtt" : "data");
const cleanFolder = (f) => String(f || "").trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
// File names keep letters, digits and a few marks; ".." and leading dots can't survive, so a name
// can never climb out of its folder.
const safeName = (n) => String(n || "token").replace(/[^\w\-. ()']+/g, "_").replace(/\.{2,}/g, ".").replace(/^[._ ]+|[._ ]+$/g, "") || "token";
// A folder below the token folder, made only of the marks safeName keeps and with no "." or ".."
// parts. Folders read from actor flags must pass this: an actor's owner can write those flags.
function inTokenFolder(f) {
  const base = cleanFolder(game.settings.get(ID, "tokenFolder")), path = cleanFolder(f);
  if (!base || !path.startsWith(`${base}/`)) return false;
  const rest = path.slice(base.length + 1);
  return /^[\w\-. ()'/]+$/.test(rest) && !rest.split("/").some((p) => !p || p === "." || p === "..");
}

async function ensureFolder(source, folder) {
  const fp = FP();
  let path = "";
  for (const part of folder.split("/").filter(Boolean)) {
    path = path ? `${path}/${part}` : part;
    try { await fp.browse(source, path); }
    catch (e) { try { await fp.createDirectory(source, path, {}); } catch (err) { /* already exists */ } }
  }
}
async function upload(file, folder) {
  const source = fileSource(), fp = FP();
  folder = cleanFolder(folder);
  await ensureFolder(source, folder);
  // Forge's CDN can serve a stale copy of an overwritten file, so Forge uploads get unique names.
  if (source === "forgevtt") {
    const stamp = Date.now().toString(36);
    file = new File([file], file.name.replace(/(\.[^.]+)?$/, (ext) => `-${stamp}${ext}`), { type: file.type });
  }
  const res = await fp.upload(source, folder, file, {}, { notify: false });
  if (res === false || res?.status === "error") throw new Error(res?.message || "the upload was refused");
  let path = res?.path ?? `${folder}/${file.name}`;
  // Version tag so cached textures aren't reused and repeat sends still count as a change.
  return path.replace(/\?.*$/, "") + "?v=" + Date.now().toString(36);
}

// Dynamic ring
// The module ships no ring art. It reads the spritesheet of the ring this actor's token uses and
// draws it at 1024 px, coloured the way Foundry's ring shader would colour it.
const routeOf = (p) => (/^(https?:|data:|blob:)/.test(p) ? p : foundry.utils.getRoute(p));
// The tool page has a <base> pointing at this module's folder, so Foundry paths it shows
// (like an actor's image) are passed as full addresses.
const fullUrl = (p) => new URL(routeOf(p), window.location.href).href;

/* The spritesheet for an actor's ring: the ring picked in Foundry's "Dynamic Token Rings" setting.
   Multiple Rings, when it is active, lets each token pick its own ring and replaces Foundry's
   active ring with a combined sheet it builds in memory, so its token flag is checked first. */
function ringSheetPath(actor) {
  const rc = CONFIG.Token.ring;
  let id = null;
  if (game.modules.get("multiple-rings")?.active) {
    id = foundry.utils.getProperty(actor?.prototypeToken ?? {}, "flags.multiple-rings.ringAppearance") || null;
  }
  if (!id) { try { id = game.settings.get("core", "dynamicTokenRing"); } catch (e) { id = null; } }
  let path = null;
  try { path = id ? rc.getConfig(id)?.spritesheet : null; } catch (e) { path = null; }
  return path || rc?.spritesheet || null;
}

const ringSheets = new Map();
function loadRingSheet(path) {
  if (!path) return Promise.resolve(null);
  if (ringSheets.has(path)) return ringSheets.get(path);
  const load = (async () => {
    const res = await fetch(routeOf(path));
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    const json = await res.json();
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = routeOf(path.replace(/[^/]*$/, "") + json.meta.image);
    await img.decode();
    return { img, frames: json.frames, config: json.config ?? {} };
  })();
  ringSheets.set(path, load);
  load.catch(() => ringSheets.delete(path));
  return load;
}

// Draws one spritesheet frame scaled to fill a size x size square (handles trimmed and rotated frames).
function drawFrame(ctx, img, f, size) {
  const k = size / f.sourceSize.w;
  const s = f.trimmed ? f.spriteSourceSize : { x: 0, y: 0, w: f.sourceSize.w, h: f.sourceSize.h };
  ctx.save();
  ctx.translate(s.x * k, s.y * k);
  ctx.scale(k, k);
  if (f.rotated) {
    ctx.translate(0, s.h);
    ctx.rotate(-Math.PI / 2);
    ctx.drawImage(img, f.frame.x, f.frame.y, f.frame.h, f.frame.w, 0, 0, s.h, s.w);
  } else ctx.drawImage(img, f.frame.x, f.frame.y, f.frame.w, f.frame.h, 0, 0, s.w, s.h);
  ctx.restore();
}
function framePixels(img, f, size) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const x = c.getContext("2d", { willReadFrequently: true });
  drawFrame(x, img, f, size);
  return x.getImageData(0, 0, size, size);
}

/* Foundry's colour rule: the token's own colour, unless it is white or unset, in which case the
   frame's colour, then the sheet's default. White when none is given. Returns [r, g, b] from 0 to 1. */
function ringColour(own, frameColour, sheetColour) {
  const C = foundry.utils.Color;
  const c = C.from(own ?? 0xFFFFFF);
  if (c.valid && Number(c) !== 0xFFFFFF) return c.rgb;
  for (const d of [frameColour, sheetColour]) {
    if (d == null || d === "") continue;
    const x = C.from(d);
    if (x.valid) return x.rgb;
  }
  return [1, 1, 1];
}

// Foundry's ring as a 1024 px PNG, coloured the way the actor's token would be. This follows
// Foundry's ring shader: the background is tinted with an overlay blend, and inside the colour
// band (or under the "-msk" mask frame, when a sheet has one) the ring colour is multiplied by
// the art's red channel.
async function ringImage(actor) {
  const sheet = await loadRingSheet(ringSheetPath(actor));
  if (!sheet) return null;
  // Like Foundry, use the ring frame made for this token's grid size (a sheet can draw small and
  // large rings differently). "-bkg" and "-msk" frames are not rings. Ties go to the larger frame.
  const tok = actor?.prototypeToken, grid = Math.min(Number(tok?.width) || 1, Number(tok?.height) || 1);
  const rings = Object.entries(sheet.frames).filter(([n]) => !n.includes("-bkg") && !n.includes("-msk"))
    .sort((a, b) => Math.abs((a[1].gridTarget ?? 1) - grid) - Math.abs((b[1].gridTarget ?? 1) - grid) || b[1].sourceSize.w - a[1].sourceSize.w);
  if (!rings.length) return null;
  const [name, ring] = rings[0];
  const bkg = sheet.frames[`${name}-bkg`] ?? null, msk = sheet.frames[`${name}-msk`] ?? null;
  const size = 1024, half = size / 2;
  const { img, config } = sheet;
  const colours = actor?.prototypeToken?.ring?.colors ?? {};
  const rc = ringColour(colours.ring, ring.ringColor, config.defaultRingColor);
  const bc = ringColour(colours.background, ring.backgroundColor, config.defaultBackgroundColor);
  const tinted = bc.some((v) => v !== 1);
  const band = msk ? { startRadius: 0, endRadius: 0 } : (ring.colorBand ?? config.defaultColorBand ?? { startRadius: 0.59, endRadius: 0.7225 });

  const out = new ImageData(size, size), o = out.data;
  const R = framePixels(img, ring, size).data;
  const B = bkg ? framePixels(img, bkg, size).data : null;
  const M = msk ? framePixels(img, msk, size).data : null;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    // Background, overlay-blended with its tint (premultiplied while compositing)
    let r = 0, g = 0, b = 0, a = 0;
    if (B && B[i + 3]) {
      a = B[i + 3] / 255;
      let col = [B[i] / 255, B[i + 1] / 255, B[i + 2] / 255];
      if (tinted) col = col.map((v, k) => (v < 0.5 ? 2 * v * bc[k] : 1 - 2 * (1 - v) * (1 - bc[k])));
      r = col[0] * a; g = col[1] * a; b = col[2] * a;
    }
    // Ring
    const ra = R[i + 3] / 255;
    if (ra) {
      const dist = Math.hypot(x + 0.5 - half, y + 0.5 - half) / half;
      let col = [R[i] / 255, R[i + 1] / 255, R[i + 2] / 255];
      if (dist >= band.startRadius && dist < band.endRadius) col = rc.map((v) => v * col[0]);
      r = col[0] * ra + r * (1 - ra); g = col[1] * ra + g * (1 - ra); b = col[2] * ra + b * (1 - ra); a = ra + a * (1 - ra);
    }
    // Mask: ring colour times the mask's red channel, laid over the top
    if (M && M[i + 3]) {
      const ma = M[i + 3] / 255, k = M[i] / 255;
      r = rc[0] * k * ma + r * (1 - ma); g = rc[1] * k * ma + g * (1 - ma); b = rc[2] * k * ma + b * (1 - ma); a = ma + a * (1 - ma);
    }
    if (a > 0) { o[i] = (r / a) * 255; o[i + 1] = (g / a) * 255; o[i + 2] = (b / a) * 255; o[i + 3] = a * 255; }
  }
  const c = document.createElement("canvas");
  c.width = c.height = size;
  c.getContext("2d").putImageData(out, 0, 0);
  return c.toDataURL("image/png");
}

// Tool page
// The tool page ships as a normal file (tool.html) next to its images in assets/.
// It is read once, given a <base> tag so its relative image paths point at this module's
// folder, and loaded into the window's iframe with srcdoc.
let toolPage = null;
async function loadToolPage() {
  if (toolPage) return toolPage;
  // getRoute drops trailing slashes, so the slash is added after it.
  const folder = new URL(`${foundry.utils.getRoute(`modules/${ID}`)}/`, window.location.href).href;
  const version = game.modules.get(ID)?.version ?? "";
  const res = await fetch(`${folder}tool.html?v=${encodeURIComponent(version)}`, { cache: "no-cache" });
  if (!res.ok) throw new Error(`tool.html: ${res.status}`);
  const html = await res.text();
  if (!html.includes("<head>")) throw new Error("tool.html has no <head>");
  return (toolPage = html.replace("<head>", `<head>\n<base href="${folder}">`));
}

// Window
const { ApplicationV2 } = foundry.applications.api;

class FeatherFrameApp extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "ccs-app",
    classes: ["ccs-app"],
    tag: "div",
    window: { title: TITLE, icon: "fa-solid fa-crow", resizable: true },
    position: { width: Math.min(1500, window.innerWidth - 60), height: Math.min(950, window.innerHeight - 60) },
    actions: { ccsHelp: FeatherFrameApp.#onHelp },
  };

  static #onHelp() { this.tool?.toggleHelp?.(); }

  // Help button in the title bar, left of the menu and close buttons.
  async _renderFrame(options) {
    const frame = await super._renderFrame(options);
    const header = frame.querySelector(".window-header");
    if (header && !header.querySelector('[data-action="ccsHelp"]')) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "header-control icon fa-solid fa-circle-question";
      b.dataset.action = "ccsHelp";
      b.dataset.tooltip = "Help";
      b.setAttribute("aria-label", "Help");
      header.insertBefore(b, header.querySelector('[data-action="toggleControls"]') ?? header.querySelector('[data-action="close"]'));
    }
    return frame;
  }

  actor = null;
  #built = false;
  #hosted = null;

  async _renderHTML() {
    // Reuse the frame while open; rebuild after close.
    if (this.#built && this.element?.isConnected && this.element.querySelector(".ccs-wrap")) return null;
    const wrap = document.createElement("div");
    wrap.className = "ccs-wrap";
    wrap.innerHTML = `<iframe class="ccs-frame" data-ccs="frame"></iframe>`;
    try { wrap.querySelector("iframe").srcdoc = await loadToolPage(); }
    catch (e) {
      console.error(`${TITLE} | tool page`, e);
      ui.notifications.error(`${TITLE}: couldn't load the tool page (${e?.message ?? e}). Try reinstalling the module.`);
    }
    return wrap;
  }

  _replaceHTML(result, content) {
    if (!result) return;
    content.replaceChildren(result);
    this.#built = true;
    this.#hosted = null;
  }

  _onRender() {
    const el = this.element;
    if (this.#hosted === el) return;
    this.#hosted = el;
    // Connect to the tool once it has started; report a frame that never starts (e.g. blocked by a host's CSP).
    const started = Date.now();
    const attach = () => {
      if (this.element !== el || !el.isConnected) return;
      const tool = this.tool;
      if (tool?.attachHost) return tool.attachHost(this.#host(), keyOf(this.actor));
      if (Date.now() - started > 8000) return ui.notifications.error(`${TITLE}: the tool didn't start. This server may block it from running inside Foundry windows.`);
      setTimeout(attach, 100);
    };
    attach();
  }

  // Persist the token list before the frame is destroyed.
  async _preClose(options) {
    try { await this.previewStop(); } catch (e) { console.warn(`${TITLE} | preview`, e); }
    try { await this.tool?.flush?.(); } catch (e) { /* ignore */ }
    return super._preClose?.(options);
  }

  get tool() {
    try { return this.element.querySelector('[data-ccs="frame"]').contentWindow.CCS ?? null; } catch (e) { return null; }
  }

  setActor(actor) {
    this.actor = actor;
    this.tool?.setActor?.(keyOf(actor));
  }

  /* Everything the tool needs from Foundry. */
  #host() {
    const info = (a) => (a ? { id: keyOf(a), name: a.pack ? `${a.name} (${game.packs.get(a.pack)?.title ?? "compendium"})` : a.name, img: fullUrl(a.img || "icons/svg/mystery-man.svg") } : null);
    return {
      actors: () => game.actors.contents.filter((a) => canUse(a)).sort((a, b) => a.name.localeCompare(b.name)).map(info),
      actor: (id) => info(getActor(id)),
      isPack: (id) => !!getActor(id)?.pack,
      fromDrop: async (text) => {
        let data; try { data = JSON.parse(text); } catch (e) { return null; }
        if (data?.type !== "Actor") return null;
        const a = await fromUuid(data.uuid);
        if (!(a instanceof Actor)) return null;
        if (a.pack && !packAllowed()) { ui.notifications.warn(PACK_OFF); return null; }
        return canUse(rememberPackActor(a)) ? info(a) : null;
      },
      prefs: () => ({ usePortrait: game.settings.get(ID, "usePortrait"), updatePlaced: game.settings.get(ID, "updatePlaced"), saveEdits: game.settings.get(ID, "saveEdits") }),
      savedEdits: (id) => savedEdits(getActor(id)).length,
      loadEdits: (id) => loadEdits(getActor(id)),
      wildcard: (id) => wildcardSet(getActor(id)),
      needsGM: (wild) => needsApproval(!!wild),
      savePref: (key, value) => game.settings.set(ID, key, value),
      selected: (id) => { this.actor = getActor(id); },
      send: (opts, progress) => this.send(opts, progress),
      previewStart: (id) => this.previewStart(id),
      previewUpdate: (src, opts) => this.previewUpdate(src, opts),
      previewStop: () => this.previewStop(),
      ring: (id) => ringImage(getActor(id)),
    };
  }

  /* Scale and ring settings a token gets for a template. */
  #tokenConfig(tpl, baked) { return tokenConfig(tpl, baked); }

  // Preview on Map. Changes are local to this client: token data is set with updateSource and the
  // mesh texture is swapped. Everything is restored on stop, close, send or scene change.
  #prev = null;

  async previewStart(actorId) {
    await this.previewStop();
    if (!canvas?.ready || !canvas.scene) throw new Error("Open a scene to preview on the map.");
    this.#prev = { actorId, sceneId: canvas.scene.id, c: document.createElement("canvas"), tex: null, cfg: null, done: new Map() };
    return this.#previewTokens().length;
  }

  // The actor's selected token, else the one already previewed, else the first placed.
  #previewTokens() {
    const P = this.#prev;
    if (!P || !canvas?.ready) return [];
    const mine = canvas.tokens.placeables.filter((t) => t.document.actorId === P.actorId && !t.destroyed);
    const picked = mine.filter((t) => t.controlled);
    const t = picked.find((x) => x.id === P.tokenId) ?? picked[0] ?? mine.find((x) => x.id === P.tokenId) ?? mine[0];
    P.tokenId = t?.id ?? null;
    return t ? [t] : [];
  }

  /* Selecting another of the actor's tokens moves the preview to it. */
  previewControl(token, controlled) {
    const P = this.#prev;
    if (!P?.cfg || !controlled || token.document.actorId !== P.actorId || token.id === P.tokenId) return;
    this.#previewApplyAll();
  }

  async #previewApplyAll() {
    const targets = this.#previewTokens();
    await this.#previewRestore(true, new Set(targets.map((t) => t.id)));
    for (const t of targets) await this.#previewApply(t);
  }

  async previewUpdate(src, opts) {
    const P = this.#prev; if (!P) return;
    if (P.sceneId !== canvas.scene?.id) { await this.#previewRestore(); P.sceneId = canvas.scene?.id; }
    if (!src) return this.#previewRestore();
    const resized = P.c.width !== src.width || P.c.height !== src.height;
    if (resized) { P.c.width = src.width; P.c.height = src.height; }
    const x = P.c.getContext("2d"); x.clearRect(0, 0, P.c.width, P.c.height); x.drawImage(src, 0, 0);
    if (!P.tex || resized || P.tex.baseTexture?.destroyed) P.tex = new PIXI.Texture(new PIXI.BaseTexture(P.c));
    else P.tex.baseTexture.update();
    P.cfg = this.#tokenConfig(opts.tpl, opts.baked);
    await this.#previewApplyAll();
  }

  async #previewApply(t) {
    const P = this.#prev, doc = t.document, src = doc._source, key = JSON.stringify(P.cfg);
    if (!P.done.has(t.id)) P.done.set(t.id, { key: null, orig: {
      "ring.enabled": src.ring.enabled, "ring.subject.scale": src.ring.subject.scale,
      "texture.scaleX": src.texture.scaleX, "texture.scaleY": src.texture.scaleY } });
    const d = P.done.get(t.id);
    if (d.key !== key) {
      const c = P.cfg;
      doc.updateSource(c.baked
        ? { "ring.enabled": false, "texture.scaleX": c.scale, "texture.scaleY": c.scale }
        : { "ring.enabled": true, "ring.subject.scale": c.correction, "texture.scaleX": c.scale, "texture.scaleY": c.scale });
      d.key = key;
      await t.draw();
    }
    this.#previewSwap(t);
  }

  #previewSwap(t) {
    const P = this.#prev;
    if (!P?.tex || !P.done.has(t.id) || !t.mesh || t.destroyed || t.mesh.texture === P.tex) return;
    if (P.tex.baseTexture?.destroyed) { P.tex = new PIXI.Texture(new PIXI.BaseTexture(P.c)); }
    t.texture = P.tex; t.mesh.texture = P.tex;
    t.renderFlags.set({ refreshSize: true, refreshMesh: true, refreshShader: true });
  }

  // Foundry redrew the token, so put the preview texture back.
  previewRefresh(t) { if (this.#prev) this.#previewSwap(t); }

  async #previewRestore(redraw = true, keep = null) {
    const P = this.#prev; if (!P) return;
    const entries = [...P.done].filter(([id]) => !keep?.has(id));
    for (const [id] of entries) P.done.delete(id);
    const scene = game.scenes.get(P.sceneId);
    for (const [id, d] of entries) {
      const doc = scene?.tokens.get(id); if (!doc) continue;
      doc.updateSource(d.orig);
      const t = doc.object;
      if (redraw && t && !t.destroyed) await t.draw();
    }
  }

  // Scene teardown: restore the document data only.
  previewTearDown() { if (this.#prev) this.#previewRestore(false); }

  async previewStop() {
    if (!this.#prev) return;
    await this.#previewRestore();
    this.#prev = null;
  }

  /* Send to Actor. The token is rendered here; the uploads and actor changes happen in
     applyPackage, either right away or, for a player without upload permission, on a GM's
     computer after the GM approves. */
  async send({ actorId, usePortrait, portraitFile, updatePlaced, wildcard = null, saveEdits = false, portraitFrom = null }, progress = () => {}) {
    const tool = this.tool;
    const inPack = String(actorId ?? "").startsWith("Compendium.");
    const actor = inPack ? await freshPackActor(actorId) : getActor(actorId);
    if (!actor) throw new Error(inPack ? "That compendium actor no longer exists. Drag it in again." : "Pick an actor first.");
    if (actor.pack && !packAllowed()) throw new Error(PACK_OFF);
    if (!canUse(actor)) throw new Error("You can't change this actor.");
    if (actor.pack && game.packs.get(actor.pack)?.locked) throw new Error(`The ${game.packs.get(actor.pack).title} compendium is locked. Unlock it, then send again.`);
    if (!tool?.current()) throw new Error("Load an image first.");
    await this.previewStop();

    const pkg = await buildPackage(actor, tool, { usePortrait, portraitFile, updatePlaced, wildcard, saveEdits, portraitFrom }, progress);
    const message = needsApproval(!!pkg.wildcard) ? await requestApproval(pkg, progress) : await applyPackage(actor, pkg, progress);
    for (const item of pkg.items) tool.markSaved?.(item);
    return message;
  }
}

/* Scale settings a token gets for a template. */
function tokenConfig(tpl, baked) {
  const big = tpl === "big";
  const scale = baked ? (big ? 2 : 1) : (Number(game.settings.get(ID, big ? "bigScale" : "stdScale")) || 1);
  const correction = Number(game.settings.get(ID, big ? "bigCorrection" : "stdCorrection")) || 1;
  return { big, baked, scale, correction };
}

/* Everything a send needs, rendered in the tool: the token images, the portrait and the edit files. */
async function buildPackage(actor, tool, { usePortrait, portraitFile, updatePlaced, wildcard, saveEdits, portraitFrom }, progress) {
  const it = tool.current();
  const sent = wildcard ? tool.items().filter((i) => wildcard.ids.includes(i.id)) : [it];
  if (wildcard) {
    if (sent.some((i) => i.tpl !== it.tpl)) throw new Error("A wildcard set can't mix Standard and Big Chungus tokens.");
    const existing = wildcard.add ? wildcardSet(actor) : null;
    if (!sent.length || (sent.length < 2 && !existing)) throw new Error("A new wildcard set needs at least two tokens.");
  }
  const tokens = [];
  for (const [n, item] of sent.entries()) {
    progress(sent.length > 1 ? `Rendering token ${n + 1} of ${sent.length}...` : "Rendering token...");
    const blob = await tool.encode(item);
    if (blob.type !== "image/webp") throw new Error("This browser can't write WebP files.");
    tokens.push({ id: item.id, name: item.outName, blob });
  }
  // For a wildcard set the portrait can come from any token in the set; otherwise the one being edited.
  const from = (wildcard && portraitFrom && sent.find((i) => i.id === portraitFrom)) || it;
  const pf = portraitFile ?? (usePortrait ? (from.origFile ?? from.file) : null);
  const portrait = pf ? { name: from.outName, ext: (pf.name?.match(/\.[^.]+$/) || [".webp"])[0].toLowerCase(), blob: pf } : null;
  let edits = null;
  if (saveEdits) {
    progress("Saving edits...");
    edits = [];
    for (const item of sent) edits.push({ id: item.id, name: item.outName, json: await tool.exportEdit(item.id) });
  }
  return { actorId: keyOf(actor), tpl: it.tpl, baked: !!tool.baked?.(), wildcard: wildcard ? { add: !!wildcard.add } : null,
    updatePlaced: !!updatePlaced, tokens, portrait, edits, items: sent };
}

/* Upload a package's files and update the actor and its placed tokens. */
async function applyPackage(actor, pkg, progress = () => {}) {
  const { baked, wildcard } = pkg;
  const { big, scale, correction } = tokenConfig(pkg.tpl, baked);
  const folder = game.settings.get(ID, "tokenFolder");
  const n = pkg.tokens.length;

  // One token, or a wildcard set: several tokens in their own folder, picked at random by Foundry.
  let tokenPath, wildPath = null, setPaths = [], setInfo = null;
  if (!wildcard) {
    progress("Uploading token...");
    const t = pkg.tokens[0];
    tokenPath = await upload(new File([t.blob], `${safeName(t.name)}${baked ? "-ringed" : ""}.webp`, { type: "image/webp" }), folder);
  } else {
    const existing = wildcard.add ? wildcardSet(actor) : null;
    const setFolder = existing?.folder ?? `${cleanFolder(folder)}/${safeName(actor.name).replace(/\s+/g, "-")}-${Date.now().toString(36)}`;
    const stamp = Date.now().toString(36);
    for (const [i, t] of pkg.tokens.entries()) {
      progress(`Uploading token ${i + 1} of ${n}...`);
      setPaths.push(await upload(new File([t.blob], `${safeName(t.name)}-${stamp}-${i + 1}.webp`, { type: "image/webp" }), setFolder));
    }
    // The wildcard goes in the folder the files actually landed in (on the Forge that is a full URL).
    const landed = setPaths[0].replace(/\?.*$/, "").replace(/\/[^/]*$/, "");
    wildPath = `${landed}/*.webp`;
    setInfo = { folder: setFolder, wild: wildPath, count: (existing?.count ?? 0) + n };
    tokenPath = setPaths[0];
  }

  const update = baked
    ? { "prototypeToken.ring.enabled": false, "prototypeToken.texture.src": wildPath ?? tokenPath, "prototypeToken.texture.scaleX": scale, "prototypeToken.texture.scaleY": scale }
    : { "prototypeToken.ring.enabled": true, "prototypeToken.ring.subject.texture": wildPath ? null : tokenPath, "prototypeToken.ring.subject.scale": correction,
        "prototypeToken.texture.src": wildPath ?? tokenPath, "prototypeToken.texture.scaleX": scale, "prototypeToken.texture.scaleY": scale };
  // A single token turns wildcards off; a set turns them on. With no ring subject image,
  // Foundry draws whichever image it picked inside the ring.
  update["prototypeToken.randomImg"] = !!wildPath;
  update[`flags.${ID}.wildcard`] = setInfo;
  // src is the plain token image: a random set image, the portrait, or the token itself.
  // The ring always shows the edited token (or, for a set, whichever image Foundry picked).
  const tokenUpdate = (src) => baked
    ? { "ring.enabled": false, "texture.src": src, "texture.scaleX": scale, "texture.scaleY": scale }
    : { "ring.enabled": true, "ring.subject.texture": wildPath ? null : tokenPath, "ring.subject.scale": correction, "texture.src": src, "texture.scaleX": scale, "texture.scaleY": scale };
  let placedSrc = () => tokenPath;

  let portraitPath = null;
  if (pkg.portrait) {
    progress("Uploading the portrait...");
    const p = pkg.portrait;
    portraitPath = await upload(new File([p.blob], `${safeName(p.name)}${p.ext}`, { type: p.blob.type || "image/webp" }), game.settings.get(ID, "portraitFolder"));
    update.img = portraitPath;
    // With a single ring token, the plain token image is the portrait, shown if the ring is turned off.
    if (!baked && !wildPath) { update["prototypeToken.texture.src"] = portraitPath; placedSrc = () => portraitPath; }
  }

  // Saved edits: one JSON file per token in <token folder>/edits, listed on the actor.
  if (pkg.edits) {
    const editFolder = `${cleanFolder(folder)}/edits`;
    const saved = [];
    for (const e of pkg.edits) {
      const id = /^[a-z0-9]+$/i.test(e.id) ? e.id : foundry.utils.randomID();
      const path = await upload(new File([e.json], `${safeName(e.name)}-${id}.json`, { type: "application/json" }), editFolder);
      saved.push({ id, name: e.name, path: path.replace(/\?.*$/, "") });
    }
    // Adding to a wildcard set keeps the edits already saved for the set.
    const keep = wildcard?.add ? savedEdits(actor).filter((e) => !saved.some((s) => s.id === e.id)) : [];
    update[`flags.${ID}.edits`] = [...keep, ...saved];
  }

  progress(`Updating ${actor.name}...`);
  await actor.update(update);

  // Tokens on scenes belong to world actors, never to a compendium entry.
  let placed = 0;
  if (pkg.updatePlaced && !actor.pack) {
    if (wildPath) {
      // Placed tokens each get a random image from the whole set, older ones included.
      const pool = setInfo.count > n ? await listSet(setInfo.folder, setPaths) : setPaths;
      placedSrc = () => pool[Math.floor(Math.random() * pool.length)];
    }
    for (const scene of game.scenes) {
      const ups = scene.tokens.filter((t) => t.actorId === actor.id).map((t) => ({ _id: t.id, ...tokenUpdate(placedSrc()) }));
      if (ups.length) { await scene.updateEmbeddedDocuments("Token", ups); placed += ups.length; }
    }
  }

  ui.notifications.info(`${TITLE}: ${wildPath ? "wildcard set" : "token"} sent to ${actor.name}.`);
  const parts = [(big ? "Big Chungus" : "Standard") + (baked ? ", ring baked in" : ""), `scale ${scale}`];
  if (!baked) parts.push(`scale correction ${correction}`);
  if (wildPath) parts.push(`${n} token${n > 1 ? "s" : ""} ${wildcard.add && setInfo.count > n ? `added, ${setInfo.count} in the set` : "in the wildcard set"}`);
  if (pkg.edits) parts.push("edits saved");
  if (portraitPath) parts.push("portrait set");
  if (placed) parts.push(`${placed} placed token${placed > 1 ? "s" : ""} updated`);
  return `Sent to ${actor.name}: ${parts.join(", ")}.`;
}

// GM approval
// A player without Upload New Files (or Use File Browser, for a wildcard set) can't upload, so the
// rendered files go to the active GM over the module's socket in small pieces. The GM sees what
// will change and approves or declines; on approval the GM's Foundry runs applyPackage. The GM
// side checks everything itself and only ever writes into its own configured folders.
// Socket messages say nothing trustworthy about who sent them, so the player also marks the
// request on their own User (the request id and a hash of the package). Only that player or a GM
// can write a User, so the GM trusts a request only when the sender's mark matches it, and clears
// the mark before answering, which is how the player knows the answer came from a GM.
const SOCKET = `module.${ID}`;
const PART = 200000;                    // characters per socket message
const MAX_TOKENS = 50, MAX_BYTES = 40e6;
const waiting = new Map();              // player: request id -> { resolve, reject }
const arriving = new Map();             // GM: request id -> { from, n, parts }

function needsApproval(wildcard) {
  if (game.user.isGM) return false;
  return !game.user.can("FILES_UPLOAD") || (wildcard && !game.user.can("FILES_BROWSE"));
}

const blobToData = (b) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(b); });
const dataToBlob = async (d) => (await fetch(d)).blob();

/* What an image file really is, from its first bytes: png, jpeg, webp, gif, avif, or null. */
function imageType(b) {
  const s = (from, to) => String.fromCharCode(...b.slice(from, to));
  if (b[0] === 0x89 && s(1, 4) === "PNG") return "png";
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return "jpeg";
  if (s(0, 4) === "RIFF" && s(8, 12) === "WEBP") return "webp";
  if (s(0, 4) === "GIF8") return "gif";
  if (s(4, 8) === "ftyp" && /^avi[fs]$/.test(s(8, 12))) return "avif";
  return null;
}
/* A data URL as an image blob, if its bytes are one of the allowed types and the browser can decode it. */
async function checkedImage(data, types, error) {
  const blob = await dataToBlob(data).catch(() => null);
  const type = blob && imageType(new Uint8Array(await blob.slice(0, 12).arrayBuffer()));
  if (!types.includes(type)) throw new Error(error);
  try { (await createImageBitmap(blob)).close?.(); } catch (e) { throw new Error(error); }
  return new Blob([blob], { type: `image/${type}` });
}

// SHA-256 of a string's UTF-8 bytes, as hex. crypto.subtle only exists on https and localhost,
// and many Foundry servers run on plain http, so it is worked out here.
const SHA = (() => {
  const K = [], H = [];
  for (let c = 2, k = 0; k < 64; c++) {
    let prime = true;
    for (let d = 2; d * d <= c; d++) if (c % d === 0) { prime = false; break; }
    if (!prime) continue;
    if (k < 8) H[k] = ((c ** (1 / 2)) % 1) * 2 ** 32 | 0;
    K[k++] = ((c ** (1 / 3)) % 1) * 2 ** 32 | 0;
  }
  return { K, H };
})();
function sha256(text) {
  const bytes = new TextEncoder().encode(text), len = bytes.length, n = ((len + 72) >> 6) << 4;
  const m = new Uint32Array(n), W = new Uint32Array(64), s = [...SHA.H], K = SHA.K;
  for (let i = 0; i < len; i++) m[i >> 2] |= bytes[i] << (24 - (i % 4) * 8);
  m[len >> 2] |= 0x80 << (24 - (len % 4) * 8);
  m[n - 2] = Math.floor(len / 0x20000000); m[n - 1] = len << 3;
  const rot = (x, r) => (x >>> r) | (x << (32 - r));
  for (let j = 0; j < n; j += 16) {
    for (let i = 0; i < 64; i++) {
      if (i < 16) { W[i] = m[j + i]; continue; }
      const x = W[i - 15], y = W[i - 2];
      W[i] = (rot(x, 7) ^ rot(x, 18) ^ (x >>> 3)) + W[i - 7] + (rot(y, 17) ^ rot(y, 19) ^ (y >>> 10)) + W[i - 16];
    }
    let [a, b, c, d, e, f, g, h] = s;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rot(e, 6) ^ rot(e, 11) ^ rot(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) | 0;
      const t2 = ((rot(a, 2) ^ rot(a, 13) ^ rot(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    [a, b, c, d, e, f, g, h].forEach((v, i) => { s[i] = (s[i] + v) | 0; });
  }
  return s.map((v) => (v >>> 0).toString(16).padStart(8, "0")).join("");
}

async function requestApproval(pkg, progress) {
  const gm = game.users.activeGM;
  if (!gm) throw new Error("No GM is online to approve this. Try again when your GM is connected.");
  progress("Packing the token for your GM...");
  const body = {
    actorId: pkg.actorId, tpl: pkg.tpl, baked: pkg.baked, wildcard: pkg.wildcard, updatePlaced: pkg.updatePlaced,
    tokens: await Promise.all(pkg.tokens.map(async (t) => ({ id: t.id, name: t.name, data: await blobToData(t.blob) }))),
    portrait: pkg.portrait ? { name: pkg.portrait.name, ext: pkg.portrait.ext, data: await blobToData(pkg.portrait.blob) } : null,
    edits: pkg.edits,
  };
  const text = JSON.stringify(body);
  if (text.length > MAX_BYTES * 1.4) throw new Error("These images are too large to send to the GM. Try fewer tokens or a smaller portrait.");
  const reqId = foundry.utils.randomID(), n = Math.ceil(text.length / PART);
  await game.user.setFlag(ID, "request", { id: reqId, hash: sha256(text) });
  const answer = new Promise((resolve, reject) => {
    waiting.set(reqId, { resolve, reject });
    setTimeout(() => {
      if (!waiting.delete(reqId)) return;
      if (game.user.getFlag(ID, "request")?.id === reqId) game.user.unsetFlag(ID, "request").catch(() => {});
      reject(new Error("Your GM didn't answer within 15 minutes."));
    }, 15 * 60 * 1000);
  });
  for (let i = 0; i < n; i++) {
    progress(`Sending to ${gm.name}... ${Math.round(((i + 1) / n) * 100)}%`);
    game.socket.emit(SOCKET, { type: "part", reqId, to: gm.id, from: game.user.id, i, n, part: text.slice(i * PART, (i + 1) * PART) });
  }
  progress(`Waiting for ${gm.name} to approve...`);
  return answer;
}

function onSocket(msg) {
  if (!msg || msg.to !== game.user.id) return;
  if (msg.type === "result") {
    const w = waiting.get(msg.reqId);
    // A GM clears the request mark before answering, so an answer while it is still set is forged.
    if (!w || game.user.getFlag(ID, "request")?.id === msg.reqId) return;
    waiting.delete(msg.reqId);
    if (msg.ok) w.resolve(String(msg.message)); else w.reject(new Error(String(msg.message)));
    return;
  }
  if (msg.type !== "part" || !game.user.isGM) return;
  let a = arriving.get(msg.reqId);
  if (!a) {
    // Nothing is kept for a request its sender hasn't marked, so each player has at most one
    // request arriving at a time and nobody can fill the GM's memory with made-up ones.
    const user = game.users.get(msg.from);
    if (!user || user.isGM || user.getFlag(ID, "request")?.id !== msg.reqId) return;
    if (!Number.isInteger(msg.n) || msg.n < 1 || msg.n * PART > MAX_BYTES * 1.5) return;
    if (!game.settings.get(ID, "allowPlayers")) return answer(msg.reqId, msg.from, false, "The GM hasn't allowed players to make tokens.");
    for (const [id, other] of arriving) if (other.from === msg.from) arriving.delete(id);
    arriving.set(msg.reqId, (a = { from: msg.from, n: msg.n, parts: new Array(msg.n), got: 0 }));
    setTimeout(() => { if (arriving.get(msg.reqId) === a) arriving.delete(msg.reqId); }, 10 * 60 * 1000);
  }
  if (a.from !== msg.from || !Number.isInteger(msg.i) || msg.i < 0 || msg.i >= a.n || a.parts[msg.i] != null || typeof msg.part !== "string") return;
  a.parts[msg.i] = msg.part;
  if (++a.got < a.n) return;
  arriving.delete(msg.reqId);
  // One approval dialog at a time; requests queue behind it.
  const text = a.parts.join("");
  approvals = approvals.then(() => handleRequest(msg.reqId, a.from, text));
}
let approvals = Promise.resolve();

/* Answer a player's request. The sender's mark is cleared first (see GM approval above). */
async function answer(reqId, userId, ok, message) {
  const user = game.users.get(userId);
  if (user?.getFlag(ID, "request")?.id === reqId) await user.unsetFlag(ID, "request").catch((e) => console.warn(`${TITLE} | approval`, e));
  game.socket.emit(SOCKET, { type: "result", reqId, to: userId, from: game.user.id, ok, message });
}

async function handleRequest(reqId, userId, text) {
  const reply = (ok, message) => answer(reqId, userId, ok, message);
  try {
    const user = game.users.get(userId);
    if (!user) throw new Error("Unknown user.");
    // The sender's own mark must name this request and match what arrived (see GM approval above).
    const mark = user.getFlag(ID, "request");
    if (user.isGM || mark?.id !== reqId || mark.hash !== sha256(text)) throw new Error("Your GM couldn't confirm this request came from you. Send it again.");
    if (!game.settings.get(ID, "allowPlayers")) throw new Error("The GM hasn't allowed players to make tokens.");
    let body;
    try { body = JSON.parse(text); } catch (e) { throw new Error("The request arrived damaged. Try again."); }
    const actor = game.actors.get(body?.actorId);
    if (!actor) throw new Error("That actor isn't in this world.");
    if (!actor.testUserPermission(user, "OWNER")) throw new Error(`${user.name} doesn't own ${actor.name}.`);
    // Only expected kinds of data get through.
    const tokens = Array.isArray(body.tokens) ? body.tokens : [];
    if (!tokens.length || tokens.length > MAX_TOKENS) throw new Error("The request has no tokens.");
    if (tokens.some((t) => typeof t.data !== "string" || !t.data.startsWith("data:image/webp;base64,"))) throw new Error("A token image isn't a WebP image.");
    const portrait = body.portrait;
    if (portrait && (typeof portrait.data !== "string" || !/^data:image\/(png|jpeg|webp|gif|avif);base64,/.test(portrait.data))) throw new Error("The portrait isn't an image.");
    const edits = Array.isArray(body.edits) ? body.edits.filter((e) => validEdit(e?.json)) : null;
    // A data URL's label says nothing about what is inside it, so every image is read and decoded
    // here before the GM is asked, and the portrait keeps the extension of what it really is.
    const tokenBlobs = [];
    for (const t of tokens) tokenBlobs.push(await checkedImage(t.data, ["webp"], "A token image isn't a WebP image."));
    const portraitBlob = portrait ? await checkedImage(portrait.data, ["png", "jpeg", "webp", "gif", "avif"], "The portrait isn't an image.") : null;
    const ext = portraitBlob ? (portraitBlob.type === "image/jpeg" ? ".jpg" : `.${portraitBlob.type.slice(6)}`) : null;
    const size = tokenBlobs.reduce((s, b) => s + b.size, 0) + (portraitBlob?.size ?? 0) + (edits ?? []).reduce((s, e) => s + e.json.length, 0);
    if (size > MAX_BYTES) throw new Error("The files are too large.");
    const tpl = body.tpl === "big" ? "big" : "standard";
    const wildcard = body.wildcard ? { add: !!body.wildcard.add } : null;

    // Ask the GM.
    const esc = escapeHtml;
    const pics = tokens.slice(0, 12).map((t) => `<img src="${esc(t.data)}" alt="" style="width:72px;height:72px;object-fit:contain;border:1px solid #444;border-radius:6px;background:#111">`).join("");
    const changes = [
      wildcard ? `${tokens.length} tokens as a wildcard set${wildcard.add ? " (added to the existing set)" : ""}` : "a new token",
      portrait ? "a new portrait" : null,
      edits?.length ? "saved edits" : null,
      body.updatePlaced ? "tokens already on scenes" : null,
    ].filter(Boolean);
    const content = `
      <p><strong>${esc(user.name)}</strong> wants to send ${esc(changes[0])} to <strong>${esc(actor.name)}</strong>.</p>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin:6px 0">${pics}</div>
      ${portrait ? `<p>Portrait:</p><img src="${esc(portrait.data)}" alt="" style="max-width:120px;max-height:120px;border-radius:6px">` : ""}
      ${changes.length > 1 ? `<p>Also changes: ${esc(changes.slice(1).join(", "))}.</p>` : ""}
      <p>Approving uploads these files to your token folders and updates the actor.</p>`;
    const choice = await foundry.applications.api.DialogV2.wait({
      window: { title: `${TITLE}: approve token?`, icon: "fa-solid fa-crow" },
      content,
      buttons: [
        { action: "approve", label: "Approve", icon: "fa-solid fa-check", default: true },
        { action: "decline", label: "Decline", icon: "fa-solid fa-xmark" },
      ],
      rejectClose: false,
    }).catch(() => null);
    if (choice !== "approve") return reply(false, `${game.user.name} declined the token.`);

    const pkg = {
      actorId: actor.id, tpl, baked: !!body.baked, wildcard, updatePlaced: !!body.updatePlaced,
      tokens: tokens.map((t, i) => ({ id: String(t.id ?? ""), name: String(t.name ?? "token"), blob: tokenBlobs[i] })),
      portrait: portrait ? { name: String(portrait.name ?? "portrait"), ext, blob: portraitBlob } : null,
      edits: edits?.length ? edits.map((e) => ({ id: String(e.id ?? ""), name: String(e.name ?? "token"), json: e.json })) : null,
    };
    const message = await applyPackage(actor, pkg);
    reply(true, `${message} Approved by ${game.user.name}.`);
  } catch (e) {
    console.error(`${TITLE} | approval`, e);
    reply(false, e?.message ?? String(e));
  }
}
Hooks.once("ready", () => game.socket?.on(SOCKET, onSocket));

/* The wildcard set this module made for an actor, if it is still in use. The set's folder is
   written to and browsed with the GM's permissions, so one outside the token folder is ignored. */
function wildcardSet(actor) {
  const info = actor?.getFlag?.(ID, "wildcard");
  const tok = actor?.prototypeToken;
  if (!info?.folder || !inTokenFolder(info.folder) || !tok?.randomImg || tok.texture?.src !== info.wild) return null;
  return info;
}

/* Every image in a wildcard set's folder. Falls back to the files just uploaded. */
async function listSet(setFolder, fallback) {
  try {
    const res = await FP().browse(fileSource(), setFolder, { extensions: [".webp"] });
    return res?.files?.length ? res.files : fallback;
  } catch (e) { return fallback; }
}

/* Saved edits listed on an actor, and loading their files back as text for the tool. The list is
   an actor flag its owner can write, so only paths on this server (or the Forge's file store) are
   read, and a file is used only if it is a saved edit whose images are written in as data URLs:
   the tool turns those into files, and any other address would make it fetch from elsewhere. */
function savedEdits(actor) {
  const list = actor?.getFlag?.(ID, "edits");
  return Array.isArray(list) ? list.filter((e) => editPathOk(e?.path)) : [];
}
function editPathOk(path) {
  const p = String(path ?? "");
  if (/^https:/i.test(p)) {
    let u; try { u = new URL(p); } catch (e) { return false; }
    return fileSource() === "forgevtt" && /(^|\.)forge-vtt\.com$/i.test(u.hostname) && /\.json$/i.test(u.pathname);
  }
  if (!/^[\w\-. ()'%/]+\.json$/i.test(p) || p.startsWith("//") || /%2e|%2f|%5c/i.test(p)) return false;
  return !p.replace(/^\//, "").split("/").some((s) => !s || s === "." || s === "..");
}
const DATA_URL = /^data:[\w.+-]+\/[\w.+-]+;base64,[A-Za-z0-9+/]*={0,2}$/;
function validEdit(json) {
  if (typeof json !== "string") return false;
  let doc; try { doc = JSON.parse(json); } catch (e) { return false; }
  const it = doc?.item;
  const file = (f) => f && typeof f === "object" && typeof f.data === "string" && DATA_URL.test(f.data);
  if (doc?.format !== "feather-and-frame-edit" || !it || typeof it !== "object" || !file(it.file)) return false;
  if (it.origFile != null && !file(it.origFile)) return false;
  if (it.strokes != null && !Array.isArray(it.strokes)) return false;
  return (it.strokes ?? []).every((s) => s && typeof s === "object" && (!s.clip || (typeof s.clip.png === "string" && DATA_URL.test(s.clip.png))));
}
async function loadEdits(actor) {
  if (!actor || !canUse(actor)) throw new Error("You can't open this actor's edits.");
  const texts = [];
  let missing = 0;
  for (const e of savedEdits(actor)) {
    try {
      const res = await fetch(`${routeOf(e.path)}?v=${Date.now().toString(36)}`, { cache: "no-cache" });
      if (!res.ok) throw new Error(res.status);
      const text = await res.text();
      if (!validEdit(text)) throw new Error("not a saved edit");
      texts.push(text);
    } catch (err) { missing++; }
  }
  return { texts, missing };
}

// Actors are addressed by id in the world and by UUID in a compendium. Compendium actors
// the tool has seen (dropped on it, or opened from their sheet) are kept here.
const packActors = new Map();
const keyOf = (a) => (a?.pack ? a.uuid : a?.id ?? "");
const getActor = (key) => (key ? game.actors.get(key) ?? packActors.get(key) ?? null : null);
const rememberPackActor = (a) => { if (a?.pack) packActors.set(a.uuid, a); return a; };
/* A compendium actor loaded again before it is written to, so a send never changes a copy that
   was deleted or re-imported since the tool saw it. */
async function freshPackActor(key) {
  const a = await fromUuid(key).catch(() => null);
  if (a instanceof Actor && a.pack) return rememberPackActor(a);
  packActors.delete(key);
  return null;
}
Hooks.on("deleteActor", (a) => { if (a.pack) packActors.delete(a.uuid); });
const packAllowed = () => game.user.isGM && game.settings.get(ID, "compendiumActors");
const PACK_OFF = `${TITLE}: compendium actors are turned off. A GM can turn them on in the module settings.`;

/* GMs always; players only if allowed and only for owned actors. Compendium actors: GMs, when turned on. */
function canUse(actor) {
  if (actor?.pack) return packAllowed();
  if (game.user.isGM) return true;
  if (!game.settings.get(ID, "allowPlayers")) return false;
  return actor ? actor.isOwner : true;
}
let app = null;
function openApp(actor) {
  if (actor?.pack && !packAllowed()) return ui.notifications.warn(PACK_OFF);
  rememberPackActor(actor);
  if (!canUse(actor)) return ui.notifications.warn(`${TITLE}: the GM hasn't allowed players to conjure tokens.`);
  if (!app) app = new FeatherFrameApp();
  if (actor) app.actor = actor;
  Promise.resolve(app.render({ force: true })).then(() => { if (actor) app.setActor(actor); });
  checkForUpdate();
  return app;
}

// Update check
// The module isn't listed on Foundry's package site yet, so it checks its GitHub releases itself.
// Runs once per session, for the GM only, the first time the window opens.
const REPO = "Crow-ley/feather-and-frame";
const MANIFEST = `https://github.com/${REPO}/releases/latest/download/module.json`;
let updateChecked = false;
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
async function checkForUpdate() {
  if (updateChecked || !game.user.isGM || !game.settings.get(ID, "checkUpdates")) return;
  updateChecked = true;
  let release;
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: "application/vnd.github+json" } });
    if (!res.ok) return;
    release = await res.json();
  } catch (e) { return; } // offline or GitHub unreachable: say nothing
  // Everything from GitHub is checked before use: the tag must be a plain version number
  // and the link must point into this repository. Both are escaped before they go into HTML.
  const latest = String(release.tag_name ?? "").replace(/^v/i, "");
  if (!/^\d+(\.\d+){0,3}$/.test(latest)) return;
  const installed = game.modules.get(ID)?.version ?? "0";
  if (!foundry.utils.isNewerVersion(latest, installed)) return;
  if (game.settings.get(ID, "skipVersion") === latest) return;
  const fallback = `https://github.com/${REPO}/releases/latest`;
  const url = String(release.html_url ?? "");
  const page = url.toLowerCase().startsWith(`https://github.com/${REPO}/releases/`.toLowerCase()) ? url : fallback;
  const content = `
    <p>Version <strong>${escapeHtml(latest)}</strong> is out. You have ${escapeHtml(installed)}.</p>
    <p>To update, go to Foundry's setup screen, open Add-on Modules and click the update button next to ${TITLE}.
    If that button doesn't appear, uninstall the module and install it again with this manifest URL:</p>
    <input type="text" readonly value="${escapeHtml(MANIFEST)}" style="width:100%">
    <p><a href="${escapeHtml(page)}" target="_blank" rel="noopener noreferrer">See what changed on GitHub</a></p>`;
  const choice = await foundry.applications.api.DialogV2.wait({
    window: { title: `${TITLE} update available`, icon: "fa-solid fa-feather" },
    content,
    buttons: [
      { action: "copy", label: "Copy manifest URL", icon: "fa-solid fa-copy", default: true },
      { action: "skip", label: "Skip this version", icon: "fa-solid fa-forward" },
      { action: "close", label: "Close", icon: "fa-solid fa-xmark" },
    ],
    rejectClose: false,
  }).catch(() => null);
  if (choice === "copy") {
    await game.clipboard.copyPlainText(MANIFEST);
    ui.notifications.info(`${TITLE}: manifest URL copied.`);
  } else if (choice === "skip") await game.settings.set(ID, "skipVersion", latest);
}

// Map preview upkeep
Hooks.on("refreshToken", (t) => app?.previewRefresh(t));
Hooks.on("canvasTearDown", () => app?.previewTearDown());
Hooks.on("controlToken", (t, controlled) => app?.previewControl(t, controlled));

// Entry points
Hooks.once("ready", async () => {
  game.modules.get(ID).api = { open: openApp };
});

// Actors sidebar button
Hooks.on("renderActorDirectory", (dir, html) => {
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root || root.querySelector(".ccs-open")) return;
  const target = root.querySelector(".header-actions") ?? root.querySelector(".directory-header");
  if (!target) return;
  const b = document.createElement("button");
  b.type = "button"; b.className = "ccs-open";
  b.innerHTML = `<i class="fa-solid fa-crow"></i> Feather &amp; Frame`;
  b.addEventListener("click", () => openApp());
  if (!canUse()) return;
  target.append(b);
});

// Actor context menu
const contextEntry = {
  name: "Conjure Token", label: "Conjure Token",
  icon: '<i class="fa-solid fa-crow"></i>',
  condition: (li) => {
    const el = li instanceof HTMLElement ? li : li?.[0];
    return canUse(game.actors.get(el?.dataset?.entryId ?? el?.dataset?.documentId));
  },
  callback: (li) => {
    const el = li instanceof HTMLElement ? li : li?.[0];
    const id = el?.dataset?.entryId ?? el?.dataset?.documentId;
    openApp(game.actors.get(id));
  },
};
contextEntry.onClick = (event, li) => contextEntry.callback(li ?? event?.currentTarget);
Hooks.on("getActorContextOptions", (app, options) => { options.push(contextEntry); });
Hooks.on("getActorDirectoryEntryContext", (app, options) => { options.push(contextEntry); });

// Actor sheet header control
Hooks.on("getHeaderControlsApplicationV2", (sheet, controls) => {
  const doc = sheet.document;
  if (!(doc instanceof Actor) || !doc.isOwner || !canUse(doc)) return;
  controls.push({ icon: "fa-solid fa-crow", label: "Conjure Token", action: "ccsConjure", onClick: () => openApp(doc) });
  try { sheet.options.actions ??= {}; sheet.options.actions.ccsConjure ??= () => openApp(doc); } catch (e) { /* ignore */ }
});

/* Portrait button on dnd5e sheets (edit mode only). */
function addPortraitBar(sheet, html) {
  const actor = sheet.document ?? sheet.actor;
  if (!(actor instanceof Actor) || !canUse(actor)) return;
  const root = html instanceof HTMLElement ? html : html?.[0] ?? sheet.element;
  if (!root) return;
  root.querySelectorAll(".ccs-portrait-bar").forEach((b) => b.remove());
  const MODES = sheet.constructor?.MODES;
  const editing = MODES && "_mode" in sheet ? sheet._mode === MODES.EDIT : sheet.isEditable;
  if (!editing) return;
  const img = root.querySelector('.portrait img, img.portrait, [data-action="showArtwork"] img, img[data-edit="img"]');
  const box = img?.closest(".portrait") ?? img?.parentElement;
  if (!box) return;
  if (getComputedStyle(box).position === "static") box.style.position = "relative";

  const bar = document.createElement("button");
  bar.type = "button"; bar.className = "ccs-portrait-bar ccs-at-bottom";
  bar.innerHTML = `<i class="fa-solid fa-crow"></i><span>Conjure Token</span>`;
  bar.setAttribute("data-tooltip", "Open Feather & Frame for this actor");
  bar.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); openApp(actor); });
  box.append(bar);
}

// Tidy 5e
const tidyWatched = new WeakSet();
function findTidyPortrait(root, actor) {
  const imgs = [...root.querySelectorAll("img")].filter((i) => {
    const src = i.getAttribute("src") || "";
    return actor.img && (src === actor.img || decodeURI(i.src).endsWith(actor.img));
  });
  if (!imgs.length) return null;
  imgs.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight);
  return imgs[0];
}
function findTidyGear(img) {
  let anc = img.parentElement;
  for (let i = 0; i < 4 && anc; i++, anc = anc.parentElement) {
    const icon = anc.querySelector("i.fa-gear, i.fa-cog, i.fa-gears");
    const btn = icon?.closest("button, a, [role=button]");
    if (btn) return btn;
  }
  return null;
}
function placeTidyCrow(root, actor) {
  const img = findTidyPortrait(root, actor);
  const gear = img && findTidyGear(img);
  let crow = root.querySelector(".ccs-portrait-bar");
  if (!gear || !gear.offsetParent) { crow?.remove(); return; }  // gear is only visible in edit mode
  const host = img.parentElement;
  if (!crow || crow.parentElement !== host) {
    crow?.remove();
    crow = document.createElement("button");
    crow.type = "button"; crow.className = "ccs-portrait-bar";
    crow.innerHTML = `<i class="fa-solid fa-crow"></i><span>Conjure Token</span>`;
    crow.setAttribute("data-tooltip", "Open Feather & Frame for this actor");
    crow.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); openApp(actor); });
    host.append(crow);
  }

  if (getComputedStyle(host).position === "static") host.style.position = "relative";
  const hr = host.getBoundingClientRect(), ir = img.getBoundingClientRect();
  const sx = host.offsetWidth ? hr.width / host.offsetWidth : 1, sy = host.offsetHeight ? hr.height / host.offsetHeight : 1;
  crow.style.left = `${((ir.left + ir.right) / 2 - hr.left) / sx - host.clientLeft}px`;
  crow.style.top = `${((ir.top + ir.bottom) / 2 - hr.top) / sy - host.clientTop}px`;
}
function addTidyCrow(sheet, root, actor) {
  placeTidyCrow(root, actor);
  if (tidyWatched.has(root)) return;
  tidyWatched.add(root);
  let queued = false;
  new MutationObserver((muts) => {
    if (muts.every((m) => m.target.closest?.(".ccs-portrait-bar"))) return;
    if (queued) return; queued = true;
    requestAnimationFrame(() => { queued = false; if (root.isConnected) placeTidyCrow(root, sheet.document ?? actor); });
  }).observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "src", "style", "hidden"] });
  new ResizeObserver(() => { if (root.isConnected) placeTidyCrow(root, sheet.document ?? actor); }).observe(root);
}
function onSheetRender(sheet, html) {
  const actor = sheet.document ?? sheet.actor;
  if (!(actor instanceof Actor) || !canUse(actor)) return;
  const root = html instanceof HTMLElement ? html : html?.[0] ?? sheet.element;
  if (!root) return;
  const tidy = root.classList?.contains("tidy5e-sheet") || root.closest?.(".tidy5e-sheet") || root.querySelector?.(".tidy5e-sheet")
    || /tidy/i.test(sheet.constructor?.name ?? "");
  if (tidy) return addTidyCrow(sheet, sheet.element ?? root, actor);
  addPortraitBar(sheet, html);
}
Hooks.on("renderActorSheetV2", onSheetRender);
Hooks.on("renderActorSheet", onSheetRender);
Hooks.on("tidy5e-sheet.renderActorSheet", onSheetRender);

