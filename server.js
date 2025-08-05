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

// 🌍 Fonction pour obtenir les coordonnées GPS d'une ville
async function getCoordinatesForCity(city) {
  try {
    const response = await axios.get("https://nominatim.openstreetmap.org/search", {
      params: {
        q: city,
        format: "json",
        addressdetails: 1,
        limit: 1
      },
      headers: {
        "User-Agent": "VoyageApp/1.0"
      }
    });

    if (response.data.length === 0) {
      console.warn("❌ Aucune coordonnée trouvée pour", city);
      return null;
    }

    const { lat, lon } = response.data[0];
    return { lat: parseFloat(lat), lon: parseFloat(lon), city };
  } catch (error) {
    console.error("Erreur géoloc:", city, error.message);
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

  const $ = cheerio.load(content);
  const cities = [];

  $("h3").each((_, el) => {
    const text = $(el).text();
    const match = text.match(/\u2013\s*(.+)$/); // extrait "Tokyo" de "Jour 1 – Tokyo"
    if (match) cities.push(match[1].trim());
  });

  const uniqueCities = [...new Set(cities)];
  const coordinates = [];

  for (const city of uniqueCities) {
    const coord = await getCoordinatesForCity(city);
    if (coord) coordinates.push(coord);
  }

  const { data, error } = await supabase
    .from("guides")
    .upsert({ id, content, coordinates })
    .select();

  if (error) {
    console.error("❌ Supabase upsert error:", error.message, error.details, error.hint);
    return res.status(500).send(`Erreur Supabase : ${error.message} — ${error.details || ""}`);
  }

  console.log("✅ Guide enregistré avec coordonnées :", coordinates);
  res.send(`✅ Guide enregistré avec ${coordinates.length} villes géolocalisées pour l'ID ${id}`);
});

// 📄 Lecture du guide
app.get("/:id", async (req, res) => {
  const id = req.params.id;

  const { data, error } = await supabase
    .from("guides")
    .select("content, coordinates")
    .eq("id", id)
    .single();

  if (error || !data) {
    return res.status(404).send("Aucun guide trouvé pour cet ID.");
  }

  const { content, coordinates } = data;

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
      margin: 2rem 0;
      border-radius: 12px;
    }
    .map-number {
      background-color: #1a73e8;
      color: white;
      font-weight: bold;
      border-radius: 50%;
      text-align: center;
      width: 24px;
      height: 24px;
      line-height: 24px;
      font-size: 14px;
      border: 2px solid white;
      box-shadow: 0 2px 6px rgba(0,0,0,0.2);
    }
  </style>
</head>
<body>
${content}

${coordinates && coordinates.length ? `
  <h2>🗺️ Carte interactive</h2>
  <div id="map"></div>
  <script src="https://unpkg.com/leaflet/dist/leaflet.js"></script>
  <script>
    window.addEventListener("load", () => {
      const coords = ${JSON.stringify(coordinates)};
      if (!coords.length) return;

      const map = L.map('map').setView([coords[0].lat, coords[0].lon], 6);

      L.tileLayer('https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap France | Données © contributeurs OpenStreetMap',
        maxZoom: 19
      }).addTo(map);

      const latlngs = [];

      coords.forEach((c, index) => {
        L.marker([c.lat, c.lon])
          .addTo(map)
          .bindPopup("<strong>Étape " + (index + 1) + "</strong><br />" + c.city);

        L.circleMarker([c.lat, c.lon], {
          radius: 12,
          fillColor: "#1a73e8",
          fillOpacity: 0.8,
          color: "#fff",
          weight: 2
        }).addTo(map)
          .bindTooltip(`${index + 1}`, { permanent: true, direction: "center", className: "map-number" });

        latlngs.push([c.lat, c.lon]);
      });

      L.polyline(latlngs, {
        color: "#1a73e8",
        weight: 4,
        opacity: 0.7,
        lineJoin: "round"
      }).addTo(map);
    });
  </script>
` : `<p><em>Aucune donnée géographique disponible pour ce guide.</em></p>`}

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
