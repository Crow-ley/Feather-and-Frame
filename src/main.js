/* Feather & Frame (Foundry VTT v13+)
 * Opens the token tool inside Foundry and sends finished tokens straight to an actor. */

const ID = "feather-and-frame";
const TITLE = "Feather & Frame";

// Settings
Hooks.once("init", () => {
  const reg = (key, data) => game.settings.register(ID, key, { scope: "world", config: true, ...data });
  reg("allowPlayers", { name: "Let players conjure their own tokens", hint: "Players can open Feather & Frame for actors they own and update their token and portrait. Players also need the Upload New Files permission (Game Settings, User Management or Configure Permissions).", type: Boolean, default: false });
  reg("tokenFolder", { name: "Token upload folder", hint: "Folder inside your Foundry data where finished tokens are saved.", type: String, default: "tokens/conjured" });
  reg("portraitFolder", { name: "Portrait upload folder", hint: "Folder for portrait images.", type: String, default: "tokens/conjured/portraits" });
  reg("stdScale", { name: "Standard: token scale", type: Number, default: 1 });
  reg("stdCorrection", { name: "Standard: ring scale correction", type: Number, default: 1 });
  reg("bigScale", { name: "Big Chungus: token scale", hint: "Token scale enlarges the ring and the image together.", type: Number, default: 2 });
  reg("checkUpdates", { name: "Check GitHub for updates", hint: "Once per session, when a GM opens the window, ask GitHub whether a newer version is out. This sends one request to api.github.com and nothing else.", type: Boolean, default: true });
  reg("bigCorrection", { name: "Big Chungus: ring scale correction", hint: "Scale correction enlarges only the image inside the ring. Big Chungus images are drawn at half size, so 2 makes it fill the ring.", type: Number, default: 2 });
  game.settings.register(ID, "usePortrait", { scope: "client", config: false, type: Boolean, default: true });
  game.settings.register(ID, "updatePlaced", { scope: "client", config: false, type: Boolean, default: true });
  game.settings.register(ID, "matchSize", { scope: "client", config: false, type: Boolean, default: true });
  game.settings.register(ID, "saveEdits", { scope: "client", config: false, type: Boolean, default: true });
  game.settings.register(ID, "skipVersion", { scope: "client", config: false, type: String, default: "" });
});

