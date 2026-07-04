const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");

const BETOR_URL = "https://catalogo.betor.top/static/data/items.json";

const manifest = {
  id: "community.betorbr.nuvio",
  version: "1.0.1",
  name: "BeTor BR",
  description: "Filmes e séries dublados e legendados em Português (PT-BR) via BeTor",
  logo: "https://betor.top/favicon.ico",
  resources: ["stream", "catalog"],
  types: ["movie", "series"],
  idPrefixes: ["tt"],
  catalogs: [
    {
      type: "movie",
      id: "betor_movies",
      name: "🇧🇷 BeTor - Filmes",
      extra: [{ name: "search" }, { name: "skip" }]
    },
    {
      type: "series",
      id: "betor_series",
      name: "🇧🇷 BeTor - Séries",
      extra: [{ name: "search" }, { name: "skip" }]
    }
  ]
};

const builder = new addonBuilder(manifest);

let cachedData = null;
let lastFetch = 0;

async function fetchBetorData() {
  const now = Date.now();
  if (cachedData && now - lastFetch < 3600000) return cachedData;
  
  try {
    const fetch = require("node-fetch");
    const res = await fetch(BETOR_URL);
    cachedData = await res.json();
    lastFetch = now;
    console.log(`BeTor: ${cachedData.length} itens carregados`);
    return cachedData;
  } catch (e) {
    console.error("Erro ao buscar dados do BeTor:", e);
    return cachedData || [];
  }
}

function extractInfoHash(magnetUri) {
  if (!magnetUri) return null;
  const match = magnetUri.match(/urn:btih:([a-zA-Z0-9]+)/i);
  return match ? match[1].toLowerCase() : null;
}

function extractTrackers(magnetUri) {
  if (!magnetUri) return [];
  const matches = magnetUri.match(/tr=([^&]+)/g) || [];
  return matches.map(t => decodeURIComponent(t.replace("tr=", "")));
}

builder.defineCatalogHandler(async ({ type, id, extra }) => {
  const data = await fetchBetorData();
  const skip = parseInt(extra?.skip || 0);
  const search = extra?.search?.toLowerCase();

  // Agrupar por imdb_id para não duplicar
  const seen = new Set();
  let items = data.filter(item => {
    if (!item.imdb_id) return false;
    if (seen.has(item.imdb_id)) return false;
    seen.add(item.imdb_id);
    
    if (type === "movie") return item.item_type === "movie";
    if (type === "series") return item.item_type === "series";
    return false;
  });

  if (search) {
    items = items.filter(item =>
      item.torrent_name?.toLowerCase().includes(search)
    );
  }

  const metas = items.slice(skip, skip + 20).map(item => ({
    id: item.imdb_id,
    type: type,
    name: item.torrent_name?.replace(/\.\d{4}.*/, "") || item.imdb_id,
    poster: `https://images.metahub.space/poster/medium/${item.imdb_id}/img`
  })).filter(m => m.id);

  return { metas };
});

builder.defineStreamHandler(async ({ type, id }) => {
  const data = await fetchBetorData();
  
  const items = data.filter(i => i.imdb_id === id && i.magnet_uri);
  if (!items.length) return { streams: [] };

  const streams = items.map(item => {
    const infoHash = extractInfoHash(item.magnet_uri);
    if (!infoHash) return null;
    
    return {
      name: `🇧🇷 BeTor BR`,
      title: `${item.torrent_name || ""}\n📡 ${item.provider_slug || ""}`,
      infoHash: infoHash,
      sources: extractTrackers(item.magnet_uri)
    };
  }).filter(Boolean);

  return { streams };
});

const port = process.env.PORT || 3000;
serveHTTP(builder.getInterface(), { port });
console.log(`BeTor BR addon rodando na porta ${port}`);
