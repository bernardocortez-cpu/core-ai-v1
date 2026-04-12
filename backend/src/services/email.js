const sgMail = require("@sendgrid/mail");

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const SENDGRID_FROM =
  process.env.SENDGRID_FROM || "Core AI <no-reply@getcoreai.io>";

let sendgridReady = false;

function initSendgrid() {
  if (!SENDGRID_API_KEY) {
    throw new Error("Missing env SENDGRID_API_KEY");
  }
  if (!sendgridReady) {
    sgMail.setApiKey(SENDGRID_API_KEY);
    sendgridReady = true;
  }
}

async function sendEmail({ to, subject, html, text, attachments, replyTo }) {
  initSendgrid();

  try {
    return await sgMail.send({
      to,
      from: SENDGRID_FROM,
      subject,
      html,
      text,
      attachments,
      ...(replyTo ? { replyTo } : {}),
    });
  } catch (error) {
    const details = error?.response?.body || error;
    console.error("[SENDGRID] send error:", details);
    const err = new Error("EMAIL_SEND_FAILED");
    err.details = details;
    throw err;
  }
}

module.exports = { sendEmail };
