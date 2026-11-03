import { getStore } from "@netlify/blobs";

const CC = /^[A-Z]{2}$/;
const json = (d, s = 200) =>
  new Response(JSON.stringify(d), {
    status: s,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

// chave publica derivada do id secreto do jogador (o id nunca fica exposto)
async function pubKey(id) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(id));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("").slice(0, 24);
}

// "Ana", "ana", "Aná" e "A.na" contam como o mesmo nome
const norm = (s) =>
  String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");

export default async (req) => {
  const store = getStore({ name: "rank", consistency: "strong" });
  const names = getStore({ name: "names", consistency: "strong" });
  const url = new URL(req.url);

  if (req.method === "GET") {
    // consulta de nome livre: /api/rank?name=Ana&id=<id secreto opcional>
    const nm = url.searchParams.get("name");
    if (nm !== null) {
      const nn = norm(nm);
      if (nn.length < 2) return json({ free: false, error: "invalid" });
      const id = url.searchParams.get("id") || "";
      const me = id.length >= 16 && id.length <= 64 ? await pubKey(id) : null;
      const c = await names.get(nn, { type: "json" });
      return json({ free: !c || c.k === me });
    }
    const board = url.searchParams.get("b") === "nc" ? "nc" : "n";
    const { blobs } = await store.list({ prefix: board + "/" });
    const items = (
      await Promise.all(blobs.slice(0, 300).map((x) => store.get(x.key, { type: "json" })))
    ).filter(Boolean);
    items.sort((a, c) => c.t - a.t);
    return json(items.slice(0, 50));
  }

  if (req.method === "POST") {
    let d;
    try {
      d = await req.json();
    } catch {
      return json({ error: "json" }, 400);
    }
    const board = d.b === "nc" ? "nc" : "n";
    const name = String(d.name || "").trim().slice(0, 12);
    const cc = String(d.cc || "");
    const t = Number(d.t);
    const id = String(d.id || "");
    const nn = norm(name);
    if (nn.length < 2 || !CC.test(cc) || !(t > 0 && t <= 10800) || id.length < 16 || id.length > 64) {
      return json({ error: "invalid" }, 400);
    }
    const k = await pubKey(id);

    // o nome so pode pertencer a um jogador
    const claim = await names.get(nn, { type: "json" });
    if (claim && claim.k !== k) return json({ error: "name_taken" }, 409);

    // se o jogador trocou de nome, libera o nome antigo
    for (const b2 of ["n", "nc"]) {
      const rec = await store.get(b2 + "/" + k, { type: "json" });
      if (rec && norm(rec.name) !== nn) {
        const oc = await names.get(norm(rec.name), { type: "json" });
        if (oc && oc.k === k) await names.delete(norm(rec.name));
      }
    }
    if (!claim) await names.setJSON(nn, { k });

    const key = board + "/" + k;
    const old = await store.get(key, { type: "json" });
    const best = old && old.t > t ? old.t : t; // guarda sempre o melhor tempo
    await store.setJSON(key, { k, name, cc, t: Math.round(best * 10) / 10 });
    return json({ ok: true, k });
  }

  return json({ error: "method" }, 405);
};

export const config = { path: "/api/rank" };
