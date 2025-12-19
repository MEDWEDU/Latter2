import { Router, Request, Response } from 'express';
import { AuthService } from '../database/services/AuthService';
import { User } from '../database/models/User';
import {
  hasRefreshToken,
  setRefreshToken,
  setUserStatus,
  invalidateAllRefreshTokens,
} from '../database/redis/redisUtils';
import {
  asyncHandler,
  BadRequestError,
  UnauthorizedError,
  ConflictError,
} from '../utils';
import { authMiddleware } from '../middleware/auth';
import logger from '../utils/logger';
import {
  getRedis,
  isRedisConnected,
} from '../database/config/redis/redisConnection';
import { getRedisConfig } from '../database/config/redis/redisConfig';

const router = Router();

const generateSixDigitCode = (): string => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

const setRegistrationData = async (
  email: string,
  password: string,
  code: string,
  ttl?: number
): Promise<boolean> => {
  const config = getRedisConfig();
  const expirationTime = ttl || config.emailCodeTTL;
  const key = `registration:${email.toLowerCase()}`;

  const data = JSON.stringify({ password, code });

  try {
    if (isRedisConnected()) {
      const redis = getRedis();
      if (redis) {
        await redis.setex(key, expirationTime, data);
        logger.info(
          `Registration data set for ${email} (TTL: ${expirationTime}s)`
        );
        return true;
      }
    }

    logger.warn('Redis not connected, registration may fail on verification');
    return false;
  } catch (error) {
    logger.error('Error setting registration data:', error);
    return false;
  }
};

const getRegistrationData = async (
  email: string
): Promise<{ password: string; code: string } | null> => {
  const key = `registration:${email.toLowerCase()}`;

  try {
    if (isRedisConnected()) {
      const redis = getRedis();
      if (redis) {
        const data = await redis.get(key);
        if (data) {
          logger.info(`Registration data retrieved for ${email}`);
          return JSON.parse(data);
        }
      }
    }

    logger.warn('Redis not connected or data not found');
    return null;
  } catch (error) {
    logger.error('Error getting registration data:', error);
    return null;
  }
};

const deleteRegistrationData = async (email: string): Promise<boolean> => {
  const key = `registration:${email.toLowerCase()}`;

  try {
    if (isRedisConnected()) {
      const redis = getRedis();
      if (redis) {
        const result = await redis.del(key);
        logger.info(`Registration data deleted for ${email}`);
        return result > 0;
      }
    }

    return false;
  } catch (error) {
    logger.error('Error deleting registration data:', error);
    return false;
  }
};

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Регистрация нового пользователя
 *     description: Отправляет код подтверждения на указанный email. Код действителен в течение 15 минут.
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RegisterRequest'
 *           example:
 *             email: "user@example.com"
 *             password: "SecurePassword123!"
 *     responses:
 *       200:
 *         description: Код подтверждения отправлен на email
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Verification code sent to email"
 *                 email:
 *                   type: string
 *                   example: "user@example.com"
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       409:
 *         $ref: '#/components/responses/Conflict'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.post(
  '/register',
  asyncHandler(async (req: Request, res: Response) => {
    const { email, password } = req.body;

    if (!email || !password) {
      throw BadRequestError('Email and password are required');
    }

    if (!AuthService.validateEmail(email)) {
      throw BadRequestError('Invalid email format');
    }

    const passwordValidation = AuthService.validatePassword(password);
    if (!passwordValidation.valid) {
      throw BadRequestError(passwordValidation.errors.join(', '));
    }

    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      logger.warn(`Registration attempt for existing email: ${email}`);
      throw ConflictError('Email already registered');
    }

    const code = generateSixDigitCode();

    const stored = await setRegistrationData(email, password, code);
    if (!stored) {
      throw new Error('Failed to store verification code');
    }

    logger.info(`Registration initiated for email: ${email}`);

    res.status(200).json({
      message: 'Verification code sent to email',
      email: email.toLowerCase(),
    });
  })
);

