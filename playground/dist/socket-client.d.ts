import { EventEmitter } from 'events';
export interface Event {
    type: 'ready' | 'error' | 'finished';
    session_id: string;
    duration?: number;
    message?: string;
}
export declare class SocketClient extends EventEmitter {
    private socket;
    private connected;
    private buffer;
    private readingAudio;
    private audioLength;
    connect(): Promise<void>;
    private handleData;
    private processBuffer;
    disconnect(): void;
    isConnected(): boolean;
}
//# sourceMappingURL=socket-client.d.ts.map