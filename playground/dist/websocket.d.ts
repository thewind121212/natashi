import { Server as HttpServer } from 'http';
export declare class WebSocketHandler {
    private wss;
    private socketClient;
    private apiClient;
    private audioPlayer;
    private queueManager;
    private clients;
    private currentSessionId;
    private bytesReceived;
    private debugMode;
    private isPaused;
    private isStreamReady;
    constructor(server: HttpServer);
    private log;
    private setupWebSocket;
    private setupAudioPlayer;
    private setupQueueManager;
    connect(): Promise<void>;
    private resetPlaybackState;
    private playTrack;
    private handleGoEvent;
    private handleBrowserMessage;
    private broadcastJson;
    private extractVideoId;
    isConnected(): boolean;
}
//# sourceMappingURL=websocket.d.ts.map