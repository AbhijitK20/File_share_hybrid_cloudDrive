const nodemailer = require('nodemailer');
const { logger } = require('./logger');

let transporter = null;

function isPlaceholderSecret(value = '') {
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return true;

  return [
    'replace_with',
    'your_app_password',
    'your-app-password',
    'changeme',
    'example',
    'abcdefgh',
  ].some((token) => normalized.includes(token));
}

function createFallbackTransporter(reason) {
  logger.warn(`[MAIL] SMTP unavailable (${reason}). Falling back to local JSON mail transport.`);
  const tx = nodemailer.createTransport({ jsonTransport: true });
  tx.__isFallback = true;
  return tx;
}

function getTransporter() {
  if (transporter) return transporter;

  if (!process.env.SMTP_HOST || !process.env.SMTP_PORT || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    transporter = createFallbackTransporter('missing SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS');
    return transporter;
  }

  if (isPlaceholderSecret(process.env.SMTP_PASS) || isPlaceholderSecret(process.env.SMTP_USER)) {
    transporter = createFallbackTransporter('placeholder SMTP credentials detected');
    return transporter;
  }

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: String(process.env.SMTP_SECURE || 'false') === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  return transporter;
}

async function sendEmail({ to, subject, text, html }) {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const tx = getTransporter();

  try {
    const info = await tx.sendMail({ from, to, subject, text, html });

    if (tx.__isFallback) {
      logger.info(`[MAIL] Email captured locally for ${to}. SMTP disabled or unavailable.`);
    } else {
      logger.info(`[MAIL] Sent email to ${to} with messageId ${info.messageId}`);
    }

    return info;
  } catch (error) {
    // Do not break auth flows when SMTP credentials are invalid at runtime.
    logger.warn(`[MAIL] SMTP send failed (${error.message}). Switching to fallback local transport.`);
    transporter = createFallbackTransporter('runtime SMTP authentication failure');
    const fallbackInfo = await transporter.sendMail({ from, to, subject, text, html });
    logger.info(`[MAIL] Email captured locally for ${to}.`);
    return fallbackInfo;
  }
}

function otpTemplate(title, code, minutes) {
  return {
    text: `${title}\n\nYour verification code is: ${code}\nIt expires in ${minutes} minutes.\n\nIf you did not request this, ignore this email.`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto">
        <h2>${title}</h2>
        <p>Your verification code is:</p>
        <div style="font-size:28px;font-weight:700;letter-spacing:4px;padding:12px 16px;background:#f4f4f5;border-radius:8px;display:inline-block">${code}</div>
        <p style="margin-top:16px">This code expires in <strong>${minutes} minutes</strong>.</p>
        <p>If you did not request this, you can ignore this email.</p>
      </div>
    `,
  };
}

module.exports = {
  sendEmail,
  otpTemplate,
};