/**
 * @swagger
 * /api/auth/verify-email:
 *   post:
 *     summary: Подтверждение email адреса
 *     description: Подтверждает email с помощью кода и создает пользователя. После успешного подтверждения возвращает токены доступа.
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/VerifyEmailRequest'
 *           example:
 *             email: "user@example.com"
 *             code: "123456"
 *     responses:
 *       201:
 *         description: Пользователь успешно создан и авторизован
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *             example:
 *               message: "User created successfully"
 *               accessToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *               refreshToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *               user:
 *                 id: "507f1f77bcf86cd799439011"
 *                 email: "user@example.com"
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.post(
  '/verify-email',
  asyncHandler(async (req: Request, res: Response) => {
    const { email, code } = req.body;

    if (!email || !code) {
      throw BadRequestError('Email and code are required');
    }

    if (!AuthService.validateEmail(email)) {
      throw BadRequestError('Invalid email format');
    }

    const registrationData = await getRegistrationData(email);
    if (!registrationData) {
      logger.warn(
        `Verification attempt with expired/invalid code for: ${email}`
      );
      throw UnauthorizedError('Invalid or expired code');
    }

    if (registrationData.code !== code) {
      logger.warn(`Verification attempt with wrong code for: ${email}`);
      throw UnauthorizedError('Invalid or expired code');
    }

    const passwordHash = await AuthService.hashPassword(
      registrationData.password
    );

    const user = await User.create({
      email: email.toLowerCase(),
      passwordHash,
      firstName: '',
      lastName: '',
      profile: {
        position: '',
        company: '',
        category: 'Other',
        skills: [],
      },
      emailVerified: true,
      status: 'offline',
    });

    await deleteRegistrationData(email);

    const userId = (
      user._id as unknown as { toString: () => string }
    ).toString();
    const accessToken = AuthService.generateAccessToken(userId);
    const refreshToken = AuthService.generateRefreshToken(userId);

    await setRefreshToken(userId, refreshToken);

    logger.info(`User created successfully: ${email} (ID: ${userId})`);

    res.status(201).json({
      message: 'User created successfully',
      accessToken,
      refreshToken,
      user: {
        id: userId,
        email: user.email,
      },
    });
  })
);

interface LoginRequestBody {
  email?: string;
  password?: string;
}

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Вход в систему
 *     description: Авторизует пользователя и возвращает токены доступа. Также обновляет статус пользователя на "online".
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginRequest'
 *           example:
 *             email: "user@example.com"
 *             password: "SecurePassword123!"
 *     responses:
 *       200:
 *         description: Успешная авторизация
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/AuthResponse'
 *                 - type: object
 *                   properties:
 *                     user:
 *                       allOf:
 *                         - $ref: '#/components/schemas/User'
 *                         - type: object
 *                           properties:
 *                             profile:
 *                               type: object
 *                               example:
 *                                 position: "Senior Developer"
 *                                 company: "TechCorp"
 *                                 category: "IT"
 *                                 skills: ["JavaScript", "React", "Node.js"]
 *             example:
 *               message: "Login successful"
 *               accessToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *               refreshToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *               user:
 *                 id: "507f1f77bcf86cd799439011"
 *                 email: "user@example.com"
 *                 firstName: "Иван"
 *                 lastName: "Петров"
 *                 profile:
 *                   position: "Senior Developer"
 *                   company: "TechCorp"
 *                   category: "IT"
 *                   skills: ["JavaScript", "React", "Node.js"]
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.post(
  '/login',
  asyncHandler(async (req: Request, res: Response) => {
    const { email, password } = req.body as LoginRequestBody;

    if (typeof email !== 'string' || typeof password !== 'string') {
      throw BadRequestError('Email and password are required');
    }

    const normalizedEmail = email.toLowerCase().trim();

    logger.info('Login attempt', { email: normalizedEmail });

    if (!AuthService.validateEmail(normalizedEmail)) {
      logger.warn('Login failed (invalid email format)', {
        email: normalizedEmail,
      });
      throw BadRequestError('Invalid email format');
    }

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      logger.warn('Login failed (invalid credentials)', {
        email: normalizedEmail,
      });
      throw UnauthorizedError('Invalid email or password');
    }

    const passwordMatches = await AuthService.comparePassword(
      password,
      user.passwordHash
    );

    if (!passwordMatches) {
      logger.warn('Login failed (invalid credentials)', {
        email: normalizedEmail,
      });
      throw UnauthorizedError('Invalid email or password');
    }

    const userId = (
      user._id as unknown as { toString: () => string }
    ).toString();

    const accessToken = AuthService.generateAccessToken(userId);
    const refreshToken = AuthService.generateRefreshToken(userId);

    const refreshStored = await setRefreshToken(userId, refreshToken);
    if (!refreshStored) {
      logger.warn(`Failed to store refresh token for user: ${userId}`);
    }

    const statusUpdated = await setUserStatus(userId, 'online');
    if (!statusUpdated) {
      logger.warn(`Failed to update online status for user: ${userId}`);
    }

    logger.info('Login successful', { email: normalizedEmail, userId });

    res.status(200).json({
      message: 'Login successful',
      accessToken,
      refreshToken,
      user: {
        id: userId,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        profile: {
          position: user.profile?.position || '',
          company: user.profile?.company || '',
          category: user.profile?.category || 'Other',
          skills: user.profile?.skills || [],
        },
      },
    });
  })
);

interface RefreshRequestBody {
  refreshToken?: string;
}

/**
 * @swagger
 * /api/auth/refresh:
 *   post:
 *     summary: Обновление токена доступа
 *     description: Обновляет access token с помощью refresh token. Refresh token должен быть валидным и находиться в хранилище.
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RefreshTokenRequest'
 *           example:
 *             refreshToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *     responses:
 *       200:
 *         description: Токен успешно обновлен
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Token refreshed"
 *                 accessToken:
 *                   type: string
 *                   description: "Новый JWT токен доступа (действует 24 часа)"
 *                   example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.post(
  '/refresh',
  asyncHandler(async (req: Request, res: Response) => {
    const { refreshToken } = req.body as RefreshRequestBody;

    if (typeof refreshToken !== 'string' || refreshToken.length === 0) {
      throw BadRequestError('Refresh token is required');
    }

    const verification = AuthService.verifyRefreshToken(refreshToken);
    if (!verification.valid || !verification.userId) {
      logger.warn('Token refresh failed (invalid or expired token)');
      throw UnauthorizedError('Invalid or expired refresh token');
    }

    const tokenIsStored = await hasRefreshToken(
      verification.userId,
      refreshToken
    );
    if (!tokenIsStored) {
      logger.warn('Token refresh failed (token not found in store)', {
        userId: verification.userId,
      });
      throw UnauthorizedError('Invalid or expired refresh token');
    }

    const accessToken = AuthService.generateAccessToken(verification.userId);

    logger.info('Token refreshed', { userId: verification.userId });

    res.status(200).json({
      message: 'Token refreshed',
      accessToken,
    });
  })
);

// POST /api/auth/logout - Logout user
router.post(
  '/logout',
  authMiddleware,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user?.userId;

    if (!userId) {
      throw UnauthorizedError('User not authenticated');
    }

    // Invalidate all refresh tokens for this user
    await invalidateAllRefreshTokens(userId);

    // Mark user as offline
    await setUserStatus(userId, 'offline');

    // Log security event
    logger.info('User logged out successfully', {
      userId,
      timestamp: new Date().toISOString(),
    });

    res.status(200).json({
      message: 'Logged out successfully',
    });
  })
);

export default router;
