const express = require("express");
const bodyParser = require("body-parser");
const low = require("lowdb");
const FileSync = require("lowdb/adapters/FileSync");
const axios = require("axios");
const path = require("path");

const app = express();
app.use(bodyParser.text({ type: "*/*" }));

// Base de données LowDB
const adapter = new FileSync("db.json");
const db = low(adapter);

// Initialisation des données
if (!db.has("guides").value()) {
  db.set("guides", {}).write();
}

// 🔧 Fonction pour obtenir une image depuis l'API Unsplash
async function getImageForCity(city) {
  try {
    const response = await axios.get("https://source.unsplash.com/800x400/?" + encodeURIComponent(city));
    return response.request.res.responseUrl;
  } catch (error) {
    console.error("Erreur de récupération d’image pour", city);
    return null;
  }
}

// ✅ Route d’accueil — sert index.html personnalisé
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Route POST pour enregistrer un guide
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
  for (const city of cities) {
    const img = await getImageForCity(city);
    if (img) {
      cityImages[city] = img;
    }
  }

  db.set(`guides.${id}`, { content, cityImages }).write();

  res.send(`✅ Guide enregistré avec images pour l'ID ${id}`);
});

// Route GET pour afficher un guide
app.get("/:id", (req, res) => {
  const id = req.params.id;
  const guideData = db.get(`guides.${id}`).value();

  if (!guideData) {
    res.status(404).send("Aucun guide trouvé pour cet ID.");
    return;
  }

  const { content, cityImages } = guideData;

  let renderedContent = content.replace(/^(#{2,3})\s*(.+)$/gm, (match, hashes, city) => {
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
<button onclick="window.print()">Exporter en PDF</button>
</body>
</html>
`);
});

// Démarrage du serveur
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`✅ Serveur lancé sur le port ${port}`);
});