const express = require("express");
const bodyParser = require("body-parser");
const { createClient } = require("@supabase/supabase-js");
const axios = require("axios");
const cheerio = require("cheerio");
const path = require("path");

const app = express();
app.use(bodyParser.text({ type: "*/*" }));

// 🔐 Connexion Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// 🔄 Images fictives
async function getImageForCity(city) {
  return `https://via.placeholder.com/800x400.png?text=${encodeURIComponent(city)}`;
}

// 🔄 Coordonnées fictives
async function getCoordinatesForCity(city) {
  const fakeCoords = {
    "Tokyo": { lat: 35.6762, lon: 139.6503 },
    "Nikko": { lat: 36.7487, lon: 139.5986 },
    "Hakone": { lat: 35.1911, lon: 139.0260 },
    "Kyoto": { lat: 35.0116, lon: 135.7681 },
    "Hiroshima": { lat: 34.3853, lon: 132.4553 },
    "Osaka": { lat: 34.6937, lon: 135.5023 },
    "Nara": { lat: 34.6851, lon: 135.8048 },
    "Kobe": { lat: 34.6901, lon: 135.1956 },
    "Okayama": { lat: 34.6551, lon: 133.9195 },
    "Miyajima": { lat: 34.2950, lon: 132.3198 },
  };
  return fakeCoords[city] ? { ...fakeCoords[city], city } : null;
}

// ✅ Route d'accueil
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// 📝 Enregistrement du guide
app.post("/guide/:id", async (req, res) => {
  const id = req.params.id;
  const content = req.body;

  const $ = cheerio.load(content);
  const cities = [];

  $("h3").each((_, el) => {
    const text = $(el).text();
    const parts = text.split("–").map(p => p.trim());
    if (parts.length > 1) {
      const city = parts[1];
      if (!cities.includes(city)) cities.push(city);
    }
  });

  const cityImages = {};
  const coordinates = [];

  for (const city of cities) {
    const img = await getImageForCity(city);
    const coords = await getCoordinatesForCity(city);

    if (img) cityImages[city] = img;
    if (coords) coordinates.push(coords);
  }

  const { data, error } = await supabase
    .from("guides")
    .upsert({ id, content, city_images: cityImages, coordinates })
    .select();

  if (error) {
    console.error("❌ Supabase upsert error:", error.message, error.details, error.hint);
    return res.status(500).send(`Erreur Supabase : ${error.message} — ${error.details || ""}`);
  }

  console.log("✅ Guide enregistré avec images et coordonnées pour l'ID", id);
  res.send(`✅ Guide enregistré avec images et carte pour l'ID ${id}`);
});

// 📄 Lecture du guide
app.get("/:id", async (req, res) => {
  const id = req.params.id;

  const { data, error } = await supabase
    .from("guides")
    .select("content, city_images, coordinates")
    .eq("id", id)
    .single();

  if (error || !data) {
    return res.status(404).send("Aucun guide trouvé pour cet ID.");
  }

  const { content, city_images: cityImages, coordinates } = data;

  const renderedContent = content.replace(/<h3[^>]*>(.*?)<\/h3>/g, (match, title) => {
    const parts = title.split("–").map(p => p.trim());
    const city = parts[1];
    const imgUrl = cityImages?.[city];
    const imgTag = imgUrl ? `<img src="${imgUrl}" alt="Image de ${city}" style="width:100%;margin:1rem 0;border-radius:8px;" />` : "";
    return `${match}\n${imgTag}`;
  });

  const mapScript = coordinates && coordinates.length > 0
    ? `
    <div id="map" style="height: 500px; margin-top: 2rem; border-radius: 8px;"></div>
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <script>
      const coordinates = ${JSON.stringify(coordinates)};
      if (coordinates.length > 0) {
        const map = L.map('map').setView([coordinates[0].lat, coordinates[0].lon], 6);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap'
        }).addTo(map);
        coordinates.forEach(({ lat, lon, city }) => {
          L.marker([lat, lon]).addTo(map).bindPopup(city);
        });
      }
    </script>
  `
    : `<p>Aucune donnée géographique disponible pour ce guide.</p>`;

  res.send(`
<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Guide de voyage</title>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600&display=swap" rel="stylesheet" />
<style>
  body {
    font-family: 'Poppins', sans-serif;
    background: #f5f9ff;
    color: #222;
    max-width: 900px;
    margin: auto;
    padding: 2rem 1rem;
    line-height: 1.6;
  }
  h2, h3, h4 { color: #1a73e8; }
  h2 { border-bottom: 3px solid #1a73e8; padding-bottom: 0.3rem; }
  h3 { border-left: 5px solid #1a73e8; padding-left: 0.5rem; background: #e8f0fe; border-radius: 4px; }
  h4 { color: #0f59d7; margin-top: 1.2rem; }
  img { max-width: 100%; border-radius: 8px; margin: 1rem 0; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
  #map { height: 500px; margin-top: 2rem; }
  button {
    margin-top: 2.5rem;
    background: #1a73e8;
    color: white;
    border: none;
    border-radius: 6px;
    padding: 0.8rem 2rem;
    font-size: 1.1rem;
    cursor: pointer;
  }
</style>
</head>
<body>
${renderedContent}
${mapScript}
<button onclick="window.print()">Exporter en PDF</button>
</body>
</html>
`);
});

// 🚀 Lancement du serveur
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`✅ Serveur lancé sur le port ${port}`);
});
