const express = require("express");
const bodyParser = require("body-parser");
const { createClient } = require("@supabase/supabase-js");
const axios = require("axios");
const path = require("path");

const app = express();
app.use(bodyParser.text({ type: "*/*" }));

// 🔐 Connexion Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// 🔧 Récupère une image pour une ville
async function getImageForCity(city) {
  try {
    const response = await axios.get("https://source.unsplash.com/800x400/?" + encodeURIComponent(city));
    return response.request.res.responseUrl;
  } catch (error) {
    console.error("❌ Erreur image pour", city, ":", error.message);
    return null;
  }
}

// 🌍 Récupère les coordonnées via Nominatim
async function getCoordinatesForCity(city) {
  console.log("🔍 Recherche coordonnées pour :", city);
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(city)}`;
    const response = await axios.get(url, {
      headers: {
        "User-Agent": "GuideVoyageApp/1.0 (contact@tonsite.com)",
        "Accept-Language": "fr"
      }
    });

    console.log("📦 Réponse Nominatim brute :", response.data);

    if (response.data && response.data.length > 0) {
      const result = response.data[0];
      const coords = {
        lat: parseFloat(result.lat),
        lon: parseFloat(result.lon),
        name: city
      };
      console.log("✅ Coordonnées trouvées :", coords);
      return coords;
    } else {
      console.warn("⚠️ Aucune coordonnée trouvée pour :", city);
    }
  } catch (error) {
    console.error("💥 Erreur Nominatim :", error.message);
  }
  return null;
}

// ✅ Accueil
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// 📝 Enregistrement du guide
app.post("/guide/:id", async (req, res) => {
  const id = req.params.id;
  const content = req.body;

  // Extraction des villes
  const cityRegex = /^(#{2,3})\s*(.+)$/gm;
  const cities = [];
  let match;
  while ((match = cityRegex.exec(content)) !== null) {
    cities.push(match[2].trim());
  }
  console.log("🏙️ Villes extraites :", cities);

  // Images
  const cityImages = {};
  for (const city of cities) {
    const img = await getImageForCity(city);
    if (img) cityImages[city] = img;
  }

  // Coordonnées
  const coordinates = [];
  for (const city of cities) {
    const coord = await getCoordinatesForCity(city);
    if (coord) coordinates.push(coord);
  }
  console.log("📍 Coordonnées récoltées :", coordinates);

  // Enregistrement Supabase
  const { data, error } = await supabase
    .from("guides")
    .upsert({ id, content, city_images: cityImages, coordinates })
    .select();

  if (error) {
    console.error("❌ Supabase upsert error:", error.message, error.details, error.hint);
    return res.status(500).send(`Erreur Supabase : ${error.message} — ${error.details || ""}`);
  }

  console.log("✅ Supabase enregistrement :", data);
  res.send(`✅ Guide enregistré avec images et coordonnées pour l'ID ${id}`);
});

// 📄 Affichage d’un guide
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

  const renderedContent = content.replace(/^(#{2,3})\s*(.+)$/gm, (match, hashes, city) => {
    const imgUrl = cityImages && cityImages[city.trim()];
    const heading = `${hashes} ${city}`;
    const imgTag = imgUrl
      ? `<img src="${imgUrl}" alt="Image de ${city}" style="width:100%;margin:1rem 0;border-radius:8px;" />`
      : "";
    return `${heading}\n${imgTag}`;
  });

  const mapScript = `
    <div id="map" style="height: 500px; margin-top: 3rem;"></div>
    <script src="https://unpkg.com/leaflet/dist/leaflet.js"></script>
    <script>
      const coordinates = ${JSON.stringify(coordinates)};
      if (coordinates.length > 0) {
        const map = L.map('map').setView([coordinates[0].lat, coordinates[0].lon], 5);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap contributors'
        }).addTo(map);

        coordinates.forEach(coord => {
          L.marker([coord.lat, coord.lon]).addTo(map).bindPopup(coord.name);
        });
      }
    </script>
  `;

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
  img {
    max-width: 100%;
    border-radius: 8px;
    margin: 1rem 0;
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  }
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

// 🚀 Démarrage
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`✅ Serveur lancé sur le port ${port}`);
});