// Helpers
const FP = () => foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
const fileSource = () => (globalThis.ForgeVTT?.usingTheForge ? "forgevtt" : "data");
const cleanFolder = (f) => String(f || "").trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
const safeName = (n) => String(n || "token").replace(/[^\w\-. ()']+/g, "_").replace(/^_+|_+$/g, "") || "token";

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
// The module ships no ring art. It reads the spritesheet of the ring picked in Foundry's
// "Dynamic Token Ring" setting and draws its largest frame at 1024 px.
const routeOf = (p) => (/^(https?:|data:|blob:)/.test(p) ? p : foundry.utils.getRoute(p));
let ringSheet = null;
function loadRingSheet() {
  const path = CONFIG.Token.ring?.spritesheet;
  if (!path) return Promise.resolve(null);
  if (ringSheet?.path === path) return ringSheet.load;
  const load = (async () => {
    const res = await fetch(routeOf(path));
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    const json = await res.json();
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = routeOf(path.replace(/[^/]*$/, "") + json.meta.image);
    await img.decode();
    const frames = Object.entries(json.frames);
    const rings = frames.filter(([name]) => !/bkg$/i.test(name)).sort((a, b) => b[1].sourceSize.w - a[1].sourceSize.w);
    if (!rings.length) return null;
    const [name, ring] = rings[0];
    const bkg = json.frames[`${name}-bkg`] ?? frames.find(([n, f]) => /bkg$/i.test(n) && f.sourceSize.w === ring.sourceSize.w)?.[1] ?? null;
    return { img, ring, bkg, config: json.config ?? {} };
  })();
  ringSheet = { path, load };
  load.catch(() => { if (ringSheet?.load === load) ringSheet = null; });
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

// The color Foundry uses for the ring band when the token has no ring color of its own.
function dispositionColor(actor) {
  const colors = CONFIG.Canvas.dispositionColors, tok = actor?.prototypeToken;
  if (actor?.hasPlayerOwner) return colors.PARTY;
  const key = Object.entries(CONST.TOKEN_DISPOSITIONS).find(([, v]) => v === tok?.disposition)?.[0];
  return colors[key] ?? colors.NEUTRAL;
}
const css = (c) => (c == null || c === "" ? null : foundry.utils.Color.from(c).css);

// Foundry's ring as a 1024 px PNG, colored the way the actor's token would be.
// In the spritesheet the color band is drawn in pure red or magenta, with the red channel as
// its strength. Foundry's shader paints the ring color there, so the same is done here per pixel.
async function ringImage(actor) {
  const sheet = await loadRingSheet();
  if (!sheet) return null;
  const size = 1024, half = size / 2, c = document.createElement("canvas");
  c.width = c.height = size;
  const x = c.getContext("2d", { willReadFrequently: true });
  const colors = actor?.prototypeToken?.ring?.colors ?? {};
  if (sheet.bkg) {
    const b = document.createElement("canvas");
    b.width = b.height = size;
    const bx = b.getContext("2d");
    drawFrame(bx, sheet.img, sheet.bkg, size);
    const tint = css(colors.background) ?? css(sheet.config.defaultBackgroundColor);
    if (tint) {
      bx.globalCompositeOperation = "multiply"; bx.fillStyle = tint; bx.fillRect(0, 0, size, size);
      bx.globalCompositeOperation = "destination-in"; drawFrame(bx, sheet.img, sheet.bkg, size);
    }
    x.drawImage(b, 0, 0);
  }
  const r = document.createElement("canvas");
  r.width = r.height = size;
  const rx = r.getContext("2d", { willReadFrequently: true });
  drawFrame(rx, sheet.img, sheet.ring, size);
  const band = sheet.config.defaultColorBand ?? { startRadius: 0.666, endRadius: 0.7225 };
  const color = foundry.utils.Color.from(css(colors.ring) ?? css(sheet.config.defaultRingColor) ?? css(dispositionColor(actor)));
  const [cr, cg, cb] = color.rgb.map((v) => v * 255);
  const r0 = band.startRadius * half - 1, r1 = band.endRadius * half + 1, lo = Math.floor(half - r1), n = Math.ceil(r1 * 2);
  const data = rx.getImageData(lo, lo, n, n), d = data.data;
  for (let y = 0; y < n; y++) for (let xx = 0; xx < n; xx++) {
    const dist = Math.hypot(lo + xx + 0.5 - half, lo + y + 0.5 - half);
    if (dist < r0 || dist > r1) continue;
    const i = (y * n + xx) * 4;
    if (d[i + 1] > d[i] * 0.25) continue; // metal and shading in the band stay as they are
    const k = d[i] / 255;
    d[i] = cr * k; d[i + 1] = cg * k; d[i + 2] = cb * k;
  }
  rx.putImageData(data, lo, lo);
  x.drawImage(r, 0, 0);
  return c.toDataURL("image/png");
}

// Tool page
// The tool page ships as a normal file (tool.html) next to its images in assets/.
// It is read once, given a <base> tag so its relative image paths point at this module's
// folder, and loaded into the window's iframe with srcdoc.
let toolPage = null;
async function loadToolPage() {
  if (toolPage) return toolPage;
  const folder = new URL(foundry.utils.getRoute(`modules/${ID}/`), window.location.href).href;
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
      ui.notifications.error(`${TITLE}: couldn't load the tool page. Try reinstalling the module.`);
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
      if (tool?.attachHost) return tool.attachHost(this.#host(), this.actor?.id);
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
    this.tool?.setActor?.(actor?.id ?? "");
  }

  /* Everything the tool needs from Foundry. */
  #host() {
    const info = (a) => (a ? { id: a.id, name: a.name, img: a.img || "icons/svg/mystery-man.svg" } : null);
    return {
      actors: () => game.actors.contents.filter((a) => canUse(a)).sort((a, b) => a.name.localeCompare(b.name)).map(info),
      actor: (id) => info(game.actors.get(id)),
      fromDrop: async (text) => {
        let data; try { data = JSON.parse(text); } catch (e) { return null; }
        if (data?.type !== "Actor") return null;
        const a = await fromUuid(data.uuid);
        return a && canUse(a) ? info(a) : null;
      },
      prefs: () => ({ usePortrait: game.settings.get(ID, "usePortrait"), updatePlaced: game.settings.get(ID, "updatePlaced"), matchSize: game.settings.get(ID, "matchSize"), saveEdits: game.settings.get(ID, "saveEdits") }),
      savedEdits: (id) => savedEdits(game.actors.get(id)).length,
      loadEdits: (id) => loadEdits(game.actors.get(id)),
      wildcard: (id) => wildcardSet(game.actors.get(id)),
      actorSize: (id) => sizeInfo(game.actors.get(id)),
      savePref: (key, value) => game.settings.set(ID, key, value),
      selected: (id) => { this.actor = game.actors.get(id) ?? null; },
      send: (opts, progress) => this.send(opts, progress),
      previewStart: (id) => this.previewStart(id),
      previewUpdate: (src, opts) => this.previewUpdate(src, opts),
      previewStop: () => this.previewStop(),
      ring: (id) => ringImage(game.actors.get(id) ?? null),
    };
  }

  /* Scale and ring settings a token gets for a template. */
  #tokenConfig(tpl, baked) {
    const big = tpl === "big";
    const scale = baked ? (big ? 2 : 1) : (Number(game.settings.get(ID, big ? "bigScale" : "stdScale")) || 1);
    const correction = Number(game.settings.get(ID, big ? "bigCorrection" : "stdCorrection")) || 1;
    return { big, baked, scale, correction };
  }

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

  async send({ actorId, usePortrait, portraitFile, updatePlaced, wildcard = null, matchSize = false, saveEdits = false }, progress = () => {}) {
    const actor = game.actors.get(actorId), tool = this.tool;
    if (!actor) throw new Error("Pick an actor first.");
    if (!canUse(actor)) throw new Error("You can't change this actor.");
    const it = tool?.current();
    if (!it) throw new Error("Load an image first.");
    if (wildcard && !game.user.isGM && !game.user.can("FILES_BROWSE"))
      throw new Error("Wildcard sets need the Use File Browser permission. Ask your GM to turn it on for players.");
    await this.previewStop();

    const baked = !!tool.baked?.();
    const { big, scale, correction } = this.#tokenConfig(it.tpl, baked);
    const folder = game.settings.get(ID, "tokenFolder");
    const encodeOne = async (item) => {
      const blob = await tool.encode(item);
      if (blob.type !== "image/webp") throw new Error("This browser can't write WebP files.");
      return blob;
    };

    // One token, or a wildcard set: several tokens in their own folder, picked at random by Foundry.
    let tokenPath, wildPath = null, setPaths = [], setInfo = null, sent = [it];
    if (!wildcard) {
      progress("Rendering token...");
      const blob = await encodeOne(it);
      tokenPath = await upload(new File([blob], `${safeName(it.outName)}${baked ? "-ringed" : ""}.webp`, { type: "image/webp" }), folder);
    } else {
      sent = tool.items().filter((i) => wildcard.ids.includes(i.id));
      if (sent.some((i) => i.tpl !== it.tpl)) throw new Error("A wildcard set can't mix Standard and Big Chungus tokens.");
      const existing = wildcard.add ? wildcardSet(actor) : null;
      if (!sent.length || (sent.length < 2 && !existing)) throw new Error("A new wildcard set needs at least two tokens.");
      const setFolder = existing?.folder ?? `${cleanFolder(folder)}/${safeName(actor.name).replace(/\s+/g, "-")}-${Date.now().toString(36)}`;
      const stamp = Date.now().toString(36);
      for (const [n, item] of sent.entries()) {
        progress(`Rendering token ${n + 1} of ${sent.length}...`);
        const blob = await encodeOne(item);
        setPaths.push(await upload(new File([blob], `${safeName(item.outName)}-${stamp}-${n + 1}.webp`, { type: "image/webp" }), setFolder));
      }
      // The wildcard goes in the folder the files actually landed in (on the Forge that is a full URL).
      const landed = setPaths[0].replace(/\?.*$/, "").replace(/\/[^/]*$/, "");
      wildPath = `${landed}/*.webp`;
      setInfo = { folder: setFolder, wild: wildPath, count: (existing?.count ?? 0) + sent.length };
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
    const tokenUpdate = (src) => baked
      ? { "ring.enabled": false, "texture.src": src, "texture.scaleX": scale, "texture.scaleY": scale }
      : { "ring.enabled": true, "ring.subject.texture": wildPath ? null : src, "ring.subject.scale": correction, "texture.src": src, "texture.scaleX": scale, "texture.scaleY": scale };
    let placedSrc = () => tokenPath;

    const size = matchSize ? sizeInfo(actor) : null;
    if (size) { update["prototypeToken.width"] = size.w; update["prototypeToken.height"] = size.h; }

    let portraitPath = null;
    const f = portraitFile ?? (usePortrait ? (it.origFile ?? it.file) : null);
    if (f) {
      progress("Uploading the portrait...");
      const ext = (f.name.match(/\.[^.]+$/) || [".webp"])[0].toLowerCase();
      portraitPath = await upload(new File([f], `${safeName(it.outName)}${ext}`, { type: f.type || "image/webp" }), game.settings.get(ID, "portraitFolder"));
      update.img = portraitPath;
      // With a single ring token, the plain token image is the portrait, shown if the ring is turned off.
      if (!baked && !wildPath) { update["prototypeToken.texture.src"] = portraitPath; placedSrc = () => portraitPath; }
    }

    // Saved edits: one JSON file per token in <token folder>/edits, listed on the actor.
    if (saveEdits) {
      const editFolder = `${cleanFolder(folder)}/edits`;
      const saved = [];
      for (const [n, item] of sent.entries()) {
        progress(sent.length > 1 ? `Saving edits ${n + 1} of ${sent.length}...` : "Saving edits...");
        const json = await tool.exportEdit(item.id);
        const path = await upload(new File([json], `${safeName(item.outName)}-${item.id}.json`, { type: "application/json" }), editFolder);
        saved.push({ id: item.id, name: item.outName, path: path.replace(/\?.*$/, "") });
      }
      // Adding to a wildcard set keeps the edits already saved for the set.
      const keep = wildcard?.add ? savedEdits(actor).filter((e) => !saved.some((s) => s.id === e.id)) : [];
      update[`flags.${ID}.edits`] = [...keep, ...saved];
    }

    progress(`Updating ${actor.name}...`);
    await actor.update(update);

    let placed = 0;
    if (updatePlaced) {
      if (wildPath) {
        // Placed tokens each get a random image from the whole set, older ones included.
        const pool = setInfo.count > sent.length ? await listSet(setInfo.folder, setPaths) : setPaths;
        placedSrc = () => pool[Math.floor(Math.random() * pool.length)];
      }
      for (const scene of game.scenes) {
        const ups = scene.tokens.filter((t) => t.actorId === actor.id).map((t) => {
          const u = { _id: t.id, ...tokenUpdate(placedSrc()) };
          if (size) { u.width = size.w; u.height = size.h; }
          return u;
        });
        if (ups.length) { await scene.updateEmbeddedDocuments("Token", ups); placed += ups.length; }
      }
    }

    for (const item of sent) tool.markSaved?.(item);
    ui.notifications.info(`${TITLE}: ${wildPath ? "wildcard set" : "token"} sent to ${actor.name}.`);
    const tpl = (big ? "Big Chungus" : "Standard") + (baked ? ", ring baked in" : "");
    const parts = [tpl, `scale ${scale}`];
    if (!baked) parts.push(`scale correction ${correction}`);
    if (wildPath) parts.push(`${sent.length} token${sent.length > 1 ? "s" : ""} ${wildcard.add && setInfo.count > sent.length ? `added, ${setInfo.count} in the set` : "in the wildcard set"}`);
    if (size) parts.push(`size ${size.w} × ${size.h}`);
    if (saveEdits) parts.push("edits saved");
    if (portraitPath) parts.push("portrait set");
    if (placed) parts.push(`${placed} placed token${placed > 1 ? "s" : ""} updated`);
    return `Sent to ${actor.name}: ${parts.join(", ")}.`;
  }
}

/* The wildcard set this module made for an actor, if it is still in use. */
function wildcardSet(actor) {
  const info = actor?.getFlag?.(ID, "wildcard");
  const tok = actor?.prototypeToken;
  if (!info?.folder || !tok?.randomImg || tok.texture?.src !== info.wild) return null;
  return info;
}

/* Every image in a wildcard set's folder. Falls back to the files just uploaded. */
async function listSet(setFolder, fallback) {
  try {
    const res = await FP().browse(fileSource(), setFolder, { extensions: [".webp"] });
    return res?.files?.length ? res.files : fallback;
  } catch (e) { return fallback; }
}

/* Saved edits listed on an actor, and loading their files back as text for the tool. */
function savedEdits(actor) {
  const list = actor?.getFlag?.(ID, "edits");
  return Array.isArray(list) ? list.filter((e) => e?.path) : [];
}
async function loadEdits(actor) {
  if (!actor || !canUse(actor)) throw new Error("You can't open this actor's edits.");
  const texts = [];
  let missing = 0;
  for (const e of savedEdits(actor)) {
    try {
      const res = await fetch(`${routeOf(e.path)}?v=${Date.now().toString(36)}`, { cache: "no-cache" });
      if (!res.ok) throw new Error(res.status);
      texts.push(await res.text());
    } catch (err) { missing++; }
  }
  return { texts, missing };
}

/* How many grid squares the actor's size covers, when the game system says (dnd5e does). */
function sizeInfo(actor) {
  const key = actor?.system?.traits?.size, sizes = CONFIG.DND5E?.actorSizes;
  if (!key || !sizes?.[key]) return null;
  const n = sizes[key].token ?? 1;
  return { label: game.i18n.localize(sizes[key].label), w: n, h: n };
}

/* GMs always; players only if allowed and only for owned actors. */
function canUse(actor) {
  if (game.user.isGM) return true;
  if (!game.settings.get(ID, "allowPlayers")) return false;
  return actor ? actor.isOwner : true;
}
let app = null;
function openApp(actor) {
  if (!canUse(actor)) return ui.notifications.warn(`${TITLE}: the GM hasn't allowed players to conjure tokens.`);
  if (!game.user.isGM && !game.user.can("FILES_UPLOAD")) return ui.notifications.warn(`${TITLE}: you need the "Upload New Files" permission. Ask your GM to turn it on for players.`);
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

