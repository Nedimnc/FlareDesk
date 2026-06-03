process.env.FLAREDESK_DB_PATH = ':memory:';
process.env.FLAREDESK_API_KEY = 'test-api-key';
process.env.NODE_ENV = 'test';

jest.mock('../server/services/analyzer', () => ({
  analyzeEmail: jest.fn().mockResolvedValue({
    tone_label: 'Frustrated',
    distress_score: 8,
    priority: 'HIGH',
    summary: 'Webhook analysis summary.',
    escalation_risk: 'Churn',
  }),
}));

const request = require('supertest');
const app = require('../server/index');
const db = require('../server/services/database');
const { analyzeEmail } = require('../server/services/analyzer');

beforeEach(() => {
  db.clearEmails();
  analyzeEmail.mockClear();
  delete process.env.WEBHOOK_SECRET;
  delete process.env.MAILGUN_WEBHOOK_SIGNING_KEY;
});

afterAll(() => db.closeDb());

describe('Inbound email webhook', () => {
  test('POST /api/webhooks/inbound-email creates ticket with message headers', async () => {
    const res = await request(app)
      .post('/api/webhooks/inbound-email')
      .send({
        sender: 'customer@test.com',
        subject: 'Billing problem',
        body: 'I have been charged twice and need help.',
        message_id: '<first@test>',
      });

    expect(res.status).toBe(201);
    expect(res.body.ticket.channel).toBe('email');
    expect(res.body.ticket.message_id).toBe('<first@test>');
    expect(analyzeEmail).toHaveBeenCalledTimes(1);
  });

  test('duplicate Message-ID returns existing ticket without re-analysis', async () => {
    await request(app)
      .post('/api/webhooks/inbound-email')
      .send({
        sender: 'customer@test.com',
        subject: 'Billing problem',
        body: 'I have been charged twice and need help.',
        message_id: '<duplicate@test>',
      });
    analyzeEmail.mockClear();

    const duplicate = await request(app)
      .post('/api/webhooks/inbound-email')
      .send({
        sender: 'customer@test.com',
        subject: 'Billing problem',
        body: 'Duplicate webhook delivery.',
        message_id: '<duplicate@test>',
      });

    expect(duplicate.status).toBe(200);
    expect(duplicate.body.duplicate).toBe(true);
    expect(analyzeEmail).not.toHaveBeenCalled();
  });

  test('Mailgun form reply appends to existing ticket thread', async () => {
    const created = await request(app)
      .post('/api/webhooks/inbound-email')
      .send({
        sender: 'customer@test.com',
        subject: 'Outage',
        body: 'The app is down for us.',
        message_id: '<root@test>',
      });

    const reply = await request(app)
      .post('/api/webhooks/inbound-email')
      .type('form')
      .send({
        from: 'Customer <customer@test.com>',
        subject: 'Re: Outage',
        'stripped-text': 'Any update on the outage?',
        'message-id': '<reply@test>',
        'in-reply-to': '<root@test>',
        references: '<root@test>',
      });

    expect(reply.status).toBe(200);
    expect(reply.body.ticket.id).toBe(created.body.ticket.id);
    expect(reply.body.response.author_type).toBe('customer');
    expect(reply.body.response.delivery_status).toBe('received');

    const thread = db.getTicketThread(created.body.ticket.id);
    expect(thread.responses).toHaveLength(1);
    expect(thread.responses[0].provider_message_id).toBe('<reply@test>');
  });

  test('WEBHOOK_SECRET rejects unsigned requests when configured', async () => {
    process.env.WEBHOOK_SECRET = 'secret';
    const res = await request(app)
      .post('/api/webhooks/inbound-email')
      .send({
        sender: 'customer@test.com',
        subject: 'Billing problem',
        body: 'Please help.',
      });

    expect(res.status).toBe(401);
  });
});
