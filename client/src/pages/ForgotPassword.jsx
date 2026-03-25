import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { HiMail, HiLockClosed, HiKey, HiArrowRight } from 'react-icons/hi';
import { requestPasswordReset, resetPasswordWithCode } from '../services/api';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const sendCode = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);
    try {
      const data = await requestPasswordReset(email);
      setMessage(data.message || 'Reset code sent.');
      setStep(2);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to send reset code');
    } finally {
      setLoading(false);
    }
  };

  const submitReset = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);
    try {
      const data = await resetPasswordWithCode({ email, code, newPassword });
      setMessage(data.message || 'Password reset successful');
      setStep(3);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to reset password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen pt-24 pb-12 px-6 flex items-center justify-center">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md glass p-8">
        <h1 className="text-2xl font-bold gradient-text mb-2">Forgot Password</h1>
        <p className="text-white/50 mb-6">Receive an OTP on email and reset your password.</p>

        {step === 1 && (
          <form onSubmit={sendCode} className="space-y-4">
            <label className="text-white/50 text-sm block">Email</label>
            <div className="relative">
              <HiMail className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
              <input className="input-field w-full pl-10" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <button className="btn-primary w-full flex justify-center items-center gap-2" disabled={loading}>
              {loading ? 'Sending...' : <>Send Code <HiArrowRight /></>}
            </button>
          </form>
        )}

        {step === 2 && (
          <form onSubmit={submitReset} className="space-y-4">
            <label className="text-white/50 text-sm block">Verification Code</label>
            <div className="relative">
              <HiKey className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
              <input className="input-field w-full pl-10" value={code} onChange={(e) => setCode(e.target.value)} required />
            </div>
            <label className="text-white/50 text-sm block">New Password</label>
            <div className="relative">
              <HiLockClosed className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
              <input className="input-field w-full pl-10" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={6} />
            </div>
            <button className="btn-primary w-full" disabled={loading}>{loading ? 'Resetting...' : 'Reset Password'}</button>
          </form>
        )}

        {step === 3 && (
          <div className="text-green-400 text-sm">
            Password updated. <Link to="/login" className="text-brand-400">Go to login</Link>
          </div>
        )}

        {message && <p className="mt-4 text-green-400 text-sm">{message}</p>}
        {error && <p className="mt-4 text-red-400 text-sm">{error}</p>}
      </motion.div>
    </div>
  );
}

