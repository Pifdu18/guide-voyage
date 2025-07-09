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

// 🔧 Image ville depuis Unsplash
async function getImageForCity(city) {
  try {
    const response = await axios.get("https://source.unsplash.com/800x400/?" + encodeURIComponent(city));
    return response.request.res.responseUrl;
  } catch (error) {
    console.error("Erreur récupération image pour", city, error.message);
    return null;
  }
}

// 🌍 Coordonnées via OpenStreetMap (Nominatim)
async function getCoordinatesForCity(city) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(city)}`;
    const response = await axios.get(url, {
      headers: { "User-Agent": "GuideVoyageApp/1.0" }
    });
    if (response.data && response.data.length > 0) {
      const result = response.data[0];
      return { lat: parseFloat(result.lat), lon: parseFloat(result.lon), name: city };
    }
  } catch (error) {
    console.error("Erreur géocodage pour", city, error.message);
  }
  return null;
}

// ✅ Route d'accueil
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// 📝 Enregistrement guide
app.post("/guide/:id", async (req, res) => {
  const id = req.params.id;
  const content = req.body;

  const cityRegex = /^(#{2,3})\s*(.+)$/gm;
  const cities = [];
  let match;
  while ((match = cityRegex.exec(content)) !== null) {
    cities.push(match[2].trim());
  }

  const cityImages = {};
  const coordinates = [];

  for (const city of cities) {
    const [img, coord] = await Promise.all([
      getImageForCity(city),
      getCoordinatesForCity(city)
    ]);
    if (img) cityImages[city] = img;
    if (coord) coordinates.push(coord);
  }

  const { data, error } = await supabase
    .from("guides")
    .upsert({ id, content, city_images: cityImages, coordinates })
    .select();

  if (error) {
    console.error("❌ Supabase upsert error:", error.message);
    return res.status(500).send(`Erreur Supabase : ${error.message}`);
  }

  console.log("✅ Guide enregistré avec images et coordonnées.");
  res.send(`✅ Guide enregistré avec images et carte pour l'ID ${id}`);
});

// 📄 Lecture guide
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

  const leafletMapBlock = `
<div id="map" style="height: 400px; margin: 2rem 0; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<script>
  const map = L.map('map').setView([48.8566, 2.3522], 4);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap'
  }).addTo(map);

  const coordinates = ${JSON.stringify(coordinates)};
  coordinates.forEach(point => {
    L.marker([point.lat, point.lon]).addTo(map)
      .bindPopup(point.name)
      .openPopup();
  });

  if (coordinates.length) {
    const bounds = L.latLngBounds(coordinates.map(c => [c.lat, c.lon]));
    map.fitBounds(bounds, { padding: [30, 30] });
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
${leafletMapBlock}
<button onclick="window.print()">Exporter en PDF</button>
</body>
</html>
`);
});

// 🚀 Démarrage du serveur
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`✅ Serveur lancé sur le port ${port}`);
});
