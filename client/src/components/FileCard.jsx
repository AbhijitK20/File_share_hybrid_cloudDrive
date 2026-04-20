import { useState } from 'react';
import { motion } from 'framer-motion';
import { HiDownload, HiEye, HiDocument, HiPhotograph, HiFilm, HiDocumentText } from 'react-icons/hi';
import { fetchFileAsBlob } from '../services/api';

const getFileIcon = (mimetype) => {
  if (mimetype?.startsWith('image/')) return <HiPhotograph className="text-pink-400" />;
  if (mimetype?.startsWith('video/')) return <HiFilm className="text-purple-400" />;
  if (mimetype?.includes('pdf')) return <HiDocumentText className="text-red-400" />;
  return <HiDocument className="text-brand-400" />;
};

const formatSize = (bytes) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

export default function FileCard({ file, index = 0, onPreview }) {
  const [downloading, setDownloading] = useState(false);
  const isPreviewable = true;

  const handleDownload = async () => {
    try {
      setDownloading(true);
      const url = await fetchFileAsBlob(file.id, 'download');
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('Error downloading file. It may be private or expired.');
      console.error(err);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.1, duration: 0.4 }}
      className="card flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 group hover:border-white/20 transition-all"
    >
      <div className="flex items-center gap-4 min-w-0 w-full sm:w-auto">
        {/* File icon */}
        <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center text-2xl flex-shrink-0 group-hover:bg-white/10 transition-all duration-300">
          {getFileIcon(file.mimetype)}
        </div>

        {/* File info */}
        <div className="min-w-0">
          <p className="text-white font-medium truncate max-w-[220px] sm:max-w-xs" title={file.name}>
            {file.name}
          </p>
          <p className="text-white/40 text-sm mt-0.5">{formatSize(file.size)}</p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap w-full sm:w-auto sm:justify-end flex-shrink-0">
        {isPreviewable && onPreview && (
          <button
            onClick={() => onPreview(file)}
            className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-white/70 hover:text-white transition-all duration-300 text-sm font-medium"
            title="Preview file"
          >
            <HiEye className="text-lg" />
            <span className="hidden sm:inline">Preview</span>
          </button>
        )}
        
        <button
          onClick={handleDownload}
          disabled={downloading}
          className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-brand-500/10 hover:bg-brand-500/20 text-brand-400 hover:text-brand-300 border border-brand-500/20 hover:border-brand-500/30 transition-all duration-300 text-sm font-medium disabled:opacity-50"
        >
          {downloading ? (
             <div className="w-5 h-5 border-2 border-brand-400/30 border-t-brand-400 rounded-full animate-spin" />
          ) : (
             <HiDownload className="text-lg" />
          )}
          <span className="hidden sm:inline">{downloading ? 'Downloading...' : 'Download'}</span>
        </button>
      </div>
    </motion.div>
  );
}
