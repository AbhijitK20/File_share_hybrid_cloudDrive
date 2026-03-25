import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { verifyEmailCode, resendVerificationCode } from '../services/api';

export default function VerifyEmail() {
  const { user } = useAuth();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const data = await verifyEmailCode({ email: user?.email, code });
      setMessage(data.message || 'Email verified');
    } catch (err) {
      setError(err.response?.data?.message || 'Verification failed');
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    setError('');
    setMessage('');
    try {
      const data = await resendVerificationCode(user?.email);
      setMessage(data.message || 'Code resent');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to resend code');
    }
  };

  return (
    <div className="min-h-screen pt-24 pb-12 px-6 flex items-center justify-center">
      <div className="glass p-8 w-full max-w-md">
        <h1 className="text-2xl font-bold gradient-text mb-2">Verify Email</h1>
        <p className="text-white/50 mb-6">Enter code sent to {user?.email}</p>
        <form onSubmit={submit} className="space-y-4">
          <input className="input-field w-full" value={code} onChange={(e) => setCode(e.target.value)} required placeholder="6-digit code" />
          <button className="btn-primary w-full" disabled={loading}>{loading ? 'Verifying...' : 'Verify'}</button>
        </form>
        <button className="btn-secondary w-full mt-3" onClick={resend}>Resend code</button>
        {message && <p className="mt-4 text-green-400 text-sm">{message}</p>}
        {error && <p className="mt-4 text-red-400 text-sm">{error}</p>}
      </div>
    </div>
  );
}

