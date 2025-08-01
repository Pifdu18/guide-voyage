const express = require("express");
const bodyParser = require("body-parser");
const { createClient } = require("@supabase/supabase-js");
const axios = require("axios");
const path = require("path");
const cheerio = require("cheerio");

const app = express();
app.use(bodyParser.text({ type: "*/*" }));

// 🔐 Connexion Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// 🔧 Fonction pour obtenir une image d'une ville
async function getImageForCity(city) {
  try {
    const response = await axios.get(
      "https://source.unsplash.com/800x400/?" + encodeURIComponent(city)
    );
    return response.request.res.responseUrl;
  } catch (error) {
    console.error("Erreur récupération image pour", city, error.message);
    return null;
  }
}

// ✅ Route d'accueil
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// 📝 Enregistrement du guide
app.post("/guide/:id", async (req, res) => {
  const id = req.params.id;
  const content = req.body;

  // Extraction des villes (titres niveau 2 ou 3)
  const cityRegex = /^(#{2,3})\s*(.+)$/gm;
  const cities = [];
  let match;
  while ((match = cityRegex.exec(content)) !== null) {
    cities.push(match[2].trim());
  }

  const cityImages = {};
  for (const city of cities) {
    const img = await getImageForCity(city);
    if (img) {
      cityImages[city] = img;
    }
  }

  // Enregistrement Supabase
  const { data, error } = await supabase
    .from("guides")
    .upsert({ id, content, city_images: cityImages })
    .select();

  if (error) {
    console.error(
      "❌ Supabase upsert error:",
      error.message,
      error.details,
      error.hint
    );
    return res
      .status(500)
      .send(`Erreur Supabase : ${error.message} — ${error.details || ""}`);
  }

  console.log("✅ Supabase upsert success, data:", data);
  res.send(`✅ Guide enregistré avec images pour l'ID ${id}`);
});

// 📄 Lecture du guide
app.get("/:id", async (req, res) => {
  const id = req.params.id;

  const { data, error } = await supabase
    .from("guides")
    .select("content, city_images")
    .eq("id", id)
    .single();

  if (error || !data) {
    return res.status(404).send("Aucun guide trouvé pour cet ID.");
  }

  const { content, city_images: cityImages } = data;

  // Injecter les images dans le markdown
  let renderedContent = content.replace(
    /^(#{2,3})\s*(.+)$/gm,
    (match, hashes, city) => {
      const imgUrl = cityImages && cityImages[city.trim()];
      const heading = `${hashes} ${city}`;
      const imgTag = imgUrl
        ? `<img src="${imgUrl}" alt="Image de ${city}" style="width:100%;margin:1rem 0;border-radius:8px;" />`
        : "";
      return `${heading}\n${imgTag}`;
    }
  );

  // 🧠 Extraction des villes via Cheerio
  const $ = cheerio.load(renderedContent);
  const cities = [];
  $("h2, h3").each((_, el) => {
    const text = $(el).text();
    const match = text.match(/–\s*(.+)$/); // Ex: "Jour 1 – Hanoï" => "Hanoï"
    if (match && match[1]) {
      cities.push(match[1].trim());
    }
  });

  console.log("🔎 Villes extraites pour la carte :", cities);

  // 📍 Géocodage via Nominatim
  const geoResults = await Promise.all(
    cities.map(async (city) => {
      try {
        const response = await axios.get(
          "https://nominatim.openstreetmap.org/search",
          {
            params: {
              q: city,
              format: "json",
              limit: 1,
            },
            headers: { "User-Agent": "guide-voyage-bot" },
          }
        );
        if (response.data && response.data.length > 0) {
          const { lat, lon, display_name } = response.data[0];
          return {
            city,
            lat: parseFloat(lat),
            lon: parseFloat(lon),
            name: display_name,
          };
        }
      } catch (err) {
        console.error(`Erreur géocodage pour ${city}:`, err.message);
      }
      return null;
    })
  );

  const coordinates = geoResults.filter(Boolean);
  console.log("📍 Coordonnées obtenues :", coordinates);

  // 🧭 Générer HTML final
  const mapSection = coordinates.length
    ? `
  <div id="map" style="height: 400px; margin-top: 3rem; border-radius: 8px;"></div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    const map = L.map('map').setView([${coordinates[0].lat}, ${coordinates[0].lon}], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
    }).addTo(map);

    const points = ${JSON.stringify(coordinates)};
    points.forEach(p => {
      L.marker([p.lat, p.lon]).addTo(map)
        .bindPopup(p.name || p.city);
    });
  </script>
  `
    : `<p style="margin-top:2rem;color:#888;font-style:italic">Aucune donnée géographique disponible pour ce guide.</p>`;

  res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Guide de voyage</title>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<style>
  *, *::before, *::after { box-sizing: border-box; }
  body {
    font-family: 'Poppins', sans-serif;
    background: #f5f9ff;
    color: #222;
    margin: 0;
    padding: 2rem 1rem;
    max-width: 900px;
    margin-left: auto;
    margin-right: auto;
    line-height: 1.6;
  }
  h2, h3, h4 {
    color: #1a73e8;
    margin-top: 2rem;
    margin-bottom: 0.6rem;
  }
  h2 {
    border-bottom: 3px solid #1a73e8;
    padding-bottom: 0.3rem;
  }
  h3 {
    font-weight: 600;
    border-left: 5px solid #1a73e8;
    padding-left: 0.5rem;
    background: #e8f0fe;
    border-radius: 4px;
  }
  h4 {
    margin-top: 1.2rem;
    font-weight: 600;
    color: #0f59d7;
  }
  ul {
    padding-left: 1.4rem;
    margin-top: 0.4rem;
    margin-bottom: 1rem;
  }
  li {
    margin-bottom: 0.5rem;
  }
  blockquote {
    font-style: italic;
    background: #e3f2fd;
    border-left: 5px solid #1a73e8;
    margin: 2rem 0;
    padding: 1rem 1.2rem;
    border-radius: 4px;
  }
  p { margin-top: 0; }
  button {
    margin-top: 2.5rem;
    background: #1a73e8;
    color: white;
    border: none;
    border-radius: 6px;
    padding: 0.8rem 2rem;
    font-size: 1.1rem;
    cursor: pointer;
    transition: background-color 0.3s ease;
    box-shadow: 0 4px 8px rgb(26 115 232 / 0.3);
  }
  button:hover {
    background: #155ab6;
    box-shadow: 0 6px 12px rgb(21 90 182 / 0.5);
  }
  img {
    max-width: 100%;
    border-radius: 8px;
    margin: 1rem 0;
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  }
</style>
</head>
<body>
${renderedContent}
${mapSection}
<button onclick="window.print()">Exporter en PDF</button>
</body>
</html>`);
});

// 🚀 Lancement du serveur
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`✅ Serveur lancé sur le port ${port}`);
});
