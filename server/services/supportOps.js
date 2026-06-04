const validator = require('validator');

const SLA_POLICIES = {
  CRITICAL: { firstResponseHours: 1, resolutionHours: 4 },
  HIGH: { firstResponseHours: 4, resolutionHours: 24 },
  MEDIUM: { firstResponseHours: 8, resolutionHours: 48 },
  LOW: { firstResponseHours: 24, resolutionHours: 120 },
};

const QUEUES = [
  {
    id: 'Escalations',
    label: 'Escalations',
    description: 'Legal, chargeback, social, churn, and high-distress issues.',
    defaultAssignee: 'Senior Agent',
  },
  {
    id: 'Billing',
    label: 'Billing',
    description: 'Refunds, duplicate charges, invoices, and plan questions.',
    defaultAssignee: 'Billing Specialist',
  },
  {
    id: 'Technical',
    label: 'Technical',
    description: 'API, webhook, integration, uptime, and platform incidents.',
    defaultAssignee: 'Technical Support',
  },
  {
    id: 'Success',
    label: 'Success',
    description: 'Onboarding, retention, renewal, and workflow coaching.',
    defaultAssignee: 'Customer Success',
  },
  {
    id: 'General',
    label: 'General',
    description: 'Lower-risk questions and general support triage.',
    defaultAssignee: 'Support Agent',
  },
];

const MACROS = [
  {
    id: 'refund-review',
    title: 'Refund / billing review',
    queue: 'Billing',
    body: 'Thanks for flagging this. I am reviewing the billing records now and will confirm the valid charge, refund path, and corrected documentation in the next update.',
  },
  {
    id: 'critical-escalation',
    title: 'Critical escalation ownership',
    queue: 'Escalations',
    body: 'I understand how urgent this is. I am taking ownership of this ticket, escalating it to a senior specialist, and will keep you updated with concrete next steps.',
  },
  {
    id: 'technical-investigation',
    title: 'Technical investigation',
    queue: 'Technical',
    body: 'We are checking logs and recent changes for the affected workflow. I will share the suspected cause, mitigation, and ETA as soon as we have a verified update.',
  },
  {
    id: 'retention-call',
    title: 'Retention / success call',
    queue: 'Success',
    body: 'I would like to set up a short call with our success lead so we can understand what is not working and agree on a recovery plan before renewal decisions are made.',
  },
  {
    id: 'friendly-followup',
    title: 'Friendly follow-up',
    queue: 'General',
    body: 'Thanks for reaching out. I can help with this and will make sure you have a clear next step before we close the loop.',
  },
];

const KB_ARTICLES = [
  {
    id: 'kb-billing-duplicates',
    title: 'Resolving duplicate billing and refund requests',
    tags: ['billing', 'refund', 'chargeback', 'invoice'],
    summary: 'Steps for verifying duplicate charges, issuing credits, and preventing chargebacks.',
  },
  {
    id: 'kb-incident-response',
    title: 'Handling outage or webhook incidents',
    tags: ['webhook', 'api', '500', 'outage', 'sla'],
    summary: 'Checklist for incident triage, logs, customer updates, and SLA language.',
  },
  {
    id: 'kb-social-escalation',
    title: 'Social media escalation playbook',
    tags: ['twitter', 'social', 'followers', 'public'],
    summary: 'Guidance for influencer complaints and public-response coordination.',
  },
  {
    id: 'kb-onboarding',
    title: 'Customer onboarding walkthrough',
    tags: ['onboarding', 'dashboard', 'gmail', 'setup'],
    summary: 'Quick-start steps for new customers connecting inboxes and reading distress scores.',
  },
  {
    id: 'kb-retention',
    title: 'Retention call prep',
    tags: ['cancel', 'renewal', 'churn', 'enterprise'],
    summary: 'Questions and concessions to prepare before a retention conversation.',
  },
];

function addHours(date, hours) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function calculateSlaDeadlines(priority, receivedAt = new Date()) {
  const policy = SLA_POLICIES[priority] || SLA_POLICIES.MEDIUM;
  const received = receivedAt instanceof Date ? receivedAt : new Date(receivedAt);
  return {
    first_response_due_at: addHours(received, policy.firstResponseHours).toISOString(),
    resolution_due_at: addHours(received, policy.resolutionHours).toISOString(),
  };
}

