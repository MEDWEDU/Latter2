import { io, Socket } from 'socket.io-client';
import { tokenStorage } from './apiClient';

const getSocketUrl = (): string => {
  const env = import.meta.env as unknown as {
    VITE_API_URL?: string;
    VITE_API_BASE_URL?: string;
    DEV?: boolean;
  };

  const configured = env.VITE_API_URL || env.VITE_API_BASE_URL;
  const base = (configured || 'http://localhost:5000').replace(/\/$/, '');
  
  return base.replace('/api', '');
};

class SocketManager {
  private socket: Socket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private isIntentionalDisconnect = false;

  public connect(): Socket {
    if (this.socket?.connected) {
      return this.socket;
    }

    const token = tokenStorage.getAccessToken();
    if (!token) {
      throw new Error('No authentication token available');
    }

    this.isIntentionalDisconnect = false;

    this.socket = io(getSocketUrl(), {
      auth: {
        token,
      },
      query: {
        token,
      },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: this.maxReconnectAttempts,
      reconnectionDelay: this.reconnectDelay,
      reconnectionDelayMax: 5000,
      timeout: 10000,
    });

    this.setupEventHandlers();

    return this.socket;
  }

  private setupEventHandlers(): void {
    if (!this.socket) return;

    this.socket.on('connect', () => {
      console.log('✅ Socket.io connected:', this.socket?.id);
      this.reconnectAttempts = 0;
    });

    this.socket.on('disconnect', (reason) => {
      console.log('❌ Socket.io disconnected:', reason);
      
      if (reason === 'io server disconnect' && !this.isIntentionalDisconnect) {
        setTimeout(() => {
          this.connect();
        }, this.reconnectDelay);
      }
    });

    this.socket.on('connect_error', (error) => {
      console.error('Socket.io connection error:', error);
      this.reconnectAttempts++;
      
      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        console.error('Max reconnection attempts reached');
        this.disconnect();
      }
    });

    this.socket.on('error', (error) => {
      console.error('Socket.io error:', error);
    });

    this.socket.on('reconnect', (attemptNumber) => {
      console.log('🔄 Socket.io reconnected after', attemptNumber, 'attempts');
      this.reconnectAttempts = 0;
    });

    this.socket.on('reconnect_attempt', (attemptNumber) => {
      console.log('🔄 Socket.io reconnection attempt:', attemptNumber);
    });

    this.socket.on('reconnect_error', (error) => {
      console.error('Socket.io reconnection error:', error);
    });

    this.socket.on('reconnect_failed', () => {
      console.error('Socket.io reconnection failed');
    });
  }

  public disconnect(): void {
    if (this.socket) {
      this.isIntentionalDisconnect = true;
      this.socket.disconnect();
      this.socket = null;
    }
  }

  public getSocket(): Socket | null {
    return this.socket;
  }

  public isConnected(): boolean {
    return this.socket?.connected ?? false;
  }

  public emit(event: string, data?: unknown): void {
    if (this.socket?.connected) {
      this.socket.emit(event, data);
    } else {
      console.warn('Socket not connected, cannot emit event:', event);
    }
  }

  public on(event: string, handler: (...args: unknown[]) => void): void {
    if (this.socket) {
      this.socket.on(event, handler);
    }
  }

  public off(event: string, handler?: (...args: unknown[]) => void): void {
    if (this.socket) {
      if (handler) {
        this.socket.off(event, handler);
      } else {
        this.socket.off(event);
      }
    }
  }
}

export const socketManager = new SocketManager();
export default socketManager;
