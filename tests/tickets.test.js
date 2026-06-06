process.env.FLAREDESK_DB_PATH = ':memory:';
process.env.FLAREDESK_API_KEY = 'test-api-key';
process.env.NODE_ENV = 'test';

jest.mock('../server/services/analyzer', () => ({
  analyzeEmail: jest.fn().mockResolvedValue({
    tone_label: 'Neutral',
    distress_score: 3,
    priority: 'LOW',
    summary: 'Test',
    escalation_risk: 'None',
  }),
}));

const request = require('supertest');
const app = require('../server/index');
const db = require('../server/services/database');

const AUTH = { Authorization: 'Bearer test-api-key' };

beforeEach(() => db.clearEmails());
afterAll(() => db.closeDb());

describe('Ticket threads and responses', () => {
  test('GET /api/emails/:id/thread returns ticket with responses and events', async () => {
    const created = await request(app)
      .post('/api/emails')
      .set(AUTH)
      .send({ sender: 'c@test.com', subject: 'Help', body: 'Need help with billing issue today.' });
    const res = await request(app).get(`/api/emails/${created.body.id}/thread`).set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.ticket.ticket_number).toMatch(/^FD-/);
    expect(Array.isArray(res.body.events)).toBe(true);
    expect(res.body.events.length).toBeGreaterThan(0);
  });

  test('POST /api/emails/:id/responses adds agent reply', async () => {
    const created = await request(app)
      .post('/api/emails')
      .set(AUTH)
      .send({ sender: 'c@test.com', subject: 'Help', body: 'Need help with billing issue today.' });
    const res = await request(app)
      .post(`/api/emails/${created.body.id}/responses`)
      .set(AUTH)
      .send({ body: 'We are reviewing your account now.', is_internal: false });
    expect(res.status).toBe(201);
    expect(res.body.response.body).toBeTruthy();
    expect(res.body.response.delivery_status).toBe('logged');
    expect(res.body.delivery.provider).toBe('local');
    expect(res.body.ticket.response_count).toBe(1);
  });

  test('POST response on closed ticket returns 400', async () => {
    const created = await request(app)
      .post('/api/emails')
      .set(AUTH)
      .send({ sender: 'c@test.com', subject: 'Help', body: 'Need help with billing issue today.' });
    await request(app)
      .patch(`/api/emails/${created.body.id}`)
      .set(AUTH)
      .send({ status: 'Closed' });
    const res = await request(app)
      .post(`/api/emails/${created.body.id}/responses`)
      .set(AUTH)
      .send({ body: 'Too late' });
    expect(res.status).toBe(400);
  });

  test('private messages are ticket-scoped and readable by recipient', async () => {
    const created = await request(app)
      .post('/api/emails')
      .set(AUTH)
      .send({ sender: 'c@test.com', subject: 'Help', body: 'Need help with billing issue today.' });

    const message = await request(app)
      .post(`/api/emails/${created.body.id}/private-messages`)
      .set({ ...AUTH, 'x-flaredesk-agent': 'Sarah Chen' })
      .send({
        recipient: 'Marcus Webb',
        body: 'Can you review this escalation before I reply?',
      });

    expect(message.status).toBe(201);
    expect(message.body.sender).toBe('Sarah Chen');
    expect(message.body.recipient).toBe('Marcus Webb');

    const list = await request(app)
      .get(`/api/emails/${created.body.id}/private-messages`)
      .set({ ...AUTH, 'x-flaredesk-agent': 'Marcus Webb' });
    expect(list.status).toBe(200);
    expect(list.body.messages).toHaveLength(1);
    expect(list.body.unread_count).toBe(1);

    const read = await request(app)
      .post(`/api/emails/${created.body.id}/private-messages/read`)
      .set({ ...AUTH, 'x-flaredesk-agent': 'Marcus Webb' })
      .send({});
    expect(read.status).toBe(200);
    expect(read.body.updated).toBe(1);

    const thread = await request(app).get(`/api/emails/${created.body.id}/thread`).set(AUTH);
    expect(thread.body.private_messages).toHaveLength(1);
  });

  test('team members endpoint exposes private chat recipients', async () => {
    const res = await request(app).get('/api/team-members').set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.some((member) => member.name === 'Marcus Webb')).toBe(true);
  });
});
