require("dotenv").config();
const express = require("express");
const axios = require("axios");
const yts = require("yt-search");
const ytdl = require("ytdl-core");
const path = require("path");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const cors = require("cors");

const app = express();
const port = process.env.PORT || 8080;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// Routes
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({
  model: "gemini-1.5-flash",
  generationConfig: {
    temperature: 0.3,
    topP: 0.95,
    topK: 64,
    maxOutputTokens: 8192,
  },
});

// GPT Chat Endpoint
app.get("/gpt", async (req, res) => {
  const prompt = req.query.text;
  if (!prompt) return res.status(400).json({ error: "Prompt is required" });

  try {
    const chat = model.startChat({ history: [], generationConfig: {} });
    const result = await chat.sendMessage(prompt);
    const response = await result.response;
    res.json({ response: response.text() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch GPT response" });
  }
});

// YouTube Music Download Endpoint
app.get("/play", async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: "Missing query parameter" });

  try {
    const { videos } = await yts(query);
    if (!videos || !videos.length) {
      return res.status(404).json({ error: "No results found", query });
    }

    const url = videos[0].url;
    const info = await ytdl.getInfo(url);
    const title = sanitizeFilename(info.videoDetails.title);
    
    res.header('Content-Disposition', `attachment; filename="${title}.mp3"`);
    ytdl(url, {
      filter: 'audioonly',
      quality: 'highestaudio',
    }).pipe(res);
  } catch (e) {
    console.error("Download Error:", e);
    res.status(500).json({ error: e.message });
  }
});

// YouTube Video Download Endpoint
app.get("/youtube", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: "Missing YouTube URL" });

  try {
    const info = await ytdl.getInfo(url);
    const title = sanitizeFilename(info.videoDetails.title);
    
    res.header('Content-Disposition', `attachment; filename="${title}.mp4"`);
    ytdl(url, {
      quality: 'highest',
      filter: format => format.container === 'mp4',
    }).pipe(res);
  } catch (e) {
    console.error("Download Error:", e);
    res.status(500).json({ error: e.message });
  }
});

// TikTok Download Endpoint (Disabled - requires yt-dlp)
app.get("/tiktok", async (req, res) => {
  res.status(501).json({ 
    error: "TikTok downloads are currently unavailable. This endpoint requires yt-dlp to be installed on the server." 
  });
});

// Facebook Download Endpoint (Disabled - requires yt-dlp)
app.get("/facebook", async (req, res) => {
  res.status(501).json({ 
    error: "Facebook downloads are currently unavailable. This endpoint requires yt-dlp to be installed on the server." 
  });
});

// Lyrics Endpoint
app.get("/lyrics", async (req, res) => {
  const text = req.query.text;
  if (!text) return res.status(400).json({ error: "Missing song name" });

  try {
    const searchUrl = `https://genius.com/api/search/song?page=1&q=${encodeURIComponent(text)}`;
    const searchRes = await axios.get(searchUrl);
    const song = searchRes.data.response.sections[0].hits[0]?.result;

    if (!song) return res.status(404).json({ error: "Lyrics not found" });

    res.json({
      title: song.full_title,
      url: song.url,
      thumbnail: song.song_art_image_thumbnail_url
    });
  } catch (e) {
    console.error("Lyrics Error:", e);
    res.status(500).json({ error: e.message });
  }
});

// Helper function to sanitize filenames
function sanitizeFilename(filename) {
  return filename.replace(/[^\w\s.-]/gi, '').replace(/\s+/g, ' ').trim();
}

// Start server
app.listen(port, () => console.log(`✅ Server running on http://localhost:${port}`));
