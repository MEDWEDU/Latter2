import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import logger from '../utils/logger';

// Extend Request interface to include custom properties
declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      startTime?: number;
    }
  }
}

const sensitiveFields = [
  'password',
  'token',
  'accessToken',
  'refreshToken',
  'authorization',
  'secret',
  'apiKey',
  'creditCard',
  'cvv',
];

const sanitizeBody = (
  body: Record<string, unknown>
): Record<string, unknown> => {
  if (!body || typeof body !== 'object') return body;

  const sanitized = { ...body };
  for (const field of sensitiveFields) {
    if (field in sanitized) {
      sanitized[field] = '***REDACTED***';
    }
  }
  return sanitized;
};

export const requestLogger = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  req.requestId = uuidv4();
  req.startTime = Date.now();

  const { method, originalUrl, ip, headers } = req;
  const userAgent = headers['user-agent'] || 'Unknown';

  logger.http('Incoming request', {
    requestId: req.requestId,
    method,
    url: originalUrl,
    ip,
    userAgent,
  });

  if (['POST', 'PUT', 'PATCH'].includes(method) && req.body) {
    logger.debug('Request body', {
      requestId: req.requestId,
      body: sanitizeBody(req.body),
    });
  }

  const originalSend = res.send;
  res.send = function (body): Response {
    res.send = originalSend;

    const responseTime = Date.now() - (req.startTime || Date.now());
    const { statusCode } = res;

    const logLevel =
      statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'http';

    logger[logLevel]('Request completed', {
      requestId: req.requestId,
      method,
      url: originalUrl,
      statusCode,
      responseTime: `${responseTime}ms`,
    });

    return originalSend.call(this, body);
  };

  next();
};
