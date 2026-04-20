const supabase = require('../utils/supabase');
const { logger } = require('../utils/logger');
const { toPrivacySafeActivityIdentity } = require('../utils/privacy');

const ALLOWED_VISIBILITY = ['public', 'private'];
const ALLOWED_ACCESS_MODES = ['public', 'allowlist', 'blocklist'];
const ALLOWED_PERMISSION_VALUES = ['view', 'edit', 'delete'];

function normalizeEmail(email = '') {
  return String(email).trim().toLowerCase();
}

function normalizePermissions(permissions) {
  const list = Array.isArray(permissions) ? permissions : ['view'];
  const unique = [...new Set(list.filter((p) => ALLOWED_PERMISSION_VALUES.includes(p)))];
  if (unique.length === 0) return ['view'];
  if (unique.includes('edit') && !unique.includes('view')) unique.unshift('view');
  return unique;
}

function getClientIp(req) {
  return req.headers['x-forwarded-for'] || req.ip || null;
}

async function getOwnedFile(fileId, ownerId) {
  const { data, error } = await supabase
    .from('files')
    .select('*')
    .eq('id', fileId)
    .eq('uploaded_by_id', ownerId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  return data;
}

async function logActivity({ fileId, actorUserId, actorEmail, action, details, ipAddress }) {
  try {
    const privacyIdentity = toPrivacySafeActivityIdentity({
      email: actorEmail,
      ipAddress,
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
    logger.warn(`Activity log failed (${action}) for file ${fileId}: ${error.message}`);
  }
}

async function getUsersMapByIds(userIds = []) {
  if (!userIds || userIds.length === 0) return new Map();

  const { data: users } = await supabase
    .from('users')
    .select('id, email, name')
    .in('id', userIds);

  return new Map((users || []).map((u) => [u.id, u]));
}

exports.getMyFiles = async (req, res) => {
  try {
    const { data: files, error } = await supabase
      .from('files')
      .select('*')
      .eq('uploaded_by_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json({
      count: files.length,
      files: files.map(f => ({
        id: f.id,
        name: f.original_name,
        size: f.size,
        groupCode: f.group_code,
        mimetype: f.mimetype,
        visibility: f.visibility,
        accessMode: f.access_mode,
        encrypted: f.encryption?.enabled || false,
        expiresAt: f.expires_at,
        createdAt: f.created_at,
      })),
    });
  } catch (error) {
    logger.error('Dashboard error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.deleteFile = async (req, res) => {
  try {
    const { id } = req.params;
    const file = await getOwnedFile(id, req.user.id);
    if (!file) return res.status(404).json({ message: 'File not found' });

    // Delete from Storage
    const { error: storageError } = await supabase.storage.from('uploads').remove([file.filename]);
    if (storageError) {
      logger.warn(`Storage deletion warning for file ${id}: ${storageError.message}`);
    }
    
    // Delete from DB
    const { error: deleteError } = await supabase.from('files').delete().eq('id', id);
    if (deleteError) throw deleteError;

    const bytesToSubtract = file.compressed_size || file.size || 0;
    const nextStorage = Math.max(0, Number(req.user.storage_used || 0) - Number(bytesToSubtract));
    await supabase.from('users').update({ storage_used: nextStorage }).eq('id', req.user.id);

    res.json({ message: 'File deleted' });
  } catch (error) {
    logger.error('Delete file error:', error);
    res.status(500).json({ message: 'Delete error' });
  }
};

exports.extendExpiry = async (req, res) => {
  try {
    const { id } = req.params;

    if (req.user.plan !== 'premium') {
      return res.status(403).json({
        message: 'Only Pro users can extend file expiration',
      });
    }

    const days = Number(req.body.days ?? 7);
    if (!Number.isFinite(days) || days <= 0) {
      return res.status(400).json({ message: 'days must be a positive number' });
    }

    const file = await getOwnedFile(id, req.user.id);
    if (!file) return res.status(404).json({ message: 'File not found' });

    const now = Date.now();
    const currentExpiry = new Date(file.expires_at).getTime();
    const base = currentExpiry > now ? currentExpiry : now;
    const nextExpiryDate = new Date(base + days * 24 * 60 * 60 * 1000);
    if (Number.isNaN(nextExpiryDate.getTime())) {
      return res.status(400).json({ message: 'Invalid expiry extension value' });
    }
    const nextExpiry = nextExpiryDate.toISOString();

    const { error } = await supabase
      .from('files')
      .update({ expires_at: nextExpiry })
      .eq('id', id)
      .eq('uploaded_by_id', req.user.id);

    if (error) throw error;

    await logActivity({
      fileId: id,
      actorUserId: req.user.id,
      actorEmail: req.user.email,
      action: 'expiry_extended',
      details: `Extended by ${days} day(s)`,
      ipAddress: getClientIp(req),
    });

    return res.json({ message: 'Expiry extended', expiresAt: nextExpiry });
  } catch (error) {
    logger.error('Extend expiry error:', error);
    return res.status(500).json({ message: 'Failed to extend expiry' });
  }
};

exports.toggleVisibility = async (req, res) => {
  try {
    const { id } = req.params;
    const { visibility } = req.body;

    if (!ALLOWED_VISIBILITY.includes(visibility)) {
      return res.status(400).json({ message: 'Invalid visibility value' });
    }

    const file = await getOwnedFile(id, req.user.id);
    if (!file) return res.status(404).json({ message: 'File not found' });

    const { error } = await supabase
      .from('files')
      .update({ visibility })
      .eq('id', id)
      .eq('uploaded_by_id', req.user.id);

    if (error) throw error;

    await logActivity({
      fileId: id,
      actorUserId: req.user.id,
      actorEmail: req.user.email,
      action: 'visibility_updated',
      details: `Visibility changed to ${visibility}`,
      ipAddress: getClientIp(req),
    });

    return res.json({ message: 'Visibility updated', visibility });
  } catch (error) {
    logger.error('Toggle visibility error:', error);
    return res.status(500).json({ message: 'Failed to update visibility' });
  }
};

exports.getStats = async (req, res) => {
  try {
    const { data: files } = await supabase
      .from('files')
      .select('id, size, expires_at, encryption')
      .eq('uploaded_by_id', req.user.id);

    const totalFiles = files?.length || 0;
    const totalSize = files?.reduce((sum, f) => sum + f.size, 0) || 0;
    const nowIso = new Date().toISOString();
    const activeFiles = (files || []).filter((f) => f.expires_at > nowIso).length;

    const ownedFileIds = (files || []).map((f) => f.id);
    let totalShares = 0;

    if (ownedFileIds.length > 0) {
      const { count } = await supabase
        .from('file_permissions')
        .select('*', { count: 'exact', head: true })
        .in('file_id', ownedFileIds)
        .eq('permission_type', 'allow');

      totalShares = Number(count || 0);
    }

    res.json({
      totalFiles,
      activeFiles,
      totalShares,
      totalSize,
      encryptedFiles: files?.filter(f => f.encryption?.enabled).length || 0,
    });
  } catch (error) {
    logger.error('Stats error:', error);
    res.status(500).json({ message: 'Stats error' });
  }
};

exports.updateAccessControl = async (req, res) => {
  try {
    const { id } = req.params;
    const { mode } = req.body;

    if (!ALLOWED_ACCESS_MODES.includes(mode)) {
      return res.status(400).json({ message: 'Invalid access mode' });
    }

    const file = await getOwnedFile(id, req.user.id);
    if (!file) return res.status(404).json({ message: 'File not found' });

    const { error } = await supabase
      .from('files')
      .update({ access_mode: mode })
      .eq('id', id)
      .eq('uploaded_by_id', req.user.id);

    if (error) throw error;

    await logActivity({
      fileId: id,
      actorUserId: req.user.id,
      actorEmail: req.user.email,
      action: 'access_mode_updated',
      details: `Access mode changed to ${mode}`,
      ipAddress: getClientIp(req),
    });

    return res.json({ message: 'Access mode updated', mode });
  } catch (error) {
    logger.error('Update access control error:', error);
    return res.status(500).json({ message: 'Failed to update access control' });
  }
};

exports.getFilePermissions = async (req, res) => {
  try {
    const { id } = req.params;
    const file = await getOwnedFile(id, req.user.id);
    if (!file) return res.status(404).json({ message: 'File not found' });

    const { data: permissionRows, error } = await supabase
      .from('file_permissions')
      .select('user_id, permission_type, permissions')
      .eq('file_id', id);

    if (error) throw error;

    const userIds = [...new Set((permissionRows || []).map((r) => r.user_id).filter(Boolean))];
    const usersMap = await getUsersMapByIds(userIds);

    const allowedUsers = (permissionRows || [])
      .filter((r) => r.permission_type === 'allow')
      .map((r) => {
        const user = usersMap.get(r.user_id) || {};
        return {
          userId: r.user_id,
          email: user.email || null,
          name: user.name || null,
          permissions: normalizePermissions(r.permissions),
        };
      });

    const blockedUsers = (permissionRows || [])
      .filter((r) => r.permission_type === 'block')
      .map((r) => {
        const user = usersMap.get(r.user_id) || {};
        return {
          userId: r.user_id,
          email: user.email || null,
          name: user.name || null,
        };
      });

    return res.json({
      fileId: id,
      visibility: file.visibility,
      mode: file.access_mode,
      allowedUsers,
      blockedUsers,
    });
  } catch (error) {
    logger.error('Get file permissions error:', error);
    return res.status(500).json({ message: 'Failed to load file permissions' });
  }
};

exports.addBlockedUser = async (req, res) => {
  try {
    const { id } = req.params;
    const file = await getOwnedFile(id, req.user.id);
    if (!file) return res.status(404).json({ message: 'File not found' });

    let targetUserId = req.body.userId || null;
    let targetEmail = normalizeEmail(req.body.email || '');

    if (!targetUserId && targetEmail) {
      const { data: user } = await supabase
        .from('users')
        .select('id, email')
        .eq('email', targetEmail)
        .maybeSingle();
      if (!user) return res.status(404).json({ message: 'User with this email not found' });
      targetUserId = user.id;
      targetEmail = user.email;
    }

    if (!targetUserId) {
      return res.status(400).json({ message: 'userId or email is required' });
    }

    if (targetUserId === req.user.id) {
      return res.status(400).json({ message: 'You cannot block yourself' });
    }

    const { error: permissionError } = await supabase
      .from('file_permissions')
      .upsert(
        [
          {
            file_id: id,
            user_id: targetUserId,
            permission_type: 'block',
            permissions: [],
          },
        ],
        { onConflict: 'file_id,user_id' }
      );

    if (permissionError) throw permissionError;

    await supabase
      .from('files')
      .update({ access_mode: 'blocklist' })
      .eq('id', id)
      .eq('uploaded_by_id', req.user.id);

    await logActivity({
      fileId: id,
      actorUserId: req.user.id,
      actorEmail: req.user.email,
      action: 'block_added',
      details: targetEmail || targetUserId,
      ipAddress: getClientIp(req),
    });

    return res.json({ message: 'User added to blocklist' });
  } catch (error) {
    logger.error('Add blocked user error:', error);
    return res.status(500).json({ message: 'Failed to add blocked user' });
  }
};

exports.removeBlockedUser = async (req, res) => {
  try {
    const { id, userId } = req.params;
    const file = await getOwnedFile(id, req.user.id);
    if (!file) return res.status(404).json({ message: 'File not found' });

    const { error } = await supabase
      .from('file_permissions')
      .delete()
      .eq('file_id', id)
      .eq('user_id', userId)
      .eq('permission_type', 'block');

    if (error) throw error;

    await logActivity({
      fileId: id,
      actorUserId: req.user.id,
      actorEmail: req.user.email,
      action: 'block_removed',
      details: userId,
      ipAddress: getClientIp(req),
    });

    return res.json({ message: 'User removed from blocklist' });
  } catch (error) {
    logger.error('Remove blocked user error:', error);
    return res.status(500).json({ message: 'Failed to remove blocked user' });
  }
};

exports.addAllowedUser = async (req, res) => {
  try {
    const { id } = req.params;
    const file = await getOwnedFile(id, req.user.id);
    if (!file) return res.status(404).json({ message: 'File not found' });

    const email = normalizeEmail(req.body.email);
    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    const { data: targetUser } = await supabase
      .from('users')
      .select('id, email, name')
      .eq('email', email)
      .maybeSingle();

    if (!targetUser) {
      return res.status(404).json({ message: 'User with this email not found' });
    }

    if (targetUser.id === req.user.id) {
      return res.status(400).json({ message: 'You already own this file' });
    }

    const permissions = normalizePermissions(req.body.permissions);
    const { error: permissionError } = await supabase
      .from('file_permissions')
      .upsert(
        [
          {
            file_id: id,
            user_id: targetUser.id,
            permission_type: 'allow',
            permissions,
          },
        ],
        { onConflict: 'file_id,user_id' }
      );

    if (permissionError) throw permissionError;

    await supabase
      .from('files')
      .update({ access_mode: 'allowlist' })
      .eq('id', id)
      .eq('uploaded_by_id', req.user.id);

    await logActivity({
      fileId: id,
      actorUserId: req.user.id,
      actorEmail: req.user.email,
      action: 'share_added',
      details: `${targetUser.email} (${permissions.join(',')})`,
      ipAddress: getClientIp(req),
    });

    return res.json({
      message: 'Access granted successfully',
      user: {
        userId: targetUser.id,
        email: targetUser.email,
        name: targetUser.name,
        permissions,
      },
    });
  } catch (error) {
    logger.error('Add allowed user error:', error);
    return res.status(500).json({ message: 'Failed to add allowed user' });
  }
};

exports.updateAllowedUserPermissions = async (req, res) => {
  try {
    const { id, userId } = req.params;
    const file = await getOwnedFile(id, req.user.id);
    if (!file) return res.status(404).json({ message: 'File not found' });

    const permissions = normalizePermissions(req.body.permissions);
    const { data, error } = await supabase
      .from('file_permissions')
      .update({ permissions, permission_type: 'allow' })
      .eq('file_id', id)
      .eq('user_id', userId)
      .eq('permission_type', 'allow')
      .select('user_id')
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ message: 'Allowed user record not found' });

    await logActivity({
      fileId: id,
      actorUserId: req.user.id,
      actorEmail: req.user.email,
      action: 'share_permissions_updated',
      details: `${userId} -> ${permissions.join(',')}`,
      ipAddress: getClientIp(req),
    });

    return res.json({ message: 'Permissions updated', permissions });
  } catch (error) {
    logger.error('Update allowed user permissions error:', error);
    return res.status(500).json({ message: 'Failed to update permissions' });
  }
};

exports.removeAllowedUser = async (req, res) => {
  try {
    const { id, userId } = req.params;
    const file = await getOwnedFile(id, req.user.id);
    if (!file) return res.status(404).json({ message: 'File not found' });

    const { error } = await supabase
      .from('file_permissions')
      .delete()
      .eq('file_id', id)
      .eq('user_id', userId)
      .eq('permission_type', 'allow');

    if (error) throw error;

    await logActivity({
      fileId: id,
      actorUserId: req.user.id,
      actorEmail: req.user.email,
      action: 'share_removed',
      details: userId,
      ipAddress: getClientIp(req),
    });

    return res.json({ message: 'Access removed successfully' });
  } catch (error) {
    logger.error('Remove allowed user error:', error);
    return res.status(500).json({ message: 'Failed to remove allowed user' });
  }
};

exports.getFileActivity = async (req, res) => {
  try {
    const { id } = req.params;
    const file = await getOwnedFile(id, req.user.id);
    if (!file) return res.status(404).json({ message: 'File not found' });

    const { data: permissionRows, error: permissionsError } = await supabase
      .from('file_permissions')
      .select('user_id, permission_type, permissions')
      .eq('file_id', id);

    if (permissionsError) throw permissionsError;

    const { data: activityRows, error: activityError } = await supabase
      .from('file_activity')
      .select('actor_user_id, actor_email, action, details, created_at')
      .eq('file_id', id)
      .order('created_at', { ascending: false })
      .limit(200);

    if (activityError) throw activityError;

    const userIds = new Set();
    (permissionRows || []).forEach((r) => {
      if (r.user_id) userIds.add(r.user_id);
    });
    (activityRows || []).forEach((r) => {
      if (r.actor_user_id) userIds.add(r.actor_user_id);
    });

    const usersMap = await getUsersMapByIds([...userIds]);

    const sharedWith = (permissionRows || [])
      .filter((r) => r.permission_type === 'allow')
      .map((r) => {
        const user = usersMap.get(r.user_id) || {};
        return {
          userId: r.user_id,
          email: user.email || null,
          name: user.name || null,
          permissions: normalizePermissions(r.permissions),
        };
      });

    const viewedByMap = new Map();
    const editedByMap = new Map();

    (activityRows || []).forEach((row) => {
      const action = String(row.action || '').toLowerCase();
      const user = row.actor_user_id ? usersMap.get(row.actor_user_id) : null;
      const email = row.actor_email || user?.email || 'anonymous';
      const name = user?.name || null;
      const key = row.actor_user_id || email;

      if (['view', 'preview', 'download'].includes(action)) {
        const prev = viewedByMap.get(key) || { userId: row.actor_user_id || null, email, name, count: 0 };
        prev.count += 1;
        viewedByMap.set(key, prev);
      }

      if (action.includes('edit')) {
        const prev = editedByMap.get(key) || { userId: row.actor_user_id || null, email, name, count: 0 };
        prev.count += 1;
        editedByMap.set(key, prev);
      }
    });

    const activityLogs = (activityRows || []).map((row) => {
      const user = row.actor_user_id ? usersMap.get(row.actor_user_id) : null;
      return {
        at: row.created_at,
        action: row.action,
        details: row.details,
        userId: row.actor_user_id,
        email: row.actor_email || user?.email || null,
        name: user?.name || null,
      };
    });

    return res.json({
      summary: {
        sharedWithCount: sharedWith.length,
        viewedByCount: viewedByMap.size,
        editedByCount: editedByMap.size,
      },
      sharedWith,
      viewedBy: [...viewedByMap.values()],
      editedBy: [...editedByMap.values()],
      activityLogs,
    });
  } catch (error) {
    logger.error('Get file activity error:', error);
    return res.status(500).json({ message: 'Failed to load file activity' });
  }
};
