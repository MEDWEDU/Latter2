import { useEffect, useRef, useState } from 'react';
import { Loader2, CheckCheck, Play, Volume2 } from 'lucide-react';
import type { MessageWithSenderResponse } from '../types/api';

interface MessageWindowProps {
  messages: MessageWithSenderResponse[];
  currentUserId: string;
  loading?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
  typingUsers?: Set<string>;
  participantNames?: Map<string, string>;
}

interface MessageItemProps {
  message: MessageWithSenderResponse;
  isMine: boolean;
  senderName?: string;
}

function MessageItem({ message, isMine, senderName }: MessageItemProps) {
  const [imageError, setImageError] = useState(false);

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const renderMedia = () => {
    if (!message.media || imageError) return null;

    const { type, url } = message.media;

    switch (type) {
      case 'image':
        return (
          <img
            src={url}
            alt="Attached"
            className="max-w-sm rounded-lg cursor-pointer hover:opacity-90 transition-opacity"
            onError={() => setImageError(true)}
            onClick={() => window.open(url, '_blank')}
          />
        );
      case 'video':
        return (
          <video
            src={url}
            controls
            className="max-w-sm rounded-lg"
            preload="metadata"
          >
            <track kind="captions" />
          </video>
        );
      case 'audio':
        return (
          <div className="flex items-center gap-2 p-3 bg-[#F3F4F6] rounded-lg">
            <Volume2 size={20} className="text-[#6B7280]" />
            <audio src={url} controls className="flex-1">
              <track kind="captions" />
            </audio>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-md px-4 py-3 rounded-2xl ${
          isMine
            ? 'bg-white text-[#1A1A1A] rounded-br-md'
            : 'bg-[#F0F9FF] text-[#1A1A1A] rounded-bl-md'
        } shadow-sm`}
      >
        {!isMine && senderName && (
          <p className="text-xs font-semibold text-[#2290FF] mb-1">
            {senderName}
          </p>
        )}
        {message.media && <div className="mb-2">{renderMedia()}</div>}
        {message.content && <p className="whitespace-pre-wrap break-words">{message.content}</p>}
        <div
          className={`text-xs mt-1 flex items-center gap-1 ${
            isMine ? 'justify-end' : 'justify-start'
          } text-[#6B7280]`}
        >
          <span>{formatTime(message.timestamp)}</span>
          {message.editedAt && <span className="text-[#6B7280]">(изм.)</span>}
          {isMine && (
            <CheckCheck size={14} className="text-[#2290FF]" />
          )}
        </div>
      </div>
    </div>
  );
}

export default function MessageWindow({
  messages,
  currentUserId,
  loading,
  hasMore,
  onLoadMore,
  typingUsers = new Set(),
  participantNames = new Map(),
}: MessageWindowProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  };

  useEffect(() => {
    if (shouldAutoScroll) {
      scrollToBottom('auto');
    }
  }, [messages, shouldAutoScroll]);

  const handleScroll = () => {
    if (!scrollContainerRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;
    setShouldAutoScroll(isNearBottom);

    if (scrollTop < 100 && hasMore && onLoadMore && !loading) {
      onLoadMore();
    }
  };

  if (loading && messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#F9FBFF]">
        <div className="text-center">
          <Loader2 size={48} className="text-[#2290FF] animate-spin mx-auto mb-4" />
          <p className="text-[#6B7280]">Загрузка сообщений...</p>
        </div>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#F9FBFF]">
        <div className="text-center">
          <div className="w-24 h-24 bg-gradient-to-br from-[#2290FF] to-[#0066CC] rounded-3xl flex items-center justify-center mx-auto mb-6">
            <Play size={48} className="text-white ml-2" />
          </div>
          <h2 className="text-2xl font-bold text-[#1A1A1A] mb-2">
            Начните разговор
          </h2>
          <p className="text-[#6B7280]">Отправьте первое сообщение!</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={scrollContainerRef}
      className="flex-1 overflow-y-auto p-6 space-y-4 bg-[#F9FBFF]"
      onScroll={handleScroll}
    >
      {loading && hasMore && (
        <div className="flex justify-center py-2">
          <Loader2 size={24} className="text-[#2290FF] animate-spin" />
        </div>
      )}

      {messages.map((message) => {
        const isMine = message.senderId === currentUserId;
        const senderName = isMine
          ? undefined
          : participantNames.get(message.senderId) ||
            `${message.sender?.firstName || ''} ${message.sender?.lastName || ''}`.trim();

        return (
          <MessageItem
            key={message.id}
            message={message}
            isMine={isMine}
            senderName={senderName}
          />
        );
      })}

      {typingUsers.size > 0 && (
        <div className="flex justify-start">
          <div className="px-4 py-3 rounded-2xl bg-[#F0F9FF] rounded-bl-md">
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 bg-[#6B7280] rounded-full animate-bounce" />
              <div className="w-2 h-2 bg-[#6B7280] rounded-full animate-bounce delay-100" />
              <div className="w-2 h-2 bg-[#6B7280] rounded-full animate-bounce delay-200" />
            </div>
          </div>
        </div>
      )}

      <div ref={messagesEndRef} />
    </div>
  );
}
