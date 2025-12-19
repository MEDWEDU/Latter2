import { Router, Request, Response } from 'express';
import { Types } from 'mongoose';
import { FeedbackRequest } from '../database/models/FeedbackRequest';
import { Message } from '../database/models/Message';
import { Chat } from '../database/models/Chat';
import { User } from '../database/models/User';
import { authMiddleware } from '../middleware/auth';
import {
  asyncHandler,
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
} from '../utils';
import logger from '../utils/logger';

const router = Router();

interface CreateFeedbackRequestBody {
  messageId: string;
  responderId: string;
}

interface UpdateFeedbackRequestBody {
  status: 'responded' | 'expired';
}

interface PopulatedFeedbackRequest {
  _id: Types.ObjectId;
  messageId: {
    _id: Types.ObjectId;
    content: string;
    senderId: Types.ObjectId;
    timestamp: Date;
  };
  requesterId: {
    _id: Types.ObjectId;
    firstName: string;
    lastName: string;
  };
  responderId: {
    _id: Types.ObjectId;
    firstName: string;
    lastName: string;
  };
  chatId: Types.ObjectId;
  status: 'pending' | 'responded' | 'expired';
  requestedAt: Date;
  respondedAt?: Date;
  expiresAt: Date;
}

/**
 * @swagger
 * /api/feedback-requests:
 *   post:
 *     summary: Создать запрос обратной связи
 *     description: Создает запрос обратной связи на сообщение. Запрос действителен в течение 24 часов.
 *     tags: [Feedback]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - messageId
 *               - responderId
 *             properties:
 *               messageId:
 *                 type: string
 *                 description: ID сообщения для обратной связи
 *                 example: "507f1f77bcf86cd799439015"
 *               responderId:
 *                 type: string
 *                 description: ID пользователя, которому направляется запрос
 *                 example: "507f1f77bcf86cd799439012"
 *           example:
 *             messageId: "507f1f77bcf86cd799439015"
 *             responderId: "507f1f77bcf86cd799439012"
 *     responses:
 *       201:
 *         description: Запрос обратной связи успешно создан
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Feedback'
 *             example:
 *               id: "507f1f77bcf86cd799439016"
 *               userId: "507f1f77bcf86cd799439011"
 *               messageId: "507f1f77bcf86cd799439015"
 *               responderId: "507f1f77bcf86cd799439012"
 *               chatId: "507f1f77bcf86cd799439013"
 *               status: "pending"
 *               requestedAt: "2024-01-15T10:30:00.000Z"
 *               expiresAt: "2024-01-16T10:30:00.000Z"
 *               message: "Feedback request created successfully"
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       409:
 *         description: Запрос на обратную связь уже существует
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: 'FEEDBACK_REQUEST_EXISTS',
 *                 message: 'A feedback request for this message already exists',
 *                 details: []
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
// POST /api/feedback-requests - Create a new feedback request
router.post(
  '/',
  authMiddleware,
  asyncHandler(async (req: Request, res: Response) => {
    const { messageId, responderId } = req.body as CreateFeedbackRequestBody;
    const currentUserId = req.user!.userId;
    const currentUserObjectId = new Types.ObjectId(currentUserId);

    // Validate required fields
    if (!messageId || !responderId) {
      throw BadRequestError('messageId and responderId are required');
    }

    // Validate ObjectId formats
    if (!Types.ObjectId.isValid(messageId)) {
      throw BadRequestError('Invalid messageId format');
    }

    if (!Types.ObjectId.isValid(responderId)) {
      throw BadRequestError('Invalid responderId format');
    }

    // Prevent self-request
    if (responderId === currentUserId) {
      throw BadRequestError('Cannot request feedback from yourself');
    }

    // Check if message exists
    const message = await Message.findById(messageId);
    if (!message) {
      throw NotFoundError('Message not found');
    }

    // Check if responder is a valid user
    const responder = await User.findById(responderId);
    if (!responder) {
      throw BadRequestError('Responder user not found');
    }

    // Verify user has access to the chat containing the message
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

    // Verify responder is also a participant in the chat
    const responderIsParticipant = chat.participants.some(participant =>
      participant.equals(new Types.ObjectId(responderId))
    );

    if (!responderIsParticipant) {
      throw BadRequestError('Responder must be a participant of the chat');
    }

    // Check for duplicate feedback request
    const existingRequest = await FeedbackRequest.findOne({
      messageId: new Types.ObjectId(messageId),
    });

    if (existingRequest) {
      throw ConflictError('Feedback request already exists for this message');
    }

    // Create feedback request
    const feedbackRequest = await FeedbackRequest.create({
      messageId: new Types.ObjectId(messageId),
      requesterId: currentUserObjectId,
      responderId: new Types.ObjectId(responderId),
      chatId: new Types.ObjectId(message.chatId),
      status: 'pending',
      requestedAt: new Date()
    });

    // Populate the response
    const populatedRequest = await FeedbackRequest.findById(feedbackRequest._id)
      .populate({
        path: 'messageId',
        select: 'content senderId timestamp',
      })
      .populate({
        path: 'requesterId',
        select: 'firstName lastName',
      })
      .populate({
        path: 'responderId',
        select: 'firstName lastName',
      })
      .lean() as unknown as PopulatedFeedbackRequest;

    logger.info('Feedback request created', {
      userId: currentUserId,
      requestId: feedbackRequest._id,
      messageId,
      responderId,
    });

    res.status(201).json({
      message: 'Feedback request created',
      data: {
        id: populatedRequest._id,
        messageId: populatedRequest.messageId._id,
        requesterId: populatedRequest.requesterId._id,
        responderId: populatedRequest.responderId._id,
        status: populatedRequest.status,
        requestedAt: populatedRequest.requestedAt,
        respondedAt: populatedRequest.respondedAt || null,
        expiresAt: populatedRequest.expiresAt,
        message: {
          id: populatedRequest.messageId._id,
          content: populatedRequest.messageId.content,
          senderId: populatedRequest.messageId.senderId,
          timestamp: populatedRequest.messageId.timestamp,
        },
        requester: {
          id: populatedRequest.requesterId._id,
          firstName: populatedRequest.requesterId.firstName,
          lastName: populatedRequest.requesterId.lastName,
        },
        responder: {
          id: populatedRequest.responderId._id,
          firstName: populatedRequest.responderId.firstName,
          lastName: populatedRequest.responderId.lastName,
        },
      },
    });
  })
);

/**
 * @swagger
 * /api/feedback-requests:
 *   get:
 *     summary: Получить активные запросы обратной связи
 *     description: Возвращает список активных запросов обратной связи для текущего пользователя с пагинацией и фильтрацией по статусу.
 *     tags: [Feedback]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, responded, expired]
 *         description: Фильтр по статусу запроса
 *         example: "pending"
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *         description: Максимальное количество результатов (1-100)
 *         example: 20
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
 *         description: Список запросов обратной связи
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/FeedbackListResponse'
 *             example:
 *               message: "Feedback requests retrieved"
 *               feedbackRequests:
 *                 - id: "507f1f77bcf86cd799439016"
 *                   messageId: "507f1f77bcf86cd799439015"
 *                   requesterId: "507f1f77bcf86cd799439011"
 *                   responderId: "507f1f77bcf86cd799439012"
 *                   chatId: "507f1f77bcf86cd799439013"
 *                   status: "pending"
 *                   requestedAt: "2024-01-15T10:30:00.000Z"
 *                   expiresAt: "2024-01-16T10:30:00.000Z"
 *               total: 1
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
// GET /api/feedback-requests - Get active feedback requests for current user
router.get(
  '/',
  authMiddleware,
  asyncHandler(async (req: Request, res: Response) => {
    const currentUserId = req.user!.userId;
    const currentUserObjectId = new Types.ObjectId(currentUserId);

    // Parse query parameters
    const { status: statusParam, limit: limitParam, offset: offsetParam } = req.query;

    let status: 'pending' | 'responded' | 'expired' | undefined;
    if (statusParam && typeof statusParam === 'string') {
      if (!['pending', 'responded', 'expired'].includes(statusParam)) {
        throw BadRequestError('Invalid status parameter. Must be pending, responded, or expired');
      }
      status = statusParam as 'pending' | 'responded' | 'expired';
    }

    let limit = 20; // default limit
    let offset = 0; // default offset

    if (limitParam !== undefined) {
      const parsedLimit = Number(limitParam);
      if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
        throw BadRequestError('limit must be an integer between 1 and 100');
      }
      limit = parsedLimit;
    }

    if (offsetParam !== undefined) {
      const parsedOffset = Number(offsetParam);
      if (!Number.isInteger(parsedOffset) || parsedOffset < 0) {
        throw BadRequestError('offset must be a non-negative integer');
      }
      offset = parsedOffset;
    }

    // Build query filter
    const filter: Record<string, unknown> = {
      $or: [
        { requesterId: currentUserObjectId },
        { responderId: currentUserObjectId },
      ],
    };

    if (status) {
      filter.status = status;
    } else {
      // Default to active requests (pending and not expired)
      filter.$and = [
        { status: 'pending' },
        { expiresAt: { $gte: new Date() } }
      ];
    }

    // Get total count
    const total = await FeedbackRequest.countDocuments(filter);

    // Get feedback requests with pagination
    const feedbackRequests = await FeedbackRequest.find(filter)
      .populate({
        path: 'messageId',
        select: 'content senderId timestamp',
      })
      .populate({
        path: 'requesterId',
        select: 'firstName lastName',
      })
      .populate({
        path: 'responderId',
        select: 'firstName lastName',
      })
      .sort({ requestedAt: -1 })
      .skip(offset)
      .limit(limit)
      .lean() as unknown as PopulatedFeedbackRequest[];

    logger.info('Feedback requests retrieved', {
      userId: currentUserId,
      total,
      count: feedbackRequests.length,
      status,
      limit,
      offset,
    });

    res.status(200).json({
      message: 'Feedback requests retrieved',
      requests: feedbackRequests.map(req => ({
        id: req._id,
        messageId: req.messageId._id,
        requesterId: req.requesterId._id,
        responderId: req.responderId._id,
        status: req.status,
        requestedAt: req.requestedAt,
        respondedAt: req.respondedAt || null,
        expiresAt: req.expiresAt,
        message: {
          id: req.messageId._id,
          content: req.messageId.content,
          senderId: req.messageId.senderId,
          timestamp: req.messageId.timestamp,
        },
        requester: {
          id: req.requesterId._id,
          firstName: req.requesterId.firstName,
          lastName: req.requesterId.lastName,
        },
        responder: {
          id: req.responderId._id,
          firstName: req.responderId.firstName,
          lastName: req.responderId.lastName,
        },
      })),
      total,
      count: feedbackRequests.length,
      limit,
      offset,
    });
  })
);

/**
 * @swagger
 * /api/feedback-requests/{id}:
 *   get:
 *     summary: Получить детали запроса обратной связи
 *     description: Возвращает подробную информацию о конкретном запросе обратной связи.
 *     tags: [Feedback]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID запроса обратной связи
 *         example: "507f1f77bcf86cd799439016"
 *     responses:
 *       200:
 *         description: Детали запроса обратной связи
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Feedback'
 *             example:
 *               id: "507f1f77bcf86cd799439016"
 *               messageId: "507f1f77bcf86cd799439015"
 *               requesterId: "507f1f77bcf86cd799439011"
 *               responderId: "507f1f77bcf86cd799439012"
 *               chatId: "507f1f77bcf86cd799439013"
 *               status: "pending"
 *               requestedAt: "2024-01-15T10:30:00.000Z"
 *               expiresAt: "2024-01-16T10:30:00.000Z"
 *               message:
 *                 id: "507f1f77bcf86cd799439015"
 *                 content: "Привет! Как дела?"
 *                 senderId: "507f1f77bcf86cd799439011"
 *                 timestamp: "2024-01-15T10:30:00.000Z"
 *               requester:
 *                 id: "507f1f77bcf86cd799439011"
 *                 firstName: "Иван"
 *                 lastName: "Петров"
 *               responder:
 *                 id: "507f1f77bcf86cd799439012"
 *                 firstName: "Анна"
 *                 lastName: "Смирнова"
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
// GET /api/feedback-requests/:id - Get specific feedback request
router.get(
  '/:id',
  authMiddleware,
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const currentUserId = req.user!.userId;
    const currentUserObjectId = new Types.ObjectId(currentUserId);

    // Validate ObjectId format
    if (!Types.ObjectId.isValid(id)) {
      throw BadRequestError('Invalid feedback request ID format');
    }

    // Find feedback request and verify user access
    const feedbackRequest = await FeedbackRequest.findById(id)
      .populate({
        path: 'messageId',
        select: 'content senderId timestamp',
      })
      .populate({
        path: 'requesterId',
        select: 'firstName lastName',
      })
      .populate({
        path: 'responderId',
        select: 'firstName lastName',
      })
      .lean() as unknown as PopulatedFeedbackRequest | null;

    if (!feedbackRequest) {
      throw NotFoundError('Feedback request not found');
    }

    // Check if user has access (is requester or responder)
    const hasAccess = 
      feedbackRequest.requesterId._id.equals(currentUserObjectId) ||
      feedbackRequest.responderId._id.equals(currentUserObjectId);

    if (!hasAccess) {
      throw ForbiddenError('You do not have access to this feedback request');
    }

    logger.info('Feedback request retrieved', {
      userId: currentUserId,
      requestId: id,
    });

    res.status(200).json({
      message: 'Feedback request retrieved',
      data: {
        id: feedbackRequest._id,
        messageId: feedbackRequest.messageId._id,
        requesterId: feedbackRequest.requesterId._id,
        responderId: feedbackRequest.responderId._id,
        status: feedbackRequest.status,
        requestedAt: feedbackRequest.requestedAt,
        respondedAt: feedbackRequest.respondedAt || null,
        expiresAt: feedbackRequest.expiresAt,
        message: {
          id: feedbackRequest.messageId._id,
          content: feedbackRequest.messageId.content,
          senderId: feedbackRequest.messageId.senderId,
          timestamp: feedbackRequest.messageId.timestamp,
        },
        requester: {
          id: feedbackRequest.requesterId._id,
          firstName: feedbackRequest.requesterId.firstName,
          lastName: feedbackRequest.requesterId.lastName,
        },
        responder: {
          id: feedbackRequest.responderId._id,
          firstName: feedbackRequest.responderId.firstName,
          lastName: feedbackRequest.responderId.lastName,
        },
      },
    });
  })
);

/**
 * @swagger
 * /api/feedback-requests/{id}:
 *   patch:
 *     summary: Обновить статус запроса обратной связи
 *     description: Обновляет статус запроса обратной связи. Только получатель запроса может изменить статус.
 *     tags: [Feedback]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID запроса обратной связи
 *         example: "507f1f77bcf86cd799439016"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateFeedbackRequest'
 *           example:
 *             status: "responded"
 *     responses:
 *       200:
 *         description: Статус запроса обратной связи успешно обновлен
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Feedback request status updated"
 *                 data:
 *                   $ref: '#/components/schemas/Feedback'
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
// PATCH /api/feedback-requests/:id - Update feedback request status
router.patch(
  '/:id',
  authMiddleware,
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { status } = req.body as UpdateFeedbackRequestBody;
    const currentUserId = req.user!.userId;
    const currentUserObjectId = new Types.ObjectId(currentUserId);

    // Validate ObjectId format
    if (!Types.ObjectId.isValid(id)) {
      throw BadRequestError('Invalid feedback request ID format');
    }

    // Validate status
    if (!status || !['responded', 'expired'].includes(status)) {
      throw BadRequestError('status is required and must be responded or expired');
    }

    // Find feedback request
    const feedbackRequest = await FeedbackRequest.findById(id);
    if (!feedbackRequest) {
      throw NotFoundError('Feedback request not found');
    }

    // Only responder can update status
    if (!feedbackRequest.responderId.equals(currentUserObjectId)) {
      throw ForbiddenError('Only the responder can update this feedback request status');
    }

    // Check if request is already expired
    if (feedbackRequest.status === 'expired' || new Date() > feedbackRequest.expiresAt) {
      feedbackRequest.status = 'expired';
      await feedbackRequest.save();
      throw BadRequestError('Cannot update status of expired request');
    }

    // Prevent reverting back to pending (status can only be responded or expired)
    if (feedbackRequest.status === 'responded' && status === 'responded') {
      throw BadRequestError('Request has already been responded to');
    }

    // Update status
    if (status === 'responded') {
      feedbackRequest.status = 'responded';
      feedbackRequest.respondedAt = new Date();
    } else if (status === 'expired') {
      feedbackRequest.status = 'expired';
    }

    await feedbackRequest.save();

    // Populate response
    const updatedRequest = await FeedbackRequest.findById(id)
      .populate({
        path: 'messageId',
        select: 'content senderId timestamp',
      })
      .populate({
        path: 'requesterId',
        select: 'firstName lastName',
      })
      .populate({
        path: 'responderId',
        select: 'firstName lastName',
      })
      .lean() as unknown as PopulatedFeedbackRequest;

    logger.info('Feedback request updated', {
      userId: currentUserId,
      requestId: id,
      newStatus: status,
    });

    res.status(200).json({
      message: 'Feedback request updated',
      data: {
        id: updatedRequest._id,
        messageId: updatedRequest.messageId._id,
        requesterId: updatedRequest.requesterId._id,
        responderId: updatedRequest.responderId._id,
        status: updatedRequest.status,
        requestedAt: updatedRequest.requestedAt,
        respondedAt: updatedRequest.respondedAt || null,
        expiresAt: updatedRequest.expiresAt,
        message: {
          id: updatedRequest.messageId._id,
          content: updatedRequest.messageId.content,
          senderId: updatedRequest.messageId.senderId,
          timestamp: updatedRequest.messageId.timestamp,
        },
        requester: {
          id: updatedRequest.requesterId._id,
          firstName: updatedRequest.requesterId.firstName,
          lastName: updatedRequest.requesterId.lastName,
        },
        responder: {
          id: updatedRequest.responderId._id,
          firstName: updatedRequest.responderId.firstName,
          lastName: updatedRequest.responderId.lastName,
        },
      },
    });
  })
);

export default router;