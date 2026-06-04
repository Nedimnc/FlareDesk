process.env.FLAREDESK_DB_PATH = ':memory:';
process.env.FLAREDESK_API_KEY = 'test-api-key';
process.env.NODE_ENV = 'test';

jest.mock('../server/services/analyzer', () => ({
  analyzeEmail: jest.fn().mockImplementation(({ subject }) => {
    const critical = /refund|chargeback|attorney/i.test(subject);
    return Promise.resolve({
      tone_label: critical ? 'Furious' : 'Neutral',
      distress_score: critical ? 10 : 4,
      priority: critical ? 'CRITICAL' : 'MEDIUM',
      summary: `Summary for ${subject}`,
      escalation_risk: critical ? 'Chargeback' : 'None',
    });
  }),
}));

const request = require('supertest');
const app = require('../server/index');
const db = require('../server/services/database');

const AUTH = { Authorization: 'Bearer test-api-key' };

beforeEach(() => db.clearEmails());
afterAll(() => db.closeDb());

describe('support operations features', () => {
  test('critical ticket gets SLA deadlines, escalation queue, and critical alert event', async () => {
    const created = await request(app)
      .post('/api/emails')
      .set(AUTH)
      .send({
        sender: 'risk@test.com',
        subject: 'refund chargeback threat',
        body: 'I want a refund now or I am filing a chargeback.',
      });

    expect(created.status).toBe(201);
    expect(created.body.priority).toBe('CRITICAL');
    expect(created.body.queue).toBe('Escalations');
    expect(created.body.assigned_to).toBe('Senior Agent');
    expect(created.body.first_response_due_at).toBeTruthy();
    expect(created.body.resolution_due_at).toBeTruthy();
    expect(created.body.critical_alert_sent_at).toBeTruthy();

    const events = await request(app).get(`/api/emails/${created.body.id}/events`).set(AUTH);
    expect(events.body.some((event) => event.event_type === 'critical_alert')).toBe(true);
  });

  test('reply draft can apply a macro and returns knowledge suggestions', async () => {
    const created = await request(app)
      .post('/api/emails')
      .set(AUTH)
      .send({
        sender: 'billing@test.com',
        subject: 'Duplicate billing charge',
        body: 'We were charged twice and need a refund.',
      });

    const draft = await request(app)
      .get(`/api/emails/${created.body.id}/reply-draft?macro_id=refund-review`)
      .set(AUTH);

    expect(draft.status).toBe(200);
    expect(draft.body.macro_id).toBe('refund-review');
    expect(draft.body.body).toMatch(/billing records/i);
    expect(draft.body.knowledge_base.length).toBeGreaterThan(0);
  });

  test('queues and reports endpoints expose operational metrics', async () => {
    await request(app)
      .post('/api/emails')
      .set(AUTH)
      .send({ sender: 'api@test.com', subject: 'Webhook 500 error', body: 'Our webhook returns 500.' });

    const queues = await request(app).get('/api/queues').set(AUTH);
    const report = await request(app).get('/api/reports/overview').set(AUTH);

    expect(queues.status).toBe(200);
    expect(queues.body.some((queue) => queue.id === 'Technical')).toBe(true);
    expect(report.status).toBe(200);
    expect(report.body.queue_breakdown.Technical).toBe(1);
  });

  test('resolved tickets create and accept CSAT surveys', async () => {
    const created = await request(app)
      .post('/api/emails')
      .set(AUTH)
      .send({ sender: 'csat@test.com', subject: 'Question', body: 'Need a quick answer.' });

    await request(app)
      .patch(`/api/emails/${created.body.id}`)
      .set(AUTH)
      .send({ status: 'Resolved' });

    const csat = await request(app)
      .post(`/api/emails/${created.body.id}/csat`)
      .set(AUTH)
      .send({ rating: 5, comment: 'Great support.' });

    expect(csat.status).toBe(201);
    expect(csat.body.rating).toBe(5);

    const dashboard = await request(app).get('/api/dashboard').set(AUTH);
    expect(dashboard.body.avg_csat).toBe(5);
    expect(dashboard.body.csat_responses).toBe(1);
  });
});
