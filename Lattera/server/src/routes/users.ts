import { Router, Request, Response } from 'express';
import { FilterQuery, Types } from 'mongoose';
import { AuthService } from '../database/services/AuthService';
import { SearchHistory } from '../database/models/SearchHistory';
import { User, IUser } from '../database/models/User';
import {
  invalidateAllRefreshTokens,
  setRefreshToken,
} from '../database/redis/redisUtils';
import { authMiddleware } from '../middleware/auth';
import {
  asyncHandler,
  BadRequestError,
  NotFoundError,
  UnauthorizedError,
} from '../utils';
import logger from '../utils/logger';

const router = Router();

const VALID_PROFILE_CATEGORIES = [
  'IT',
  'Marketing',
  'Design',
  'Finance',
  'Other',
] as const;

type ProfileCategory = (typeof VALID_PROFILE_CATEGORIES)[number];

interface PasswordChangeRequest {
  oldPassword: string;
  newPassword: string;
}

interface ProfileUpdateRequest {
  firstName?: string;
  lastName?: string;
  profile?: {
    position?: string;
    company?: string;
    category?: ProfileCategory;
    skills?: string[];
  };
}

const escapeRegex = (value: string): string => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

const parseOptionalSingleString = (
  value: unknown,
  name: string,
  maxLength: number
): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw BadRequestError(`${name} must be a string`);
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;

  if (trimmed.length > maxLength) {
    throw BadRequestError(`${name} must be less than ${maxLength} characters`);
  }

  return trimmed;
};

const parseIntParam = (
  value: unknown,
  name: string,
  defaultValue: number
): number => {
  if (value === undefined) return defaultValue;
  if (typeof value !== 'string') {
    throw BadRequestError(`${name} must be a number`);
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) {
    throw BadRequestError(`${name} must be a valid integer`);
  }

  return parsed;
};

