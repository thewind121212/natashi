import express, { Express, Request, Response } from 'express';
import * as path from 'path';
import { ApiClient } from './api-client';

const PORT = 3000;

export function createServer(): Express {
  const app = express();
  const apiClient = new ApiClient();

  // Parse JSON body
  app.use(express.json());

  // Serve static files from public directory
  app.use(express.static(path.join(__dirname, '../public')));

  // Health check endpoint
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // === Session Control Endpoints (proxy to Go API) ===

  // Play - start a session
  app.post('/api/session/:id/play', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { url, format } = req.body;

      if (!url) {
        res.status(400).json({ status: 'error', message: 'url is required' });
        return;
      }

      console.log(`[API] Play: session=${id} url=${url}`);
      const result = await apiClient.play(id, url, format || 'pcm');
      res.json(result);
    } catch (err) {
      console.error('[API] Play error:', err);
      res.status(500).json({ status: 'error', message: String(err) });
    }
  });

  // Stop - stop a session
  app.post('/api/session/:id/stop', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      console.log(`[API] Stop: session=${id}`);
      const result = await apiClient.stop(id);
      res.json(result);
    } catch (err) {
      console.error('[API] Stop error:', err);
      res.status(500).json({ status: 'error', message: String(err) });
    }
  });

  // Pause - pause a session
  app.post('/api/session/:id/pause', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      console.log(`[API] Pause: session=${id}`);
      const result = await apiClient.pause(id);
      res.json(result);
    } catch (err) {
      console.error('[API] Pause error:', err);
      res.status(500).json({ status: 'error', message: String(err) });
    }
  });

  // Resume - resume a session
  app.post('/api/session/:id/resume', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      console.log(`[API] Resume: session=${id}`);
      const result = await apiClient.resume(id);
      res.json(result);
    } catch (err) {
      console.error('[API] Resume error:', err);
      res.status(500).json({ status: 'error', message: String(err) });
    }
  });

  // Status - get session status
  app.get('/api/session/:id/status', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const result = await apiClient.status(id);
      res.json(result);
    } catch (err) {
      console.error('[API] Status error:', err);
      res.status(500).json({ status: 'error', message: String(err) });
    }
  });

  // Go API health check
  app.get('/api/go/health', async (_req: Request, res: Response) => {
    try {
      const result = await apiClient.health();
      res.json(result);
    } catch (err) {
      res.status(503).json({ status: 'error', message: 'Go API unavailable' });
    }
  });

  return app;
}

export function startServer(app: Express): Promise<void> {
  return new Promise((resolve) => {
    app.listen(PORT, () => {
      console.log(`[Server] Listening on http://localhost:${PORT}`);
      resolve();
    });
  });
}
