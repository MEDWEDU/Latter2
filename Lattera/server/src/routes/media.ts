import express, { Request, Response } from 'express';
import multer from 'multer';
import { s3Service, ALLOWED_MIME_TYPES } from '../database/services/S3Service';
import { MediaFile } from '../database/models/MediaFile';
import { Types } from 'mongoose';
import { asyncHandler } from '../utils';
import HttpError from '../utils/HttpError';

const router = express.Router();

// Настройка multer для обработки файлов в памяти
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB максимальный размер (будет перепроверен в сервисе)
  },
  fileFilter: (_req, file, cb) => {
    // Проверка MIME-типа
    const allAllowedTypes = Object.values(
      ALLOWED_MIME_TYPES
    ).flat() as string[];
    if (allAllowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Неподдерживаемый тип файла: ${file.mimetype}`));
    }
  },
});

/**
 * @swagger
 * /api/media/upload:
 *   post:
 *     summary: Загрузить файл в S3
 *     description: Загружает файл в Amazon S3 и создает запись в базе данных. Поддерживает изображения, аудио, видео и документы.
 *     tags: [Media]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *               - userId
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: Файл для загрузки (максимум 100MB)
 *               userId:
 *                 type: string
 *                 description: ID пользователя
 *                 example: "507f1f77bcf86cd799439011"
 *     responses:
 *       200:
 *         description: Файл успешно загружен
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Media'
 *             example:
 *               id: "507f1f77bcf86cd799439014"
 *               fileName: "image.jpg"
 *               fileSize: 102400
 *               mimeType: "image/jpeg"
 *               uploadUrl: "https://s3.amazonaws.com/lettera/uploads/uuid-filename.jpg"
 *               downloadUrl: "https://s3.amazonaws.com/lettera/uploads/uuid-filename.jpg?signature=xyz"
 *               uploadedAt: "2024-01-15T10:30:00.000Z"
 *       400:
 *         description: Неверный запрос
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               fileMissing:
 *                 summary: Файл не загружен
 *                 value:
 *                   error:
 *                     code: "FILE_MISSING"
 *                     message: "Файл не был загружен"
 *                     details: []
 *               invalidUserId:
 *                 summary: Неверный ID пользователя
 *                 value:
 *                   error:
 *                     code: "INVALID_USER_ID"
 *                     message: "Некорректный ID пользователя"
 *                     details: []
 *               unsupportedFileType:
 *                 summary: Неподдерживаемый тип файла
 *                 value:
 *                   error:
 *                     code: "UNSUPPORTED_FILE_TYPE"
 *                     message: "Неподдерживаемый тип файла: image/gif"
 *                     details: []
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
/**
 * @route POST /api/media/upload
 * @desc Загрузка медиафайла
 * @access Private
 */
router.post(
  '/upload',
  upload.single('file'),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) {
      throw new HttpError(400, 'Файл не был загружен', 'FILE_MISSING');
    }

    const userId = req.body.userId;
    if (!userId || !Types.ObjectId.isValid(userId)) {
      throw new HttpError(
        400,
        'Некорректный ID пользователя',
        'INVALID_USER_ID'
      );
    }

    const result = await s3Service.uploadFile(
      req.file.buffer,
      req.file.mimetype,
      userId,
      req.file.originalname
    );

    res.json({
      success: true,
      data: {
        url: result.url,
        key: result.key,
        type: result.type,
        size: result.size,
        mimeType: result.mimeType,
        uploadedAt: result.uploadedAt,
      },
    });
  })
);

/**
 * @swagger
 * /api/media/{url}:
 *   delete:
 *     summary: Удалить файл
 *     description: Удаляет файл из S3 и из базы данных. Можно удалять только свои файлы.
 *     tags: [Media]
 *     parameters:
 *       - in: path
 *         name: url
 *         required: true
 *         schema:
 *           type: string
 *         description: URL файла ( закодированный )
 *         example: "uploads%2Fuuid-filename.jpg"
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               userId:
 *                 type: string
 *                 description: ID пользователя
 *                 example: "507f1f77bcf86cd799439011"
 *           example:
 *             userId: "507f1f77bcf86cd799439011"
 *     responses:
 *       200:
 *         description: Файл успешно удален
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Файл успешно удален"
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
/**
 * @route DELETE /api/media/:url
 * @desc Удаление медиафайла
 * @access Private
 */
router.delete(
  '/:url(*)',
  asyncHandler(async (req: Request, res: Response) => {
    const fileUrl = decodeURIComponent(req.params.url);
    const userId = req.body.userId;

    if (userId && Types.ObjectId.isValid(userId)) {
      const mediaFile = await MediaFile.findOne({
        url: fileUrl,
        uploadedBy: new Types.ObjectId(userId),
      });

      if (!mediaFile) {
        throw new HttpError(
          404,
          'Файл не найден или у вас нет прав для его удаления',
          'FILE_NOT_FOUND_OR_FORBIDDEN'
        );
      }
    }

    await s3Service.deleteFile(fileUrl, userId);

    res.json({
      success: true,
      message: 'Файл успешно удален',
    });
  })
);

/**
 * @route GET /api/media/presigned/:key
 * @desc Получение временного URL для скачивания файла
 * @access Private
 */
/**
 * @swagger
 * /api/media/presigned/{key}:
 *   get:
 *     summary: Получить presigned URL для скачивания
 *     description: Возвращает временный URL для скачивания файла из S3.
 *     tags: [Media]
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema:
 *           type: string
 *         description: Ключ файла в S3
 *         example: "uploads/uuid-filename.jpg"
 *       - in: query
 *         name: expiresIn
 *         schema:
 *           type: integer
 *           minimum: 60
 *           maximum: 86400
 *           default: 3600
 *         description: Время жизни URL в секундах (1 минута - 24 часа)
 *         example: 3600
 *     responses:
 *       200:
 *         description: Presigned URL успешно получен
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     url:
 *                       type: string
 *                       format: uri
 *                       description: Временный URL для скачивания
 *                       example: "https://s3.amazonaws.com/lettera/uploads/uuid-filename.jpg?signature=abc123&x-amz-expires=3600"
 *                     expiresIn:
 *                       type: integer
 *                       description: Время жизни URL в секундах
 *                       example: 3600
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.get(
  '/presigned/:key(*)',
  asyncHandler(async (req: Request, res: Response) => {
    const key = req.params.key;
    const expiresIn = parseInt(req.query.expiresIn as string) || 3600;

    const exists = await s3Service.fileExists(key);
    if (!exists) {
      throw new HttpError(404, 'Файл не найден', 'FILE_NOT_FOUND');
    }

    const presignedUrl = await s3Service.generatePresignedUrl(key, expiresIn);

    res.json({
      success: true,
      data: {
        url: presignedUrl,
        expiresIn,
      },
    });
  })
);

/**
 * @route GET /api/media/user/:userId/stats
 * @desc Получение статистики файлов пользователя
 * @access Private
 */
/**
 * @swagger
 * /api/media/user/{userId}/stats:
 *   get:
 *     summary: Получить статистику файлов пользователя
 *     description: Возвращает общую статистику файлов пользователя (количество, общий размер по типам).
 *     tags: [Media]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID пользователя
 *         example: "507f1f77bcf86cd799439011"
 *     responses:
 *       200:
 *         description: Статистика файлов
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     totalFiles:
 *                       type: integer
 *                       description: Общее количество файлов
 *                       example: 25
 *                     totalSize:
 *                       type: integer
 *                       description: Общий размер файлов в байтах
 *                       example: 52428800
 *                     byType:
 *                       type: object
 *                       properties:
 *                         images:
 *                           type: integer
 *                           example: 15
 *                         videos:
 *                           type: integer
 *                           example: 5
 *                         audio:
 *                           type: integer
 *                           example: 3
 *                         documents:
 *                           type: integer
 *                           example: 2
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.get(
  '/user/:userId/stats',
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = req.params;

    if (!Types.ObjectId.isValid(userId)) {
      throw new HttpError(
        400,
        'Некорректный ID пользователя',
        'INVALID_USER_ID'
      );
    }

    const stats = await s3Service.getUserFileStats(userId);

    res.json({
      success: true,
      data: stats,
    });
  })
);

/**
 * @route GET /api/media/user/:userId/files
 * @desc Получение списка файлов пользователя с пагинацией
 * @access Private
 */
/**
 * @swagger
 * /api/media/user/{userId}/files:
 *   get:
 *     summary: Получить список файлов пользователя
 *     description: Возвращает список файлов пользователя с пагинацией и фильтрацией по типу.
 *     tags: [Media]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID пользователя
 *         example: "507f1f77bcf86cd799439011"
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
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [images, videos, audio, documents]
 *         description: Фильтр по типу файлов
 *         example: "images"
 *     responses:
 *       200:
 *         description: Список файлов пользователя
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     files:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Media'
 *                     total:
 *                       type: integer
 *                       description: Общее количество файлов
 *                       example: 25
 *                     limit:
 *                       type: integer
 *                       description: Максимальное количество результатов
 *                       example: 20
 *                     offset:
 *                       type: integer
 *                       description: Смещение для пагинации
 *                       example: 0
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.get(
  '/user/:userId/files',
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const type = req.query.type as 'image' | 'audio' | 'video' | undefined;

    if (!Types.ObjectId.isValid(userId)) {
      throw new HttpError(
        400,
        'Некорректный ID пользователя',
        'INVALID_USER_ID'
      );
    }

    const query: { uploadedBy: Types.ObjectId; type?: string } = {
      uploadedBy: new Types.ObjectId(userId),
    };
    if (type) {
      query.type = type;
    }

    const files = await MediaFile.find(query)
      .sort({ uploadedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select('-__v');

    const total = await MediaFile.countDocuments(query);

    res.json({
      success: true,
      data: {
        files,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      },
    });
  })
);

export default router;
