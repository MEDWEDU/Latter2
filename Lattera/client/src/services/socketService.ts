import { socketManager } from '../utils/socket';
import type { MessageResponse } from '../types/api';

export interface SocketUserStatus {
  userId: string;
  status: 'online' | 'offline';
  timestamp: string;
}

export interface SocketTypingEvent {
  userId: string;
  chatId: string;
  isTyping: boolean;
}

export interface SocketNewMessageEvent {
  type: 'message:new';
  data: {
    messageId: string;
    chatId: string;
    senderId: string;
    content: string;
    timestamp: string;
    media?: {
      type: 'image' | 'audio' | 'video';
      url: string;
      metadata?: Record<string, unknown>;
    } | null;
  };
}

export interface SocketEditedMessageEvent {
  type: 'message:edited';
  data: {
    messageId: string;
    chatId: string;
    content: string;
    editedAt: string;
  };
}

export interface SocketDeletedMessageEvent {
  type: 'message:deleted';
  data: {
    messageId: string;
    chatId: string;
  };
}

type MessageEventHandler = (message: MessageResponse) => void;
type UserStatusHandler = (status: SocketUserStatus) => void;
type TypingHandler = (event: SocketTypingEvent) => void;
type MessageEditedHandler = (data: SocketEditedMessageEvent['data']) => void;
type MessageDeletedHandler = (data: SocketDeletedMessageEvent['data']) => void;

class SocketService {
  private messageHandlers = new Set<MessageEventHandler>();
  private userStatusHandlers = new Set<UserStatusHandler>();
  private typingHandlers = new Set<TypingHandler>();
  private messageEditedHandlers = new Set<MessageEditedHandler>();
  private messageDeletedHandlers = new Set<MessageDeletedHandler>();

  public initialize(): void {
    const socket = socketManager.connect();

    socket.on('message:new', (event: SocketNewMessageEvent) => {
      const message: MessageResponse = {
        id: event.data.messageId,
        chatId: event.data.chatId,
        senderId: event.data.senderId,
        content: event.data.content,
        media: event.data.media || null,
        editedAt: null,
        deletedFor: [],
        timestamp: event.data.timestamp,
      };

      this.messageHandlers.forEach((handler) => handler(message));
    });

    socket.on('message:edited', (event: SocketEditedMessageEvent) => {
      this.messageEditedHandlers.forEach((handler) => handler(event.data));
    });

    socket.on('message:deleted', (event: SocketDeletedMessageEvent) => {
      this.messageDeletedHandlers.forEach((handler) => handler(event.data));
    });

    socket.on('user:online', (data: SocketUserStatus) => {
      this.userStatusHandlers.forEach((handler) =>
        handler({ ...data, status: 'online' })
      );
    });

    socket.on('user:offline', (data: SocketUserStatus) => {
      this.userStatusHandlers.forEach((handler) =>
        handler({ ...data, status: 'offline' })
      );
    });

    socket.on('user:typing', (data: SocketTypingEvent) => {
      this.typingHandlers.forEach((handler) => handler(data));
    });
  }

  public disconnect(): void {
    socketManager.disconnect();
    this.messageHandlers.clear();
    this.userStatusHandlers.clear();
    this.typingHandlers.clear();
    this.messageEditedHandlers.clear();
    this.messageDeletedHandlers.clear();
  }

  public onNewMessage(handler: MessageEventHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  public onMessageEdited(handler: MessageEditedHandler): () => void {
    this.messageEditedHandlers.add(handler);
    return () => this.messageEditedHandlers.delete(handler);
  }

  public onMessageDeleted(handler: MessageDeletedHandler): () => void {
    this.messageDeletedHandlers.add(handler);
    return () => this.messageDeletedHandlers.delete(handler);
  }

  public onUserStatus(handler: UserStatusHandler): () => void {
    this.userStatusHandlers.add(handler);
    return () => this.userStatusHandlers.delete(handler);
  }

  public onTyping(handler: TypingHandler): () => void {
    this.typingHandlers.add(handler);
    return () => this.typingHandlers.delete(handler);
  }

  public emitTyping(chatId: string): void {
    socketManager.emit('user:typing', { chatId });
  }

  public emitStopTyping(chatId: string): void {
    socketManager.emit('user:stop-typing', { chatId });
  }

  public isConnected(): boolean {
    return socketManager.isConnected();
  }
}

export const socketService = new SocketService();
export default socketService;
