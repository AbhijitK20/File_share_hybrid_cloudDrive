const crypto = require('crypto');

function isPrivacyMinimized() {
  return String(process.env.PRIVACY_MINIMIZE_LOGS || 'false').toLowerCase() === 'true';
}

function maskEmail(email) {
  const value = String(email || '').trim().toLowerCase();
  if (!value) return null;

  const [localPart, domainPart] = value.split('@');
  if (!domainPart) return null;

  const visible = localPart.slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(localPart.length - 2, 1))}@${domainPart}`;
}

function anonymizeIp(ipAddress) {
  const value = String(ipAddress || '').trim();
  if (!value) return null;

  const salt = String(process.env.JWT_SECRET || 'privacy-salt');
  const digest = crypto
    .createHash('sha256')
    .update(`${salt}:${value}`)
    .digest('hex')
    .slice(0, 16);

  return `hash:${digest}`;
}

function toPrivacySafeActivityIdentity({ email, ipAddress }) {
  if (!isPrivacyMinimized()) {
    return {
      actorEmail: email || null,
      ipAddress: ipAddress || null,
    };
  }

  return {
    actorEmail: maskEmail(email),
    ipAddress: anonymizeIp(ipAddress),
  };
}

module.exports = {
  isPrivacyMinimized,
  maskEmail,
  anonymizeIp,
  toPrivacySafeActivityIdentity,
};
