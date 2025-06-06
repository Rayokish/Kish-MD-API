# Kish-MD API

An API providing music download, video download, and AI chat functionalities using various external APIs.

## Setup

1. Clone the repo
2. Run `npm install`
3. Create `.env` file from `.env.example` and add your API keys
4. Run `npm start` to start the server

## API Endpoints

- `GET /play?text=songname` — Simulate download MP3 by song name
- `POST /gpt` — Chat with Gemini AI (send JSON body `{ "prompt": "your question" }`)
- `GET /tiktok?url=video_url` — Download TikTok video info
- `GET /facebook?url=video_url` — Download Facebook video info
- `GET /youtube?url=video_url` — Download YouTube video info
- `GET /lyrics?text=songname` — Fetch song lyrics

## Notes

- Requires Maher Zubair API key and Gemini API key in `.env` file
- This is a basic API server meant for educational/demo use

## License

MIT