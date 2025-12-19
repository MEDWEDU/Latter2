import { User } from '../../database/models/User';
import { Chat } from '../../database/models/Chat';
import { Message } from '../../database/models/Message';
import jwt from 'jsonwebtoken';
import bcryptjs from 'bcryptjs';

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key';

/**
 * Создать тестового пользователя
 */
export async function createTestUser(data?: Partial<any>) {
  const defaultData = {
    email: `test-${Date.now()}@example.com`,
    passwordHash: await bcryptjs.hash('Test@1234', 12),
    firstName: 'Test',
    lastName: 'User',
    profile: {
      position: 'Developer',
      company: 'Test Company',
      category: 'IT',
      skills: ['JavaScript', 'TypeScript'],
    },
  };

  const user = new User({ ...defaultData, ...data });
  await user.save();
  return user;
}

/**
 * Создать тестовый чат между двумя пользователями
 */
export async function createTestChat(user1: any, user2: any, data?: Partial<any>) {
  const defaultData = {
    participants: [user1._id, user2._id],
    type: 'private',
    lastMessage: {
      content: 'Hello',
      senderId: user1._id,
      timestamp: new Date(),
    },
    unreadCount: { [user1._id.toString()]: 0, [user2._id.toString()]: 1 },
  };

  const chat = new Chat({ ...defaultData, ...data });
  await chat.save();
  return chat;
}

/**
 * Создать тестовое сообщение
 */
export async function createTestMessage(
  chatId: any,
  senderId: any,
  content: string = 'Test message'
) {
  const message = new Message({
    chatId,
    senderId,
    content,
    timestamp: new Date(),
  });
  await message.save();
  return message;
}

/**
 * Генерировать JWT токен для тестирования
 */
export function generateTestJWT(userId: any): string {
  return jwt.sign(
    { userId: userId.toString(), iat: Math.floor(Date.now() / 1000) },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

/**
 * Очистить всё из БД
 */
export async function clearDatabase() {
  const collections = [User, Chat, Message];
  for (const model of collections) {
    await model.deleteMany({});
  }
}