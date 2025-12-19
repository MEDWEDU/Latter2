import { Router, Request, Response } from 'express';
import { Types } from 'mongoose';
import { Message } from '../database/models/Message';
import { Chat } from '../database/models/Chat';
import { authMiddleware } from '../middleware/auth';
import {
  asyncHandler,
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from '../utils';
import logger from '../utils/logger';
import { getSocketHandler } from '../utils/socketManager';

const router = Router();

interface CreateMessageRequest {
  chatId: string;
  content?: string;
  media?: {
    type: 'image' | 'audio' | 'video';
    url: string;
    metadata?: {
      duration?: number;
      width?: number;
      height?: number;
    };
  };
}

interface PopulatedSender {
  _id: Types.ObjectId;
  firstName: string;
  lastName: string;
}

/**
 * @swagger
 * /api/messages:
 *   post:
 *     summary: Отправить сообщение
 *     description: Отправляет новое сообщение в чат. Поддерживает текстовые сообщения и медиа (изображения, аудио, видео).
 *     tags: [Messages]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - chatId
 *             properties:
 *               chatId:
 *                 type: string
 *                 description: ID чата
 *                 example: "507f1f77bcf86cd799439013"
 *               content:
 *                 type: string
 *                 maxLength: 5000
 *                 description: Текст сообщения
 *                 example: "Привет! Как дела?"
 *               media:
 *                 type: object
 *                 properties:
 *                   type:
 *                     type: string
 *                     enum: [image, audio, video]
 *                     description: Тип медиафайла
 *                     example: "image"
 *                   url:
 *                     type: string
 *                     description: URL медиафайла
 *                     example: "https://s3.amazonaws.com/lettera/uploads/image.jpg"
 *                   metadata:
 *                     type: object
 *                     properties:
 *                       duration:
 *                         type: number
 *                         description: Длительность для аудио/видео (в секундах)
 *                       width:
 *                         type: number
 *                         description: Ширина для изображений/видео
 *                       height:
 *                         type: number
 *                         description: Высота для изображений/видео
 *           examples:
 *             textMessage:
 *               summary: Текстовое сообщение
 *               value:
 *                 chatId: "507f1f77bcf86cd799439013"
 *                 content: "Привет! Как дела?"
 *             mediaMessage:
 *               summary: Сообщение с изображением
 *               value:
 *                 chatId: "507f1f77bcf86cd799439013"
 *                 content: "Посмотри на это фото!"
 *                 media:
 *                   type: "image"
 *                   url: "https://s3.amazonaws.com/lettera/uploads/photo.jpg"
 *                   metadata:
 *                     width: 1920
 *                     height: 1080
 *     responses:
 *       201:
 *         description: Сообщение успешно отправлено
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Message sent"
 *                 data:
 *                   $ref: '#/components/schemas/Message'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
// POST /api/messages - Create a new message
router.post(
  '/',
  authMiddleware,
  asyncHandler(async (req: Request, res: Response) => {
    const { chatId, content, media } = req.body as CreateMessageRequest;
    const currentUserId = req.user!.userId;
    const currentUserObjectId = new Types.ObjectId(currentUserId);

    // Validate chatId
    if (!chatId) {
      throw BadRequestError('chatId is required');
    }

    if (!Types.ObjectId.isValid(chatId)) {
      throw BadRequestError('Invalid chat ID format');
    }

    // Validate content or media is provided
    const trimmedContent = content?.trim() || '';
    if (!trimmedContent && !media) {
      throw BadRequestError('Either content or media must be provided');
    }

    // Validate content length
    if (trimmedContent && trimmedContent.length > 5000) {
      throw BadRequestError('Content must not exceed 5000 characters');
    }

    // Validate media if provided
    if (media) {
      if (!media.type || !['image', 'audio', 'video'].includes(media.type)) {
        throw BadRequestError(
          'Invalid media type. Must be image, audio, or video'
        );
      }
      if (!media.url || typeof media.url !== 'string') {
        throw BadRequestError('Media URL is required');
      }
      if (media.url.length > 1000) {
        throw BadRequestError('Media URL must not exceed 1000 characters');
      }
    }

    // Find chat and verify user is participant
    const chat = await Chat.findById(chatId);

    if (!chat) {
      throw NotFoundError('Chat not found');
    }

    const isParticipant = chat.participants.some(participant =>
      participant.equals(currentUserObjectId)
    );

    if (!isParticipant) {
      throw ForbiddenError('You are not a participant of this chat');
    }

    // Create message
    const newMessage = await Message.create({
      chatId: new Types.ObjectId(chatId),
      senderId: currentUserObjectId,
      content: trimmedContent,
      media: media || undefined,
      timestamp: new Date(),
    });

    // Update chat's lastMessage
    await Chat.findByIdAndUpdate(chatId, {
      lastMessage: {
        content: trimmedContent || '[Media]',
        senderId: currentUserObjectId,
        timestamp: new Date(),
      },
    });

    logger.info('Message sent', {
      userId: currentUserId,
      chatId,
      messageId: newMessage._id,
    });

    // Broadcast new message via Socket.io
    const socketHandler = getSocketHandler();
    if (socketHandler) {
      socketHandler.broadcastNewMessage({
        messageId: (newMessage._id as any).toString(),
        chatId: newMessage.chatId.toString(),
        senderId: newMessage.senderId.toString(),
        content: newMessage.content,
        timestamp: newMessage.timestamp.toISOString(),
      });
    }

    res.status(201).json({
      message: 'Message sent',
      data: {
        id: newMessage._id,
        chatId: newMessage.chatId,
        senderId: newMessage.senderId,
        content: newMessage.content,
        media: newMessage.media || null,
        editedAt: newMessage.editedAt || null,
        deletedFor: newMessage.deletedFor,
        timestamp: newMessage.timestamp,
      },
    });
  })
);

/**
 * @swagger
 * /api/messages:
 *   get:
 *     summary: Получить историю сообщений
 *     description: Возвращает список сообщений чата с пагинацией. Сортируется от новых к старым.
 *     tags: [Messages]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: chatId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID чата
 *         example: "507f1f77bcf86cd799439013"
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 50
 *         description: Максимальное количество сообщений (1-100)
 *         example: 50
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           minimum: 0
 *           default: 0
 *         description: Смещение для пагинации
 *         example: 0
 *     responses:
 *       200:
 *         description: Список сообщений
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/MessageListResponse'
 *             example:
 *               message: "Messages retrieved"
 *               messages:
 *                 - id: "507f1f77bcf86cd799439015"
 *                   chatId: "507f1f77bcf86cd799439013"
 *                   senderId: "507f1f77bcf86cd799439012"
 *                   content: "Привет! Как дела?"
 *                   mediaFiles: []
 *                   edited: false
 *                   deletedForAll: false
 *                   createdAt: "2024-01-15T10:30:00.000Z"
 *                   updatedAt: "2024-01-15T10:30:00.000Z"
 *               total: 156
 *               hasMore: true
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
// GET /api/messages?chatId=...&limit=50&offset=0 - Get messages
router.get(
  '/',
  authMiddleware,
  asyncHandler(async (req: Request, res: Response) => {
    const { chatId } = req.query;
    const currentUserId = req.user!.userId;
    const currentUserObjectId = new Types.ObjectId(currentUserId);

    // Validate chatId
    if (!chatId || typeof chatId !== 'string') {
      throw BadRequestError('chatId query parameter is required');
    }

    if (!Types.ObjectId.isValid(chatId)) {
      throw BadRequestError('Invalid chat ID format');
    }

    // Parse pagination parameters
    const limitRaw = req.query.limit;
    const offsetRaw = req.query.offset;

    let limit = 50;
    let offset = 0;

    if (limitRaw !== undefined) {
      const parsedLimit = Number(limitRaw);
      if (
        !Number.isInteger(parsedLimit) ||
        parsedLimit < 1 ||
        parsedLimit > 100
      ) {
        throw BadRequestError('limit must be an integer between 1 and 100');
      }
      limit = parsedLimit;
    }

    if (offsetRaw !== undefined) {
      const parsedOffset = Number(offsetRaw);
      if (!Number.isInteger(parsedOffset) || parsedOffset < 0) {
        throw BadRequestError('offset must be a non-negative integer');
      }
      offset = parsedOffset;
    }

    // Verify user is participant of the chat
    const chat = await Chat.findById(chatId);

    if (!chat) {
      throw NotFoundError('Chat not found');
    }

    const isParticipant = chat.participants.some(participant =>
      participant.equals(currentUserObjectId)
    );

    if (!isParticipant) {
      throw ForbiddenError('You are not a participant of this chat');
    }

    // Get total count (excluding messages deleted for this user)
    const total = await Message.countDocuments({
      chatId: new Types.ObjectId(chatId),
      deletedFor: { $ne: currentUserObjectId },
    });

    // Find messages not deleted for this user
    const messages = await Message.find({
      chatId: new Types.ObjectId(chatId),
      deletedFor: { $ne: currentUserObjectId },
    })
      .populate<{ senderId: PopulatedSender }>({
        path: 'senderId',
        select: 'firstName lastName',
      })
      .sort({ timestamp: -1 })
      .skip(offset)
      .limit(limit)
      .lean();

    logger.info('Messages retrieved', {
      userId: currentUserId,
      chatId,
      total,
      count: messages.length,
      limit,
      offset,
    });

    res.status(200).json({
      message: 'Messages retrieved',
      total,
      count: messages.length,
      limit,
      offset,
      messages: messages.map(msg => ({
        id: msg._id,
        chatId: msg.chatId,
        senderId: msg.senderId._id,
        sender: {
          id: msg.senderId._id,
          firstName: msg.senderId.firstName,
          lastName: msg.senderId.lastName,
        },
        content: msg.content,
        media: msg.media || null,
        editedAt: msg.editedAt || null,
        deletedFor: msg.deletedFor,
        timestamp: msg.timestamp,
      })),
    });
  })
);

/**
 * @swagger
 * /api/messages/{messageId}:
 *   patch:
 *     summary: Редактировать сообщение
 *     description: Редактирует сообщение. Можно редактировать только свои сообщения в течение 15 минут после отправки.
 *     tags: [Messages]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: messageId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID сообщения
 *         example: "507f1f77bcf86cd799439015"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateMessageRequest'
 *           example:
 *             content: "Привет! Как дела? 😊"
 *     responses:
 *       200:
 *         description: Сообщение успешно отредактировано
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Message updated successfully"
 *                 data:
 *                   $ref: '#/components/schemas/Message'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       409:
 *         description: Сообщение слишком старое для редактирования
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: 'TOO_LATE_TO_EDIT',
 *                 message: 'Messages can only be edited within 15 minutes of sending',
 *                 details: []
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
// PATCH /api/messages/:messageId - Edit a message
router.patch(
  '/:messageId',
  authMiddleware,
  asyncHandler(async (req: Request, res: Response) => {
    const { messageId } = req.params;
    const { content } = req.body;
    const currentUserId = req.user!.userId;
    const currentUserObjectId = new Types.ObjectId(currentUserId);

    // Validate messageId
    if (!Types.ObjectId.isValid(messageId)) {
      throw BadRequestError('Invalid message ID format');
    }

    // Validate content
    if (!content || typeof content !== 'string') {
      throw BadRequestError('content is required');
    }

    const trimmedContent = content.trim();

    if (!trimmedContent) {
      throw BadRequestError('content cannot be empty');
    }

    if (trimmedContent.length > 5000) {
      throw BadRequestError('Content must not exceed 5000 characters');
    }

    // Find message
    const message = await Message.findById(messageId);

    if (!message) {
      throw NotFoundError('Message not found');
    }

    // Verify user is the sender
    if (!message.senderId.equals(currentUserObjectId)) {
      throw ForbiddenError('You can only edit your own messages');
    }

    // Check if message was sent less than 15 minutes ago
    const messageAge = Date.now() - message.timestamp.getTime();
    const fifteenMinutesInMs = 15 * 60 * 1000;

    if (messageAge > fifteenMinutesInMs) {
      throw ForbiddenError(
        'Messages can only be edited within 15 minutes of sending'
      );
    }

    // Update message
    message.content = trimmedContent;
    message.editedAt = new Date();
    await message.save();

    logger.info('Message updated', {
      userId: currentUserId,
      messageId,
    });

    // Broadcast edited message via Socket.io
    const socketHandler = getSocketHandler();
    if (socketHandler) {
      socketHandler.broadcastEditedMessage({
        messageId: (message._id as any).toString(),
        chatId: message.chatId.toString(),
        content: message.content,
        editedAt: message.editedAt!.toISOString(),
      });
    }

    res.status(200).json({
      message: 'Message updated',
      data: {
        id: message._id,
        content: message.content,
        editedAt: message.editedAt,
      },
    });
  })
);

/**
 * @swagger
 * /api/messages/{messageId}:
 *   delete:
 *     summary: Удалить сообщение
 *     description: Удаляет сообщение. Можно удалить только свое сообщение. Если forAll=true, удаляется для всех участников чата в течение 24 часов после отправки.
 *     tags: [Messages]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: messageId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID сообщения
 *         example: "507f1f77bcf86cd799439015"
 *       - in: query
 *         name: forAll
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Удалить сообщение для всех участников чата (только в течение 24 часов)
 *         example: true
 *     responses:
 *       200:
 *         description: Сообщение успешно удалено
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *             example:
 *               message: "Message deleted successfully"
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       409:
 *         description: Время для удаления для всех истекло
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: 'TOO_LATE_TO_DELETE_FOR_ALL',
 *                 message: 'Messages can only be deleted for all participants within 24 hours of sending',
 *                 details: []
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
// DELETE /api/messages/:messageId?forAll=false - Delete a message
router.delete(
  '/:messageId',
  authMiddleware,
  asyncHandler(async (req: Request, res: Response) => {
    const { messageId } = req.params;
    const { forAll } = req.query;
    const currentUserId = req.user!.userId;
    const currentUserObjectId = new Types.ObjectId(currentUserId);

    // Validate messageId
    if (!Types.ObjectId.isValid(messageId)) {
      throw BadRequestError('Invalid message ID format');
    }

    // Parse forAll parameter
    const deleteForAll = forAll === 'true';

    // Find message
    const message = await Message.findById(messageId);

    if (!message) {
      throw NotFoundError('Message not found');
    }

    // Find chat to verify participation
    const chat = await Chat.findById(message.chatId);

    if (!chat) {
      throw NotFoundError('Chat not found');
    }

    const isParticipant = chat.participants.some(participant =>
      participant.equals(currentUserObjectId)
    );

    if (!isParticipant) {
      throw ForbiddenError('You are not a participant of this chat');
    }

    if (deleteForAll) {
      // Hard delete - only sender can delete for all
      if (!message.senderId.equals(currentUserObjectId)) {
        throw ForbiddenError('Only the sender can delete message for everyone');
      }

      // Check if message is less than 24 hours old
      const messageAge = Date.now() - message.timestamp.getTime();
      const twentyFourHoursInMs = 24 * 60 * 60 * 1000;

      if (messageAge > twentyFourHoursInMs) {
        throw ForbiddenError(
          'Messages can only be deleted for everyone within 24 hours of sending'
        );
      }

      // Delete message
      await Message.findByIdAndDelete(messageId);

      logger.info('Message deleted for everyone', {
        userId: currentUserId,
        messageId,
      });

      // Broadcast deleted message via Socket.io
      const socketHandler = getSocketHandler();
      if (socketHandler) {
        socketHandler.broadcastDeletedMessage({
          messageId: messageId,
          chatId: message.chatId.toString(),
        });
      }
    } else {
      // Soft delete - add user to deletedFor array
      const userIdStr = currentUserObjectId.toString();
      const deletedForStrings = message.deletedFor.map((id: Types.ObjectId) =>
        id.toString()
      );

      if (!deletedForStrings.includes(userIdStr)) {
        message.deletedFor.push(currentUserObjectId);
        await message.save();
      }

      logger.info('Message deleted for user', {
        userId: currentUserId,
        messageId,
      });
    }

    res.status(200).json({
      message: 'Message deleted successfully',
    });
  })
);

export default router;
