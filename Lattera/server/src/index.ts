import express from 'express';
import http from 'http';
import cors from 'cors';
import dotenv from 'dotenv';
import swaggerUI from 'swagger-ui-express';
import { Server as SocketIOServer } from 'socket.io';
import healthRouter from './routes/health';
import mediaRouter from './routes/media';
import authRouter from './routes/auth';
import usersRouter from './routes/users';
import chatsRouter from './routes/chats';
import messagesRouter from './routes/messages';
import feedbackRouter from './routes/feedback';
import { swaggerSpec } from './swagger/swaggerConfig';
import {
  connectDB,
  createIndexes,
  initializeRedis,
  setupRedisGracefulShutdown,
} from './database';
import { requestLogger } from './middleware/requestLogger';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { setupSocket } from './websocket/socketHandler';
import { setSocketHandler } from './utils/socketManager';
import logger from './utils/logger';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Request logging middleware
app.use(requestLogger);

// Middleware
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Swagger UI
app.use('/api-docs', swaggerUI.serve, swaggerUI.setup(swaggerSpec, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'Lettera API Documentation',
  swaggerOptions: {
    persistAuthorization: true,
    displayRequestDuration: true,
    filter: true,
    showExtensions: true,
    showCommonExtensions: true,
  },
}));

// Routes
app.use('/api/health', healthRouter);
app.use('/api/media', mediaRouter);
app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/chats', chatsRouter);
app.use('/api/messages', messagesRouter);
app.use('/api/feedback-requests', feedbackRouter);

// Root route
app.get('/', (_req, res) => {
  res.json({
    message: 'Lettera Server API',
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
  });
});

// 404 handler (must be before error handler)
app.use('*', notFoundHandler);

// Global error handler (must be last)
app.use(errorHandler);

// Initialize database connection and start server
const startServer = async () => {
  try {
    logger.info('🚀 Starting Lettera Server...');

    // Подключаемся к базе данных
    logger.info('=== DATABASE CONNECTION ===');
    await connectDB();

    // Создаем индексы
    await createIndexes();

    // Подключаемся к Redis (не блокирует, если Redis недоступен)
    logger.info('=== REDIS CONNECTION ===');
    await initializeRedis();
    setupRedisGracefulShutdown();

    // Create HTTP server with Socket.io support
    const httpServer = http.createServer(app);

    // Initialize Socket.io server
    const io = new SocketIOServer(httpServer, {
      cors: {
        origin: process.env.FRONTEND_URL || true,
        credentials: true,
      },
      transports: ['websocket', 'polling'],
      maxHttpBufferSize: 1e6, // 1MB for file uploads
    });

    // Initialize Socket.io handler with Redis support
    const { getRedis } = await import('./database/redis/index');
    const redisClient = getRedis();
    const socketHandler = setupSocket(io, redisClient);

    // Register socket handler globally for use throughout the application
    setSocketHandler(socketHandler);

    // Start HTTP server
    httpServer.listen(PORT, () => {
      logger.info(`✅ Server is running on port ${PORT}`);
      logger.info(`📖 API documentation available at http://localhost:${PORT}`);
      logger.info(
        `🏥 Health check available at http://localhost:${PORT}/api/health`
      );
      logger.info(
        `🗄️  Database health check: http://localhost:${PORT}/api/health/db`
      );
      logger.info(
        `📡 Redis health check: http://localhost:${PORT}/api/health/redis`
      );
      logger.info(`📎 Media uploads: http://localhost:${PORT}/api/media`);
      logger.info(`🔌 Socket.io real-time messaging enabled`);
    });

    // Graceful shutdown
    const gracefulShutdown = (signal: string) => {
      logger.info(`🛑 Received ${signal}. Graceful shutdown starting...`);

      httpServer.close(() => {
        logger.info('🔌 HTTP server closed');
        logger.info('👋 Goodbye!');
        process.exit(0);
      });

      // Close Socket.io connections
      io.close();
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  } catch (error) {
    logger.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

// Start the server
startServer();

export default app;
