import { useState, useRef, ChangeEvent } from 'react';
import { Send, Paperclip, Smile, Mic, X, Loader2 } from 'lucide-react';

interface MessageComposerProps {
  onSendMessage: (content: string, media?: File) => Promise<void>;
  onTyping: () => void;
  onStopTyping: () => void;
  disabled?: boolean;
}

export default function MessageComposer({
  onSendMessage,
  onTyping,
  onStopTyping,
  disabled,
}: MessageComposerProps) {
  const [message, setMessage] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleMessageChange = (value: string) => {
    setMessage(value);

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    if (value.length > 0) {
      onTyping();
      typingTimeoutRef.current = setTimeout(() => {
        onStopTyping();
      }, 3000);
    } else {
      onStopTyping();
    }
  };

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const maxSize = file.type.startsWith('video/')
      ? 100 * 1024 * 1024
      : file.type.startsWith('audio/')
        ? 2 * 1024 * 1024
        : 10 * 1024 * 1024;

    if (file.size > maxSize) {
      alert('Файл слишком большой');
      return;
    }

    setSelectedFile(file);

    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreviewUrl(reader.result as string);
      };
      reader.readAsDataURL(file);
    } else {
      setPreviewUrl(null);
    }
  };

  const handleRemoveFile = () => {
    setSelectedFile(null);
    setPreviewUrl(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSend = async () => {
    if ((!message.trim() && !selectedFile) || isSending || disabled) return;

    setIsSending(true);
    onStopTyping();

    try {
      await onSendMessage(message.trim(), selectedFile || undefined);
      setMessage('');
      setSelectedFile(null);
      setPreviewUrl(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (error) {
      console.error('Error sending message:', error);
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="border-t border-[#E5E7EB] p-4 bg-white">
      {selectedFile && (
        <div className="mb-3 p-3 bg-[#F9FBFF] rounded-lg border border-[#E5E7EB]">
          <div className="flex items-center gap-3">
            {previewUrl ? (
              <img
                src={previewUrl}
                alt="Preview"
                className="w-16 h-16 rounded object-cover"
              />
            ) : (
              <div className="w-16 h-16 rounded bg-[#E5E7EB] flex items-center justify-center">
                <Paperclip size={24} className="text-[#6B7280]" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[#1A1A1A] truncate">
                {selectedFile.name}
              </p>
              <p className="text-xs text-[#6B7280]">
                {(selectedFile.size / 1024).toFixed(2)} KB
              </p>
            </div>
            <button
              onClick={handleRemoveFile}
              className="p-1 hover:bg-[#E5E7EB] rounded transition-colors"
              disabled={isSending}
            >
              <X size={20} className="text-[#6B7280]" />
            </button>
          </div>
        </div>
      )}

      <div className="flex items-end gap-2">
        <div className="flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*,audio/*"
            onChange={handleFileSelect}
            className="hidden"
            disabled={isSending || disabled}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-10 h-10 rounded-lg hover:bg-[#F3F4F6] flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={isSending || disabled}
          >
            <Paperclip size={20} className="text-[#6B7280]" />
          </button>
          <button
            className="w-10 h-10 rounded-lg hover:bg-[#F3F4F6] flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={isSending || disabled}
          >
            <Smile size={20} className="text-[#6B7280]" />
          </button>
        </div>
        <textarea
          placeholder="Сообщение..."
          className="flex-1 max-h-32 px-4 py-3 rounded-xl border-2 border-[#E5E7EB] focus:border-[#2290FF] focus:outline-none resize-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          rows={1}
          value={message}
          onChange={(e) => handleMessageChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isSending || disabled}
        />
        {message.trim() || selectedFile ? (
          <button
            onClick={handleSend}
            className="w-10 h-10 rounded-lg bg-[#2290FF] hover:bg-[#1a7ae6] flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={isSending || disabled}
          >
            {isSending ? (
              <Loader2 size={20} className="text-white animate-spin" />
            ) : (
              <Send size={20} className="text-white" />
            )}
          </button>
        ) : (
          <button
            className="w-10 h-10 rounded-lg hover:bg-[#F3F4F6] flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={isSending || disabled}
          >
            <Mic size={20} className="text-[#6B7280]" />
          </button>
        )}
      </div>
    </div>
  );
}
