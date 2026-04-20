const path = require('path');
const fs = require('fs');
const { scanFile, scanBuffer } = require('../utils/malwareScan');

let fileTypeModulePromise = null;

async function getFileTypeModule() {
  if (!fileTypeModulePromise) {
    fileTypeModulePromise = import('file-type');
  }
  return fileTypeModulePromise;
}

// Whitelist of allowed MIME types (configurable)
const ALLOWED_MIMETYPES = [
  // Images
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/tiff',
  'image/svg+xml',
  // Documents
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
  'application/json',
  // Archives (caution: scan contents separately)
  'application/zip',
  'application/gzip',
  'application/x-tar',
  // Audio/Video
  'audio/mpeg',
  'audio/wav',
  'video/mp4',
  'video/quicktime',
  'video/x-msvideo'
];

// Blacklisted extensions (dangerous file types)
const BLOCKED_EXTENSIONS = [
  '.exe', '.bat', '.cmd', '.com', '.msi', // Windows executables
  '.sh', '.bash', '.csh', '.ksh', '.zsh', // Shell scripts
  '.app', '.deb', '.rpm', // Unix/Linux executables
  '.php', '.jsp', '.asp', '.aspx', '.phtml', '.pht', // Server-side scripts
  '.js', '.cjs', '.mjs', // JavaScript
  '.jar', '.class', // Java
  '.py', '.pyc', '.pyo', // Python
  '.rb', '.go', // Ruby, Go
  '.ps1', '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh', '.msh', // PowerShell/Windows scripts
  '.scr', '.pif', '.sys', '.dll', '.drv', '.ocx', '.lib', // System files
  '.reg', '.mdt', '.mde', '.lnk' // Windows shortcuts/registry
];

// Allowed extensions (used as secondary validation)
const ALLOWED_EXTENSIONS = [
  // Images
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif', '.svg',
  // Documents
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv', '.json', '.xml',
  // Archives
  '.zip', '.gz', '.tar', '.rar', '.7z',
  // Audio/Video
  '.mp3', '.wav', '.m4a', '.aac', '.flac', '.mp4', '.mov', '.avi', '.mkv', '.webm',
  // Code (for sharing, not execution)
  '.html', '.css', '.scss', '.md', '.sql'
];

/**
 * Validates file based on multiple criteria
 * @param {Object} file - Multer file object
 * @returns {Object} - { isValid: boolean, error: string|null }
 */
async function validateFile(file) {
  // Check if file exists
  if (!file) {
    return { isValid: false, error: 'No file provided' };
  }

  const fileName = file.originalname;
  const fileExt = path.extname(fileName).toLowerCase();
  const fileMime = file.mimetype;

  // 1. Check extension against blacklist
  if (BLOCKED_EXTENSIONS.includes(fileExt)) {
    return { isValid: false, error: `File extension ${fileExt} is not allowed` };
  }

  // 2. Check extension is in whitelist
  if (!ALLOWED_EXTENSIONS.includes(fileExt)) {
    return { isValid: false, error: `File extension ${fileExt} is not supported` };
  }

  // 3. Check MIME type against whitelist
  if (!ALLOWED_MIMETYPES.includes(fileMime)) {
    return { isValid: false, error: `File type ${fileMime} is not allowed` };
  }

  // 4. Magic byte validation (check actual file signature)
  try {
    if (file.path || file.buffer) {
      const fileTypeModule = await getFileTypeModule();
      const fileType = file.buffer
        ? await fileTypeModule.fileTypeFromBuffer(file.buffer)
        : await fileTypeModule.fileTypeFromFile(file.path);

      if (fileType && !ALLOWED_MIMETYPES.includes(fileType.mime)) {
        return { 
          isValid: false, 
          error: `File content does not match declared type. Detected: ${fileType.mime}` 
        };
      }
    }
  } catch (error) {
    console.error('Magic byte validation error:', error);
    // Don't fail validation, log and continue
  }

  // 5. Check for double extension bypass (e.g., file.php.jpg)
  const nameWithoutExt = path.basename(fileName, fileExt);
  const doubleExt = path.extname(nameWithoutExt).toLowerCase();
  if (doubleExt && BLOCKED_EXTENSIONS.includes(doubleExt)) {
    return { 
      isValid: false, 
      error: `Double extension detected (${doubleExt}${fileExt}), not allowed` 
    };
  }

  // 6. Optional malware scan
  if (file.path || file.buffer) {
    const scan = file.path
      ? await scanFile(file.path)
      : await scanBuffer(file.buffer, file.originalname);

    if (scan.scanned && !scan.clean) {
      return {
        isValid: false,
        error: `Malware detected: ${scan.reason}`,
      };
    }
  }

  return { isValid: true, error: null };
}

/**
 * Sanitize filename to prevent injection attacks
 * @param {string} filename - Original filename
 * @returns {string} - Sanitized filename
 */
function sanitizeFilename(filename) {
  return filename
    .replace(/[^\w\s.-]/g, '') // Remove special characters
    .replace(/\s+/g, '_') // Replace spaces with underscores
    .slice(0, 255); // Limit length
}

/**
 * Middleware to validate uploaded files
 */
const fileValidationMiddleware = async (req, res, next) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files provided' });
  }

  // Validate each file
  const validationErrors = [];
  
  for (const file of req.files) {
    const validation = await validateFile(file);
    if (!validation.isValid) {
      validationErrors.push({
        filename: file.originalname,
        error: validation.error
      });
    }
  }

  if (validationErrors.length > 0) {
    // Clean up uploaded files that failed validation
    req.files.forEach(file => {
      if (file.path && fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
    });

    return res.status(400).json({
      error: 'File validation failed',
      details: validationErrors
    });
  }

  next();
};

module.exports = {
  validateFile,
  sanitizeFilename,
  fileValidationMiddleware,
  ALLOWED_MIMETYPES,
  BLOCKED_EXTENSIONS,
  ALLOWED_EXTENSIONS
};
