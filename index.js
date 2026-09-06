const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const https = require("https");

const BETOR_URL = "https://catalogo.betor.top/static/data/items.json";
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 horas

const manifest = {
  id: "community.betorbr.nuvio",
  version: "1.0.3",
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

// Índices compactos
let movieIndex = null;
let seriesIndex = null;
let streamIndex = null;
let lastFetch = 0;
let isFetching = false;

function extractInfoHash(magnetUri) {
  if (!magnetUri) return null;
  const match = magnetUri.match(/urn:btih:([a-zA-Z0-9]+)/i);
  return match ? match[1].toLowerCase() : null;
}

function extractTrackers(magnetUri) {
  if (!magnetUri) return [];
  const matches = magnetUri.match(/tr=([^&]+)/g) || [];
  return matches.slice(0, 5).map(t => decodeURIComponent(t.replace("tr=", "")));
}

function getQualityScore(torrentName) {
  if (!torrentName) return 0;
  const name = torrentName.toLowerCase();
  if (name.includes("2160p") || name.includes("4k") || name.includes("uhd")) return 4000;
  if (name.includes("1080p")) return 3000;
  if (name.includes("720p")) return 2000;
  if (name.includes("480p")) return 1000;
  return 500;
}

function scoreStream(item) {
  const quality = getQualityScore(item.torrent_name);
  const seeds = parseInt(item.seeds || item.seeders || 0);
  return quality + seeds;
}

function cleanName(torrentName) {
  if (!torrentName) return "";
  return torrentName.replace(/\.(19|20)\d{2}.*$/i, "").replace(/\./g, " ").trim();
}

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = "";
      res.on("data", chunk => { data += chunk; });
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
        data = null; // libera memória
      });
    }).on("error", reject);
  });
}

async function buildIndexes() {
  const now = Date.now();
  if ((movieIndex && now - lastFetch < CACHE_TTL) || isFetching) return;

  isFetching = true;
  try {
    console.log("Buscando dados do BeTor...");
    const data = await fetchJSON(BETOR_URL);
    console.log(`${data.length} itens recebidos`);

    const movies = {};
    const series = {};
    const streams = {};

    // Agrupa todos os streams por imdb_id com score
    const rawStreams = {};
    for (const item of data) {
      if (!item.imdb_id || !item.magnet_uri) continue;
      const infoHash = extractInfoHash(item.magnet_uri);
      if (!infoHash) continue;

      if (!rawStreams[item.imdb_id]) rawStreams[item.imdb_id] = [];
      rawStreams[item.imdb_id].push({
        h: infoHash,
        t: extractTrackers(item.magnet_uri),
        n: (item.torrent_name || "").substring(0, 60),
        p: (item.provider_slug || "").substring(0, 20),
        s: scoreStream(item)
      });
    }

    // Ordena por score e guarda só os top 5
    for (const [imdbId, items] of Object.entries(rawStreams)) {
      streams[imdbId] = items
        .sort((a, b) => b.s - a.s)
        .slice(0, 5)
        .map(({ h, t, n, p }) => ({ h, t, n, p }));

      // Catálogo: pega nome do melhor stream
      const best = rawStreams[imdbId][0];
      if (!best) continue;

      const bestItem = data.find(i => i.imdb_id === imdbId);
      if (bestItem?.item_type === "movie") {
        movies[imdbId] = cleanName(bestItem.torrent_name).substring(0, 50);
      } else if (bestItem?.item_type === "series") {
        series[imdbId] = cleanName(bestItem.torrent_name).substring(0, 50);
      }
    }

    // Limpa dados antigos antes de atualizar
    movieIndex = null;
    seriesIndex = null;
    streamIndex = null;

    movieIndex = movies;
    seriesIndex = series;
    streamIndex = streams;
    lastFetch = now;

    console.log(`Índices prontos: ${Object.keys(movies).length} filmes, ${Object.keys(series).length} séries`);
  } catch (e) {
    console.error("Erro:", e.message);
  } finally {
    isFetching = false;
  }
}

builder.defineCatalogHandler(async ({ type, extra }) => {
  await buildIndexes();
  if (!movieIndex) return { metas: [] };

  const skip = parseInt(extra?.skip || 0);
  const search = extra?.search?.toLowerCase();
  const index = type === "movie" ? movieIndex : seriesIndex;

  let entries = Object.entries(index);

  if (search) {
    entries = entries.filter(([, name]) => name.toLowerCase().includes(search));
  }

  const metas = entries.slice(skip, skip + 20).map(([imdbId, name]) => ({
    id: imdbId,
    type,
    name: name || imdbId,
    poster: `https://images.metahub.space/poster/medium/${imdbId}/img`
  }));

  return { metas };
});

builder.defineStreamHandler(async ({ id }) => {
  await buildIndexes();
  if (!streamIndex) return { streams: [] };

  const items = streamIndex[id] || [];

  const streams = items.map(item => ({
    name: `🇧🇷 BeTor BR`,
    title: `${item.n}\n📡 ${item.p}`,
    infoHash: item.h,
    sources: item.t
  }));

  return { streams };
});

const port = process.env.PORT || 3000;
serveHTTP(builder.getInterface(), { port });
console.log(`BeTor BR addon rodando na porta ${port}`);
