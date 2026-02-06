// HTTP client for Go Gin API (control commands)

const GO_API_PORT = process.env.GO_API_PORT || '8180';
const API_BASE = `http://localhost:${GO_API_PORT}`;

export interface PlayRequest {
  url: string;
  format?: 'pcm' | 'opus' | 'web';
  start_at?: number;
}

export interface ApiResponse {
  status: string;
  session_id: string;
  message?: string;
}

export interface StatusResponse {
  session_id: string;
  status: string;
  bytes_sent: number;
  url?: string;
}

export interface MetadataResponse {
  url: string;
  title: string;
  duration: number;
  thumbnail: string;
  is_playlist: boolean;
  error?: string;
}

export interface PlaylistEntry {
  url: string;
  title: string;
  duration: number;
  thumbnail: string;
}

export interface PlaylistResponse {
  url: string;
  count: number;
  entries: PlaylistEntry[];
  error?: string;
}

export interface SearchResult {
  id: string;
  url: string;
  title: string;
  duration: number;
  thumbnail: string;
  channel: string;
}

export interface SearchResponse {
  query: string;
  count: number;
  results: SearchResult[];
  error?: string;
}

export class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE) {
    this.baseUrl = baseUrl;
  }

  async play(sessionId: string, url: string, format: string = 'pcm', startAt?: number): Promise<ApiResponse> {
    const response = await fetch(`${this.baseUrl}/session/${sessionId}/play`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, format, start_at: startAt }),
    });
    return response.json() as Promise<ApiResponse>;
  }

  async stop(sessionId: string): Promise<ApiResponse> {
    const response = await fetch(`${this.baseUrl}/session/${sessionId}/stop`, {
      method: 'POST',
    });
    return response.json() as Promise<ApiResponse>;
  }

  async pause(sessionId: string): Promise<ApiResponse> {
    const response = await fetch(`${this.baseUrl}/session/${sessionId}/pause`, {
      method: 'POST',
    });
    return response.json() as Promise<ApiResponse>;
  }

  async resume(sessionId: string): Promise<ApiResponse> {
    const response = await fetch(`${this.baseUrl}/session/${sessionId}/resume`, {
      method: 'POST',
    });
    return response.json() as Promise<ApiResponse>;
  }

  async status(sessionId: string): Promise<StatusResponse> {
    const response = await fetch(`${this.baseUrl}/session/${sessionId}/status`, {
      method: 'GET',
    });
    return response.json() as Promise<StatusResponse>;
  }

  async health(): Promise<{ status: string }> {
    const response = await fetch(`${this.baseUrl}/health`);
    return response.json() as Promise<{ status: string }>;
  }

  async getMetadata(url: string): Promise<MetadataResponse> {
    const response = await fetch(`${this.baseUrl}/metadata?url=${encodeURIComponent(url)}`);
    return response.json() as Promise<MetadataResponse>;
  }

  async getPlaylist(url: string): Promise<PlaylistResponse> {
    const response = await fetch(`${this.baseUrl}/playlist?url=${encodeURIComponent(url)}`);
    return response.json() as Promise<PlaylistResponse>;
  }

  async search(query: string): Promise<SearchResponse> {
    const response = await fetch(`${this.baseUrl}/search?q=${encodeURIComponent(query)}`);
    return response.json() as Promise<SearchResponse>;
  }
}
