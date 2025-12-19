import { Search } from 'lucide-react';
import type { ChatResponseData } from '../types/api';

interface ChatListProps {
  chats: ChatResponseData[];
  selectedChatId: string | null;
  onChatSelect: (chatId: string) => void;
  onlineUsers: Set<string>;
  loading?: boolean;
  currentUserId: string;
}

export default function ChatList({
  chats,
  selectedChatId,
  onChatSelect,
  onlineUsers,
  loading,
  currentUserId,
}: ChatListProps) {
  const getOtherParticipant = (chat: ChatResponseData) => {
    return chat.participants.find((p) => p.id !== currentUserId);
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      return date.toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
      });
    } else if (days === 1) {
      return 'Вчера';
    } else if (days < 7) {
      return date.toLocaleDateString('ru-RU', { weekday: 'short' });
    } else {
      return date.toLocaleDateString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
      });
    }
  };

  if (loading) {
    return (
      <aside className="w-80 border-r border-[#E5E7EB] flex flex-col bg-white">
        <div className="p-4 border-b border-[#E5E7EB]">
          <div className="h-10 bg-[#F3F4F6] rounded-lg animate-pulse" />
        </div>
        <div className="flex-1 overflow-y-auto">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="p-4 border-b border-[#E5E7EB] flex gap-3">
              <div className="w-12 h-12 bg-[#F3F4F6] rounded-full animate-pulse" />
              <div className="flex-1">
                <div className="h-4 bg-[#F3F4F6] rounded mb-2 animate-pulse" />
                <div className="h-3 bg-[#F3F4F6] rounded w-3/4 animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </aside>
    );
  }

  return (
    <aside className="w-80 border-r border-[#E5E7EB] flex flex-col bg-white">
      <div className="p-4 border-b border-[#E5E7EB]">
        <div className="relative">
          <Search
            size={20}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B7280]"
          />
          <input
            type="text"
            placeholder="Поиск по людям..."
            className="w-full h-10 pl-10 pr-4 rounded-lg border border-[#E5E7EB] focus:border-[#2290FF] focus:outline-none transition-colors"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {chats.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-[#6B7280]">Нет активных чатов</p>
          </div>
        ) : (
          chats.map((chat) => {
            const otherParticipant = getOtherParticipant(chat);
            if (!otherParticipant) return null;

            const isOnline = onlineUsers.has(otherParticipant.id);
            const unreadCount = chat.unreadCount[currentUserId] || 0;

            return (
              <button
                key={chat.id}
                onClick={() => onChatSelect(chat.id)}
                className={`w-full p-4 flex items-start gap-3 hover:bg-[#F3F4F6] transition-colors border-b border-[#E5E7EB] ${
                  selectedChatId === chat.id ? 'bg-[#F9FBFF]' : ''
                }`}
              >
                <div className="relative flex-shrink-0">
                  <img
                    src={
                      otherParticipant.avatarUrl ||
                      `https://ui-avatars.com/api/?name=${encodeURIComponent(
                        `${otherParticipant.firstName} ${otherParticipant.lastName}`
                      )}&background=2290FF&color=fff`
                    }
                    alt={`${otherParticipant.firstName} ${otherParticipant.lastName}`}
                    className="w-12 h-12 rounded-full object-cover"
                  />
                  {isOnline && (
                    <div className="absolute bottom-0 right-0 w-3 h-3 bg-[#10B981] rounded-full border-2 border-white" />
                  )}
                </div>
                <div className="flex-1 min-w-0 text-left">
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="font-semibold text-[#1A1A1A] truncate">
                      {otherParticipant.firstName} {otherParticipant.lastName}
                    </h3>
                    {chat.lastMessage && (
                      <span className="text-xs text-[#6B7280] ml-2 flex-shrink-0">
                        {formatTime(chat.lastMessage.timestamp)}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-[#6B7280] truncate">
                    {chat.lastMessage?.content || 'Нет сообщений'}
                  </p>
                </div>
                {unreadCount > 0 && (
                  <div className="flex-shrink-0 w-5 h-5 bg-[#2290FF] text-white text-xs rounded-full flex items-center justify-center font-semibold">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </div>
                )}
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}
