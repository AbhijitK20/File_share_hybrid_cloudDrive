const supabase = require('../utils/supabase');
const { logFileAccess, logger } = require('../utils/logger');
const encryptionUtils = require('../utils/encryption');
const compressionUtils = require('../utils/compression');
const { toPrivacySafeActivityIdentity } = require('../utils/privacy');

function sanitizeFilename(filename) {
  return filename.replace(/[\r\n\0]/g, '').replace(/[\x00-\x1F\x7F]/g, '').slice(0, 255);
}

function getClientIp(req) {
  return req.headers['x-forwarded-for'] || req.ip || null;
}

function hasViewPermission(permissions) {
  const list = Array.isArray(permissions) ? permissions : [];
  return list.includes('view') || list.includes('edit') || list.includes('delete');
}

async function getPermissionEntry(fileId, userId) {
  if (!userId) return null;

  const { data, error } = await supabase
    .from('file_permissions')
    .select('permission_type, permissions')
    .eq('file_id', fileId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    logger.warn(`Permission read failed for file ${fileId}: ${error.message}`);
    return null;
  }

  return data;
}

function canAccessFile(file, userId, permissionEntry) {
  if (userId && file.uploaded_by_id === userId) return true;

  const visibility = file.visibility || 'public';
  const mode = file.access_mode || 'public';
  const isPublic = visibility === 'public';

  const hasExplicitAllow = !!(
    userId &&
    permissionEntry &&
    permissionEntry.permission_type === 'allow' &&
    hasViewPermission(permissionEntry.permissions)
  );

  // Private files are never discoverable by access code unless explicitly shared.
  if (!isPublic) {
    return hasExplicitAllow;
  }

  if (mode === 'allowlist') {
    return hasExplicitAllow;
  }

  if (mode === 'blocklist') {
    if (permissionEntry && permissionEntry.permission_type === 'block') return false;
    return true;
  }

  return true;
}

async function logActivity({ fileId, actorUserId, actorEmail, action, details, req }) {
  try {
    const privacyIdentity = toPrivacySafeActivityIdentity({
      email: actorEmail,
      ipAddress: getClientIp(req),
    });

    await supabase.from('file_activity').insert([
      {
        file_id: fileId,
        actor_user_id: actorUserId || null,
        actor_email: privacyIdentity.actorEmail,
        action,
        details: details || null,
        ip_address: privacyIdentity.ipAddress,
      },
    ]);
  } catch (error) {
    logger.warn(`Failed to write activity log for ${action} on file ${fileId}: ${error.message}`);
  }
}

async function fetchFileOrNull(fileId) {
  const now = new Date().toISOString();
  const { data: file, error } = await supabase
    .from('files')
    .select('*')
    .eq('id', fileId)
    .gt('expires_at', now)
    .maybeSingle();

  if (error) {
    logger.warn(`File fetch failed for ${fileId}: ${error.message}`);
    return null;
  }

  return file;
}

async function getReadableFileData(file) {
  const { data: storageData, error: storageError } = await supabase.storage
    .from('uploads')
    .download(file.filename);

  if (storageError) {
    throw new Error('File not found in storage');
  }

  let fileData = Buffer.from(await storageData.arrayBuffer());

  if (file.encryption?.enabled) {
    const { data: uploader, error: uploaderError } = await supabase
      .from('users')
      .select('master_key')
      .eq('id', file.uploaded_by_id)
      .maybeSingle();

    if (uploaderError || !uploader?.master_key) {
      throw new Error('Unable to load encryption key');
    }

    const masterKey = encryptionUtils.decryptMasterKeyFromStorage(uploader.master_key);
    const fileKeyData = encryptionUtils.generateFileKey(masterKey, file.encryption.fileKeyNonce);
    fileData = encryptionUtils.decryptFile(fileData, fileKeyData.fileKey, file.encryption.iv, file.encryption.authTag);
  }

  if (file.is_compressed) {
    fileData = await compressionUtils.decompressGZIP(fileData);
  }

  return fileData;
}

