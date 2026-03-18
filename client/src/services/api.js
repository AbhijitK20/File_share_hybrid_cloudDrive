import axios from 'axios';

const API_BASE = 'http://localhost:5000/api';

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
 * @returns {Promise<string>} - Object URL
 */
export const fetchFileAsBlob = async (fileId, type = 'download') => {
  const response = await api.get(`/files/${type}/${fileId}`, { responseType: 'blob' });
  return URL.createObjectURL(response.data);
};

export default api;
