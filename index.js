require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const yts = require("yt-search");
const ytdl = require("ytdl-core");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const util = require("util");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const cors = require("cors");

const execAsync = util.promisify(exec);
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
const genAI = new GoogleGenerativeAI("AIzaSyAuw9QCvV-MSYKGl1FLpDetJyKF7_5vj6s");
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

// Improved Play Endpoint (Audio Download)
app.get("/play", async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: "Please provide a song name" });

  try {
    const { videos } = await yts(query);
    if (!videos || !videos.length) {
      return res.status(404).json({ error: "No results found" });
    }

    const tempFile = `./temp_${Date.now()}.mp3`;
    await execAsync(`yt-dlp -x --audio-format mp3 -o "${tempFile}" ${videos[0].url}`);

    if (!fs.existsSync(tempFile)) throw new Error("Download failed");

    res.download(tempFile, `${videos[0].title}.mp3`, (err) => {
      if (err) console.error("Download Error:", err);
      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    });
  } catch (e) {
    console.error("Download Error:", e);
    res.status(500).json({ error: e.message });
  }
});

// Improved TikTok Download Endpoint
app.get("/tiktok", async (req, res) => {
  const url = req.query.url;
  if (!url || !url.includes('tiktok.com')) {
    return res.status(400).json({ error: "Please provide a valid TikTok URL" });
  }

  try {
    const tempFile = `./temp_tt_${Date.now()}.mp4`;
    await execAsync(`yt-dlp -f best -o "${tempFile}" "${url}"`);

    if (!fs.existsSync(tempFile)) throw new Error("Download failed");

    res.download(tempFile, `tiktok_${Date.now()}.mp4`, (err) => {
      if (err) console.error("Download Error:", err);
      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    });
  } catch (e) {
    console.error("TikTok Error:", e);
    res.status(500).json({ error: "TikTok download failed: " + e.message });
  }
});

// Improved Facebook Download Endpoint
app.get("/facebook", async (req, res) => {
  const url = req.query.url;
  if (!url || !url.includes('facebook.com')) {
    return res.status(400).json({ error: "Please provide a valid Facebook URL" });
  }

  try {
    const tempFile = `./temp_fb_${Date.now()}.mp4`;
    await execAsync(`yt-dlp -f best -o "${tempFile}" "${url}"`);

    if (!fs.existsSync(tempFile)) throw new Error("Download failed");

    res.download(tempFile, `facebook_${Date.now()}.mp4`, (err) => {
      if (err) console.error("Download Error:", err);
      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    });
  } catch (e) {
    console.error("Facebook Error:", e);
    res.status(500).json({ error: "Facebook download failed: " + e.message });
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

// Improved Lyrics Endpoint with full lyrics scraping
app.get("/lyrics", async (req, res) => {
  const query = req.query.text;
  if (!query) return res.status(400).json({ error: "Please provide a song name" });

  try {
    const searchUrl = `https://api.genius.com/search?q=${encodeURIComponent(query)}`;
    const searchRes = await axios.get(searchUrl, {
      headers: {
        Authorization: `Bearer tMYxCNuCOeGbhO6nBga9yXzIwQT1wKwtaxZQ9ziS9INcQGuVx3Y1pXR230JRFVCD`
      }
    });

    const hits = searchRes.data.response.hits;
    if (!hits.length) return res.status(404).json({ error: "No lyrics found" });

    const song = hits[0].result;
    const songPage = await axios.get(song.url);
    const $ = cheerio.load(songPage.data);

    let lyrics = '';
    $('div[data-lyrics-container="true"]').each((_, el) => {
      $(el).find('br').replaceWith('\n');
      lyrics += $(el).text().trim() + '\n\n';
    });

    lyrics = lyrics.trim();
    if (!lyrics) return res.status(404).json({ error: "Lyrics not found in song page." });

    res.json({
      title: song.title,
      artist: song.primary_artist.name,
      full_title: song.full_title,
      url: song.url,
      thumbnail: song.song_art_image_thumbnail_url,
      lyrics
    });
  } catch (err) {
    console.error("Genius API error:", err);
    res.status(500).json({ error: "Failed to fetch lyrics from Genius" });
  }
});

// Start server
app.listen(port, () => console.log(`✅ Server running on http://localhost:${port}`));
