import { Server as HttpServer } from 'http';
export declare class WebSocketHandler {
    private wss;
    private socketClient;
    private audioPlayer;
    private clients;
    private currentSessionId;
    private bytesReceived;
    private debugMode;
    constructor(server: HttpServer);
    private setupWebSocket;
    private setupAudioPlayer;
    connect(): Promise<void>;
    private handleGoEvent;
    private handleBrowserMessage;
    private broadcastJson;
    isConnected(): boolean;
}
//# sourceMappingURL=websocket.d.ts.map