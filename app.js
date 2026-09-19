// Small DOM helper: h("div", { class: "x" }, "text", childNode)
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(kid));
  }
  return el;
}

const $ = (sel) => document.querySelector(sel);
// Like el.replaceChildren, but skips null, undefined, false and empty strings instead of printing them.
const mount = (el, ...kids) => el.replaceChildren(...kids.flat().filter((k) => k != null && k !== false && k !== ""));
const fmtMB = (n) => `${(n / 1e6).toFixed(1)} MB`;
const fmtBytes = (n) => `${n.toLocaleString("en-US")} bytes`;

const state = { data: null, selectedId: null, acknowledged: false };

/* ---------- Build list ---------- */

function renderList() {
  const { builds } = state.data;
  const list = $("#build-list");
  mount(list, 
    h("div", { class: "list-head", "aria-hidden": "true" }, h("span", {}, "Carrier"), h("span", {}, "Version"), h("span", {}, "Size")),
    h(
      "div",
      { role: "radiogroup", "aria-label": "Firmware builds" },
      builds.map((b) =>
        h(
          "label",
          { class: `row${b.available ? "" : " row--missing"}` },
          h("input", {
            type: "radio",
            name: "build",
            value: b.id,
            checked: state.selectedId === b.id,
            onchange: () => select(b.id),
          }),
          h("span", { class: "row-body" }, h("span", { class: "carrier" }, b.carrier), h("span", {}, b.version), h("span", {}, b.size ? fmtMB(b.size) : ""))
        )
      )
    )
  );
}

function select(id) {
  state.selectedId = id;
  state.acknowledged = false;
  renderDetail();
  if (window.matchMedia("(max-width: 860px)").matches) {
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    $("#detail").scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "start" });
  }
}

/* ---------- Detail panel ---------- */

function renderDetail() {
  const panel = $("#detail");
  const build = state.data.builds.find((b) => b.id === state.selectedId);

  if (!build) {
    mount(panel, 
      h("p", { class: "detail-empty" }, h("strong", {}, "Select a build"), "You'll see its file size and SHA-256 checksum here, and the download button.")
    );
    return;
  }

  const copyBtn = h("button", { type: "button", class: "link-btn" }, "Copy checksum");
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(build.sha256);
      copyBtn.textContent = "Copied";
    } catch {
      copyBtn.textContent = "Select the text to copy";
    }
    setTimeout(() => (copyBtn.textContent = "Copy checksum"), 1800);
  });

  const canDownload = build.available && state.acknowledged;
  const action = canDownload
    ? h("a", { class: "button", href: `/dl/${build.id}`, download: build.file }, `Download ${fmtMB(build.size)}`)
    : h("button", { class: "button", type: "button", disabled: true }, `Download ${fmtMB(build.size)}`);

  const reason = !build.available
    ? "This build hasn't been uploaded to storage yet."
    : !state.acknowledged
      ? "Tick the box above to enable the download."
      : "";

  mount(panel, 
    h("h3", {}, build.carrier),
    h("p", { class: "ver" }, `Version ${build.version}`),
    h(
      "dl",
      { class: "facts" },
      h("div", {}, h("dt", {}, "File"), h("dd", {}, build.file)),
      h("div", {}, h("dt", {}, "Size"), h("dd", {}, `${fmtMB(build.size)} (${fmtBytes(build.size)})`)),
      h("div", {}, h("dt", {}, "SHA-256"), h("dd", {}, h("span", { class: "hash" }, build.sha256)), copyBtn),
      build.note && h("div", {}, h("dt", {}, "About this build"), h("dd", {}, build.note))
    ),
    h(
      "p",
      { class: "notice" },
      build.warning && h("strong", {}, `${build.warning} `),
      "A build made for one carrier may leave the hotspot locked or unusable if you flash it onto another carrier's device."
    ),
    h(
      "label",
      { class: "ack" },
      h("input", {
        type: "checkbox",
        checked: state.acknowledged,
        onchange: (e) => {
          state.acknowledged = e.target.checked;
          renderDetail();
          $("#detail .ack input")?.focus();
        },
      }),
      h("span", {}, `I've checked that this build matches my device and carrier.`)
    ),
    action,
    reason && h("p", { class: "hint" }, reason)
  );
}

/* ---------- Tools ---------- */

function renderTools() {
  mount(
    $("#tool-list"),
    state.data.tools.map((t) =>
      h(
        "div",
        { class: "tool" },
        h("div", {}, h("h3", {}, t.name), h("p", {}, t.available && t.size ? `${t.detail} ${fmtMB(t.size)}.` : t.detail)),
        t.available
          ? h("a", { class: "button", href: `/dl/${t.id}`, download: t.file }, "Download")
          : h("span", { class: "muted" }, "Not uploaded yet")
      )
    )
  );
}

/* ---------- File check ---------- */

const MAX_CHECK_BYTES = 300 * 1024 * 1024;

function showResult(kind, title, ...body) {
  const box = $("#result");
  box.hidden = false;
  box.dataset.state = kind;
  mount(box, h("strong", {}, title), body);
}

async function checkFile(file) {
  if (!file) return;
  if (!(window.crypto && crypto.subtle)) {
    showResult("bad", "This browser can't check files", h("p", {}, "Open the page over HTTPS in a current browser and try again."));
    return;
  }
  if (file.size > MAX_CHECK_BYTES) {
    showResult("bad", "That file is too large to be a build", h("p", {}, `${file.name} is ${fmtMB(file.size)}. Firmware builds here are about 60 MB.`));
    return;
  }

  showResult("busy", `Checking ${file.name}…`, h("p", {}, "Reading the file and working out its checksum."));
  try {
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    const hit = state.data.builds.find((b) => b.sha256 === hex);

    if (hit) {
      const selected = state.data.builds.find((b) => b.id === state.selectedId);
      const other = selected && selected.id !== hit.id;
      showResult(
        "ok",
        `Matches ${hit.carrier} ${hit.version}`,
        h("p", {}, "The file is complete and unchanged."),
        other && h("p", {}, `This isn't the ${selected.carrier} build you have selected, so check it's the one you want.`)
      );
    } else {
      showResult(
        "bad",
        "No match",
        h("p", {}, `This file isn't any build on this page. It may have downloaded incompletely, or it may come from somewhere else. Download it again and check it again.`),
        h("p", { class: "muted" }, `${fmtBytes(file.size)} in ${file.name}`),
        h("p", { class: "hash" }, hex)
      );
    }
  } catch (err) {
    showResult("bad", "Couldn't read that file", h("p", {}, "Choose the file again. If it keeps failing, copy it to another folder first."));
  }
}

function wireDropZone() {
  const drop = $("#drop");
  const input = $("#file");
  input.addEventListener("change", () => checkFile(input.files[0]));
  ["dragenter", "dragover"].forEach((ev) =>
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.add("is-over");
    })
  );
  ["dragleave", "drop"].forEach((ev) =>
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.remove("is-over");
    })
  );
  drop.addEventListener("drop", (e) => checkFile(e.dataTransfer.files[0]));
}

/* ---------- Start ---------- */

async function init() {
  wireDropZone();
  try {
    const res = await fetch("/api/builds");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.data = await res.json();
    renderList();
    renderDetail();
    renderTools();
  } catch (err) {
    mount($("#build-list"), 
      h("p", { class: "notice" }, "Couldn't load the build list. Reload the page. If it keeps failing, the Worker behind /api/builds isn't running.")
    );
  }
}

init();
