import { useState } from 'react';
import type { UserSearchResult } from '../types/api';
import { api } from '../services/api';
import { useApp } from '../contexts/AppContext';
import Button from './ui/Button';

interface UserCardProps {
  user: UserSearchResult;
  onChatCreated?: (chatId: string) => void;
}

export default function UserCard({ user, onChatCreated }: UserCardProps) {
  const { addToast } = useApp();
  const [loading, setLoading] = useState(false);

  const fullName = `${user.firstName} ${user.lastName}`;

  const handleWriteClick = async () => {
    setLoading(true);
    try {
      const response = await api.chats.create({
        participantIds: [user.id],
      });
      addToast('success', 'Чат создан');
      onChatCreated?.(response.chat.id);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Ошибка создания чата';
      addToast('error', message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-lg shadow-blue-500/5 p-6 hover:shadow-xl hover:shadow-blue-500/10 transition-all duration-300 hover:-translate-y-1">
      <div className="flex items-start gap-4 mb-4">
        <img
          src={user.avatarUrl || 'https://via.placeholder.com/64'}
          alt={fullName}
          className="w-16 h-16 rounded-full object-cover"
        />
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-[#1A1A1A] mb-1 truncate">{fullName}</h3>
          <p className="text-sm text-[#6B7280] truncate">
            {user.profile.position}
          </p>
          <p className="text-sm text-[#2290FF] font-medium truncate">
            {user.profile.company}
          </p>
        </div>
      </div>

      <div className="mb-4">
        <span className="inline-block px-3 py-1 bg-[#E0F0FF] text-[#2290FF] rounded-lg text-xs font-medium">
          {user.profile.category}
        </span>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {user.profile.skills.map((skill) => (
          <span
            key={skill}
            className="px-2.5 py-1 bg-[#F0F9FF] text-[#2290FF] rounded-md text-xs font-medium border border-[#2290FF]/20"
          >
            {skill}
          </span>
        ))}
      </div>

      <Button
        variant="primary"
        className="w-full"
        onClick={handleWriteClick}
        loading={loading}
      >
        Написать
      </Button>
    </div>
  );
}
