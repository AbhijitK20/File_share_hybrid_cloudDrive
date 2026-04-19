const winston = require('winston');
const path = require('path');
const fs = require('fs');

const isServerless = Boolean(process.env.VERCEL);

const logsDir = path.join(__dirname, '../logs');
if (!isServerless) {
  try {
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
  } catch (error) {
    // Fallback to console-only logging if filesystem is unavailable.
  }
}

// Define log levels and colors
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white',
};

winston.addColors(colors);

// Define log format
const format = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.colorize({ all: true }),
  winston.format.printf(
    (info) => `${info.timestamp} ${info.level}: ${info.message}`,
  ),
);

const transports = [new winston.transports.Console()];

if (!isServerless) {
  try {
    transports.push(
      new winston.transports.File({
        filename: path.join(logsDir, 'error.log'),
        level: 'error',
        format: winston.format.uncolorize(),
      }),
      new winston.transports.File({
        filename: path.join(logsDir, 'all.log'),
        format: winston.format.uncolorize(),
      })
    );
  } catch (error) {
    // Keep console transport only when file transport fails.
  }
}

// Create logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'debug',
  format,
  transports,
});

/**
 * Log file upload event (audit trail)
 */
function logFileUpload(userId, files, ipAddress, userAgent) {
  const fileInfo = files.map(f => ({
    filename: f.filename,
    originalName: f.originalname,
    size: f.size,
    mimetype: f.mimetype
  }));

  logger.info('FILE_UPLOADED', {
    userId: userId || 'ANONYMOUS',
    fileCount: files.length,
    files: JSON.stringify(fileInfo),
    ipAddress,
    userAgent
  });
}

/**
 * Log file access event (audit trail)
 */
function logFileAccess(userId, fileId, action, ipAddress, success = true) {
  const level = success ? 'info' : 'warn';
  logger[level](`FILE_${action.toUpperCase()}`, {
    userId: userId || 'ANONYMOUS',
    fileId,
    action,
    ipAddress,
    success
  });
}

/**
 * Log security-related events
 */
function logSecurityEvent(eventType, details, ipAddress, severity = 'warn') {
  logger[severity](`SECURITY_EVENT: ${eventType}`, {
    eventType,
    details: JSON.stringify(details),
    ipAddress,
    timestamp: new Date().toISOString()
  });
}

/**
 * Log file validation failures (security audit)
 */
function logValidationFailure(filename, reason, ipAddress) {
  logger.warn('FILE_VALIDATION_FAILED', {
    filename,
    reason,
    ipAddress,
    timestamp: new Date().toISOString()
  });
}

/**
 * Log rate limit hits (potential abuse detection)
 */
function logRateLimitHit(ipAddress, endpoint, limit) {
  logger.warn('RATE_LIMIT_EXCEEDED', {
    ipAddress,
    endpoint,
    limit,
    timestamp: new Date().toISOString()
  });
}

module.exports = {
  logger,
  logFileUpload,
  logFileAccess,
  logSecurityEvent,
  logValidationFailure,
  logRateLimitHit
};
