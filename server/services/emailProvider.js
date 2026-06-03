const crypto = require('crypto');

const HEADER_LIMIT = 1000;

function firstString(...values) {
  for (const value of values) {
    if (Array.isArray(value)) {
      const found = firstString(...value);
      if (found) return found;
      continue;
    }
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function normalizeHeader(value) {
  const raw = firstString(value);
  if (!raw) return null;
  return raw.length > HEADER_LIMIT ? raw.slice(0, HEADER_LIMIT) : raw;
}

function normalizeSender(value) {
  const raw = firstString(value);
  const match = raw.match(/<([^>]+)>/);
  return match ? match[1].trim() : raw;
}

function parseInboundPayload(body = {}) {
  const sender = normalizeSender(firstString(body.sender, body.from, body.From, body['reply-to']));
  const subject = firstString(body.subject, body.Subject) || '(no subject)';
  const emailBody = firstString(
    body.body,
    body['stripped-text'],
    body['body-plain'],
    body['text-plain'],
    body.text,
    body.TextBody
  );

  return {
    sender,
    subject,
    body: emailBody,
    message_id: normalizeHeader(
      body.message_id || body['message-id'] || body['Message-Id'] || body['Message-ID']
    ),
    in_reply_to: normalizeHeader(
      body.in_reply_to || body['in-reply-to'] || body['In-Reply-To']
    ),
    email_references: normalizeHeader(
      body.references || body.References || body['email-references']
    ),
    provider: firstString(body.provider) || 'mailgun',
  };
}

function timingSafeEqual(a, b) {
  const left = Buffer.from(a || '', 'utf8');
  const right = Buffer.from(b || '', 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function verifySharedSecret(req) {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) return true;
  return timingSafeEqual(req.headers['x-flaredesk-webhook-secret'], secret);
}

function verifyMailgunSignature(body = {}) {
  const signingKey = process.env.MAILGUN_WEBHOOK_SIGNING_KEY;
  if (!signingKey) return true;

  const signatureBody = typeof body.signature === 'object' && body.signature ? body.signature : {};
  const timestamp = firstString(signatureBody.timestamp, body.timestamp);
  const token = firstString(signatureBody.token, body.token);
  const signature = firstString(signatureBody.signature, body.signature);

  if (!timestamp || !token || !signature) return false;

  const expected = crypto
    .createHmac('sha256', signingKey)
    .update(`${timestamp}${token}`)
    .digest('hex');

  return timingSafeEqual(signature, expected);
}

function verifyInboundRequest(req) {
  return verifySharedSecret(req) && verifyMailgunSignature(req.body || {});
}

module.exports = {
  parseInboundPayload,
  verifyInboundRequest,
};
