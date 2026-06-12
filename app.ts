import express from "express";
import path from "path";
import fs from "fs";
import os from "os";
import { spawn } from "child_process";
import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import { rimraf } from "rimraf";

// Export the app for serverless environments (like Vercel)
export const app = express();

// Store conversion logs globally (taskId -> logs)
const conversionLogs = new Map<string, string[]>();

// yt-dlp configuration
// On serverless environments like Vercel, only /tmp is writable
const tmpDir = os.tmpdir();
const YT_DLP_URL = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux";
const YT_DLP_PATH = path.join(tmpDir, "yt-dlp_linux");
const DOWNLOADS_DIR = path.join(tmpDir, "downloads");
const FFMPEG_DIR = path.join(tmpDir, "ffmpeg-bin");

// Ensure directories exist
if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
if (!fs.existsSync(FFMPEG_DIR)) fs.mkdirSync(FFMPEG_DIR, { recursive: true });

// Setup symlinks so yt-dlp finds both ffmpeg and ffprobe in one directory
try {
  if (ffmpegStatic && !fs.existsSync(path.join(FFMPEG_DIR, "ffmpeg"))) {
    fs.symlinkSync(ffmpegStatic, path.join(FFMPEG_DIR, "ffmpeg"));
  }
  if (ffprobeStatic.path && !fs.existsSync(path.join(FFMPEG_DIR, "ffprobe"))) {
    fs.symlinkSync(ffprobeStatic.path, path.join(FFMPEG_DIR, "ffprobe"));
  }
} catch (err) {
  // ignore symlink errors
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

const PORT = 3000;

app.use(express.json());

// Real-time logs endpoint
app.get("/api/logs", (req, res) => {
  const taskId = req.query.taskId as string;
  if (!taskId) return res.json({ logs: [] });
  const logs = conversionLogs.get(taskId) || [];
  return res.json({ logs: logs.slice(-100) });
});

let downloadPromise: Promise<void> | null = null;
async function ensureYtDlp() {
  if (fs.existsSync(YT_DLP_PATH)) {
    return;
  }
  if (!downloadPromise) {
    downloadPromise = downloadYtDlp().finally(() => { downloadPromise = null; });
  }
  return downloadPromise;
}

// Background initialization of yt-dlp
ensureYtDlp().catch(console.error);

// API Route to process the video (yt-dlp)
app.get("/api/download", async (req, res) => {
    try {
      const url = req.query.url;
      if (!url || typeof url !== "string") {
        return res.status(400).json({ error: "No URL provided." });
      }

      // Generate a unique ID for this download task
      const trackId = (req.query.taskId as string) || Math.random().toString(36).substring(7);

      if (!conversionLogs.has(trackId)) {
        conversionLogs.set(trackId, []);
      }

      // Check if yt-dlp is ready, if not, wait for it
      if (!fs.existsSync(YT_DLP_PATH)) {
        conversionLogs.get(trackId)?.push("Downloading required extraction tools (first time setup)...");
        await ensureYtDlp();
        conversionLogs.get(trackId)?.push("Tools initialization complete.");
      }

      const outputFileTemplate = path.join(DOWNLOADS_DIR, `%(title)s-[${trackId}].%(ext)s`);
      
      // Get download preferences
      const type = (req.query.type as string) || 'audio';
      const formatParam = (req.query.format as string) || 'mp4';
      const qualityParam = (req.query.quality as string) || '1080';

      // Ensure yt-dlp has finished, let's find the resulting file
      const findDownloadedFile = () => {
        const files = fs.readdirSync(DOWNLOADS_DIR);
        // We look for any file containing our trackId, since extensions can vary (mp3, mp4, webm)
        return files.find(f => f.includes(`[${trackId}]`));
      };
      
      // Cleanup any pre-existing files for this trackId just to be safe
      const existingFile = findDownloadedFile();
      if (existingFile) {
        fs.unlinkSync(path.join(DOWNLOADS_DIR, existingFile));
      }

      console.log(`Starting yt-dlp for url: ${url} tracking ID: ${trackId} type: ${type}`);
      conversionLogs.set(trackId, [`Initialized download task ${trackId}`, `Target URL: ${url}`, `Type: ${type}`]);
      
      // Handle Cookies
      let cookieArgs: string[] = [];
      const tmpCookiesPath = path.join(tmpDir, "cookies.txt");
      const rootCookiesPath = path.join(process.cwd(), "cookies.txt");
      
      if (fs.existsSync(rootCookiesPath)) {
        // If user uploaded cookies.txt to project root
        cookieArgs = ["--cookies", rootCookiesPath];
        conversionLogs.get(trackId)?.push(`Using authentication cookies from project root 'cookies.txt'.`);
      } else if (process.env.YOUTUBE_COOKIES) {
        // If passed via environment variable (useful for Vercel, but formatting can break)
        // Fix potential newline issues where literal \n was pasted
        const formattedCookies = process.env.YOUTUBE_COOKIES.replace(/\\n/g, '\n');
        fs.writeFileSync(tmpCookiesPath, formattedCookies);
        cookieArgs = ["--cookies", tmpCookiesPath];
        conversionLogs.get(trackId)?.push(`Using authentication cookies from environment variable.`);
      } else {
        conversionLogs.get(trackId)?.push(`Warning: No cookies found. YouTube might block the download.`);
      }

      // If we use cookies from a desktop browser, override player clients that would trigger bot flags
      let extractorArgs = ["--extractor-args", "youtube:player_client=ios,tv"];
      if (cookieArgs.length > 0) {
        // We use default web client if desktop cookies are provided, or android_creator
        extractorArgs = ["--extractor-args", "youtube:player_client=web,default"];
        conversionLogs.get(trackId)?.push(`Switched to desktop player clients to match cookies.`);
      }

      // Execute yt-dlp
      // Also specifying ffmpeg location to avoid "ffmpeg not found"
      let modeArgs: string[] = [];
      
      if (type === 'audio') {
        // Keep EXACT audio arguments from the previous versions!
        modeArgs = [
          "-x",
          "--audio-format", "mp3",
          "--audio-quality", "128K"
        ];
      } else {
        // Video mode arguments
        const safeFormat = formatParam === 'webm' ? 'webm' : 'mp4';
        let formatString = 'bestvideo+bestaudio/best';
        let sortArgs: string[] = [];
        
        if (qualityParam === '1080') {
           formatString = `bv*[height<=1080]+ba/b`;
        } else if (qualityParam === '720') {
           formatString = `bv*[height<=720]+ba/b`;
        }

        // To prevent slow ffmpeg transcoding on Cloud Run, we prefer codecs 
        // that natively match the requested container format.
        // We put "res" first so it doesn't choose a lower resolution just to get the codec.
        if (safeFormat === 'mp4') {
          sortArgs = ["-S", "res,vcodec:h264,acodec:m4a"];
        } else {
          sortArgs = ["-S", "res,vcodec:vp9,acodec:opus"];
        }

        modeArgs = [
          "-f", formatString,
          ...sortArgs,
          "--merge-output-format", safeFormat,
          "--concurrent-fragments", "4"
        ];
      }

      const args = [
        ...modeArgs,
        "--no-playlist",
        "--ffmpeg-location", FFMPEG_DIR,
        "--js-runtimes", `node:${process.execPath}`,
        ...extractorArgs, 
        ...cookieArgs,
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

      // yt-dlp has finished, let's find the resulting file
      const downloadedFile = findDownloadedFile();

      if (!downloadedFile) {
        throw new Error("Download completed but resulting file not found.");
      }

      const filePath = path.join(DOWNLOADS_DIR, downloadedFile);

      // Original filename to send to client (remove the track ID part to keep it clean)
      // e.g. "My Video Title-[abc1234].mp3" -> "My Video Title.mp3"
      const clientFileName = downloadedFile.replace(`-[${trackId}]`, '');

      // Send the file directly to the client
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
      conversionLogs.get(trackId)?.push(`ERROR: Failed to download and convert the video.`);
      res.status(500).json({ error: "Failed to download and convert the video.", details: error.message });
    }
  });

  export default app;
