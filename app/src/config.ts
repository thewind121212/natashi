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
} as const;
