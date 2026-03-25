const nodemailer = require('nodemailer');
const { logger } = require('./logger');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  if (!process.env.SMTP_HOST || !process.env.SMTP_PORT || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    throw new Error('SMTP is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS');
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
  const info = await tx.sendMail({ from, to, subject, text, html });
  logger.info(`[MAIL] Sent email to ${to} with messageId ${info.messageId}`);
  return info;
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

