#!/usr/bin/env bash
# Install yt-dlp in Render's writable directory
mkdir -p /opt/render/.local/bin
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /opt/render/.local/bin/yt-dlp
chmod a+rx /opt/render/.local/bin/yt-dlp

# Regular build commands
npm install