exports.getFilesByCode = async (req, res) => {
  try {
    const { code } = req.params;
    if (!/^\d{6}$/.test(code)) return res.status(400).json({ message: 'Invalid code' });

    const now = new Date().toISOString();
    const { data: files, error } = await supabase
      .from('files')
      .select('*')
      .eq('group_code', code)
      .gt('expires_at', now);

    if (error || !files || files.length === 0) {
      return res.status(404).json({ message: 'Files not found or expired' });
    }

    const fileIds = files.map((f) => f.id);
    const permissionMap = new Map();
    if (req.user?.id && fileIds.length > 0) {
      const { data: permissions } = await supabase
        .from('file_permissions')
        .select('file_id, permission_type, permissions')
        .eq('user_id', req.user.id)
        .in('file_id', fileIds);

      (permissions || []).forEach((permission) => {
        permissionMap.set(permission.file_id, permission);
      });
    }

    const filteredFiles = files.filter(f => {
      const permission = permissionMap.get(f.id) || null;
      return canAccessFile(f, req.user?.id, permission);
    });

    if (filteredFiles.length === 0) {
      return res.status(403).json({ message: 'You do not have access to these files' });
    }

    res.json({
      groupCode: code,
      files: filteredFiles.map(f => ({
        id: f.id,
        name: f.original_name,
        size: f.size,
        mimetype: f.mimetype,
        encrypted: f.encryption?.enabled || false,
        expiresAt: f.expires_at,
      })),
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};

exports.downloadFile = async (req, res) => {
  try {
    const { id } = req.params;
    const file = await fetchFileOrNull(id);
    const permissionEntry = await getPermissionEntry(id, req.user?.id);

    if (!file) {
      logFileAccess(req.user?.id, id, 'download', getClientIp(req), false);
      return res.status(404).json({ message: 'File not found or expired' });
    }

    if (!canAccessFile(file, req.user?.id, permissionEntry)) {
      logFileAccess(req.user?.id, id, 'download', getClientIp(req), false);
      return res.status(403).json({ message: 'Access denied' });
    }

    const fileData = await getReadableFileData(file);

    logFileAccess(req.user?.id, id, 'download', getClientIp(req), true);
    await logActivity({
      fileId: id,
      actorUserId: req.user?.id,
      actorEmail: req.user?.email,
      action: 'download',
      details: `Downloaded ${file.original_name}`,
      req,
    });

    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(sanitizeFilename(file.original_name))}"`);
    res.setHeader('Content-Type', file.mimetype);
    res.send(fileData);
  } catch (error) {
    logger.error('Download processing error:', error);
    res.status(500).json({ message: 'Download error' });
  }
};

exports.previewFile = async (req, res) => {
  try {
    const { id } = req.params;
    const file = await fetchFileOrNull(id);
    const permissionEntry = await getPermissionEntry(id, req.user?.id);

    if (!file) {
      logFileAccess(req.user?.id, id, 'preview', getClientIp(req), false);
      return res.status(404).json({ message: 'File not found or expired' });
    }

    if (!canAccessFile(file, req.user?.id, permissionEntry)) {
      logFileAccess(req.user?.id, id, 'preview', getClientIp(req), false);
      return res.status(403).json({ message: 'Access denied' });
    }

    const fileData = await getReadableFileData(file);

    logFileAccess(req.user?.id, id, 'preview', getClientIp(req), true);
    await logActivity({
      fileId: id,
      actorUserId: req.user?.id,
      actorEmail: req.user?.email,
      action: 'preview',
      details: `Previewed ${file.original_name}`,
      req,
    });

    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(sanitizeFilename(file.original_name))}"`);
    res.setHeader('Content-Type', file.mimetype);
    res.send(fileData);
  } catch (error) {
    logger.error('Preview processing error:', error);
    res.status(500).json({ message: 'Preview error' });
  }
};
