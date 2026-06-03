require('dotenv').config();
const db = require('./services/database');

const SEED_EMAILS = [
  {
    sender: 'angry.customer@gmail.com',
    subject: 'I WANT MY MONEY BACK NOW',
    body: `I am absolutely furious. I paid $299 for your premium plan three weeks ago and received NOTHING that was promised in your marketing. I have called twice and was put on hold for over an hour each time. This is theft. I want a full refund processed within 24 hours or I am filing a chargeback with American Express and reporting you to the BBB. I have screenshots of every broken promise on your website. Do not send me another canned response.`,
    tone_label: 'Furious',
    distress_score: 10,
    priority: 'CRITICAL',
    escalation_risk: 'Chargeback',
    summary: 'Customer demands immediate refund after unfulfilled premium plan promises and poor phone support.',
  },
  {
    sender: 'legal.threat@corp.com',
    subject: 'You will be hearing from my attorney',
    body: `This letter serves as formal notice that your platform has caused measurable financial harm to our organization. Your SLA guarantees 99.9% uptime; we experienced a 14-hour outage last Tuesday that cost us an estimated $47,000 in lost transactions. Our legal counsel is preparing a demand letter. Cease all automated billing immediately. Any further charges will be considered fraudulent. Respond only to our counsel at the address on file.`,
    tone_label: 'Furious',
    distress_score: 9,
    priority: 'CRITICAL',
    escalation_risk: 'Legal',
    summary: 'Corporate customer cites SLA breach and threatens legal action over prolonged outage damages.',
  },
  {
    sender: 'twitter.complaint@gmail.com',
    subject: "I'm posting about this to my 50k followers",
    body: `Wow. Just wow. I've been patient for two weeks but your support team ghosted me after my last ticket. I run a tech review channel with 52,000 followers on Twitter/X and I was planning a positive feature on FlareDesk — not anymore. I'm drafting a thread right now with screen recordings of every failure. Fix my account by end of day or this goes public. Tagging your CEO.`,
    tone_label: 'Furious',
    distress_score: 9,
    priority: 'CRITICAL',
    escalation_risk: 'Social Media',
    summary: 'Influencer threatens public social media campaign after being ignored by support.',
  },
  {
    sender: 'frustrated.buyer@yahoo.com',
    subject: 'Third time contacting you - still no resolution',
    body: `This is my THIRD email about the same issue. Ticket #88421 was closed without resolution. Ticket #89102 was assigned to someone who never replied. I upgraded specifically for priority support and this is worse than free tiers I've used. My integration still throws 500 errors on every webhook. I need a senior engineer on this today, not another "we're looking into it" auto-reply.`,
    tone_label: 'Frustrated',
    distress_score: 7,
    priority: 'HIGH',
    escalation_risk: 'Churn',
    summary: 'Repeat contact with unresolved webhook errors and closed tickets without fixes.',
  },
  {
    sender: 'worried.user@gmail.com',
    subject: 'Please help, I really need this for my business',
    body: `Hi team — I'm honestly quite anxious about this. Our small bakery relies on your order sync for weekend markets and it stopped working yesterday morning. I have 200 pre-orders at risk. I've tried reinstalling the connector but I'm not technical. Could someone please call me? I really don't want to let customers down. Any ETA would help me sleep tonight.`,
    tone_label: 'Anxious',
    distress_score: 6,
    priority: 'HIGH',
    escalation_risk: 'Churn',
    summary: 'Small business owner anxious about broken order sync before a high-volume weekend.',
  },
  {
    sender: 'billing.issue@company.com',
    subject: 'Charged twice this month',
    body: `Our accounts payable flagged duplicate charges on invoice #INV-2024-1187 and #INV-2024-1194 — both for $99 on the same card within 48 hours. Please confirm which is valid and issue a credit memo for the duplicate. We need corrected documentation before our month-end close on Friday.`,
    tone_label: 'Frustrated',
    distress_score: 6,
    priority: 'MEDIUM',
    escalation_risk: 'Chargeback',
    summary: 'Duplicate billing charges need credit and corrected invoices before month-end.',
  },
  {
    sender: 'confused.user@gmail.com',
    subject: 'Not sure how to use the dashboard',
    body: `I just signed up yesterday and I'm a bit lost. Where do I connect my Gmail inbox? I clicked around the settings but couldn't find it. Also, what does "distress score" mean exactly? A quick walkthrough link or 5-minute call would be amazing. Sorry if this is a silly question.`,
    tone_label: 'Anxious',
    distress_score: 4,
    priority: 'MEDIUM',
    escalation_risk: 'None',
    summary: 'New user needs onboarding help connecting Gmail and understanding distress scores.',
  },
  {
    sender: 'mild.complaint@gmail.com',
    subject: 'Feature I need seems to be missing',
    body: `Hi — overall the product is fine but I was surprised that bulk assign isn't available on our plan. The pricing page implied it was included in Team tier. Can you clarify if this is on the roadmap? It's slowing our morning triage routine. Not angry, just trying to plan our workflow.`,
    tone_label: 'Frustrated',
    distress_score: 4,
    priority: 'MEDIUM',
    escalation_risk: 'None',
    summary: 'Customer asks about missing bulk-assign feature expected on Team plan.',
  },
  {
    sender: 'general.question@gmail.com',
    subject: 'Quick question about pricing tiers',
    body: `Hello! We're a 6-person support team evaluating FlareDesk against two competitors. Does the $99/month plan include SSO and audit logs, or is that Enterprise only? Also curious about annual billing discount. Thanks!`,
    tone_label: 'Neutral',
    distress_score: 2,
    priority: 'LOW',
    escalation_risk: 'None',
    summary: 'Prospect asking about SSO, audit logs, and annual pricing for a 6-person team.',
  },
  {
    sender: 'happy.customer@gmail.com',
    subject: 'Just wanted to say your team is amazing',
    body: `I had to write in because Sarah on your team saved our launch last week. She stayed late to help us configure escalation rules and our response times dropped 40%. We're renewing for another year. Tell her thank you from the whole DevRel crew at Lumen Labs!`,
    tone_label: 'Satisfied',
    distress_score: 1,
    priority: 'LOW',
    escalation_risk: 'None',
    summary: 'Positive feedback praising agent Sarah and reporting improved response times.',
  },
  {
    sender: 'new.user@startup.io',
    subject: 'Onboarding question about API limits',
    body: `Hey — we're integrating the REST API into our internal tooling. Docs mention 1000 req/hour on Team plan; is that per workspace or per API key? Also, do webhooks retry on 5xx? Just want to architect this correctly before we go live next sprint.`,
    tone_label: 'Neutral',
    distress_score: 3,
    priority: 'LOW',
    escalation_risk: 'None',
    summary: 'Technical onboarding questions about API rate limits and webhook retries.',
  },
  {
    sender: 'cancellation@enterprise.com',
    subject: 'We need to discuss canceling our enterprise plan',
    body: `Our VP of Customer Experience asked me to reach out. After the last two quarters of inconsistent analysis accuracy and slow roadmap delivery, we're evaluating alternatives. Before we make a final decision, we'd like a call with your customer success lead to discuss retention options and data export. Contract renewal is in 30 days.`,
    tone_label: 'Frustrated',
    distress_score: 8,
    priority: 'HIGH',
    escalation_risk: 'Churn',
    summary: 'Enterprise account considering cancellation due to accuracy and roadmap concerns.',
  },
];

function seed() {
  db.clearEmails();
  const now = new Date().toISOString();
  for (const email of SEED_EMAILS) {
    db.insertEmail({
      sender: email.sender,
      subject: email.subject,
      body: email.body,
      tone_label: email.tone_label,
      distress_score: email.distress_score,
      priority: email.priority,
      summary: email.summary,
      escalation_risk: email.escalation_risk,
      assigned_to: 'Unassigned',
      status: 'Open',
      received_at: now,
      analyzed_at: now,
    });
  }
  const count = db.getDb().prepare('SELECT COUNT(*) as c FROM emails').get().c;
  console.log(`✓ Seeded ${count} emails into FlareDesk database.`);
  db.closeDb();
}

seed();
