const validator = require('validator');

const LIMITS = {
  sender: 255,
  subject: 500,
  body: 10000,
};

function stripHtml(value) {
  return value.replace(/<[^>]*>/g, '');
}

function sanitizeRaw(value, maxLength, fieldName) {
  if (value == null || typeof value !== 'string') {
    return { error: `${fieldName} is required` };
  }
  const stripped = stripHtml(value).trim();
  if (!stripped) {
    return { error: `${fieldName} cannot be empty` };
  }
  if (stripped.length > maxLength) {
    return { error: `${fieldName} must be at most ${maxLength} characters` };
  }
  return { value: stripped };
}

function sanitizeString(value, maxLength, fieldName) {
  const raw = sanitizeRaw(value, maxLength, fieldName);
  if (raw.error) return raw;
  return { value: validator.escape(raw.value) };
}

function sanitizeEmailInput({ sender, subject, body }) {
  const errors = [];
  const result = {};

  const senderRaw = sanitizeRaw(sender, LIMITS.sender, 'sender');
  if (senderRaw.error) errors.push(senderRaw.error);
  else result.sender = validator.escape(senderRaw.value);

  const subjectRaw = sanitizeRaw(subject, LIMITS.subject, 'subject');
  if (subjectRaw.error) errors.push(subjectRaw.error);
  else result.subject = validator.escape(subjectRaw.value);

  const bodyRaw = sanitizeRaw(body, LIMITS.body, 'body');
  if (bodyRaw.error) errors.push(bodyRaw.error);
  else result.body = validator.escape(bodyRaw.value);

  if (errors.length) {
    return { valid: false, errors };
  }
  return {
    valid: true,
    data: result,
    analysisBody: bodyRaw.value,
  };
}

function sanitizePatchInput({ status, assigned_to }) {
  const result = {};
  const allowedStatus = new Set(['Open', 'In Progress', 'Waiting on Customer', 'Resolved', 'Closed']);

  if (status !== undefined) {
    if (typeof status !== 'string' || !allowedStatus.has(status.trim())) {
      return { valid: false, error: 'Invalid status value' };
    }
    result.status = status.trim();
  }

  if (assigned_to !== undefined) {
    const assignedResult = sanitizeString(assigned_to, LIMITS.sender, 'assigned_to');
    if (assignedResult.error) {
      return { valid: false, error: assignedResult.error };
    }
    result.assigned_to = assignedResult.value;
  }

  if (!Object.keys(result).length) {
    return { valid: false, error: 'No valid fields to update' };
  }

  return { valid: true, data: result };
}

function sanitizeResponseInput({ body, is_internal }) {
  if (body == null || typeof body !== 'string') {
    return { valid: false, error: 'Response body is required' };
  }
  const stripped = stripHtml(body).trim();
  if (!stripped) {
    return { valid: false, error: 'Response body cannot be empty' };
  }
  if (stripped.length > 10000) {
    return { valid: false, error: 'Response body must be at most 10000 characters' };
  }
  return {
    valid: true,
    data: {
      body: validator.escape(stripped),
      is_internal: Boolean(is_internal),
    },
  };
}

module.exports = {
  sanitizeEmailInput,
  sanitizePatchInput,
  stripHtml,
  LIMITS,
  sanitizeResponseInput,
};
