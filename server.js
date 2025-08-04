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

// 🌍 Fonction pour géolocaliser une ville via Nominatim
async function getCoordinatesForCity(city) {
  try {
    const response = await axios.get("https://nominatim.openstreetmap.org/search", {
      params: {
        q: city,
        format: "json",
        limit: 1,
      },
      headers: {
        "User-Agent": "guide-voyage-app"
      }
    });

    if (response.data && response.data.length > 0) {
      const result = response.data[0];
      return {
        lat: parseFloat(result.lat),
        lon: parseFloat(result.lon),
        city
      };
    } else {
      console.warn("❗ Ville non trouvée:", city);
      return null;
    }

  } catch (error) {
    console.error("🌍 Erreur géoloc pour", city, error.message);
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
  const cityNames = new Set();

  $("h3").each((_, el) => {
    const text = $(el).text();
    const match = text.match(/–\s*(.+)/); // ex: "Jour 1 – Tokyo"
    if (match) cityNames.add(match[1].trim());
  });

  const coordinates = [];
  for (const city of cityNames) {
    await new Promise(r => setTimeout(r, 1000)); // éviter throttling
    const coords = await getCoordinatesForCity(city);
    if (coords) coordinates.push(coords);
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
  res.send(`✅ Guide enregistré avec géolocalisation pour l'ID ${id}`);
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

  const mapSection = coordinates && coordinates.length
    ? `
    <div id="map" style="height: 400px; margin: 2rem 0; border-radius: 12px;"></div>
    <script>
      const coords = ${JSON.stringify(coordinates)};
      const map = L.map('map').setView([coords[0].lat, coords[0].lon], 6);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
      }).addTo(map);
      coords.forEach(c => {
        L.marker([c.lat, c.lon]).addTo(map).bindPopup(c.city);
      });
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
  </style>
</head>
<body>
${content}
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
