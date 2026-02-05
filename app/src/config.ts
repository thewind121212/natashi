// App configuration - loads from environment variables

export const config = {
  // Discord bot (optional - only needed for Discord features)
  botToken: process.env.BOT_TOKEN ?? '',
  guildId: process.env.GUILD_ID ?? '',

  // Go API connection
  goApiPort: process.env.GO_API_PORT ?? '8180',
  socketPath: process.env.SOCKET_PATH ?? '/tmp/music-playground.sock',

  // Debug mode
  debugAudio: process.env.DEBUG_AUDIO === '1',

  // Discord OAuth2
  discordClientId: process.env.DISCORD_CLIENT_ID ?? '',
  discordClientSecret: process.env.DISCORD_CLIENT_SECRET ?? '',
  discordRedirectUri: process.env.DISCORD_REDIRECT_URI ?? 'http://localhost:3000/auth/callback',

  // JWT
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-in-production',

  // Access control - comma-separated Discord user IDs (empty = allow all)
  // Supports both ALLOWED_DISCORD_IDS and ALLOWED_DISCORD_ID
  allowedDiscordIds: (process.env.ALLOWED_DISCORD_IDS || process.env.ALLOWED_DISCORD_ID)?.split(',').map((id) => id.trim()).filter(Boolean) ?? [],
} as const;
