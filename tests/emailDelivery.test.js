const { sendTicketReply } = require('../server/services/emailDelivery');

const originalFetch = global.fetch;

const baseTicket = {
  sender: 'customer@test.com',
  subject: 'Need help',
  message_id: '<root@test>',
  email_references: null,
};

afterEach(() => {
  delete process.env.MAILGUN_API_KEY;
  delete process.env.MAILGUN_DOMAIN;
  delete process.env.MAILGUN_FROM;
  delete process.env.MAILGUN_API_BASE;
  global.fetch = originalFetch;
});

describe('emailDelivery', () => {
  test('logs locally when Mailgun is not configured', async () => {
    const result = await sendTicketReply({ ticket: baseTicket, body: 'We are on it.' });

    expect(result.status).toBe('logged');
    expect(result.provider).toBe('local');
    expect(result.messageId).toMatch(/^<flaredesk-/);
  });

  test('sends Mailgun request when configured', async () => {
    process.env.MAILGUN_API_KEY = 'key-test';
    process.env.MAILGUN_DOMAIN = 'mg.test.com';
    process.env.MAILGUN_FROM = 'Support <support@test.com>';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: '<mailgun@test>', message: 'Queued. Thank you.' }),
    });

    const result = await sendTicketReply({ ticket: baseTicket, body: 'We are on it.' });

    expect(result.status).toBe('sent');
    expect(result.provider).toBe('mailgun');
    expect(result.messageId).toBe('<mailgun@test>');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.mailgun.net/v3/mg.test.com/messages',
      expect.objectContaining({ method: 'POST' })
    );
  });
});
