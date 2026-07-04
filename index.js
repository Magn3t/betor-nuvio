const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");

const BETOR_URL = "https://betor.top/items.json";

const manifest = {
  id: "community.betorbr.nuvio",
  version: "1.0.0",
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
    return cachedData;
  } catch (e) {
    console.error("Erro ao buscar dados do BeTor:", e);
    return cachedData || [];
  }
}

builder.defineCatalogHandler(async ({ type, id, extra }) => {
  const data = await fetchBetorData();
  const skip = parseInt(extra?.skip || 0);
  const search = extra?.search?.toLowerCase();

  let items = data.filter(item => {
    if (type === "movie") return item.type === "movie" || !item.type;
    if (type === "series") return item.type === "series";
    return false;
  });

  if (search) {
    items = items.filter(item =>
      item.title?.toLowerCase().includes(search) ||
      item.name?.toLowerCase().includes(search)
    );
  }

  const metas = items.slice(skip, skip + 20).map(item => ({
    id: item.imdb_id || item.id,
    type: type,
    name: item.title || item.name,
    poster: item.poster,
    description: item.description || "",
    year: item.year
  })).filter(m => m.id);

  return { metas };
});

builder.defineStreamHandler(async ({ type, id }) => {
  const data = await fetchBetorData();
  
  const item = data.find(i => i.imdb_id === id || i.id === id);
  if (!item || !item.torrents) return { streams: [] };

  const streams = item.torrents.map(t => ({
    name: `BeTor BR\n${t.quality || ""}`,
    title: `${t.name || ""}\n👥 Seeds: ${t.seeds || 0} | Peers: ${t.peers || 0}`,
    infoHash: t.hash,
    sources: t.trackers || []
  })).filter(s => s.infoHash);

  return { streams };
});

const port = process.env.PORT || 3000;
serveHTTP(builder.getInterface(), { port });
console.log(`BeTor BR addon rodando na porta ${port}`);
