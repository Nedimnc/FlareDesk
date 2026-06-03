const crypto = require('crypto');
const validator = require('validator');

function mailgunConfig() {
  const apiKey = process.env.MAILGUN_API_KEY;
  const domain = process.env.MAILGUN_DOMAIN;
  const from = process.env.MAILGUN_FROM;

  if (!apiKey || !domain || !from) return null;

  return {
    apiKey,
    domain,
    from,
    apiBase: process.env.MAILGUN_API_BASE || 'https://api.mailgun.net/v3',
  };
}

function isEmailDeliveryConfigured() {
  return Boolean(mailgunConfig());
}

function localMessageId(domain = 'local.flaredesk.test') {
  return `<flaredesk-${Date.now()}-${crypto.randomBytes(6).toString('hex')}@${domain}>`;
}

function replySubject(subject) {
  const text = validator.unescape(subject || '').trim() || '(no subject)';
  return /^re:/i.test(text) ? text : `Re: ${text}`;
}

function buildReferences(ticket) {
  const references = [ticket.email_references, ticket.message_id]
    .filter(Boolean)
    .join(' ')
    .trim();
  return references || null;
}

async function sendTicketReply({ ticket, body }) {
  const config = mailgunConfig();
  if (!config) {
    return {
      status: 'logged',
      provider: 'local',
      messageId: localMessageId(),
      detail: 'Email delivery not configured; reply stored locally for demo.',
    };
  }

  const form = new URLSearchParams();
  form.set('from', config.from);
  form.set('to', validator.unescape(ticket.sender));
  form.set('subject', replySubject(ticket.subject));
  form.set('text', validator.unescape(body));

  if (ticket.message_id) form.set('h:In-Reply-To', ticket.message_id);
  const references = buildReferences(ticket);
  if (references) form.set('h:References', references);

  try {
    const response = await fetch(`${config.apiBase}/${config.domain}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`api:${config.apiKey}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form,
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        status: 'failed',
        provider: 'mailgun',
        detail: payload.message || `Mailgun returned HTTP ${response.status}`,
      };
    }

    return {
      status: 'sent',
      provider: 'mailgun',
      messageId: payload.id || localMessageId(config.domain),
      detail: payload.message || 'Reply sent through Mailgun.',
    };
  } catch (err) {
    return {
      status: 'failed',
      provider: 'mailgun',
      detail: err.message || 'Mailgun request failed',
    };
  }
}

module.exports = {
  isEmailDeliveryConfigured,
  sendTicketReply,
};
