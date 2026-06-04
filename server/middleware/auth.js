function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = header.slice(7).trim();
  const expected = process.env.FLAREDESK_API_KEY;

  if (!expected || token !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  req.agent = {
    name: req.headers['x-flaredesk-agent'] || process.env.FLAREDESK_AGENT_NAME || 'Support Agent',
    role: req.headers['x-flaredesk-role'] || process.env.FLAREDESK_AGENT_ROLE || 'admin',
    workspace_id: req.headers['x-flaredesk-workspace'] || process.env.FLAREDESK_WORKSPACE_ID || 'demo',
  };

  next();
}

module.exports = authMiddleware;
