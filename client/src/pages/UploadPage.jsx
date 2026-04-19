import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { motion, AnimatePresence } from 'framer-motion';
import { HiCloudUpload, HiDocumentAdd, HiX, HiClipboardCopy, HiLink, HiCheck, HiStar } from 'react-icons/hi';
import { QRCodeSVG } from 'qrcode.react';
import { uploadFiles } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { Link } from 'react-router-dom';

export default function UploadPage() {
  const { user } = useAuth();
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [codeCopied, setCodeCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  const isVercelFunctionUpload =
    import.meta.env.PROD &&
    (!import.meta.env.VITE_API_URL || import.meta.env.VITE_API_URL === '/api') &&
    typeof window !== 'undefined' &&
    window.location.hostname.endsWith('.vercel.app');

  const isPremium = user?.plan === 'premium';
  const planMaxFileSize = isPremium ? 5 * 1024 * 1024 * 1024 : 100 * 1024 * 1024;
  // Vercel serverless functions reject request payloads over ~4.5MB.
  const hostedMaxFileSize = 4 * 1024 * 1024;
  const MAX_FILE_SIZE = isVercelFunctionUpload
    ? Math.min(planMaxFileSize, hostedMaxFileSize)
    : planMaxFileSize;

  const onDrop = useCallback((acceptedFiles, fileRejections) => {
    if (fileRejections.length > 0) {
      setError(`Some files exceeded the ${formatSize(MAX_FILE_SIZE)} limit.`);
    } else {
      setFiles((prev) => [...prev, ...acceptedFiles]);
      setError(null);
    }
    setResult(null);
  }, [MAX_FILE_SIZE]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: true,
    maxSize: MAX_FILE_SIZE
  });

  const removeFile = (index) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleUpload = async () => {
    if (files.length === 0) return;

    setUploading(true);
    setError(null);
    setProgress(0);

    try {
      const data = await uploadFiles(files, (p) => setProgress(p));
      setResult(data);
      setFiles([]);
    } catch (err) {
      const status = err.response?.status;
      const textResponse = typeof err.response?.data === 'string' ? err.response.data : '';
      const isPayloadTooLarge = status === 413 || textResponse.includes('FUNCTION_PAYLOAD_TOO_LARGE');

      if (isPayloadTooLarge) {
        setError(`This deployment currently allows up to ${formatSize(MAX_FILE_SIZE)} per file. Deploy backend outside Vercel Functions for larger uploads.`);
      } else {
        setError(err.response?.data?.message || 'Upload failed. Please try again.');
      }
    } finally {
      setUploading(false);
    }
  };

  const copyToClipboard = (text, type) => {
    navigator.clipboard.writeText(text);
    if (type === 'code') {
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    } else {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    }
  };

  const formatSize = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="min-h-screen pt-24 pb-12 px-6">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-10"
        >
          <h1 className="text-4xl md:text-5xl font-bold gradient-text mb-3">
            Share Files Instantly
          </h1>
          <p className="text-white/50 text-lg mb-4">
            No account needed. Drop your files, get a code, share anywhere.
          </p>
          {isVercelFunctionUpload && (
            <p className="text-amber-300/80 text-xs mb-3">
              Hosted mode limit: up to {formatSize(MAX_FILE_SIZE)} per file on this deployment.
            </p>
          )}
          {!isPremium && (
            <Link to="/pricing" className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand-500/10 text-brand-400 hover:bg-brand-500/20 transition-colors text-xs font-medium border border-brand-500/20">
              <HiStar /> Upgrade to Pro for 5GB uploads
            </Link>
          )}
        </motion.div>

        {/* Drop Zone */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <div
            {...getRootProps()}
            className={`relative glass p-12 text-center cursor-pointer transition-all duration-500 group
              ${isDragActive
                ? 'border-brand-400 bg-brand-500/10 shadow-glow-lg scale-[1.02]'
                : 'hover:border-white/20 hover:bg-white/[0.03]'
              }`}
          >
            <input {...getInputProps()} />

            {/* Background decoration */}
            <div className="absolute inset-0 rounded-2xl overflow-hidden pointer-events-none">
              <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 rounded-full transition-all duration-700 ${isDragActive ? 'bg-brand-500/20 scale-150' : 'bg-brand-500/5 scale-100'}`} />
            </div>

            <div className="relative z-10">
              <motion.div
                animate={{ y: isDragActive ? -10 : 0 }}
                transition={{ duration: 0.3 }}
                className="mx-auto w-20 h-20 rounded-2xl bg-gradient-to-br from-brand-500/20 to-purple-500/20 flex items-center justify-center mb-6"
              >
                {isDragActive ? (
                  <HiDocumentAdd className="text-4xl text-brand-400" />
                ) : (
                  <HiCloudUpload className="text-4xl text-brand-400 group-hover:text-brand-300 transition-colors" />
                )}
              </motion.div>

              {isDragActive ? (
                <p className="text-xl text-brand-300 font-medium">Drop your files here...</p>
              ) : (
                <>
                  <p className="text-xl text-white/80 font-medium mb-2">
                    Drag & drop files here
                  </p>
                  <p className="text-white/40 text-sm mb-1">or click to browse</p>
                  <p className="text-brand-400/60 text-xs font-medium uppercase tracking-widest mt-4">
                    Max size: {formatSize(MAX_FILE_SIZE)} per file
                  </p>
                </>
              )}
            </div>
          </div>
        </motion.div>

        {/* Selected Files */}
        <AnimatePresence>
          {files.length > 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-6"
            >
              <div className="glass p-5">
                <div className="flex items-center justify-between mb-4">
                  <p className="text-white/60 text-sm font-medium">
                    {files.length} file{files.length !== 1 ? 's' : ''} selected
                  </p>
                  <button
                    onClick={() => setFiles([])}
                    className="text-white/40 hover:text-red-400 text-sm transition-colors"
                  >
                    Clear all
                  </button>
                </div>

                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {files.map((file, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between py-2 px-3 rounded-lg bg-white/5 hover:bg-white/[0.07] transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-white/80 truncate text-sm">{file.name}</span>
                        <span className="text-white/30 text-xs flex-shrink-0">{formatSize(file.size)}</span>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                        className="text-white/30 hover:text-red-400 transition-colors p-1"
                      >
                        <HiX />
                      </button>
                    </div>
                  ))}
                </div>

                {/* Upload Button */}
                <motion.button
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                  onClick={handleUpload}
                  disabled={uploading}
                  className="btn-primary w-full mt-5 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {uploading ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Uploading... {progress}%
                    </>
                  ) : (
                    <>
                      <HiCloudUpload className="text-xl" />
                      Upload Files
                    </>
                  )}
                </motion.button>

                {/* Progress bar */}
                {uploading && (
                  <div className="mt-3 h-1.5 bg-white/10 rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${progress}%` }}
                      className="h-full bg-gradient-to-r from-brand-500 to-purple-500 rounded-full"
                    />
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Error */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="mt-6 glass border-red-500/30 p-4"
            >
              <p className="text-red-400 text-sm">{error}</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Result Card */}
        <AnimatePresence>
          {result && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ type: 'spring', stiffness: 200, damping: 20 }}
              className="mt-8"
            >
              <div className="glass p-8 border-brand-500/20">
                <div className="text-center mb-8">
                  <div className="w-16 h-16 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center mx-auto mb-4">
                    <HiCheck className="text-3xl text-green-400" />
                  </div>
                  <h2 className="text-2xl font-bold text-white mb-1">Files Uploaded!</h2>
                  <p className="text-white/40 text-sm">Share the code or link with anyone</p>
                </div>

                {/* Access Code */}
                <div className="bg-white/5 rounded-xl p-5 mb-5">
                  <p className="text-white/40 text-xs font-medium uppercase tracking-wider mb-3">Access Code</p>
                  <div className="flex items-center justify-between">
                    <span className="text-4xl font-bold tracking-[0.3em] gradient-text">
                      {result.groupCode}
                    </span>
                    <button
                      onClick={() => copyToClipboard(result.groupCode, 'code')}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-white/70 hover:text-white transition-all text-sm"
                    >
                      {codeCopied ? <HiCheck className="text-green-400" /> : <HiClipboardCopy />}
                      {codeCopied ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                </div>

                {/* Shareable Link */}
                <div className="bg-white/5 rounded-xl p-5 mb-5">
                  <p className="text-white/40 text-xs font-medium uppercase tracking-wider mb-3">Shareable Link</p>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 flex-1 min-w-0 bg-white/5 px-4 py-2.5 rounded-lg">
                      <HiLink className="text-brand-400 flex-shrink-0" />
                      <span className="text-white/60 text-sm truncate">{result.accessUrl}</span>
                    </div>
                    <button
                      onClick={() => copyToClipboard(result.accessUrl, 'link')}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-white/10 hover:bg-white/15 text-white/70 hover:text-white transition-all text-sm flex-shrink-0"
                    >
                      {linkCopied ? <HiCheck className="text-green-400" /> : <HiClipboardCopy />}
                      {linkCopied ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                </div>

                {/* QR Code */}
                <div className="bg-white/5 rounded-xl p-5 text-center">
                  <p className="text-white/40 text-xs font-medium uppercase tracking-wider mb-4">QR Code</p>
                  <div className="inline-block p-4 bg-white rounded-xl">
                    <QRCodeSVG value={result.accessUrl} size={180} />
                  </div>
                  <p className="text-white/30 text-xs mt-3">Scan with any camera app</p>
                </div>

                {/* File count + expiry */}
                <div className="flex items-center justify-between mt-5 pt-5 border-t border-white/5">
                  <p className="text-white/40 text-sm">
                    {result.files.length} file{result.files.length !== 1 ? 's' : ''} uploaded
                  </p>
                  <p className="text-white/30 text-sm">
                    Expires: {new Date(result.expiresAt).toLocaleString()}
                  </p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
