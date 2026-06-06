import express from "express";
import path from "path";
import fs from "fs";
import { spawn } from "child_process";
import ffmpegStatic from "ffmpeg-static";
import { createServer as createViteServer } from "vite";
import { rimraf } from "rimraf";

// Store conversion logs globally (taskId -> logs)
const conversionLogs = new Map<string, string[]>();

// yt-dlp configuration
const YT_DLP_URL = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp";
const YT_DLP_PATH = path.join(process.cwd(), "yt-dlp");
const DOWNLOADS_DIR = path.join(process.cwd(), "downloads");

// Ensure downloads directory exists
if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

async function downloadYtDlp() {
  if (fs.existsSync(YT_DLP_PATH)) {
    console.log("yt-dlp already exists.");
    return;
  }
  
  console.log("Downloading yt-dlp binary...");
  const response = await fetch(YT_DLP_URL);
  
  if (!response.ok) {
    throw new Error(`Failed to download yt-dlp: ${response.statusText}`);
  }
  
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  
  fs.writeFileSync(YT_DLP_PATH, buffer);
  fs.chmodSync(YT_DLP_PATH, 0o755); // Make it executable
  console.log("yt-dlp downloaded and made executable.");
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Real-time logs endpoint
  app.get("/api/logs", (req, res) => {
    const taskId = req.query.taskId as string;
    if (!taskId) return res.json({ logs: [] });
    return res.json({ logs: conversionLogs.get(taskId) || [] });
  });

  // Background initialization of yt-dlp
  downloadYtDlp().catch(console.error);

  // API Route to download MP3
  app.get("/api/download", async (req, res) => {
    try {
      const url = req.query.url;
      if (!url || typeof url !== "string") {
        return res.status(400).json({ error: "No URL provided." });
      }

      // Check if yt-dlp is ready
      if (!fs.existsSync(YT_DLP_PATH)) {
        return res.status(503).json({ error: "Server is initializing download tools. Try again in a few seconds." });
      }

      // Generate a unique ID for this download task
      const trackId = (req.query.taskId as string) || Math.random().toString(36).substring(7);
      const outputFileTemplate = path.join(DOWNLOADS_DIR, `%(title)s-[${trackId}].%(ext)s`);
      
      console.log(`Starting yt-dlp for url: ${url} tracking ID: ${trackId}`);
      conversionLogs.set(trackId, [`Initialized download task ${trackId}`, `Target URL: ${url}`]);
      
      // Execute yt-dlp
      // Using arguments explicitly from user: -x --audio-format mp3 --audio-quality 128K
      // Also specifying ffmpeg location to avoid "ffmpeg not found"
      const args = [
        "-x",
        "--audio-format", "mp3",
        "--audio-quality", "128K",
        "--ffmpeg-location", ffmpegStatic || "",
        "--js-runtimes", "node:/usr/local/bin/node",
        "--extractor-args", "youtube:player_client=ios,android", 
        "-o", outputFileTemplate,
        url
      ];

      // Execute command using spawn so we can capture stdout/stderr in real-time
      await new Promise((resolve, reject) => {
        const ytProcess = spawn(YT_DLP_PATH, args);
        
        ytProcess.stdout.on('data', (data) => {
          const text = data.toString();
          const lines = text.split('\n').filter((l: string) => l.trim().length > 0);
          conversionLogs.get(trackId)?.push(...lines);
          if (lines.length > 0) console.log(`[${trackId}] ${lines[0]}`);
        });
        
        ytProcess.stderr.on('data', (data) => {
          const text = data.toString();
          const lines = text.split('\n').filter((l: string) => l.trim().length > 0);
          conversionLogs.get(trackId)?.push(...lines);
          if (lines.length > 0) console.error(`[${trackId}] ${lines[0]}`);
        });
        
        ytProcess.on('close', (code) => {
          if (code === 0) {
            conversionLogs.get(trackId)?.push(`Process finished successfully.`);
            resolve(code);
          } else {
            const errMsg = `yt-dlp wrapper process exited with code ${code}`;
            conversionLogs.get(trackId)?.push(`ERROR: ${errMsg}`);
            reject(new Error(errMsg));
          }
        });
        
        ytProcess.on('error', (err) => {
          conversionLogs.get(trackId)?.push(`ERROR launching process: ${err.message}`);
          reject(err);
        });
      });

      // yt-dlp has finished, let's find the resulting mp3 file
      const files = fs.readdirSync(DOWNLOADS_DIR);
      const downloadedFile = files.find(f => f.includes(`[${trackId}]`) && f.endsWith(".mp3"));

      if (!downloadedFile) {
        throw new Error("Download completed but MP3 file not found.");
      }

      const filePath = path.join(DOWNLOADS_DIR, downloadedFile);

      // Original filename to send to client (remove the track ID part to keep it clean)
      // e.g. "My Video Title-[abc1234].mp3" -> "My Video Title.mp3"
      const clientFileName = downloadedFile.replace(`-[${trackId}]`, '');

      // Send the file to the client
      res.download(filePath, clientFileName, async (err) => {
        if (err) {
          console.error("Error sending file:", err);
        }
        // Cleanup after sending
        try {
          if (fs.existsSync(filePath)) {
             fs.unlinkSync(filePath);
          }
        } catch (cleanupErr) {
          console.error("Error cleaning up file:", cleanupErr);
        }
      });

    } catch (error: any) {
      console.error("Download Error:", error);
      res.status(500).json({ error: "Failed to download and convert the video.", details: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Production static serving
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
