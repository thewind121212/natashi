// Bot Controller REST API Router
// Authenticated endpoints that control Discord bot playback in guilds

import { Router, Request, Response, NextFunction } from 'express';
import { Client } from 'discord.js';
import { verifyToken } from '../auth/jwt';
import { config } from '../config';
import {
  botPause,
  botResume,
  botSkip,
  botPrevious,
  botSeek,
  botJump,
  botStop,
  botPlay,
  botSearch,
  botRemoveFromQueue,
  botClearQueue,
  getActiveGuilds,
  getGuildState,
  setDiscordClient,
} from './bot-actions';

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.auth;
  if (!token) {
    res.status(401).json({ success: false, error: 'Not authenticated' });
    return;
  }

  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ success: false, error: 'Invalid token' });
    return;
  }

  if (config.allowedDiscordIds.length > 0 && !config.allowedDiscordIds.includes(payload.sub)) {
    res.status(403).json({ success: false, error: 'Not authorized' });
    return;
  }

  (req as any).user = payload;
  next();
}

export function createBotRouter(getClient: () => Client | null): Router {
  const router = Router();
  router.use(requireAuth);

  // Keep bot-actions in sync with the Discord client
  function withClient(res: Response): Client | null {
    const client = getClient();
    setDiscordClient(client);
    if (!client) {
      res.status(503).json({ success: false, error: 'Discord bot not connected' });
      return null;
    }
    return client;
  }

  router.get('/guilds', (_req: Request, res: Response) => {
    const client = withClient(res);
    if (!client) return;
    res.json({ guilds: getActiveGuilds(client) });
  });

  router.get('/search', async (req: Request, res: Response) => {
    const q = req.query.q as string;
    if (!q || typeof q !== 'string' || q.trim().length === 0) {
      res.status(400).json({ success: false, error: 'query parameter q is required' });
      return;
    }
    const result = await botSearch(q.trim());
    res.status(result.success ? 200 : 400).json(result);
  });

  router.get('/guild/:guildId/state', (req: Request, res: Response) => {
    const client = withClient(res);
    if (!client) return;
    const state = getGuildState(req.params.guildId, client);
    if (!state) {
      res.status(404).json({ success: false, error: 'Guild not found or bot not active' });
      return;
    }
    res.json(state);
  });

  router.post('/guild/:guildId/play', async (req: Request, res: Response) => {
    const { url } = req.body;
    if (!url || typeof url !== 'string') {
      res.status(400).json({ success: false, error: 'url is required' });
      return;
    }
    const { channelId } = req.body;
    const result = await botPlay(req.params.guildId, url, channelId);
    res.status(result.success ? 200 : 400).json(result);
  });

  router.post('/guild/:guildId/pause', async (req: Request, res: Response) => {
    const result = await botPause(req.params.guildId);
    res.status(result.success ? 200 : 400).json(result);
  });

  router.post('/guild/:guildId/resume', async (req: Request, res: Response) => {
    const result = await botResume(req.params.guildId);
    res.status(result.success ? 200 : 400).json(result);
  });

  router.post('/guild/:guildId/skip', async (req: Request, res: Response) => {
    const { channelId } = req.body;
    const result = await botSkip(req.params.guildId, channelId);
    res.status(result.success ? 200 : 400).json(result);
  });

  router.post('/guild/:guildId/previous', async (req: Request, res: Response) => {
    const { channelId } = req.body;
    const result = await botPrevious(req.params.guildId, channelId);
    res.status(result.success ? 200 : 400).json(result);
  });

  router.post('/guild/:guildId/seek', async (req: Request, res: Response) => {
    const { position } = req.body;
    if (typeof position !== 'number' || position < 0) {
      res.status(400).json({ success: false, error: 'position (number, seconds) is required' });
      return;
    }
    const { channelId } = req.body;
    const result = await botSeek(req.params.guildId, position, channelId);
    res.status(result.success ? 200 : 400).json(result);
  });

  router.post('/guild/:guildId/jump', async (req: Request, res: Response) => {
    const { index } = req.body;
    if (typeof index !== 'number' || index < 0) {
      res.status(400).json({ success: false, error: 'index (number, 0-based) is required' });
      return;
    }
    const { channelId } = req.body;
    const result = await botJump(req.params.guildId, index, channelId);
    res.status(result.success ? 200 : 400).json(result);
  });

  router.post('/guild/:guildId/stop', async (req: Request, res: Response) => {
    const result = await botStop(req.params.guildId);
    res.status(result.success ? 200 : 400).json(result);
  });

  router.delete('/guild/:guildId/queue/:index', (req: Request, res: Response) => {
    const index = parseInt(req.params.index, 10);
    if (isNaN(index)) {
      res.status(400).json({ success: false, error: 'Invalid index' });
      return;
    }
    const result = botRemoveFromQueue(req.params.guildId, index);
    res.status(result.success ? 200 : 400).json(result);
  });

  router.delete('/guild/:guildId/queue', async (req: Request, res: Response) => {
    const result = await botClearQueue(req.params.guildId);
    res.status(result.success ? 200 : 400).json(result);
  });

  return router;
}
