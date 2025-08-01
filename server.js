const express = require("express");
const bodyParser = require("body-parser");
const { createClient } = require("@supabase/supabase-js");
const axios = require("axios");
const path = require("path");
const cheerio = require("cheerio"); // Pour parser le HTML

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
    const response = await axios.get("https://source.unsplash.com/800x400/?" + encodeURIComponent(city));
    return response.request.res.responseUrl;
  } catch (error) {
    console.error("Erreur récupération image pour", city, error.message);
    return null;
  }
}

// 🔧 Fonction pour obtenir les coordonnées d’une ville
async function getCoordinatesForCity(city) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city)}&format=json&limit=1`;
    const { data } = await axios.get(url, {
      headers: { 'User-Agent': 'guide-voyage-app' }
    });
    if (data.length > 0) {
      return {
        name: city,
        lat: parseFloat(data[0].lat),
        lon: parseFloat(data[0].lon)
      };
    }
    return null;
  } catch (err) {
    console.error("❌ Erreur coordonnée pour", city, err.message);
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

  // Extraction des villes à partir du HTML
  const $ = cheerio.load(content);
  const cities = [];

  $("h2, h3").each((_, el) => {
    const text = $(el).text().trim();
    const match = text.match(/–\s*(.+)$/); // cherche "– Ville"
    if (match && match[1]) {
      cities.push(match[1].trim());
    }
  });

  console.log("🏙️ Villes extraites du HTML :", cities);

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
    console.error("❌ Supabase upsert error:", error.message, error.details, error.hint);
    return res.status(500).send(`Erreur Supabase : ${error.message} — ${error.details || ""}`);
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

  // Extraction des villes depuis le HTML
  const $ = cheerio.load(content);
  const cities = [];

  $("h2, h3").each((_, el) => {
    const text = $(el).text().trim();
    const match = text.match(/–\s*(.+)$/);
    if (match && match[1]) {
      cities.push(match[1].trim());
    }
  });

  console.log("🗺️ Villes pour carte :", cities);

  // Récupération des coordonnées
  const coordinates = [];
  for (const city of cities) {
    const point = await getCoordinatesForCity(city);
    if (point) {
      coordinates.push(point);
    }
  }

  console.log("📌 Coordonnées trouvées :", coordinates);

  // Insertion des images
  const renderedContent = content.replace(/(<h[23][^>]*>[^<]*–\s*)([^<]+)(<\/h[23]>)/g, (match, before, city, after) => {
    const imgUrl = cityImages && cityImages[city.trim()];
    const imgTag = imgUrl
      ? `<img src="${imgUrl}" alt="Image de ${city}" style="width:100%;margin:1rem 0;border-radius:8px;" />`
      : "";
    return `${before}${city}${after}\n${imgTag}`;
  });

  const mapSection = coordinates.length > 0
    ? `<div id="map" style="height: 500px; margin-top:2rem;"></div>
<script>
  const coords = ${JSON.stringify(coordinates)};
  const map = L.map('map').setView([coords[0].lat, coords[0].lon], 6);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
  }).addTo(map);
  coords.forEach(({ lat, lon, name }) => {
    L.marker([lat, lon]).addTo(map).bindPopup(name);
  });
</script>`
    : `<p style="margin-top:2rem;">Aucune donnée géographique disponible pour ce guide.</p>`;

  res.send(`
<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Guide de voyage</title>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="https://unpkg.com/leaflet/dist/leaflet.css" />
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
  #map {
    height: 500px;
    margin-top: 3rem;
    border-radius: 8px;
    box-shadow: 0 2px 12px rgba(0,0,0,0.2);
  }
</style>
</head>
<body>
${renderedContent}
${mapSection}
<button onclick="window.print()">Exporter en PDF</button>
<script src="https://unpkg.com/leaflet/dist/leaflet.js"></script>
</body>
</html>
`);
});

// 🚀 Lancement du serveur
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`✅ Serveur lancé sur le port ${port}`);
});
