import axios from 'axios';

const trimTrailingSlash = (value = '') => String(value).replace(/\/+$/, '');

const normalizeApiUrl = (value = '') => {
  const raw = String(value || '').trim();
  if (!raw) return '';

  if (raw.startsWith('/')) {
    return trimTrailingSlash(raw) || '/';
  }

  try {
    const parsed = new URL(raw);
    const normalizedPath =
      parsed.pathname && parsed.pathname !== '/'
        ? trimTrailingSlash(parsed.pathname)
        : '/api';
    return `${parsed.origin}${normalizedPath}`;
  } catch {
    return '';
  }
};

const envApiUrl = normalizeApiUrl(import.meta.env.VITE_API_URL);
const isLocalhostApi = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(envApiUrl);
const API_BASE = import.meta.env.PROD
  ? (envApiUrl && !isLocalhostApi ? envApiUrl : '/api')
  : (envApiUrl || 'http://localhost:5000/api');

const api = axios.create({
  baseURL: API_BASE,
  timeout: 60000,
});

/**
 * Upload multiple files.
 * @param {File[]} files - Array of File objects from the file input.
 * @param {function} onProgress - Progress callback (0-100).
 * @returns {Promise} - { groupCode, accessUrl, qrCode, files, expiresAt }
 */
export const uploadFiles = async (files, onProgress) => {
  const formData = new FormData();
  files.forEach((file) => {
    formData.append('files', file);
  });

  const response = await api.post('/files/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (progressEvent) => {
      if (onProgress && progressEvent.total) {
        const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
        onProgress(percent);
      }
    },
  });

  return response.data;
};

/**
 * Get files by access code.
 * @param {string} code - 6-digit access code.
 * @returns {Promise} - { groupCode, files[] }
 */
export const getFilesByCode = async (code) => {
  const response = await api.get(`/files/${code}`);
  return response.data;
};

/**
 * Get the download URL for a file.
 * @param {string} fileId - File ID.
 * @returns {string} - Download URL.
 */
export const getDownloadUrl = (fileId) => {
  return `${API_BASE}/files/download/${fileId}`;
};

/**
 * Fetch a file as a Blob (useful for protected routes via JWT).
 * @param {string} fileId - File ID
 * @param {string} type - 'download' or 'preview'
 * @returns {Promise<Blob>}
 */
export const fetchFileBlob = async (fileId, type = 'download') => {
  const response = await api.get(`/files/${type}/${fileId}`, { responseType: 'blob' });
  const responseMime = String(response.headers?.['content-type'] || '').split(';')[0].trim();
  const blob = response.data;

  if (responseMime && blob.type !== responseMime) {
    return new Blob([blob], { type: responseMime });
  }

  return blob;
};

/**
 * Fetch a file and return an object URL.
 * @param {string} fileId - File ID
 * @param {string} type - 'download' or 'preview'
 * @returns {Promise<string>} - Object URL
 */
export const fetchFileAsBlob = async (fileId, type = 'download') => {
  const blob = await fetchFileBlob(fileId, type);
  return URL.createObjectURL(blob);
};

export const checkEmailExists = async (email) => {
  const res = await api.post('/auth/email-exists', { email });
  return res.data;
};

export const requestPasswordReset = async (email) => {
  const res = await api.post('/auth/forgot-password', { email });
  return res.data;
};

export const resetPasswordWithCode = async ({ email, code, newPassword }) => {
  const res = await api.post('/auth/reset-password', { email, code, newPassword });
  return res.data;
};

export const verifyEmailCode = async ({ email, code }) => {
  const res = await api.post('/auth/verify-email', { email, code });
  return res.data;
};

export const resendVerificationCode = async (email) => {
  const res = await api.post('/auth/resend-verification', { email });
  return res.data;
};

export default api;
