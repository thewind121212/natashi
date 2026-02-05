import { config } from '../config';

const DISCORD_API_URL = 'https://discord.com/api/v10';
const DISCORD_OAUTH_URL = 'https://discord.com/oauth2/authorize';
const DISCORD_TOKEN_URL = 'https://discord.com/api/oauth2/token';

export interface DiscordUser {
  id: string;
  username: string;
  avatar: string | null;
  discriminator: string;
  global_name: string | null;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
}

export class DiscordOAuth {
  private clientId: string;
  private clientSecret: string;
  private redirectUri: string;
  private scopes: string[];

  constructor() {
    this.clientId = config.discordClientId;
    this.clientSecret = config.discordClientSecret;
    this.redirectUri = config.discordRedirectUri;
    this.scopes = ['identify'];
  }

  getAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: this.scopes.join(' '),
      state,
    });

    return `${DISCORD_OAUTH_URL}?${params.toString()}`;
  }

  async exchangeCode(code: string): Promise<TokenResponse> {
    const params = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.redirectUri,
    });

    const response = await fetch(DISCORD_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to exchange code: ${error}`);
    }

    return response.json() as Promise<TokenResponse>;
  }

  async getUser(accessToken: string): Promise<DiscordUser> {
    const response = await fetch(`${DISCORD_API_URL}/users/@me`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to get user: ${error}`);
    }

    return response.json() as Promise<DiscordUser>;
  }

  getAvatarUrl(user: DiscordUser): string | null {
    if (!user.avatar) return null;
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`;
  }
}

export const discordOAuth = new DiscordOAuth();
