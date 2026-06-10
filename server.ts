import app from "./app.js";
import express from "express";
import path from "path";

const PORT = 3000;

async function setupViteAndListen() {
  if (process.env.NODE_ENV !== "production") {
    // Only import vite dynamically here where it's safe from Vercel deployments!
    const { createServer: createViteServer } = await import("vite");
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

setupViteAndListen();
