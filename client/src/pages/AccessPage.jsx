import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { HiSearch, HiArrowRight, HiFolder, HiX } from 'react-icons/hi';
import FileCard from '../components/FileCard';
import { getFilesByCode, fetchFileBlob } from '../services/api';

const MAX_TEXT_PREVIEW_BYTES = 1024 * 1024;

function getEffectiveMimeType(file, blob) {
  const blobType = String(blob?.type || '').trim();
  const fileType = String(file?.mimetype || '').trim();
  return blobType || fileType || 'application/octet-stream';
}

function isTextLike(mimeType) {
  const value = String(mimeType || '').toLowerCase();
  return value.startsWith('text/')
    || value.includes('json')
    || value.includes('xml')
    || value.includes('javascript')
    || value.includes('yaml')
    || value.includes('csv');
}

export default function AccessPage() {
  const { code: urlCode } = useParams();
  const navigate = useNavigate();

  const [code, setCode] = useState(urlCode || '');
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [searched, setSearched] = useState(false);

  const [previewFile, setPreviewFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewMimeType, setPreviewMimeType] = useState('');
  const [previewText, setPreviewText] = useState(null);
  const [previewUnsupported, setPreviewUnsupported] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    if (urlCode) {
      fetchFiles(urlCode);
    }
  }, [urlCode]);

  const fetchFiles = async (accessCode) => {
    setLoading(true);
    setError(null);
    setSearched(true);

    try {
      const data = await getFilesByCode(accessCode);
      setFiles(data.files);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to find files. Check your code and try again.');
      setFiles([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (code.trim().length === 6) {
      navigate(`/access/${code.trim()}`);
      fetchFiles(code.trim());
    }
  };

  const closePreview = () => {
    setPreviewFile(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setPreviewMimeType('');
    setPreviewText(null);
    setPreviewUnsupported(false);
  };

  const handlePreview = async (file) => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    setPreviewFile(file);
    setPreviewUrl(null);
    setPreviewMimeType('');
    setPreviewText(null);
    setPreviewUnsupported(false);
    setPreviewLoading(true);

    try {
      const blob = await fetchFileBlob(file.id, 'preview');
      const mimeType = getEffectiveMimeType(file, blob);
      const url = URL.createObjectURL(blob);

      if (isTextLike(mimeType)) {
        const sliced = blob.size > MAX_TEXT_PREVIEW_BYTES ? blob.slice(0, MAX_TEXT_PREVIEW_BYTES) : blob;
        const text = await sliced.text();
        setPreviewText(blob.size > MAX_TEXT_PREVIEW_BYTES
          ? `${text}\n\n--- Preview truncated at 1 MB ---`
          : text);
      }

      const supportedByViewer = mimeType.startsWith('image/')
        || mimeType.startsWith('video/')
        || mimeType.startsWith('audio/')
        || mimeType.includes('pdf')
        || isTextLike(mimeType)
        || mimeType.includes('officedocument')
        || mimeType.includes('msword')
        || mimeType.includes('ms-excel')
        || mimeType.includes('ms-powerpoint');

      setPreviewUnsupported(!supportedByViewer);
      setPreviewMimeType(mimeType);
      setPreviewUrl(url);
    } catch {
      alert("Failed to load preview. It may be a private file.");
      closePreview();
    } finally {
      setPreviewLoading(false);
    }
  };

  return (
    <div className="min-h-screen pt-20 sm:pt-24 pb-10 sm:pb-12 px-4 sm:px-6">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-10"
        >
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold gradient-text mb-3">
            Access Files
          </h1>
          <p className="text-white/50 text-base sm:text-lg">
            Enter a 6-digit code to access shared files
          </p>
        </motion.div>

        {/* Code Input */}
        <motion.form
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          onSubmit={handleSubmit}
          className="glass p-4 sm:p-6 mb-8"
        >
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <HiSearch className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30 text-xl" />
              <input
                type="text"
                value={code}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, '').slice(0, 6);
                  setCode(val);
                }}
                placeholder="Enter 6-digit code"
                className="input-field w-full pl-12 text-lg tracking-widest font-medium"
                maxLength={6}
              />
            </div>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              type="submit"
              disabled={code.length !== 6 || loading}
                className="btn-primary w-full sm:w-auto justify-center flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  Access <HiArrowRight />
                </>
              )}
            </motion.button>
          </div>
        </motion.form>

        {/* Error */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="glass border-red-500/30 p-5 mb-8 text-center"
            >
              <p className="text-red-400">{error}</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Files List */}
        <AnimatePresence>
          {files.length > 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              {/* Header */}
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-lg bg-brand-500/10 flex items-center justify-center">
                  <HiFolder className="text-brand-400 text-xl" />
                </div>
                <div>
                  <p className="text-white font-medium">
                    {files.length} file{files.length !== 1 ? 's' : ''} found
                  </p>
                  <p className="text-white/30 text-sm">Code: {urlCode || code}</p>
                </div>
              </div>

              {/* File Cards */}
              <div className="space-y-3">
                {files.map((file, index) => (
                  <FileCard
                    key={file.id}
                    file={file}
                    index={index}
                    onPreview={handlePreview}
                  />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Empty state */}
        {searched && !loading && !error && files.length === 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-16"
          >
            <div className="w-20 h-20 rounded-2xl bg-white/5 flex items-center justify-center mx-auto mb-4">
              <HiFolder className="text-4xl text-white/20" />
            </div>
            <p className="text-white/30">No files found</p>
          </motion.div>
        )}
      </div>

      {/* Preview Modal */}
      <AnimatePresence>
        {previewFile && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 md:p-8"
            onClick={closePreview}
          >
            <motion.div
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-surface-900 border border-white/10 rounded-2xl w-full max-w-5xl h-full max-h-[90vh] flex flex-col overflow-hidden shadow-2xl"
            >
              {/* Header */}
              <div className="flex items-center justify-between p-4 border-b border-white/10 shrink-0 bg-surface-950">
                <p className="text-white font-medium truncate pr-4">{previewFile.name}</p>
                <button
                  onClick={closePreview}
                  className="p-2 bg-white/5 hover:bg-white/10 rounded-xl text-white/70 hover:text-white transition-colors"
                >
                  <HiX className="text-xl" />
                </button>
              </div>
              
              {/* Content Center */}
              <div className="flex-1 bg-black/50 overflow-hidden relative flex items-center justify-center p-4">
                {previewLoading ? (
                  <div className="flex flex-col items-center">
                    <div className="w-10 h-10 border-4 border-brand-400/30 border-t-brand-400 rounded-full animate-spin mb-4" />
                    <p className="text-white/50">Loading preview...</p>
                  </div>
                ) : previewUrl ? (
                  previewMimeType.startsWith('image/') ? (
                    <img
                      src={previewUrl}
                      alt={previewFile.name}
                      className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
                    />
                  ) : previewMimeType.startsWith('video/') ? (
                    <video
                      src={previewUrl}
                      controls
                      className="max-w-full max-h-full rounded-lg shadow-2xl bg-black"
                    />
                  ) : previewMimeType.startsWith('audio/') ? (
                    <audio
                      src={previewUrl}
                      controls
                      className="w-full max-w-2xl"
                    />
                  ) : previewMimeType.includes('pdf') ? (
                    <iframe
                      src={previewUrl}
                      className="w-full h-full rounded-b-xl bg-white"
                      title="PDF Preview"
                    />
                  ) : previewText !== null ? (
                    <pre className="w-full h-full overflow-auto rounded-xl bg-black/60 p-4 text-xs sm:text-sm text-white/80 whitespace-pre-wrap break-words">
                      {previewText}
                    </pre>
                  ) : !previewUnsupported ? (
                    <iframe
                      src={previewUrl}
                      className="w-full h-full rounded-b-xl bg-white"
                      title="File Preview"
                    />
                  ) : null
                ) : (
                  <p className="text-red-400">Failed to load preview</p>
                )}

                {!previewLoading && previewUnsupported && (
                  <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-amber-500/15 border border-amber-500/30 rounded-lg px-3 py-2 text-xs text-amber-200">
                    Preview is limited for this file type. Use Download for full fidelity.
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
