/* Feather & Frame (Foundry VTT v13+)
 * Opens the token tool inside Foundry and sends finished tokens straight to an actor. */

import { TOOL_HTML } from "./tool.js";

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
  reg("bigCorrection", { name: "Big Chungus: ring scale correction", hint: "Scale correction enlarges only the image inside the ring. Big Chungus images are drawn at half size, so 2 makes it fill the ring.", type: Number, default: 2 });
  game.settings.register(ID, "usePortrait", { scope: "client", config: false, type: Boolean, default: true });
  game.settings.register(ID, "updatePlaced", { scope: "client", config: false, type: Boolean, default: true });
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
    wrap.querySelector("iframe").srcdoc = TOOL_HTML;
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
      prefs: () => ({ usePortrait: game.settings.get(ID, "usePortrait"), updatePlaced: game.settings.get(ID, "updatePlaced") }),
      savePref: (key, value) => game.settings.set(ID, key, value),
      selected: (id) => { this.actor = game.actors.get(id) ?? null; },
      send: (opts, progress) => this.send(opts, progress),
      previewStart: (id) => this.previewStart(id),
      previewUpdate: (src, opts) => this.previewUpdate(src, opts),
      previewStop: () => this.previewStop(),
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

  async send({ actorId, usePortrait, portraitFile, updatePlaced }, progress = () => {}) {
    const actor = game.actors.get(actorId), tool = this.tool;
    if (!actor) throw new Error("Pick an actor first.");
    if (!canUse(actor)) throw new Error("You can't change this actor.");
    const it = tool?.current();
    if (!it) throw new Error("Load an image first.");
    await this.previewStop();

    progress("Rendering token...");
    const blob = await tool.encode(it);
    if (blob.type !== "image/webp") throw new Error("This browser can't write WebP files.");
    const base = safeName(it.outName);
    const baked = !!tool.baked?.();
    const tokenPath = await upload(new File([blob], `${base}${baked ? "-ringed" : ""}.webp`, { type: "image/webp" }), game.settings.get(ID, "tokenFolder"));

    // Baked tokens are static images; Big Chungus ones need scale 2.
    const { big, scale, correction } = this.#tokenConfig(it.tpl, baked);

    const update = baked
      ? { "prototypeToken.ring.enabled": false, "prototypeToken.texture.src": tokenPath, "prototypeToken.texture.scaleX": scale, "prototypeToken.texture.scaleY": scale }
      : { "prototypeToken.ring.enabled": true, "prototypeToken.ring.subject.texture": tokenPath, "prototypeToken.ring.subject.scale": correction,
          "prototypeToken.texture.src": tokenPath, "prototypeToken.texture.scaleX": scale, "prototypeToken.texture.scaleY": scale };
    const tokenUpdate = baked
      ? { "ring.enabled": false, "texture.src": tokenPath, "texture.scaleX": scale, "texture.scaleY": scale }
      : { "ring.enabled": true, "ring.subject.texture": tokenPath, "ring.subject.scale": correction, "texture.src": tokenPath, "texture.scaleX": scale, "texture.scaleY": scale };

    let portraitPath = null;
    const f = portraitFile ?? (usePortrait ? (it.origFile ?? it.file) : null);
    if (f) {
      progress("Uploading the portrait...");
      const ext = (f.name.match(/\.[^.]+$/) || [".webp"])[0].toLowerCase();
      portraitPath = await upload(new File([f], `${base}${ext}`, { type: f.type || "image/webp" }), game.settings.get(ID, "portraitFolder"));
      update.img = portraitPath;
      if (!baked) { update["prototypeToken.texture.src"] = portraitPath; tokenUpdate["texture.src"] = portraitPath; }
    }

    progress(`Updating ${actor.name}...`);
    await actor.update(update);

    let placed = 0;
    if (updatePlaced) {
      for (const scene of game.scenes) {
        const ups = scene.tokens.filter((t) => t.actorId === actor.id).map((t) => ({ _id: t.id, ...tokenUpdate }));
        if (ups.length) { await scene.updateEmbeddedDocuments("Token", ups); placed += ups.length; }
      }
    }

    tool.markSaved?.(it);
    ui.notifications.info(`${TITLE}: token sent to ${actor.name}.`);
    const tpl = (big ? "Big Chungus" : "Standard") + (baked ? ", ring baked in" : "");
    return `Sent to ${actor.name}: ${tpl}, scale ${scale}${baked ? "" : `, scale correction ${correction}`}${portraitPath ? ", portrait set" : ""}${placed ? `, ${placed} placed token${placed > 1 ? "s" : ""} updated` : ""}.`;
  }
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
  return app;
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

