import { qrcode } from "qrcode";
import { createCanvas, loadImage } from "canvas";
import { tag } from "markup_tag";

const IS_DEV = !Deno.env.get("DENO_DEPLOYMENT_ID");

function errResponse(
  status: number,
  statusText: string,
  init: ResponseInit = {},
): [BodyInit, ResponseInit] {
  return [`${status}: ${statusText}`, { status, statusText, ...init }];
}

async function resolveHandle(handleOrDid: string): Record<string, string> {
  const pathname = "/xrpc/com.atproto.repo.listRecords";
  const base = "https://bsky.social";
  const collection = "app.bsky.actor.profile";
  const repo = decodeURIComponent(handleOrDid);
  const url = new URL(pathname, base);
  url.search = new URLSearchParams({ collection, repo });
  const endpoint = url.toString();

  try {
    const response = await fetch(endpoint);
    const json = await response.json();
    const { uri, value } = json.records[0];
    const did = uri.replace("at://", "").replace(/\/.*/, "");
    console.log({ did, value });
    const avatar = value.avatar.cid ?? value.avatar.ref["$link"];

    return { did, avatar };
  } catch (e) {
    console.warn(e);
    return {};
  }
}

function ctype(type: string): string {
  return { "content-type": `${type}; charset=utf-8` };
}

async function genResponseArgs(request: Request) {
  const { pathname, search, searchParams } = new URL(request.url);
  const path = pathname.replace(/^\//, "");
  if (IS_DEV) {
    console.log({ path, search, params: searchParams.toString() });
  }

  const urlBase = IS_DEV
    ? "http://localhost:8000/"
    : "https://bluesquare.deno.dev/";

  if (path === "") {
    const file = await Deno.readFile("./index.html");
    return [file, { headers: { ...ctype("text/html") } }];
  }
  if (path === "favicon.ico") {
    return ["", { headers: { ...ctype("text/plain") } }];
  }

  if (path !== "qr.png") {
    const pageUrl = `${urlBase}${path}${search}`;

    searchParams.append("path", path);
    const imgSrc = `${urlBase}qr.png?${searchParams.toString()}`;

    const og = (prop, content) =>
      tag("meta", { property: `og:${prop}`, content });

    const file = tag("meta", { charset: "utf-8" }) +
      tag("meta", {
        name: "viewport",
        content: "width=device-width,initial-scale=1",
      }) +
      tag("link", {
        rel: "stylesheet",
        href: "https://cdn.jsdelivr.net/npm/water.css@2/out/water.min.css",
      }) +
      tag("title", `Bluesquare: ${path}`) +
      og("url", pageUrl) +
      og("type", "website") +
      og("title", "Bluesquare") +
      og("description", "QR code generator for Bluesky.") +
      og("site_name", "Bluesquare") +
      og("image", imgSrc) +
      tag("style", "body { text-align: center; }") +
      tag("h1", tag("a", { href: "/" }, "Bluesquare")) +
      tag(
        "div",
        tag("div", pageUrl),
        tag(
          "a",
          { href: `https://bsky.app/profile/${path}`, target: "_blank" },
          tag("img", {
            src: imgSrc,
            onerror:
              "this.parentNode.parentNode.outerHTML='&lt;div&gt;Not Found&lt;/div&gt;'",
          }),
        ),
      );

    return [file, { headers: { ...ctype("text/html") } }];
  }

  // qr.png

  const user = await resolveHandle(
    path === "qr.png" ? searchParams.get("path") : path,
  );
  if (!user.did) {
    return errResponse(404, "Not Found");
  }

  const bskyURL = `https://bsky.app/profile/${user.did}`;
  const type = searchParams.get("type") || "cloud";

  const base64Image = await qrcode(bskyURL);

  const size = 600;
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");
  const img = await loadImage(base64Image);
  ctx.drawImage(img, 0, 0, size, size);

  const iconBase =
    "https://raw.githubusercontent.com/bluesky-social/social-app/";
  const iconExt = "/assets/icon.png";
  const icons = {
    cloud: `${iconBase}56cf890debeb9872f791ccb992a5587f2c05fd9e${iconExt}`,
    cloudButterfly:
      `${iconBase}dd074371cfbcdc778dba3877fa3dda07a0f5d418${iconExt}`,
    butterfly: `${iconBase}781410690944b5efc826ccc36660f86565107d92${iconExt}`,
    user:
      `https://cdn.bsky.app/img/avatar/plain/${user.did}/${user.avatar}@jpeg`,
  };
  const iconUrl = icons[type];

  if (iconUrl) {
    const icon = await loadImage(iconUrl);

    const iSize = size / 4;
    const iOffset = (size - iSize) / 2;

    // round corner
    // ref: https://codepen.io/movii/pen/QBgqeY
    ctx.save();
    const radius = iSize / 10;
    ctx.beginPath();
    ctx.lineWidth = 5;
    ctx.moveTo(iOffset + radius, iOffset);
    ctx.lineTo(iOffset + iSize - radius, iOffset);
    ctx.quadraticCurveTo(
      iOffset + iSize,
      iOffset,
      iOffset + iSize,
      iOffset + radius,
    );
    ctx.lineTo(iOffset + iSize, iOffset + iSize - radius);
    ctx.quadraticCurveTo(
      iOffset + iSize,
      iOffset + iSize,
      iOffset + iSize - radius,
      iOffset + iSize,
    );
    ctx.lineTo(iOffset + radius, iOffset + iSize);
    ctx.quadraticCurveTo(
      iOffset,
      iOffset + iSize,
      iOffset,
      iOffset + iSize - radius,
    );
    ctx.lineTo(iOffset, iOffset + radius);
    ctx.quadraticCurveTo(iOffset, iOffset, iOffset + radius, iOffset);
    ctx.closePath();
    ctx.strokeStyle = "#FFF";
    ctx.stroke();
    ctx.clip();
    ctx.drawImage(icon, iOffset, iOffset, iSize, iSize);
    ctx.restore();
  }

  return [canvas.toBuffer(), { headers: { ...ctype("image/png") } }];
}

Deno.serve(async (request: Request) =>
  new Response(...await genResponseArgs(request))
);
