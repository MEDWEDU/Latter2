import { Router, Request, Response } from 'express';
import {
  getConnectionState,
  getRedisConnectionState,
  isRedisHealthy,
} from '../database';

const router = Router();

/**
 * @swagger
 * /api/health:
 *   get:
 *     summary: Проверка состояния сервиса
 *     description: Общая проверка состояния API, базы данных и Redis. Возвращает статус всех компонентов системы.
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Сервис работает нормально
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "OK"
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                   example: "2024-01-15T10:30:00.000Z"
 *                 uptime:
 *                   type: number
 *                   description: Время работы сервера в секундах
 *                   example: 3600
 *                 message:
 *                   type: string
 *                   example: "Lettera Server is healthy!"
 *                 environment:
 *                   type: string
 *                   example: "development"
 *                 database:
 *                   type: object
 *                   properties:
 *                     connected:
 *                       type: boolean
 *                       example: true
 *                     host:
 *                       type: string
 *                       example: "localhost"
 *                     port:
 *                       type: integer
 *                       example: 27017
 *                     name:
 *                       type: string
 *                       example: "lettera"
 *                     readyState:
 *                       type: integer
 *                       example: 1
 *                 redis:
 *                   type: object
 *                   properties:
 *                     connected:
 *                       type: boolean
 *                       example: true
 *                     status:
 *                       type: string
 *                       example: "connected"
 *                     host:
 *                       type: string
 *                       example: "localhost"
 *                     port:
 *                       type: integer
 *                       example: 6379
 *       503:
 *         description: Один или несколько сервисов недоступны
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "DEGRADED"
 *                 message:
 *                   type: string
 *                   example: "Some services are unavailable"
 *                 database:
 *                   type: object
 *                   properties:
 *                     connected:
 *                       type: boolean
 *                       example: false
 *                 redis:
 *                   type: object
 *                   properties:
 *                     connected:
 *                       type: boolean
 *                       example: false
 */
/**
 * @route GET /api/health
 * @desc Health check endpoint
 * @access Public
 */
router.get('/', async (_req: Request, res: Response) => {
  const dbState = getConnectionState();
  const redisState = getRedisConnectionState();
  const redisHealthy = await isRedisHealthy().catch(() => false);

  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    message: 'Lettera Server is healthy!',
    environment: process.env.NODE_ENV || 'development',
    database: {
      connected: dbState.readyState === 1,
      host: dbState.host,
      port: dbState.port,
      name: dbState.name,
      readyState: dbState.readyState,
    },
    redis: {
      connected: redisHealthy,
      status: redisState.status,
      host: redisState.host,
      port: redisState.port,
    },
  });
});

/**
 * @swagger
 * /api/health/db:
 *   get:
 *     summary: Проверка состояния базы данных
 *     description: Детальная проверка состояния подключения к MongoDB.
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: База данных доступна
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 database:
 *                   type: object
 *                   properties:
 *                     connected:
 *                       type: boolean
 *                       example: true
 *                     readyState:
 *                       type: integer
 *                       example: 1
 *                     readyStateText:
 *                       type: string
 *                       example: "connected"
 *                     host:
 *                       type: string
 *                       example: "localhost"
 *                     port:
 *                       type: integer
 *                       example: 27017
 *                     name:
 *                       type: string
 *                       example: "lettera"
 *                     timestamp:
 *                       type: string
 *                       format: date-time
 *                       example: "2024-01-15T10:30:00.000Z"
 *       503:
 *         description: База данных недоступна
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 database:
 *                   type: object
 *                   properties:
 *                     connected:
 *                       type: boolean
 *                       example: false
 *                     readyState:
 *                       type: integer
 *                       example: 0
 *                     readyStateText:
 *                       type: string
 *                       example: "disconnected"
 *                     host:
 *                       type: string
 *                       example: "localhost"
 *                     port:
 *                       type: integer
 *                       example: 27017
 *                     name:
 *                       type: string
 *                       example: "lettera"
 *                     timestamp:
 *                       type: string
 *                       format: date-time
 *                       example: "2024-01-15T10:30:00.000Z"
 */
/**
 * @route GET /api/health/db
 * @desc Database health check endpoint
 * @access Public
 */
router.get('/db', (_req: Request, res: Response) => {
  const dbState = getConnectionState();

  const isConnected = dbState.readyState === 1;
  const stateMap = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting',
  };

  res.status(isConnected ? 200 : 503).json({
    database: {
      connected: isConnected,
      readyState: dbState.readyState,
      readyStateText:
        stateMap[dbState.readyState as keyof typeof stateMap] || 'unknown',
      host: dbState.host,
      port: dbState.port,
      name: dbState.name,
      timestamp: new Date().toISOString(),
    },
  });
});

/**
 * @swagger
 * /api/health/redis:
 *   get:
 *     summary: Проверка состояния Redis
 *     description: Детальная проверка состояния подключения к Redis.
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Redis доступен
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 redis:
 *                   type: object
 *                   properties:
 *                     connected:
 *                       type: boolean
 *                       example: true
 *                     status:
 *                       type: string
 *                       example: "connected"
 *                     host:
 *                       type: string
 *                       example: "localhost"
 *                     port:
 *                       type: integer
 *                       example: 6379
 *                     timestamp:
 *                       type: string
 *                       format: date-time
 *                       example: "2024-01-15T10:30:00.000Z"
 *                     fallback:
 *                       type: boolean
 *                       example: false
 *       503:
 *         description: Redis недоступен
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 redis:
 *                   type: object
 *                   properties:
 *                     connected:
 *                       type: boolean
 *                       example: false
 *                     status:
 *                       type: string
 *                       example: "disconnected"
 *                     host:
 *                       type: string
 *                       example: "localhost"
 *                     port:
 *                       type: integer
 *                       example: 6379
 *                     timestamp:
 *                       type: string
 *                       format: date-time
 *                       example: "2024-01-15T10:30:00.000Z"
 *                     fallback:
 *                       type: boolean
 *                       example: true
 */
/**
 * @route GET /api/health/redis
 * @desc Redis health check endpoint
 * @access Public
 */
router.get('/redis', async (_req: Request, res: Response) => {
  const redisState = getRedisConnectionState();
  const redisHealthy = await isRedisHealthy().catch(() => false);

  res.status(redisHealthy ? 200 : 503).json({
    redis: {
      connected: redisHealthy,
      status: redisState.status,
      host: redisState.host,
      port: redisState.port,
      timestamp: new Date().toISOString(),
      fallback: !redisHealthy && redisState.status !== 'connected',
    },
  });
});

export default router;
