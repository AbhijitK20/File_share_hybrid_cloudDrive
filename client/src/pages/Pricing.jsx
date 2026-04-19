import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { HiCheck, HiStar, HiLightningBolt } from 'react-icons/hi';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';

export default function Pricing() {
  const { user, upgradePlan } = useAuth();
  const navigate = useNavigate();
  const [upgrading, setUpgrading] = useState(false);

  const handleUpgrade = async () => {
    if (!user) {
      navigate('/login');
      return;
    }
    
    // Prevent double upgrade
    if (user.plan === 'premium') return;

    setUpgrading(true);
    try {
      // 1. Create Order on Backend
      const orderRes = await api.post('/payment/create-order');
      const order = orderRes.data.order;
      const keyId = orderRes.data.keyId || import.meta.env.VITE_RAZORPAY_KEY_ID;

      if (!keyId) {
        throw new Error('Payment key missing. Please contact support.');
      }

      // 2. Initialize Razorpay Checkout
      const options = {
        key: keyId,
        amount: order.amount,
        currency: order.currency,
        name: 'FileShare',
        description: 'Upgrade to Pro Storage',
        order_id: order.id,
        handler: async function (response) {
          try {
            // 3. Verify Payment Signature
            const verifyRes = await api.post('/payment/verify', {
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature
            });

            if (verifyRes.data.success) {
              // 4. Update local user context
              await upgradePlan(); // Wait for state to reflect Premium
              navigate('/dashboard');
            }
          } catch (err) {
            console.error('Payment verification failed:', err);
            alert('Payment verification failed. Please contact support.');
            setUpgrading(false);
          }
        },
        prefill: {
          name: user.name,
          email: user.email,
        },
        theme: {
          color: '#8b5cf6', // brand-500
        },
        modal: {
          ondismiss: function() {
            setUpgrading(false);
          }
        }
      };

      const rzp = new window.Razorpay(options);
      rzp.on('payment.failed', function (response) {
        console.error('Razorpay payment failed:', response?.error || response);
        alert(response?.error?.description || 'Payment failed. Please try another payment method.');
        setUpgrading(false);
      });
      rzp.open();

    } catch (err) {
      console.error('Failed to initiate payment:', err);
      const serverMsg =
        err?.response?.data?.error ||
        err?.response?.data?.message ||
        err?.message ||
        'Failed to initiate payment';
      alert(serverMsg);
      setUpgrading(false);
    }
  };

  const isPremium = user?.plan === 'premium';

  return (
    <div className="min-h-screen pt-32 pb-12 px-6 flex flex-col items-center">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-16 max-w-2xl"
      >
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-500/10 text-brand-400 text-sm font-medium mb-6 border border-brand-500/20">
          <HiStar className="text-lg" />
          <span>Simple, transparent pricing</span>
        </div>
        <h1 className="text-4xl md:text-5xl font-bold text-white mb-4">
          Choose Your <span className="gradient-text">Power Level</span>
        </h1>
        <p className="text-white/50 text-lg">
          Whether you need quick anonymous transfers or secure personal cloud storage, we've got you covered.
        </p>
      </motion.div>

      {/* Pricing Cards */}
      <div className="grid md:grid-cols-2 gap-8 w-full max-w-5xl">
        
        {/* Free Tier */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.1 }}
          className="glass p-8 relative flex flex-col"
        >
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-white mb-2">Basic Transfer</h2>
            <p className="text-white/40 mb-6">Perfect for quick, one-off file sharing.</p>
            <div className="flex items-baseline gap-2">
              <span className="text-5xl font-bold text-white">Free</span>
            </div>
          </div>

          <div className="flex-1 space-y-4 mb-8">
            <FeatureItem text="Up to 100MB per file limits" />
            <FeatureItem text="Unlimited sharing links" />
            <FeatureItem text="24-hour file expiration" />
            <FeatureItem text="Dashboard analytics" />
          </div>

          <button
            onClick={() => !user ? navigate('/login') : navigate('/')}
            disabled={isPremium}
            className={`w-full py-3 px-4 rounded-xl font-medium transition-all ${
              !isPremium 
                ? 'bg-white/10 hover:bg-white/15 text-white' 
                : 'bg-white/5 text-white/30 cursor-not-allowed'
            }`}
          >
            {!user ? 'Sign up for Free' : isPremium ? 'Included' : 'Current Plan'}
          </button>
        </motion.div>

        {/* Pro Tier */}
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.2 }}
          className="glass p-8 relative flex flex-col border-brand-500/30 overflow-hidden"
        >
          {/* Highlight effect */}
          <div className="absolute top-0 right-0 w-32 h-32 bg-brand-500/20 blur-[50px] -mr-16 -mt-16 pointer-events-none" />
          <div className="absolute top-4 right-4 bg-brand-500/10 text-brand-400 text-xs font-bold px-3 py-1 rounded-full border border-brand-500/20">
            MOST POPULAR
          </div>

          <div className="mb-8 relative z-10">
            <h2 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-brand-400 to-purple-400 mb-2">
              Pro Storage
            </h2>
            <p className="text-white/40 mb-6">For professionals who need serious power.</p>
            <div className="flex items-baseline gap-2">
              <span className="text-5xl font-bold text-white">₹150</span>
              <span className="text-white/40">/month</span>
            </div>
          </div>

          <div className="flex-1 space-y-4 mb-8 relative z-10">
            <FeatureItem text="Massive 5GB per file limits" highlight />
            <FeatureItem text="Unlimited storage capacity" highlight />
            <FeatureItem text="Private file visibility controls" />
            <FeatureItem text="Extendable file expiration" />
            <FeatureItem text="In-browser image & PDF previews" />
          </div>

          <button
            onClick={handleUpgrade}
            disabled={upgrading || isPremium}
            className={`w-full py-3 px-4 rounded-xl font-medium flex items-center justify-center gap-2 transition-all relative z-10 ${
              isPremium
                ? 'bg-green-500/20 text-green-400 border border-green-500/30 cursor-not-allowed'
                : 'btn-primary'
            }`}
          >
            {isPremium ? (
              <>
                <HiCheck className="text-xl" /> Active Plan
              </>
            ) : upgrading ? (
              <>
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <HiLightningBolt className="text-xl" /> Upgrade to Pro
              </>
            )}
          </button>
        </motion.div>

      </div>
    </div>
  );
}

function FeatureItem({ text, highlight }) {
  return (
    <div className="flex items-start gap-3">
      <div className={`mt-1 flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center ${highlight ? 'bg-brand-500/20 text-brand-400' : 'bg-white/10 text-white/70'}`}>
        <HiCheck className="text-xs" />
      </div>
      <span className={highlight ? 'text-white' : 'text-white/70'}>{text}</span>
    </div>
  );
}
