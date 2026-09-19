const manifest = {
  "model": "MF927U4",
  "builds": [
    {
      "id": "default-zte",
      "carrier": "ZTE default",
      "version": "V1.0.0B03",
      "file": "MF927U4V1.0.0B03.bin",
      "size": 62306657,
      "sha256": "bd52e01d32ecc7d305027611b404a3ee283d4c5255a8ce097087a340fde5e183",
      "note": "ZTE's default build. It was shipped in the DEFAULT_ZTE folder."
    },
    {
      "id": "airtel",
      "carrier": "Airtel",
      "version": "V1.0.0B05",
      "file": "AIRTEL_KE_MF927U4TLV1.0.0B05.bin",
      "size": 60590429,
      "sha256": "e4126a7fbe4c657facba65eb387bba3d7323b01bc0f4f40ef0fd878efc5999db",
      "note": "The filename carries the tags KE and TL."
    },
    {
      "id": "jazz",
      "carrier": "Jazz",
      "version": "V1.0.1B11",
      "file": "BD_MF927UV1.0.1B11.bin",
      "size": 61577965,
      "sha256": "c1051953414d7587f3231a5a4eec2f057cfa509ce7327c8c035125efbe5a47df",
      "note": "The filename starts with BD_ and names the model MF927U, not MF927U4."
    },
    {
      "id": "kartel",
      "carrier": "Kartel",
      "version": "V1.0.0B03",
      "file": "KZ_MF927U4V1.0.0B03.bin",
      "size": 61567561,
      "sha256": "874a7d5159bb1b8501765fd4144d00c81dec46a622cdcda582f002fe46370849",
      "note": "The filename starts with KZ_."
    },
    {
      "id": "mtn-nigeria",
      "carrier": "MTN Nigeria",
      "version": "V1.0.2B01",
      "file": "NG_RSMF927U4V1.0.2B01.bin",
      "size": 60287705,
      "sha256": "30d4e3203a4fb2663abe331f0891036ed4081a91e8165118af867a6e08c0cf72",
      "note": "It was shipped in a folder named MTN_NIGERIA_ONLY.",
      "warning": "Only use this build on MTN Nigeria devices."
    }
  ],
  "tools": [
    {
      "id": "updater",
      "name": "Update tool",
      "detail": "ZTE Terminal Software Update Framework for Windows.",
      "file": "ZTE_Update_Tool.zip"
    },
    {
      "id": "drivers",
      "name": "USB drivers",
      "detail": "Install these before connecting the hotspot.",
      "file": "ZTE_USB_Drivers.exe"
    }
  ]
};

const builds = new Map(manifest.builds.map((b) => [b.id, b]));
const tools = new Map(manifest.tools.map((t) => [t.id, t]));

const json = (data, init = {}) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=60",
      ...init.headers,
    },
  });

// Lists every build and tool, and marks which ones are actually present in R2.
async function listItems(env) {
  const withStatus = async (item) => {
    const head = await env.FIRMWARE.head(item.file);
    return {
      ...item,
      available: head !== null,
      // Prefer the real size from R2. Builds fall back to the size recorded in the manifest.
      size: head?.size ?? item.size ?? null,
    };
  };
  const [b, t] = await Promise.all([
    Promise.all(manifest.builds.map(withStatus)),
    Promise.all(manifest.tools.map(withStatus)),
  ]);
  return { model: manifest.model, builds: b, tools: t };
}

// Streams a file from R2. Supports Range and conditional requests, so browsers can resume large downloads.
async function download(request, env, id) {
  const item = builds.get(id) ?? tools.get(id);
  if (!item) return new Response("Unknown file", { status: 404 });

  if (request.method === "HEAD") {
    const head = await env.FIRMWARE.head(item.file);
    if (!head) return new Response(null, { status: 404 });
    return new Response(null, {
      headers: {
        "content-length": String(head.size),
        "content-type": "application/octet-stream",
        "accept-ranges": "bytes",
        etag: head.httpEtag,
      },
    });
  }

  const object = await env.FIRMWARE.get(item.file, {
    range: request.headers,
    onlyIf: request.headers,
  });
  if (object === null) {
    return new Response("This file has not been uploaded yet.", { status: 404 });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("accept-ranges", "bytes");
  headers.set("content-type", "application/octet-stream");
  headers.set("content-disposition", `attachment; filename="${item.file}"`);
  headers.set("cache-control", "private, no-transform");
  headers.set("x-content-type-options", "nosniff");

  if (!object.body) return new Response(null, { status: 304, headers });

  let status = 200;
  if (object.range && request.headers.has("range")) {
    const start = object.range.offset ?? 0;
    const end = object.range.end ?? start + (object.range.length ?? object.size) - 1;
    headers.set("content-range", `bytes ${start}-${end}/${object.size}`);
    headers.set("content-length", String(end - start + 1));
    status = 206;
  } else {
    headers.set("content-length", String(object.size));
  }
  return new Response(object.body, { status, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/builds") {
      return json(await listItems(env));
    }

    const match = url.pathname.match(/^\/dl\/([a-z0-9-]+)$/);
    if (match) {
      if (!["GET", "HEAD"].includes(request.method)) {
        return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
      }
      return download(request, env, match[1]);
    }

    return env.ASSETS.fetch(request);
  },
};
