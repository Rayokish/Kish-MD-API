require("dotenv").config();
const express = require("express");
const axios = require("axios");
const fs = require("fs");
const yts = require("yt-search");
const { exec } = require("child_process");
const util = require("util");
const path = require("path");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const execAsync = util.promisify(exec);
const app = express();
const port = process.env.PORT || 8080;

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

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

app.use(express.json());

app.post("/gpt", async (req, res) => {
  const prompt = req.body.prompt;
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

app.get("/play", async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: "Missing query parameter" });

  try {
    const { videos } = await yts(query);
    if (!videos.length) return res.status(404).json({ error: "No results found" });

    const tempFile = `./temp_${Date.now()}.mp3`;
    await execAsync(`yt-dlp -x --audio-format mp3 -o "${tempFile}" ${videos[0].url}`);

    if (!fs.existsSync(tempFile)) throw new Error("Download failed");

    res.download(tempFile, `${videos[0].title}.mp3`, () => fs.unlinkSync(tempFile));
  } catch (e) {
    console.error("Download Error:", e);
    res.status(500).json({ error: e.message });
  }
});

app.get("/youtube", async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: "Missing query parameter" });

  try {
    const { videos } = await yts(query);
    if (!videos.length) return res.status(404).json({ error: "No results found" });

    const tempFile = `./temp_${Date.now()}.mp3`;
    await execAsync(`yt-dlp -x --audio-format mp3 -o "${tempFile}" ${videos[0].url}`);

    if (!fs.existsSync(tempFile)) throw new Error("Download failed");

    res.download(tempFile, `${videos[0].title}.mp3`, () => fs.unlinkSync(tempFile));
  } catch (e) {
    console.error("Download Error:", e);
    res.status(500).json({ error: e.message });
  }
});

app.get("/tiktok", async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: "Missing TikTok URL" });

  try {
    const tempFile = `./temp_${Date.now()}.mp4`;
    await execAsync(`yt-dlp -o "${tempFile}" ${query}`);

    if (!fs.existsSync(tempFile)) throw new Error("Download failed");

    res.download(tempFile, `tiktok_${Date.now()}.mp4`, () => fs.unlinkSync(tempFile));
  } catch (e) {
    console.error("Download Error:", e);
    res.status(500).json({ error: e.message });
  }
});

app.get("/facebook", async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: "Missing Facebook URL" });

  try {
    const tempFile = `./temp_${Date.now()}.mp4`;
    await execAsync(`yt-dlp -o "${tempFile}" ${query}`);

    if (!fs.existsSync(tempFile)) throw new Error("Download failed");

    res.download(tempFile, `facebook_${Date.now()}.mp4`, () => fs.unlinkSync(tempFile));
  } catch (e) {
    console.error("Download Error:", e);
    res.status(500).json({ error: e.message });
  }
});

app.get("/lyrics", async (req, res) => {
  const text = req.query.q;
  if (!text) return res.status(400).json({ error: "Missing query" });

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

app.listen(port, () => console.log(`✅ Server running on http://localhost:${port}`));
