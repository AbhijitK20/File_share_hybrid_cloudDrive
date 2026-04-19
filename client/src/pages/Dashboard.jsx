import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  HiFolder, HiTrash, HiClock, HiDocumentText, HiCloudUpload,
  HiShare, HiRefresh, HiEye, HiEyeOff
} from 'react-icons/hi';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';

const formatSize = (bytes) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const formatDate = (date) => {
  return new Date(date).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
};

const isExpired = (date) => new Date(date) < new Date();

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [files, setFiles] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [extending, setExtending] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [toggling, setToggling] = useState(null);
  const [shareEmail, setShareEmail] = useState('');
  const [sharePermission, setSharePermission] = useState('view');
  const [sharingFileId, setSharingFileId] = useState(null);
  const [activityByFile, setActivityByFile] = useState({});

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [filesRes, statsRes] = await Promise.all([
        api.get('/dashboard/files'),
        api.get('/dashboard/stats'),
      ]);
      setFiles(filesRes.data.files);
      setStats(statsRes.data);
    } catch (err) {
      console.error('Dashboard fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (fileId) => {
    if (!confirm('Are you sure you want to delete this file?')) return;
    setDeleting(fileId);
    try {
      await api.delete(`/dashboard/files/${fileId}`);
      setFiles((prev) => prev.filter((f) => f.id !== fileId));
      // Refresh stats
      const statsRes = await api.get('/dashboard/stats');
      setStats(statsRes.data);
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to delete');
    } finally {
      setDeleting(null);
    }
  };

  const handleExtend = async (fileId) => {
    setExtending(fileId);
    try {
      const res = await api.patch(`/dashboard/files/${fileId}/extend`, { days: 7 });
      setFiles((prev) =>
        prev.map((f) => (f.id === fileId ? { ...f, expiresAt: res.data.expiresAt } : f))
      );
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to extend');
    } finally {
      setExtending(null);
    }
  };

  const handleToggleVisibility = async (fileId, currentVisibility) => {
    const newVisibility = currentVisibility === 'private' ? 'public' : 'private';
    setToggling(fileId);
    try {
      const res = await api.patch(`/dashboard/files/${fileId}/visibility`, { visibility: newVisibility });
      setFiles((prev) =>
        prev.map((f) => (f.id === fileId ? { ...f, visibility: res.data.visibility } : f))
      );
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to update visibility');
    } finally {
      setToggling(null);
    }
  };

  const handleShareByEmail = async (fileId) => {
    if (!shareEmail) return;
    try {
      await api.patch(`/dashboard/files/${fileId}/access`, { mode: 'allowlist' });
      await api.post(`/dashboard/files/${fileId}/allowlist`, {
        email: shareEmail,
        permissions: sharePermission === 'edit' ? ['view', 'edit'] : ['view'],
      });
      alert('Shared successfully');
      setShareEmail('');
      setSharingFileId(null);
      await fetchData();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to share file');
    }
  };

  const loadActivity = async (fileId) => {
    try {
      const res = await api.get(`/dashboard/files/${fileId}/activity`);
      setActivityByFile((prev) => ({ ...prev, [fileId]: res.data }));
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to load activity');
    }
  };

  const statCards = stats
    ? [
        { label: 'Total Files', value: stats.totalFiles, icon: <HiDocumentText />, color: 'brand' },
        { label: 'Active Files', value: stats.activeFiles, icon: <HiFolder />, color: 'green' },
        { label: 'Total Shares', value: stats.totalShares, icon: <HiShare />, color: 'purple' },
        { label: 'Storage Used', value: formatSize(stats.totalSize), icon: <HiCloudUpload />, color: 'blue' },
      ]
    : [];

  const colorMap = {
    brand: 'from-brand-500/20 to-brand-600/10 border-brand-500/20 text-brand-400',
    green: 'from-green-500/20 to-green-600/10 border-green-500/20 text-green-400',
    purple: 'from-purple-500/20 to-purple-600/10 border-purple-500/20 text-purple-400',
    blue: 'from-blue-500/20 to-blue-600/10 border-blue-500/20 text-blue-400',
  };

  return (
    <div className="min-h-screen pt-20 sm:pt-24 pb-10 sm:pb-12 px-4 sm:px-6">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-8"
        >
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-white mb-1">
              Welcome, <span className="gradient-text">{user?.name}</span>
            </h1>
            <p className="text-white/40">Manage your uploaded files</p>
          </div>
          <div className="flex items-center gap-3 w-full md:w-auto">
            <button
              onClick={fetchData}
              className="btn-secondary flex-1 md:flex-none justify-center flex items-center gap-2 py-2 px-4 text-sm"
            >
              <HiRefresh className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
            <button
              onClick={() => navigate('/')}
              className="btn-primary flex-1 md:flex-none justify-center flex items-center gap-2 py-2 px-4 text-sm"
            >
              <HiCloudUpload />
              Upload Files
            </button>
          </div>
        </motion.div>

        {/* Stats Grid */}
        {stats && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mb-8"
          >
            {statCards.map((stat, i) => (
              <div
                key={i}
                className={`bg-gradient-to-br ${colorMap[stat.color]} border rounded-2xl p-5`}
              >
                <div className="text-2xl mb-2">{stat.icon}</div>
                <p className="text-2xl font-bold text-white">{stat.value}</p>
                <p className="text-white/40 text-sm mt-1">{stat.label}</p>
              </div>
            ))}
          </motion.div>
        )}

        {/* Files Table */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="glass overflow-hidden"
        >
          <div className="p-5 border-b border-white/5">
            <h2 className="text-lg font-semibold text-white">Your Files</h2>
          </div>

          {loading ? (
            <div className="p-12 text-center">
              <div className="w-8 h-8 border-2 border-white/20 border-t-brand-400 rounded-full animate-spin mx-auto" />
              <p className="text-white/40 mt-4">Loading your files...</p>
            </div>
          ) : files.length === 0 ? (
            <div className="p-12 text-center">
              <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mx-auto mb-4">
                <HiFolder className="text-3xl text-white/20" />
              </div>
              <p className="text-white/40 mb-4">No files uploaded yet</p>
              <button onClick={() => navigate('/')} className="btn-primary text-sm py-2 px-6">
                Upload Your First File
              </button>
            </div>
          ) : (
            <div className="divide-y divide-white/5">
              {files.map((file, i) => (
                <div key={file.id}>
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.05 }}
                    className="p-4 px-4 sm:px-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 hover:bg-white/[0.02] transition-colors"
                  >
                    <div className="flex items-center gap-4 min-w-0 w-full lg:flex-1">
                      <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center flex-shrink-0">
                        <HiDocumentText className="text-brand-400" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-white font-medium truncate text-sm">{file.name}</p>
                        <div className="flex flex-wrap items-center gap-2 mt-1">
                          <span className="text-white/30 text-xs">{formatSize(file.size)}</span>
                          <span className="text-white/30 text-xs">Code: {file.groupCode}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${
                            isExpired(file.expiresAt)
                              ? 'bg-red-500/10 text-red-400'
                              : 'bg-green-500/10 text-green-400'
                          }`}>
                            {isExpired(file.expiresAt) ? 'Expired' : `Expires ${formatDate(file.expiresAt)}`}
                          </span>
                          <button
                            onClick={() => handleToggleVisibility(file.id, file.visibility || 'public')}
                            disabled={toggling === file.id}
                            className={`flex items-center justify-center gap-1 text-xs px-2 py-0.5 rounded-full transition-colors disabled:opacity-50 ${
                              (file.visibility || 'public') === 'private'
                                ? 'bg-purple-500/10 text-purple-400 hover:bg-purple-500/20'
                                : 'bg-blue-500/10 text-blue-400 hover:bg-blue-500/20'
                            }`}
                            title={`Click to make ${(file.visibility || 'public') === 'private' ? 'Public' : 'Private'}`}
                          >
                            {toggling === file.id ? (
                              <div className="w-3 h-3 border border-white/20 border-t-white rounded-full animate-spin" />
                            ) : (file.visibility || 'public') === 'private' ? (
                              <><HiEyeOff /> Private</>
                            ) : (
                              <><HiEye /> Public</>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap w-full lg:w-auto justify-end flex-shrink-0">
                      <button
                        onClick={() => setSharingFileId(sharingFileId === file.id ? null : file.id)}
                        className="p-2 rounded-lg hover:bg-white/5 text-white/40 hover:text-brand-400 transition-all"
                        title="Share with specific email"
                      >
                        <HiShare className="text-lg" />
                      </button>
                      <button
                        onClick={() => loadActivity(file.id)}
                        className="p-2 rounded-lg hover:bg-white/5 text-white/40 hover:text-green-400 transition-all"
                        title="Load sharing & activity"
                      >
                        <HiEye className="text-lg" />
                      </button>
                      {!isExpired(file.expiresAt) && (
                        <button
                          onClick={() => handleExtend(file.id)}
                          disabled={extending === file.id}
                          className="p-2 rounded-lg hover:bg-white/5 text-white/40 hover:text-blue-400 transition-all disabled:opacity-30"
                          title="Extend by 7 days"
                        >
                          {extending === file.id ? (
                            <div className="w-4 h-4 border-2 border-white/20 border-t-blue-400 rounded-full animate-spin" />
                          ) : (
                            <HiClock className="text-lg" />
                          )}
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(file.id)}
                        disabled={deleting === file.id}
                        className="p-2 rounded-lg hover:bg-red-500/10 text-white/40 hover:text-red-400 transition-all disabled:opacity-30"
                        title="Delete file"
                      >
                        {deleting === file.id ? (
                          <div className="w-4 h-4 border-2 border-white/20 border-t-red-400 rounded-full animate-spin" />
                        ) : (
                          <HiTrash className="text-lg" />
                        )}
                      </button>
                    </div>
                  </motion.div>

                  {sharingFileId === file.id && (
                    <div className="px-5 pb-4 flex flex-col md:flex-row gap-2 items-stretch md:items-center w-full">
                      <input
                        type="email"
                        placeholder="user@gmail.com"
                        className="input-field flex-1"
                        value={shareEmail}
                        onChange={(e) => setShareEmail(e.target.value)}
                      />
                      <select
                        className="input-field md:w-40"
                        value={sharePermission}
                        onChange={(e) => setSharePermission(e.target.value)}
                      >
                        <option value="view">View</option>
                        <option value="edit">Edit</option>
                      </select>
                      <button className="btn-primary md:w-36" onClick={() => handleShareByEmail(file.id)}>
                        Add Access
                      </button>
                    </div>
                  )}
                  {activityByFile[file.id] && (
                    <div className="px-5 pb-4 space-y-3">
                      <div className="text-xs text-white/60">
                        Shared with: <span className="text-white">{activityByFile[file.id].summary?.sharedWithCount || 0}</span> |
                        Viewed by: <span className="text-white"> {activityByFile[file.id].summary?.viewedByCount || 0}</span> |
                        Edited by: <span className="text-white"> {activityByFile[file.id].summary?.editedByCount || 0}</span>
                      </div>
                      <div className="grid md:grid-cols-2 gap-3">
                        <div className="bg-white/5 rounded-xl p-3">
                          <p className="text-sm text-white font-medium mb-2">People you shared with</p>
                          <div className="space-y-1">
                            {(activityByFile[file.id].sharedWith || []).map((p) => (
                              <div key={`${file.id}-s-${p.userId}`} className="text-xs text-white/70">
                                {p.email} ({(p.permissions || []).join(', ')})
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="bg-white/5 rounded-xl p-3">
                          <p className="text-sm text-white font-medium mb-2">People who viewed</p>
                          <div className="space-y-1">
                            {(activityByFile[file.id].viewedBy || []).map((p) => (
                              <div key={`${file.id}-v-${p.userId}`} className="text-xs text-white/70">
                                {p.email || p.name} (views: {p.count})
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                      <div className="bg-white/5 rounded-xl p-3">
                        <p className="text-sm text-white font-medium mb-2">Activity timeline</p>
                        <div className="max-h-40 overflow-y-auto space-y-1">
                          {(activityByFile[file.id].activityLogs || []).map((a, idx) => (
                            <div key={`${file.id}-a-${idx}`} className="text-xs text-white/70">
                              [{new Date(a.at).toLocaleString()}] {a.email || a.name}: {a.action} {a.details ? `- ${a.details}` : ''}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
}