function computeSlaStatus(ticket, now = new Date()) {
  if (!ticket) return 'on_track';
  const resolvedAt = ticket.resolved_at || ticket.closed_at;
  const resolutionDue = ticket.resolution_due_at ? new Date(ticket.resolution_due_at) : null;
  const firstDue = ticket.first_response_due_at ? new Date(ticket.first_response_due_at) : null;

  if (['Resolved', 'Closed'].includes(ticket.status)) {
    if (resolvedAt && resolutionDue && new Date(resolvedAt) > resolutionDue) return 'breached';
    return 'met';
  }

  if (!ticket.first_response_at && firstDue && now > firstDue) return 'breached';
  if (resolutionDue && now > resolutionDue) return 'breached';

  const twoHours = 2 * 60 * 60 * 1000;
  const nextDeadline = !ticket.first_response_at && firstDue ? firstDue : resolutionDue;
  if (nextDeadline && nextDeadline.getTime() - now.getTime() <= twoHours) return 'due_soon';
  return 'on_track';
}

function classifyQueue({ subject = '', body = '', priority, escalation_risk }) {
  const text = `${subject} ${body} ${escalation_risk || ''}`.toLowerCase();
  if (priority === 'CRITICAL' || /legal|attorney|chargeback|social|twitter|cancel|churn/.test(text)) {
    return 'Escalations';
  }
  if (/billing|refund|invoice|charge|pricing|payment|credit/.test(text)) return 'Billing';
  if (/api|webhook|500|error|outage|sync|integration|connector|uptime/.test(text)) return 'Technical';
  if (/onboarding|dashboard|setup|renewal|call|walkthrough|training/.test(text)) return 'Success';
  return 'General';
}

function queueById(id) {
  return QUEUES.find((queue) => queue.id === id) || QUEUES.find((queue) => queue.id === 'General');
}

function suggestedAssignee(queueId, priority) {
  if (priority === 'CRITICAL') return 'Senior Agent';
  return queueById(queueId).defaultAssignee;
}

function getMacro(id) {
  return MACROS.find((macro) => macro.id === id) || null;
}

function suggestKbArticles(ticket) {
  const text = `${ticket.subject || ''} ${ticket.body || ''} ${ticket.escalation_risk || ''}`.toLowerCase();
  return KB_ARTICLES.map((article) => ({
    ...article,
    score: article.tags.reduce((count, tag) => count + (text.includes(tag) ? 1 : 0), 0),
  }))
    .filter((article) => article.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(({ score, ...article }) => article);
}

function buildReplyDraft(ticket, responses = [], macroId) {
  const macro = macroId ? getMacro(macroId) : null;
  const base = macro ? macro.body : draftFromTicket(ticket);
  const latestCustomerReply = [...responses]
    .reverse()
    .find((response) => response.author_type === 'customer');
  const context = latestCustomerReply
    ? ` I also saw your latest reply and will address that in the next update.`
    : '';

  return {
    body: `${validator.unescape(base)}${context}`,
    macro_id: macro ? macro.id : null,
    tone: ticket.priority === 'CRITICAL' ? 'urgent and accountable' : 'calm and helpful',
    knowledge_base: suggestKbArticles(ticket),
  };
}

function draftFromTicket(ticket) {
  const queue = ticket.queue || classifyQueue(ticket);
  if (ticket.priority === 'CRITICAL') {
    return 'I understand this is urgent and I am taking ownership now. I am escalating this to the right specialist and will follow up with a concrete update before the SLA deadline.';
  }
  if (queue === 'Billing') return getMacro('refund-review').body;
  if (queue === 'Technical') return getMacro('technical-investigation').body;
  if (queue === 'Success') return getMacro('retention-call').body;
  return getMacro('friendly-followup').body;
}

module.exports = {
  SLA_POLICIES,
  QUEUES,
  MACROS,
  KB_ARTICLES,
  calculateSlaDeadlines,
  computeSlaStatus,
  classifyQueue,
  suggestedAssignee,
  buildReplyDraft,
  getMacro,
  suggestKbArticles,
};
