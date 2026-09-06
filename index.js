const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const https = require("https");

const BETOR_URL = "https://catalogo.betor.top/static/data/items.json";
const CACHE_TTL = 6 * 60 * 60 * 1000;

const manifest = {
  id: "community.betorbr.nuvio",
  version: "1.0.5",
  name: "BeTor BR",
  description: "Filmes e series dublados e legendados em Portugues (PT-BR) via BeTor",
  logo: "https://betor.top/favicon.ico",
  resources: ["stream", "catalog"],
  types: ["movie", "series"],
  idPrefixes: ["tt"],
  catalogs: [
    {
      type: "movie",
      id: "betor_movies",
      name: "BeTor - Filmes",
      extra: [{ name: "search" }, { name: "skip" }]
    },
    {
      type: "series",
      id: "betor_series",
      name: "BeTor - Series",
      extra: [{ name: "search" }, { name: "skip" }]
    }
  ]
};

const builder = new addonBuilder(manifest);

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
  // Remove qualidade, codec, fonte e resto
  let name = torrentName
    .replace(/\b(2160p|1080p|720p|480p|4k|uhd|hdr|sdr|bluray|blu-ray|webrip|web-dl|webdl|hdtv|dvdrip|bdrip|hdrip|x264|x265|h264|h265|hevc|avc|xvid|divx|aac|ac3|dts|mp3|atmos|truehd|ddp|dd5|remux|proper|repack|extended|theatrical|directors|cut|unrated|dual|dublado|legendado|nacional|portugues|brazil|br|pt)\b.*$/i, "")
    // Remove SxxExx e resto pra series
    .replace(/\bS\d{2}E\d{2}\b.*/i, "")
    // Remove ano e resto
    .replace(/\b(19|20)\d{2}\b.*/i, "")
    // Substitui pontos e underscores por espaco
    .replace(/[._]/g, " ")
    // Remove espacos duplos
    .replace(/\s+/g, " ")
    .trim();

  return name.substring(0, 50);
}

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = "";
      res.on("data", chunk => { data += chunk; });
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
        data = null;
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
    console.log(data.length + " itens recebidos");

    const movies = {};
    const series = {};
    const streams = {};
    const rawStreams = {};
    const itemTypes = {};

    for (const item of data) {
      if (!item.imdb_id || !item.magnet_uri) continue;
      const infoHash = extractInfoHash(item.magnet_uri);
      if (!infoHash) continue;

      if (!rawStreams[item.imdb_id]) {
        rawStreams[item.imdb_id] = [];
        itemTypes[item.imdb_id] = {
          type: item.item_type,
          name: cleanName(item.torrent_name)
        };
      }

      rawStreams[item.imdb_id].push({
        h: infoHash,
        t: extractTrackers(item.magnet_uri),
        n: (item.torrent_name || "").substring(0, 80),
        p: (item.provider_slug || "").substring(0, 20),
        s: scoreStream(item)
      });
    }

    for (const imdbId of Object.keys(rawStreams)) {
      const items = rawStreams[imdbId];
      streams[imdbId] = items
        .sort((a, b) => b.s - a.s)
        .slice(0, 5)
        .map(i => ({ h: i.h, t: i.t, n: i.n, p: i.p }));

      const meta = itemTypes[imdbId];
      if (meta && meta.type === "movie") {
        movies[imdbId] = meta.name;
      } else if (meta && meta.type === "series") {
        series[imdbId] = meta.name;
      }
    }

    movieIndex = null;
    seriesIndex = null;
    streamIndex = null;

    movieIndex = movies;
    seriesIndex = series;
    streamIndex = streams;
    lastFetch = now;

    console.log("Indices prontos: " + Object.keys(movies).length + " filmes, " + Object.keys(series).length + " series");
  } catch (e) {
    console.error("Erro:", e.message);
  } finally {
    isFetching = false;
  }
}

builder.defineCatalogHandler(async function(args) {
  await buildIndexes();
  if (!movieIndex) return { metas: [] };

  const type = args.type;
  const extra = args.extra || {};
  const skip = parseInt(extra.skip || 0);
  const search = extra.search ? extra.search.toLowerCase() : null;
  const index = type === "movie" ? movieIndex : seriesIndex;

  let entries = Object.entries(index);

  if (search) {
    entries = entries.filter(e => e[1].toLowerCase().includes(search));
  }

  const metas = entries.slice(skip, skip + 20).map(e => ({
    id: e[0],
    type: type,
    name: e[1] || e[0],
    poster: "https://images.metahub.space/poster/medium/" + e[0] + "/img"
  }));

  return { metas };
});

builder.defineStreamHandler(async function(args) {
  await buildIndexes();
  if (!streamIndex) return { streams: [] };

  const items = streamIndex[args.id] || [];

  const streams = items.map(item => ({
    name: "BeTor BR",
    title: item.n + "\n" + item.p,
    infoHash: item.h,
    sources: item.t
  }));

  return { streams };
});

const port = process.env.PORT || 3000;
serveHTTP(builder.getInterface(), { port });
console.log("BeTor BR addon rodando na porta " + port);
