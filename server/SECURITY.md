# File Upload Security Implementation Guide

## Overview
This document outlines all security improvements implemented for the file upload system.

## Implemented Security Measures

### 1. ✅ File Type Validation (CRITICAL)
**File**: `server/middleware/fileValidation.js`

- **MIME Type Whitelist**: Only allowed file types can be uploaded
  - Images: JPEG, PNG, GIF, WebP, BMP, TIFF, SVG
  - Documents: PDF, Word, Excel, PowerPoint, TXT, CSV, JSON
  - Archives: ZIP, GZIP, TAR
  - Audio/Video: MP3, WAV, M4A, MP4, MOV, AVI, MKV, WebM

- **Extension Blacklist**: Dangerous extensions are blocked
  - Windows executables: `.exe`, `.bat`, `.cmd`, `.msi`, `.com`
  - Shell scripts: `.sh`, `.bash`, `.ps1`
  - Web scripts: `.php`, `.jsp`, `.asp`, `.aspx`
  - Java: `.jar`, `.class`
  - And more

- **Magic Byte Validation**: Files are validated by actual content, not just extension
  - Uses `file-type` library to read file signatures
  - Detects double extension attacks (e.g., `file.php.jpg`)

### 2. ✅ Rate Limiting (CRITICAL)
**File**: `server/middleware/rateLimiter.js`

- **Upload Limit**: 20 uploads per 15 minutes per IP
  - Premium users bypassed (if desired)
  - Prevents disk exhaustion attacks

- **Access Limit**: 30 attempts per 1 minute per IP
  - Prevents brute force on access codes

- **Download Limit**: 50 downloads per 1 minute per IP
  - Prevents bandwidth abuse

- **Auth Limit**: 5 failed attempts per 15 minutes per IP
  - Protects against password brute force

### 3. ✅ Strong Access Code Generation
**File**: `server/utils/codeGenerator.js`

- **Old**: 6-digit numeric (1 million combinations) - WEAK
- **New**: 8-character alphanumeric (218 trillion combinations) - STRONG
- Cryptographically secure random generation using `crypto.randomInt()`
- Alternative hex method also available (18 quintillion combinations)

### 4. ✅ Filename Sanitization
**File**: `server/controllers/accessController.js`

- **Header Injection Prevention**: Removes control characters, line breaks, null bytes
- **Content-Disposition Sanitization**: Prevents CRLF injection attacks
- **Length Limiting**: Filenames limited to 255 characters

### 5. ✅ Input Validation
**File**: `server/controllers/accessController.js`

- **Access Code Validation**:
  - Type checking (string)
  - Length limits (max 100 chars)
  - Prevents NoSQL injection

- **File ID Validation**:
  - MongoDB ObjectId format validation
  - Prevents invalid queries

### 6. ✅ Security Headers
**File**: `server/server.js` (Helmet middleware)

- **X-Content-Type-Options: nosniff** - Prevents MIME type sniffing
- **Content-Security-Policy** - Restricts resource loading
- **Strict-Transport-Security** - Forces HTTPS (1 year)
- **X-Frame-Options: DENY** - Prevents clickjacking
- **X-XSS-Protection** - Additional XSS protection
- **Referrer-Policy** - Controls referrer information

### 7. ✅ Audit Logging
**File**: `server/utils/logger.js`

Comprehensive logging system using Winston:

- **File Upload Logs**:
  - User ID
  - File count, names, sizes, MIME types
  - IP address, user agent
  - Timestamp

- **File Access Logs**:
  - User ID
  - File ID, action (VIEW/DOWNLOAD/PREVIEW)
  - IP address, success/failure
  - Timestamp

- **Security Events**:
  - Validation failures
  - Rate limit hits
  - Unauthorized access attempts

- **Log Files**:
  - `server/logs/error.log` - Error logs only
  - `server/logs/all.log` - All logs
  - Console output during development

### 8. ✅ Permission Enforcement
**Files**: `server/controllers/accessController.js`, `server/controllers/uploadController.js`

- **Visibility Levels**:
  - `private`: Only owner can access
  - `public`: Anyone can access
  - `shared`: Specific users can access (future enhancement)

- **Default Privacy**: Uploads default to `private` for security
- **Ownership Verification**: Cross-checks user ID with file uploader

### 9. ✅ File Size Limits (Tiered)
**File**: `server/controllers/uploadController.js`

- **Free Users**:
  - Per file: 100 MB
  - Total per upload: 500 MB

- **Premium Users**:
  - Per file: 5 GB
  - Total per upload: 50 GB

- **Hard Limit**: 5 GB enforced at Multer level

### 10. ✅ Enhanced CORS
**File**: `server/server.js`

- **Whitelist**: Only specified origin allowed
- **Methods**: GET, POST, PUT, DELETE, OPTIONS
- **Headers**: Content-Type, Authorization
- **Credentials**: Enabled with strict origin checking
- **Cache**: 24-hour preflight cache

### 11. ✅ Error Handling
**File**: All controllers

- **Generic Error Messages**: No sensitive info leaked
- **Proper HTTP Status Codes**:
  - 400 Bad Request (validation failures)
  - 403 Forbidden (permission denied)
  - 404 Not Found (file not found)
  - 410 Gone (file expired)
  - 413 Payload Too Large (file too big)
  - 429 Too Many Requests (rate limited)
  - 500 Internal Server Error (server error)

