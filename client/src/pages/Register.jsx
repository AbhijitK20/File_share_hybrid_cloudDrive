import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { HiUser, HiMail, HiLockClosed, HiArrowRight } from 'react-icons/hi';
import { useAuth } from '../context/AuthContext';
import GoogleSignInButton from '../components/GoogleSignInButton';
import api from '../services/api';

export default function Register() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { register, loginWithGoogle } = useAuth();
  const navigate = useNavigate();
  const fallbackGoogleClientId = String(import.meta.env.VITE_GOOGLE_CLIENT_ID || '').trim();
  const [googleClientId, setGoogleClientId] = useState('');

  useEffect(() => {
    let mounted = true;
    api
      .get('/auth/google/config')
      .then((res) => {
        if (!mounted) return;
        const dynamicClientId = String(res.data?.clientId || '').trim();
        if (res.data?.enabled && dynamicClientId) {
          setGoogleClientId(dynamicClientId);
          return;
        }

        setGoogleClientId(fallbackGoogleClientId);
      })
      .catch(() => {
        if (mounted) {
          setGoogleClientId(fallbackGoogleClientId);
        }
      });

    return () => {
      mounted = false;
    };
  }, [fallbackGoogleClientId]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      return setError('Passwords do not match');
    }

    setLoading(true);

    try {
      await register(name, email, password);
      navigate('/dashboard');
    } catch (err) {
      setError(err.response?.data?.message || 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleRegister = async (googleIdToken) => {
    setError('');
    setLoading(true);

    try {
      await loginWithGoogle(googleIdToken);
      navigate('/dashboard');
    } catch (err) {
      setError(err.response?.data?.message || 'Google sign-in failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen pt-24 pb-12 px-6 flex items-center justify-center">
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md"
      >
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold gradient-text mb-2">Create Account</h1>
          <p className="text-white/50">Sign up for advanced file management</p>
        </div>

        {/* Form Card */}
        <div className="glass p-8">
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Name */}
            <div>
              <label className="text-white/50 text-sm font-medium mb-2 block">Name</label>
              <div className="relative">
                <HiUser className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30" />
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  className="input-field w-full pl-11"
                  required
                  minLength={2}
                />
              </div>
            </div>

            {/* Email */}
            <div>
              <label className="text-white/50 text-sm font-medium mb-2 block">Email</label>
              <div className="relative">
                <HiMail className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="input-field w-full pl-11"
                  required
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="text-white/50 text-sm font-medium mb-2 block">Password</label>
              <div className="relative">
                <HiLockClosed className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="input-field w-full pl-11"
                  required
                  minLength={6}
                />
              </div>
            </div>

            {/* Confirm Password */}
            <div>
              <label className="text-white/50 text-sm font-medium mb-2 block">Confirm Password</label>
              <div className="relative">
                <HiLockClosed className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30" />
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  className="input-field w-full pl-11"
                  required
                  minLength={6}
                />
              </div>
            </div>

            {/* Error */}
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-red-500/10 border border-red-500/20 rounded-xl p-3"
              >
                <p className="text-red-400 text-sm">{error}</p>
              </motion.div>
            )}

            {/* Submit */}
            <motion.button
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
              type="submit"
              disabled={loading}
              className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  Create Account <HiArrowRight />
                </>
              )}
            </motion.button>
          </form>

          {googleClientId && (
            <>
              <div className="my-5 flex items-center gap-3">
                <div className="h-px flex-1 bg-white/10" />
                <span className="text-white/30 text-xs uppercase tracking-wider">or</span>
                <div className="h-px flex-1 bg-white/10" />
              </div>

              <GoogleSignInButton
                clientId={googleClientId}
                onToken={handleGoogleRegister}
                onError={(message) => setError(message)}
                buttonText="signup_with"
              />
            </>
          )}

          {/* Login link */}
          <div className="mt-6 text-center">
            <p className="text-white/40 text-sm">
              Already have an account?{' '}
              <Link to="/login" className="text-brand-400 hover:text-brand-300 font-medium transition-colors">
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
