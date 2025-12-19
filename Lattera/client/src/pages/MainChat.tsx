import { useState, useEffect, useCallback, useRef } from 'react';
import { Video, Phone, MoreVertical, Loader2 } from 'lucide-react';

import type { NavigateFn } from '../routes';
import type {
  ChatResponseData,
  MessageWithSenderResponse,
  MessageResponse,
} from '../types/api';

import { api } from '../services/api';
import { socketService } from '../services/socketService';
import { useApp } from '../contexts/AppContext';
import Logo from '../components/Logo';
import ChatList from '../components/ChatList';
import MessageWindow from '../components/MessageWindow';
import MessageComposer from '../components/MessageComposer';

export default function MainChat({ onNavigate }: { onNavigate: NavigateFn }) {
  const { user, addToast } = useApp();
  const [chats, setChats] = useState<ChatResponseData[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageWithSenderResponse[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const [chatsLoading, setChatsLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [messagesOffset, setMessagesOffset] = useState(0);
  const typingTimeoutRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  const selectedChat = chats.find((c) => c.id === selectedChatId);

  const loadChats = useCallback(async () => {
    try {
      setChatsLoading(true);
      const response = await api.chats.list({ limit: 50, offset: 0 });
      setChats(response.chats);
    } catch (error) {
      console.error('Error loading chats:', error);
      addToast('error', 'Не удалось загрузить список чатов');
    } finally {
      setChatsLoading(false);
    }
  }, [addToast]);

  const loadMessages = useCallback(
    async (chatId: string, offset = 0) => {
      try {
        setMessagesLoading(true);
        const response = await api.messages.list({
          chatId,
          limit: 50,
          offset,
        });

        if (offset === 0) {
          setMessages(response.messages.reverse());
        } else {
          setMessages((prev) => [...response.messages.reverse(), ...prev]);
        }

        setHasMoreMessages(response.messages.length === 50);
        setMessagesOffset(offset + response.messages.length);
      } catch (error) {
        console.error('Error loading messages:', error);
        addToast('error', 'Не удалось загрузить сообщения');
      } finally {
        setMessagesLoading(false);
      }
    },
    [addToast]
  );

  const handleChatSelect = useCallback(
    (chatId: string) => {
      setSelectedChatId(chatId);
      setMessages([]);
      setMessagesOffset(0);
      setTypingUsers(new Set());
      loadMessages(chatId);
    },
    [loadMessages]
  );

  const handleLoadMoreMessages = useCallback(() => {
    if (selectedChatId && hasMoreMessages && !messagesLoading) {
      loadMessages(selectedChatId, messagesOffset);
    }
  }, [selectedChatId, hasMoreMessages, messagesLoading, messagesOffset, loadMessages]);

  const handleSendMessage = useCallback(
    async (content: string, mediaFile?: File) => {
      if (!selectedChatId || !user) return;

      const tempId = `temp-${Date.now()}`;
      const tempMessage: MessageWithSenderResponse = {
        id: tempId,
        chatId: selectedChatId,
        senderId: user.id,
        sender: {
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
        },
        content,
        media: null,
        editedAt: null,
        deletedFor: [],
        timestamp: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, tempMessage]);

      try {
        let mediaData = undefined;

        if (mediaFile) {
          try {
            const uploadResponse = await api.media.upload({
              file: mediaFile,
              userId: user.id,
            });

            mediaData = {
              type: uploadResponse.data.type,
              url: uploadResponse.data.url,
            };
          } catch (error) {
            console.error('Error uploading media:', error);
            addToast('error', 'Не удалось загрузить файл');
            setMessages((prev) => prev.filter((m) => m.id !== tempId));
            return;
          }
        }

        const response = await api.messages.send({
          chatId: selectedChatId,
          content: content || undefined,
          media: mediaData,
        });

        setMessages((prev) =>
          prev.map((m) =>
            m.id === tempId
              ? {
                  ...response.data,
                  sender: {
                    id: user.id,
                    firstName: user.firstName,
                    lastName: user.lastName,
                  },
                }
              : m
          )
        );

        setChats((prev) =>
          prev.map((chat) =>
            chat.id === selectedChatId
              ? {
                  ...chat,
                  lastMessage: {
                    content: response.data.content,
                    senderId: user.id,
                    timestamp: response.data.timestamp,
                  },
                }
              : chat
          )
        );
      } catch (error) {
        console.error('Error sending message:', error);
        addToast('error', 'Не удалось отправить сообщение');
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
      }
    },
    [selectedChatId, user, addToast]
  );

  const handleTyping = useCallback(() => {
    if (selectedChatId) {
      socketService.emitTyping(selectedChatId);
    }
  }, [selectedChatId]);

  const handleStopTyping = useCallback(() => {
    if (selectedChatId) {
      socketService.emitStopTyping(selectedChatId);
    }
  }, [selectedChatId]);

  useEffect(() => {
    loadChats();
  }, [loadChats]);

  useEffect(() => {
    if (!user) return;

    try {
      socketService.initialize();

      const unsubscribeNewMessage = socketService.onNewMessage(
        (message: MessageResponse) => {
          setMessages((prev) => {
            const exists = prev.some((m) => m.id === message.id);
            if (exists) return prev;

            const messageWithSender: MessageWithSenderResponse = {
              ...message,
              sender: message.sender || {
                id: message.senderId,
                firstName: '',
                lastName: '',
              },
            };

            return [...prev, messageWithSender];
          });

          setChats((prev) =>
            prev.map((chat) =>
              chat.id === message.chatId
                ? {
                    ...chat,
                    lastMessage: {
                      content: message.content,
                      senderId: message.senderId,
                      timestamp: message.timestamp,
                    },
                    unreadCount:
                      message.senderId !== user.id
                        ? {
                            ...chat.unreadCount,
                            [user.id]: (chat.unreadCount[user.id] || 0) + 1,
                          }
                        : chat.unreadCount,
                  }
                : chat
            )
          );
        }
      );

      const unsubscribeUserStatus = socketService.onUserStatus((status) => {
        setOnlineUsers((prev) => {
          const newSet = new Set(prev);
          if (status.status === 'online') {
            newSet.add(status.userId);
          } else {
            newSet.delete(status.userId);
          }
          return newSet;
        });
      });

      const unsubscribeTyping = socketService.onTyping((event) => {
        if (event.chatId !== selectedChatId) return;

        if (event.isTyping) {
          setTypingUsers((prev) => new Set(prev).add(event.userId));

          const existingTimeout = typingTimeoutRef.current.get(event.userId);
          if (existingTimeout) {
            clearTimeout(existingTimeout);
          }

          const timeout = setTimeout(() => {
            setTypingUsers((prev) => {
              const newSet = new Set(prev);
              newSet.delete(event.userId);
              return newSet;
            });
            typingTimeoutRef.current.delete(event.userId);
          }, 5000);

          typingTimeoutRef.current.set(event.userId, timeout);
        } else {
          setTypingUsers((prev) => {
            const newSet = new Set(prev);
            newSet.delete(event.userId);
            return newSet;
          });

          const existingTimeout = typingTimeoutRef.current.get(event.userId);
          if (existingTimeout) {
            clearTimeout(existingTimeout);
            typingTimeoutRef.current.delete(event.userId);
          }
        }
      });

      const unsubscribeMessageEdited = socketService.onMessageEdited((data) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === data.messageId
              ? { ...m, content: data.content, editedAt: data.editedAt }
              : m
          )
        );
      });

      const unsubscribeMessageDeleted = socketService.onMessageDeleted((data) => {
        setMessages((prev) => prev.filter((m) => m.id !== data.messageId));
      });

      return () => {
        unsubscribeNewMessage();
        unsubscribeUserStatus();
        unsubscribeTyping();
        unsubscribeMessageEdited();
        unsubscribeMessageDeleted();
        socketService.disconnect();

        const timeouts = typingTimeoutRef.current;
        timeouts.forEach((timeout) => clearTimeout(timeout));
        timeouts.clear();
      };
    } catch (error) {
      console.error('Error initializing socket:', error);
    }
  }, [user, selectedChatId]);

  if (!user) {
    return (
      <div className="h-screen bg-white flex items-center justify-center">
        <Loader2 size={48} className="text-[#2290FF] animate-spin" />
      </div>
    );
  }

  const getOtherParticipant = (chat: ChatResponseData) => {
    return chat.participants.find((p) => p.id !== user.id);
  };

  const participantNames = new Map<string, string>();
  if (selectedChat) {
    selectedChat.participants.forEach((p) => {
      participantNames.set(p.id, `${p.firstName} ${p.lastName}`);
    });
  }

  return (
    <div className="h-screen bg-white flex flex-col">
      <header className="h-16 border-b border-[#E5E7EB] px-6 flex items-center justify-between bg-white/80 backdrop-blur-sm sticky top-0 z-10">
        <Logo size="sm" />
        <nav className="flex items-center gap-1">
          <button
            onClick={() => onNavigate('/')}
            className="px-4 py-2 text-[#2290FF] bg-[#F0F9FF] rounded-lg font-medium"
          >
            Чаты
          </button>
          <button
            onClick={() => onNavigate('/search')}
            className="px-4 py-2 text-[#6B7280] hover:bg-[#F3F4F6] rounded-lg font-medium transition-colors"
          >
            Поиск
          </button>
          <button
            onClick={() => onNavigate('/settings')}
            className="px-4 py-2 text-[#6B7280] hover:bg-[#F3F4F6] rounded-lg font-medium transition-colors"
          >
            Настройки
          </button>
        </nav>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <ChatList
          chats={chats}
          selectedChatId={selectedChatId}
          onChatSelect={handleChatSelect}
          onlineUsers={onlineUsers}
          loading={chatsLoading}
          currentUserId={user.id}
        />

        {selectedChat ? (
          <>
            <main className="flex-1 flex flex-col bg-[#F9FBFF]">
              <div className="h-16 border-b border-[#E5E7EB] px-6 flex items-center justify-between bg-white">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    {(() => {
                      const otherParticipant = getOtherParticipant(selectedChat);
                      if (!otherParticipant) return null;

                      const isOnline = onlineUsers.has(otherParticipant.id);

                      return (
                        <>
                          <img
                            src={
                              otherParticipant.avatarUrl ||
                              `https://ui-avatars.com/api/?name=${encodeURIComponent(
                                `${otherParticipant.firstName} ${otherParticipant.lastName}`
                              )}&background=2290FF&color=fff`
                            }
                            alt={`${otherParticipant.firstName} ${otherParticipant.lastName}`}
                            className="w-10 h-10 rounded-full object-cover"
                          />
                          {isOnline && (
                            <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-[#10B981] rounded-full border-2 border-white" />
                          )}
                        </>
                      );
                    })()}
                  </div>
                  <div>
                    {(() => {
                      const otherParticipant = getOtherParticipant(selectedChat);
                      if (!otherParticipant) return null;

                      const isOnline = onlineUsers.has(otherParticipant.id);

                      return (
                        <>
                          <h2 className="font-semibold text-[#1A1A1A]">
                            {otherParticipant.firstName} {otherParticipant.lastName}
                          </h2>
                          <p className="text-sm text-[#6B7280]">
                            {isOnline ? 'Online' : 'Offline'}
                          </p>
                        </>
                      );
                    })()}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button className="w-10 h-10 rounded-lg hover:bg-[#F3F4F6] flex items-center justify-center transition-colors">
                    <Video size={20} className="text-[#6B7280]" />
                  </button>
                  <button className="w-10 h-10 rounded-lg hover:bg-[#F3F4F6] flex items-center justify-center transition-colors">
                    <Phone size={20} className="text-[#6B7280]" />
                  </button>
                  <button className="w-10 h-10 rounded-lg hover:bg-[#F3F4F6] flex items-center justify-center transition-colors">
                    <MoreVertical size={20} className="text-[#6B7280]" />
                  </button>
                </div>
              </div>

              <MessageWindow
                messages={messages}
                currentUserId={user.id}
                loading={messagesLoading}
                hasMore={hasMoreMessages}
                onLoadMore={handleLoadMoreMessages}
                typingUsers={typingUsers}
                participantNames={participantNames}
              />

              <MessageComposer
                onSendMessage={handleSendMessage}
                onTyping={handleTyping}
                onStopTyping={handleStopTyping}
              />
            </main>

            <aside className="w-80 border-l border-[#E5E7EB] p-6 bg-white overflow-y-auto">
              {(() => {
                const otherParticipant = getOtherParticipant(selectedChat);
                if (!otherParticipant) return null;

                return (
                  <>
                    <div className="text-center mb-6">
                      <img
                        src={
                          otherParticipant.avatarUrl ||
                          `https://ui-avatars.com/api/?name=${encodeURIComponent(
                            `${otherParticipant.firstName} ${otherParticipant.lastName}`
                          )}&background=2290FF&color=fff`
                        }
                        alt={`${otherParticipant.firstName} ${otherParticipant.lastName}`}
                        className="w-20 h-20 rounded-full object-cover mx-auto mb-4"
                      />
                      <h2 className="text-xl font-bold text-[#1A1A1A] mb-1">
                        {otherParticipant.firstName} {otherParticipant.lastName}
                      </h2>
                      <p className="text-[#6B7280] mb-1">
                        {otherParticipant.profile.position}
                      </p>
                      <p className="text-sm text-[#6B7280]">
                        {otherParticipant.profile.company}
                      </p>
                    </div>

                    <div className="space-y-4">
                      <div>
                        <h3 className="text-sm font-medium text-[#6B7280] mb-2">
                          Категория
                        </h3>
                        <span className="inline-block px-3 py-1.5 bg-[#E0F0FF] text-[#2290FF] rounded-lg text-sm font-medium">
                          {otherParticipant.profile.category}
                        </span>
                      </div>
                    </div>
                  </>
                );
              })()}
            </aside>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center bg-[#F9FBFF]">
            <div className="text-center">
              <div className="w-24 h-24 bg-gradient-to-br from-[#2290FF] to-[#0066CC] rounded-3xl flex items-center justify-center mx-auto mb-6">
                <Phone size={48} className="text-white" />
              </div>
              <h2 className="text-2xl font-bold text-[#1A1A1A] mb-2">
                Выберите чат
              </h2>
              <p className="text-[#6B7280]">
                Выберите чат из списка слева, чтобы начать общение
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