### 12. ✅ File Cleanup
**File**: `server/server.js`

- **Cron Job**: Runs hourly to clean expired files
- **Physical Deletion**: Files removed from disk
- **Database Deletion**: Records removed from MongoDB
- **Automatic Expiration**: Default 24-hour TTL

## Usage

### Installation
```bash
cd server
npm install
```

### Configuration
Edit `server/.env`:
```env
NODE_ENV=production  # Set to 'production' for stricter error handling
LOG_LEVEL=info       # Change to 'warn' or 'error' in production
```

### Starting Server
```bash
npm start            # Production mode
npm run dev          # Development with auto-reload
```

### Environment Variables
```env
PORT=5000
MONGO_URI=mongodb://localhost:27017/fileShare
JWT_SECRET=<your-secret-key>
CLIENT_URL=http://localhost:5173
NODE_ENV=production
LOG_LEVEL=info
```

## Security Best Practices

### For Administrators
1. **Rotate JWT Secret**: Change `JWT_SECRET` periodically
2. **Monitor Logs**: Review `server/logs/all.log` for suspicious activity
3. **Update Dependencies**: `npm audit` and `npm update` regularly
4. **HTTPS in Production**: Use valid SSL certificates
5. **Database Backups**: Regular MongoDB backups
6. **File Scanning**: Consider integrating ClamAV for malware scanning

### For Developers
1. **Never commit secrets**: Use `.env` files (ignored in `.gitignore`)
2. **Validate all inputs**: Always use input validation middleware
3. **Log security events**: Use provided logger for audit trails
4. **Test file validation**: Test with various file types
5. **Review rate limits**: Adjust based on your usage patterns

### For Users
1. **Keep files private**: Default setting (private) is recommended
2. **Share selectively**: Use access codes carefully
3. **Check expiration**: Files auto-delete after 24 hours
4. **Verify file types**: Only upload trusted file types
5. **Monitor access**: Check audit logs for downloads/previews

## Testing File Uploads

### Test Safe File
```bash
curl -F "files=@document.pdf" http://localhost:5000/api/files/upload
```

### Test Blocked File (should fail)
```bash
curl -F "files=@malware.exe" http://localhost:5000/api/files/upload
# Expected: 400 Bad Request - "File extension .exe is not allowed"
```

### Test Rate Limiting
```bash
# Run this 21 times in 15 minutes
for i in {1..21}; do
  curl -F "files=@test.txt" http://localhost:5000/api/files/upload
done
# Expected: 429 Too Many Requests on 21st attempt
```

## Logs Location
- Error logs: `server/logs/error.log`
- All logs: `server/logs/all.log`
- Format: `[timestamp] [level]: [message]`

## Monitoring & Metrics

### Key Metrics to Monitor
1. **File Upload Count**: `logFileUpload` entries
2. **Failed Uploads**: Validation failures in error.log
3. **Rate Limit Hits**: Look for `RATE_LIMIT_EXCEEDED`
4. **Unauthorized Access**: `403` errors in logs
5. **File Access Patterns**: Download/preview frequency

### Alert Thresholds
- More than 50 rate limit hits per hour: Potential attack
- More than 10 validation failures per hour: Check for malware
- More than 100 404 errors per hour: Path traversal attempts

## Vulnerability Remediation Summary

| Vulnerability | Status | Solution |
|---|---|---|
| No file type validation | ✅ FIXED | Whitelist + blacklist + magic bytes |
| No rate limiting | ✅ FIXED | express-rate-limit middleware |
| Weak access codes | ✅ FIXED | 8-char alphanumeric (218T combinations) |
| Filename header injection | ✅ FIXED | Sanitization + encoding |
| No input validation | ✅ FIXED | ObjectId + string validation |
| Missing security headers | ✅ FIXED | Helmet.js middleware |
| No audit logging | ✅ FIXED | Winston logger integration |
| CORS misconfiguration | ✅ FIXED | Whitelist + strict settings |
| No malware scanning | ⏳ TODO | Consider ClamAV integration |
| No usage analytics | ⏳ TODO | Future enhancement |

## Next Steps (Optional Enhancements)

### High Priority
1. **Malware Scanning**: Integrate ClamAV or VirusTotal API
2. **IP Blocking**: Ban IPs after N failed attempts
3. **2FA**: Two-factor authentication for sensitive operations

### Medium Priority
1. **File Encryption**: Encrypt files at rest
2. **Virus Definitions**: Update malware database regularly
3. **Usage Analytics**: Track upload/download patterns
4. **Notification System**: Alert on suspicious activity

### Low Priority
1. **File Versioning**: Keep upload history
2. **Advanced Reporting**: Custom security reports
3. **API Documentation**: Swagger/OpenAPI spec
4. **Performance Optimization**: Caching strategies

## Support & Documentation
- Express: https://expressjs.com/
- Helmet: https://helmetjs.github.io/
- express-rate-limit: https://github.com/nfriedly/express-rate-limit
- file-type: https://github.com/sindresorhus/file-type
- Winston Logger: https://github.com/winstonjs/winston

---

**Last Updated**: 2024
**Security Level**: Production-Ready (with proper environment configuration)
**Maintenance**: Review security logs weekly, update dependencies monthly
