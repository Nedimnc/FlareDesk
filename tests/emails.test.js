process.env.FLAREDESK_DB_PATH = ':memory:';
process.env.FLAREDESK_API_KEY = 'test-api-key';
process.env.NODE_ENV = 'test';

jest.mock('../server/services/analyzer', () => ({
  analyzeEmail: jest.fn().mockResolvedValue({
    tone_label: 'Frustrated',
    distress_score: 7,
    priority: 'HIGH',
    summary: 'Mocked analysis summary.',
    escalation_risk: 'Churn',
  }),
}));

const request = require('supertest');
const app = require('../server/index');
const db = require('../server/services/database');
const { analyzeEmail } = require('../server/services/analyzer');

const AUTH = { Authorization: 'Bearer test-api-key' };

beforeEach(() => {
  db.clearEmails();
  analyzeEmail.mockClear();
});

afterAll(() => {
  db.closeDb();
});

describe('Emails API', () => {
  test('POST /api/emails without auth returns 401', async () => {
    const res = await request(app)
      .post('/api/emails')
      .send({ sender: 'a@b.com', subject: 'Hi', body: 'Body' });
    expect(res.status).toBe(401);
  });

  test('POST /api/emails with auth but missing fields returns 400', async () => {
    const res = await request(app).post('/api/emails').set(AUTH).send({ sender: 'a@b.com' });
    expect(res.status).toBe(400);
  });

  test('POST /api/emails with auth and valid body returns 201 with analyzed email', async () => {
    const res = await request(app)
      .post('/api/emails')
      .set(AUTH)
      .send({
        sender: 'customer@test.com',
        subject: 'Help needed',
        body: 'I need support with my order please.',
      });
    expect(res.status).toBe(201);
    expect(res.body.distress_score).toBe(7);
    expect(res.body.tone_label).toBe('Frustrated');
    expect(analyzeEmail).toHaveBeenCalled();
  });

  test('GET /api/emails returns array', async () => {
    await request(app)
      .post('/api/emails')
      .set(AUTH)
      .send({ sender: 'a@b.com', subject: 'S', body: 'Valid body text here.' });
    const res = await request(app).get('/api/emails').set(AUTH);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
  });

  test('GET /api/emails/:id returns single email', async () => {
    const created = await request(app)
      .post('/api/emails')
      .set(AUTH)
      .send({ sender: 'a@b.com', subject: 'S', body: 'Valid body text here.' });
    const res = await request(app).get(`/api/emails/${created.body.id}`).set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(created.body.id);
  });

  test('PATCH /api/emails/:id updates status', async () => {
    const created = await request(app)
      .post('/api/emails')
      .set(AUTH)
      .send({ sender: 'a@b.com', subject: 'S', body: 'Valid body text here.' });
    const res = await request(app)
      .patch(`/api/emails/${created.body.id}`)
      .set(AUTH)
      .send({ status: 'Resolved' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('Resolved');
  });

  test('DELETE /api/emails/:id removes email', async () => {
    const created = await request(app)
      .post('/api/emails')
      .set(AUTH)
      .send({ sender: 'a@b.com', subject: 'S', body: 'Valid body text here.' });
    const del = await request(app).delete(`/api/emails/${created.body.id}`).set(AUTH);
    expect(del.status).toBe(204);
    const get = await request(app).get(`/api/emails/${created.body.id}`).set(AUTH);
    expect(get.status).toBe(404);
  });

  test('Input with body > 10,000 chars returns 400', async () => {
    const res = await request(app)
      .post('/api/emails')
      .set(AUTH)
      .send({ sender: 'a@b.com', subject: 'S', body: 'x'.repeat(10001) });
    expect(res.status).toBe(400);
    expect(analyzeEmail).not.toHaveBeenCalled();
  });

  test('XSS payload in subject is sanitized in response', async () => {
    const res = await request(app)
      .post('/api/emails')
      .set(AUTH)
      .send({
        sender: 'xss@test.com',
        subject: '<script>alert(1)</script>',
        body: 'Normal body text for testing sanitization.',
      });
    expect(res.status).toBe(201);
    expect(res.body.subject.includes('<script>')).toBe(false);
  });
});
