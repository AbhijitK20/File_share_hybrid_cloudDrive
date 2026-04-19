const supabase = require('../utils/supabase');
const { logger } = require('../utils/logger');

function normalizePermissions(permissions) {
  if (!Array.isArray(permissions)) return ['view'];
  const allowed = ['view', 'edit', 'delete'];
  const filtered = permissions.filter((p) => allowed.includes(p));
  return filtered.length > 0 ? filtered : ['view'];
}

function evaluateAccess(file, userId, permissionRow) {
  const isOwner = !!userId && file.uploaded_by_id === userId;
  if (isOwner) {
    return { allowed: true, permissions: ['view', 'edit', 'delete'] };
  }

  const permissionType = permissionRow?.permission_type;
  const permissionSet = normalizePermissions(permissionRow?.permissions);

  // Explicit allowlist mode only grants access to owner or allow entries.
  if (file.access_mode === 'allowlist') {
    if (permissionType === 'allow') {
      return { allowed: true, permissions: permissionSet };
    }
    return { allowed: false, permissions: [] };
  }

  // For blocklist mode, deny explicit blocks and otherwise follow visibility.
  if (file.access_mode === 'blocklist' && permissionType === 'block') {
    return { allowed: false, permissions: [] };
  }

  // Explicit allow entries can access private files with custom permissions.
  if (permissionType === 'allow') {
    return { allowed: true, permissions: permissionSet };
  }

  if (file.visibility === 'public') {
    return { allowed: true, permissions: ['view'] };
  }

  return { allowed: false, permissions: [] };
}

async function getFileAndPermission(fileId, userId) {
  const { data: file, error: fileError } = await supabase
    .from('files')
    .select('id, uploaded_by_id, visibility, access_mode')
    .eq('id', fileId)
    .single();

  if (fileError || !file) {
    return { file: null, permissionRow: null };
  }

  if (!userId) {
    return { file, permissionRow: null };
  }

  const { data: permissionRow } = await supabase
    .from('file_permissions')
    .select('permission_type, permissions')
    .eq('file_id', fileId)
    .eq('user_id', userId)
    .maybeSingle();

  return { file, permissionRow: permissionRow || null };
}

exports.checkFileAccess = async (req, res, next) => {
  try {
    const fileId = req.params.fileId || req.params.id;
    const userId = req.user?.id || null;

    const { file, permissionRow } = await getFileAndPermission(fileId, userId);
    if (!file) {
      return res.status(404).json({ message: 'File not found' });
    }

    const access = evaluateAccess(file, userId, permissionRow);
    if (!access.allowed) {
      return res.status(403).json({ message: 'You do not have access to this file' });
    }

    req.userPermissions = access.permissions;
    return next();
  } catch (error) {
    logger.error('Error in checkFileAccess middleware:', error);
    return res.status(500).json({ message: 'Error checking file access' });
  }
};

exports.checkFilePermission = (requiredPermissions = []) => {
  return async (req, res, next) => {
    try {
      const fileId = req.params.fileId || req.params.id;
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({ message: 'Authentication required' });
      }

      const { file, permissionRow } = await getFileAndPermission(fileId, userId);
      if (!file) {
        return res.status(404).json({ message: 'File not found' });
      }

      const access = evaluateAccess(file, userId, permissionRow);
      if (!access.allowed) {
        return res.status(403).json({ message: 'You do not have access to this file' });
      }

      req.userPermissions = access.permissions;

      const hasPermission = requiredPermissions.every((perm) =>
        req.userPermissions.includes(perm)
      );

      if (!hasPermission) {
        return res.status(403).json({
          message: `You do not have permission to perform this action. Required: ${requiredPermissions.join(', ')}`,
        });
      }

      return next();
    } catch (error) {
      logger.error('Error in checkFilePermission middleware:', error);
      return res.status(500).json({ message: 'Error checking file permission' });
    }
  };
};