/**
 * @swagger
 * /api/users/search:
 *   get:
 *     summary: Поиск пользователей
 *     description: Поиск пользователей по категории, компании, навыкам и текстовому запросу. Поддерживает пагинацию и текстовый поиск.
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *           enum: [IT, Marketing, Design, Finance, Other]
 *         description: Фильтр по категории профиля
 *         example: "IT"
 *       - in: query
 *         name: company
 *         schema:
 *           type: string
 *         description: Фильтр по компании (частичное совпадение, без учета регистра)
 *         example: "TechCorp"
 *       - in: query
 *         name: skills
 *         schema:
 *           type: string
 *         description: Фильтр по навыкам (через запятую, максимум 10 навыков)
 *         example: "JavaScript,React"
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Текстовый поиск по имени, фамилии, должности и компании
 *         example: "developer"
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
 *         description: Список найденных пользователей
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SearchUsersResponse'
 *             example:
 *               message: "Users found"
 *               total: 42
 *               count: 20
 *               limit: 20
 *               offset: 0
 *               users:
 *                 - id: "507f1f77bcf86cd799439011"
 *                   firstName: "Иван"
 *                   lastName: "Петров"
 *                   profile:
 *                     position: "Senior Developer"
 *                     company: "TechCorp"
 *                     category: "IT"
 *                     skills: ["JavaScript", "React", "Node.js"]
 *                 - id: "507f1f77bcf86cd799439012"
 *                   firstName: "Анна"
 *                   lastName: "Смирнова"
 *                   profile:
 *                     position: "UI/UX Designer"
 *                     company: "DesignStudio"
 *                     category: "Design"
 *                     skills: ["Figma", "Photoshop", "Sketch"]
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
// GET /api/users/search - Search users
router.get(
  '/search',
  authMiddleware,
  asyncHandler(async (req: Request, res: Response) => {
    const categoryRaw = parseOptionalSingleString(
      req.query.category,
      'category',
      50
    );
    const company = parseOptionalSingleString(
      req.query.company,
      'company',
      100
    );
    const skillsRaw = parseOptionalSingleString(
      req.query.skills,
      'skills',
      500
    );
    const search = parseOptionalSingleString(req.query.search, 'search', 100);

    const limit = parseIntParam(req.query.limit, 'limit', 20);
    const offset = parseIntParam(req.query.offset, 'offset', 0);

    if (limit < 1 || limit > 100) {
      throw BadRequestError('limit must be an integer between 1 and 100');
    }

    if (offset < 0) {
      throw BadRequestError(
        'offset must be an integer greater than or equal to 0'
      );
    }

    let category: ProfileCategory | undefined;
    if (categoryRaw) {
      if (!VALID_PROFILE_CATEGORIES.includes(categoryRaw as ProfileCategory)) {
        throw BadRequestError(
          `category must be one of: ${VALID_PROFILE_CATEGORIES.join(', ')}`
        );
      }
      category = categoryRaw as ProfileCategory;
    }

    let skills: string[] = [];
    if (skillsRaw) {
      skills = skillsRaw
        .split(',')
        .map(skill => skill.trim())
        .filter(Boolean);

      skills = Array.from(new Set(skills));

      if (skills.length > 10) {
        throw BadRequestError('Maximum 10 skills allowed per query');
      }

      skills.forEach((skill, index) => {
        if (skill.length > 50) {
          throw BadRequestError(
            `Skill at index ${index} must be less than 50 characters`
          );
        }
      });
    }

    const query: Record<string, unknown> = {};

    if (Types.ObjectId.isValid(req.user!.userId)) {
      query._id = { $ne: new Types.ObjectId(req.user!.userId) };
    }

    if (category) {
      query['profile.category'] = category;
    }

    if (company) {
      query['profile.company'] = {
        $regex: escapeRegex(company),
        $options: 'i',
      };
    }

    if (skills.length > 0) {
      query['profile.skills'] = {
        $in: skills.map(skill => new RegExp(`^${escapeRegex(skill)}$`, 'i')),
      };
    }

    const useTextSearch = Boolean(search);
    if (search) {
      query.$text = { $search: search };
    }

    logger.info('User search request', {
      userId: req.user!.userId,
      hasCategory: Boolean(category),
      hasCompany: Boolean(company),
      skillsCount: skills.length,
      hasSearch: Boolean(search),
      limit,
      offset,
    });

    const mongoQuery = query as FilterQuery<IUser>;
    const total = await User.countDocuments(mongoQuery);

    type SelectFieldValue = 0 | 1 | { $meta: 'textScore' };

    const selectFields: Record<string, SelectFieldValue> = {
      firstName: 1,
      lastName: 1,
      avatarUrl: 1,
      profile: 1,
    };

    if (useTextSearch) {
      selectFields.score = { $meta: 'textScore' };
    }

    const sort: Record<string, 1 | -1 | { $meta: 'textScore' }> = useTextSearch
      ? { score: { $meta: 'textScore' }, createdAt: -1 }
      : { createdAt: -1 };

    const users = await User.find(mongoQuery)
      .select(selectFields)
      .sort(sort)
      .skip(offset * limit)
      .limit(limit)
      .lean();

    const historyQuery = {
      ...(category ? { category } : {}),
      ...(company ? { company } : {}),
      ...(skills.length > 0 ? { skills } : {}),
    };

    if (
      Object.keys(historyQuery).length > 0 &&
      Types.ObjectId.isValid(req.user!.userId)
    ) {
      SearchHistory.create({
        userId: new Types.ObjectId(req.user!.userId),
        query: historyQuery,
        resultsCount: Math.min(total, 1000),
        timestamp: new Date(),
      }).catch(error => {
        logger.warn('Failed to write search history record', {
          userId: req.user!.userId,
          error,
        });
      });
    }

    res.status(200).json({
      message: 'Users found',
      total,
      count: users.length,
      limit,
      offset,
      users: users.map(user => ({
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        avatarUrl: user.avatarUrl,
        profile: {
          position: user.profile?.position || '',
          company: user.profile?.company || '',
          category: (user.profile?.category || 'Other') as ProfileCategory,
          skills: user.profile?.skills || [],
        },
      })),
    });
  })
);

/**
 * @swagger
 * /api/users/me/password:
 *   patch:
 *     summary: Смена пароля
 *     description: Смена пароля текущего пользователя. При смене пароля все существующие refresh токены становятся недействительными, кроме текущей сессии.
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PasswordChangeRequest'
 *           example:
 *             oldPassword: "OldPassword123!"
 *             newPassword: "NewSecurePassword123!"
 *     responses:
 *       200:
 *         description: Пароль успешно изменен
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Password changed successfully"
 *                 accessToken:
 *                   type: string
 *                   description: "Новый JWT токен доступа"
 *                   example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *                 refreshToken:
 *                   type: string
 *                   description: "Новый refresh токен"
 *                   example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *                 info:
 *                   type: string
 *                   example: "Other sessions have been logged out"
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
// PATCH /api/users/me/password - Change password
router.patch(
  '/me/password',
  authMiddleware,
  asyncHandler(async (req: Request, res: Response) => {
    const { oldPassword, newPassword } = req.body as PasswordChangeRequest;

    if (!oldPassword || !newPassword) {
      throw BadRequestError('Old password and new password are required');
    }

    // Validate new password using AuthService
    const passwordValidation = AuthService.validatePassword(newPassword);
    if (!passwordValidation.valid) {
      throw BadRequestError(passwordValidation.errors.join(', '));
    }

    // Get user from database
    const user = await User.findById(req.user?.userId);
    if (!user) {
      throw NotFoundError('User not found');
    }

    // Verify old password
    const passwordMatches = await AuthService.comparePassword(
      oldPassword,
      user.passwordHash
    );
    if (!passwordMatches) {
      throw UnauthorizedError('Current password is incorrect');
    }

    // Hash new password
    const newPasswordHash = await AuthService.hashPassword(newPassword);

    // Update user password
    await User.findByIdAndUpdate(req.user?.userId, {
      passwordHash: newPasswordHash,
      updatedAt: new Date(),
    });

    // Invalidate ALL refresh tokens for this user EXCEPT current session
    await invalidateAllRefreshTokens(req.user!.userId);

    // Generate new tokens for current session
    const accessToken = AuthService.generateAccessToken(req.user!.userId);
    const refreshToken = AuthService.generateRefreshToken(req.user!.userId);

    // Store new refresh token
    await setRefreshToken(req.user!.userId, refreshToken);

    // Log security event
    logger.info('Password changed successfully', {
      email: user.email,
      userId: req.user!.userId,
      timestamp: new Date().toISOString(),
    });

    res.status(200).json({
      message: 'Password changed successfully',
      accessToken,
      refreshToken,
      info: 'Other sessions have been logged out',
    });
  })
);

/**
 * @swagger
 * /api/users/me:
 *   get:
 *     summary: Получить профиль текущего пользователя
 *     description: Возвращает информацию о текущем аутентифицированном пользователе.
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Профиль пользователя
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *             example:
 *               id: "507f1f77bcf86cd799439011"
 *               email: "user@example.com"
 *               firstName: "Иван"
 *               lastName: "Петров"
 *               avatarUrl: "https://s3.amazonaws.com/lettera/avatars/user123.jpg"
 *               profile:
 *                 position: "Senior Developer"
 *                 company: "TechCorp"
 *                 category: "IT"
 *                 skills: ["JavaScript", "React", "Node.js"]
 *               createdAt: "2024-01-15T10:30:00.000Z"
 *               updatedAt: "2024-01-15T10:30:00.000Z"
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
// GET /api/users/me - Get current user profile
router.get(
  '/me',
  authMiddleware,
  asyncHandler(async (req: Request, res: Response) => {
    // Get user from database (exclude passwordHash)
    const user = await User.findById(req.user?.userId).select('-passwordHash');
    if (!user) {
      throw NotFoundError('User not found');
    }

    res.status(200).json({
      id: user._id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      avatarUrl: user.avatarUrl,
      profile: {
        position: user.profile?.position || '',
        company: user.profile?.company || '',
        category: user.profile?.category || 'Other',
        skills: user.profile?.skills || [],
      },
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    });
  })
);

/**
 * @swagger
 * /api/users/me:
 *   patch:
 *     summary: Обновить профиль пользователя
 *     description: Обновляет информацию профиля текущего пользователя. Обновляются только переданные поля.
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               firstName:
 *                 type: string
 *                 maxLength: 50
 *                 description: Имя пользователя
 *                 example: "Иван"
 *               lastName:
 *                 type: string
 *                 maxLength: 50
 *                 description: Фамилия пользователя
 *                 example: "Петров"
 *               profile:
 *                 type: object
 *                 properties:
 *                   position:
 *                     type: string
 *                     maxLength: 100
 *                     description: Должность
 *                     example: "Senior Developer"
 *                   company:
 *                     type: string
 *                     maxLength: 100
 *                     description: Компания
 *                     example: "TechCorp"
 *                   category:
 *                     type: string
 *                     enum: [IT, Marketing, Design, Finance, Other]
 *                     description: Категория профиля
 *                     example: "IT"
 *                   skills:
 *                     type: array
 *                     maxItems: 10
 *                     items:
 *                       type: string
 *                       maxLength: 50
 *                     description: Навыки пользователя
 *                     example: ["JavaScript", "React", "Node.js"]
 *           example:
 *             firstName: "Иван"
 *             lastName: "Петров"
 *             profile:
 *               position: "Senior Developer"
 *               company: "TechCorp"
 *               category: "IT"
 *               skills: ["JavaScript", "React", "Node.js"]
 *     responses:
 *       200:
 *         description: Профиль успешно обновлен
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Profile updated successfully"
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *             example:
 *               message: "Profile updated successfully"
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
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
// PATCH /api/users/me - Update user profile
router.patch(
  '/me',
  authMiddleware,
  asyncHandler(async (req: Request, res: Response) => {
    const { firstName, lastName, profile } = req.body as ProfileUpdateRequest;

    // Build update object with only provided fields
    const updateData: {
      firstName?: string;
      lastName?: string;
      profile?: {
        position?: string;
        company?: string;
        category?: ProfileCategory;
        skills?: string[];
      };
      updatedAt?: Date;
    } = {};

    if (firstName !== undefined) {
      if (typeof firstName !== 'string' || firstName.trim().length === 0) {
        throw BadRequestError('First name must be a non-empty string');
      }
      if (firstName.length > 50) {
        throw BadRequestError('First name must be less than 50 characters');
      }
      updateData.firstName = firstName.trim();
    }

    if (lastName !== undefined) {
      if (typeof lastName !== 'string' || lastName.trim().length === 0) {
        throw BadRequestError('Last name must be a non-empty string');
      }
      if (lastName.length > 50) {
        throw BadRequestError('Last name must be less than 50 characters');
      }
      updateData.lastName = lastName.trim();
    }

    if (profile !== undefined) {
      updateData.profile = {};

      if (profile.position !== undefined) {
        if (typeof profile.position !== 'string') {
          throw BadRequestError('Position must be a string');
        }
        if (profile.position.length > 100) {
          throw BadRequestError('Position must be less than 100 characters');
        }
        updateData.profile.position = profile.position.trim();
      }

      if (profile.company !== undefined) {
        if (typeof profile.company !== 'string') {
          throw BadRequestError('Company must be a string');
        }
        if (profile.company.length > 100) {
          throw BadRequestError('Company must be less than 100 characters');
        }
        updateData.profile.company = profile.company.trim();
      }

      if (profile.category !== undefined) {
        if (!VALID_PROFILE_CATEGORIES.includes(profile.category)) {
          throw BadRequestError(
            `Category must be one of: ${VALID_PROFILE_CATEGORIES.join(', ')}`
          );
        }
        updateData.profile.category = profile.category;
      }

      if (profile.skills !== undefined) {
        if (!Array.isArray(profile.skills)) {
          throw BadRequestError('Skills must be an array');
        }
        if (profile.skills.length > 10) {
          throw BadRequestError('Maximum 10 skills allowed');
        }

        // Validate each skill
        profile.skills.forEach((skill, index) => {
          if (typeof skill !== 'string') {
            throw BadRequestError(`Skill at index ${index} must be a string`);
          }
          if (skill.trim().length === 0) {
            throw BadRequestError(`Skill at index ${index} cannot be empty`);
          }
          if (skill.length > 50) {
            throw BadRequestError(
              `Skill at index ${index} must be less than 50 characters`
            );
          }
        });

        updateData.profile.skills = profile.skills.map(skill => skill.trim());
      }
    }

    // Update user
    const updatedUser = await User.findByIdAndUpdate(
      req.user?.userId,
      { ...updateData, updatedAt: new Date() },
      { new: true }
    ).select('-passwordHash');

    if (!updatedUser) {
      throw NotFoundError('User not found');
    }

    res.status(200).json({
      message: 'Profile updated successfully',
      user: {
        id: updatedUser._id,
        email: updatedUser.email,
        firstName: updatedUser.firstName,
        lastName: updatedUser.lastName,
        avatarUrl: updatedUser.avatarUrl,
        profile: {
          position: updatedUser.profile?.position || '',
          company: updatedUser.profile?.company || '',
          category: updatedUser.profile?.category || 'Other',
          skills: updatedUser.profile?.skills || [],
        },
        createdAt: updatedUser.createdAt,
        updatedAt: updatedUser.updatedAt,
      },
    });
  })
);

export default router;
