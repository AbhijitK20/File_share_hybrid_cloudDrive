import { Link, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { HiCloudUpload, HiDownload, HiViewGrid, HiLogin, HiLogout, HiStar } from 'react-icons/hi';
import { useAuth } from '../context/AuthContext';
import { useState } from 'react';

export default function Navbar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [showDropdown, setShowDropdown] = useState(false);

  const navLinks = [
    { path: '/', label: 'Upload', icon: <HiCloudUpload className="text-lg" /> },
    { path: '/access', label: 'Access Files', icon: <HiDownload className="text-lg" /> },
    { path: '/pricing', label: 'Pricing', icon: <HiStar className="text-lg" /> },
  ];

  if (user) {
    navLinks.push({
      path: '/dashboard',
      label: 'Dashboard',
      icon: <HiViewGrid className="text-lg" />,
    });
  }

  const handleLogout = () => {
    logout();
    setShowDropdown(false);
    navigate('/');
  };

  return (
    <motion.nav
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5 }}
      className="fixed top-0 left-0 right-0 z-50 glass border-t-0 border-x-0 rounded-none"
    >
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-3 group">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500 to-purple-500 flex items-center justify-center shadow-glow group-hover:shadow-glow-lg transition-all duration-300">
            <span className="text-white font-bold text-lg">F</span>
          </div>
          <span className="text-xl font-bold gradient-text">FileShare</span>
        </Link>

        {/* Nav Links + Auth */}
        <div className="flex items-center gap-2">
          {navLinks.map((link) => {
            const isActive = location.pathname === link.path;
            return (
              <Link
                key={link.path}
                to={link.path}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-300 ${
                  isActive
                    ? 'bg-brand-500/20 text-brand-300 border border-brand-500/30'
                    : 'text-white/60 hover:text-white hover:bg-white/5'
                }`}
              >
                {link.icon}
                <span className="hidden sm:inline">{link.label}</span>
              </Link>
            );
          })}

          {/* Auth section */}
          {user ? (
            <div className="relative ml-2">
              <button
                onClick={() => setShowDropdown(!showDropdown)}
                className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition-all duration-300"
              >
                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-brand-500 to-purple-500 flex items-center justify-center">
                  <span className="text-white text-xs font-bold">{user.name[0].toUpperCase()}</span>
                </div>
                <span className="text-white/70 text-sm hidden sm:inline">{user.name}</span>
              </button>

              <AnimatePresence>
                {showDropdown && (
                  <motion.div
                    initial={{ opacity: 0, y: 5, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 5, scale: 0.95 }}
                    className="absolute right-0 mt-2 w-48 glass p-2"
                  >
                    <div className="px-3 py-2 border-b border-white/5 mb-1">
                      <p className="text-white text-sm font-medium">{user.name}</p>
                      <p className="text-white/30 text-xs truncate">{user.email}</p>
                    </div>
                    <button
                      onClick={handleLogout}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                    >
                      <HiLogout />
                      Sign Out
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ) : (
            <Link
              to="/login"
              className="flex items-center gap-2 ml-2 px-4 py-2 rounded-xl bg-brand-500/10 hover:bg-brand-500/20 text-brand-400 border border-brand-500/20 text-sm font-medium transition-all duration-300"
            >
              <HiLogin className="text-lg" />
              <span className="hidden sm:inline">Sign In</span>
            </Link>
          )}
        </div>
      </div>
    </motion.nav>
  );
}
