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

// 🔧 Obtenir une image depuis Unsplash
async function getImageForCity(city) {
  try {
    const response = await axios.get("https://source.unsplash.com/800x400/?" + encodeURIComponent(city));
    return response.request.res.responseUrl;
  } catch (error) {
    console.error("Erreur récupération image pour", city, error.message);
    return null;
  }
}

// 🔧 Obtenir les coordonnées depuis Nominatim
async function getCoordinatesForCity(city) {
  try {
    const res = await axios.get("https://nominatim.openstreetmap.org/search", {
      params: {
        q: city,
        format: "json",
        limit: 1
      },
      headers: { "User-Agent": "guide-app" }
    });
    if (res.data[0]) {
      return {
        lat: parseFloat(res.data[0].lat),
        lon: parseFloat(res.data[0].lon),
        name: city
      };
    }
  } catch (error) {
    console.error("Erreur géocodage pour", city, ":", error.message);
  }
  return null;
}

// ✅ Page d'accueil
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// 📝 Enregistrer un guide
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

  // Images et coordonnées
  const cityImages = {};
  const coordinates = [];

  for (const city of cities) {
    const img = await getImageForCity(city);
    if (img) cityImages[city] = img;

    const point = await getCoordinatesForCity(city);
    if (point) coordinates.push(point);
  }

  // Insertion Supabase
  const { data, error } = await supabase
    .from("guides")
    .upsert({ id, content, city_images: cityImages, coordinates })
    .select();

  if (error) {
    console.error("❌ Supabase upsert error:", error.message, error.details, error.hint);
    return res.status(500).send(`Erreur Supabase : ${error.message} — ${error.details || ""}`);
  }

  console.log("✅ Supabase upsert success, data:", data);
  res.send(`✅ Guide enregistré avec images et carte pour l'ID ${id}`);
});

// 📄 Affichage du guide
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

  const { content, city_images: cityImages, coordinates = [] } = data;

  const renderedContent = content.replace(/^(#{2,3})\s*(.+)$/gm, (match, hashes, city) => {
    const imgUrl = cityImages && cityImages[city.trim()];
    const heading = `${hashes} ${city}`;
    const imgTag = imgUrl
      ? `<img src="${imgUrl}" alt="Image de ${city}" style="width:100%;margin:1rem 0;border-radius:8px;" />`
      : "";
    return `${heading}\n${imgTag}`;
  });

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
    height: 400px;
    margin-top: 2rem;
    border-radius: 8px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
  }
</style>
</head>
<body>
${renderedContent}
<div id="map"></div>
<button onclick="window.print()">Exporter en PDF</button>
<script src="https://unpkg.com/leaflet/dist/leaflet.js"></script>
<script>
  const coordinates = ${JSON.stringify(coordinates)};
  if (coordinates.length > 0) {
    const map = L.map('map').setView([coordinates[0].lat, coordinates[0].lon], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
    }).addTo(map);

    coordinates.forEach(point => {
      L.marker([point.lat, point.lon]).addTo(map).bindPopup(point.name);
    });
  }
</script>
</body>
</html>
`);
});

// 🚀 Lancement du serveur
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`✅ Serveur lancé sur le port ${port}`);
});
