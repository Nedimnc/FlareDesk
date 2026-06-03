const {
  parseClaudeResponse,
  validateBodyForAnalysis,
  analyzeEmail,
  MAX_BODY_LENGTH,
} = require('../server/services/analyzer');

describe('analyzer', () => {
  test('valid Claude response is parsed correctly', () => {
    const json = JSON.stringify({
      tone_label: 'Furious',
      distress_score: 9,
      priority: 'CRITICAL',
      summary: 'Customer is very angry.',
      escalation_risk: 'Chargeback',
    });
    const result = parseClaudeResponse(json);
    expect(result.tone_label).toBe('Furious');
    expect(result.distress_score).toBe(9);
    expect(result.priority).toBe('CRITICAL');
    expect(result.escalation_risk).toBe('Chargeback');
  });

  test('malformed Claude response falls back to default', () => {
    const result = parseClaudeResponse('not json at all');
    expect(result.distress_score).toBe(5);
    expect(result.tone_label).toBe('Neutral');
  });

  test('empty email body is rejected before calling Claude', async () => {
    const validation = validateBodyForAnalysis('   ');
    expect(validation.valid).toBe(false);
    await expect(analyzeEmail({ subject: 'S', body: '   ' })).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  test('overly long body is rejected', () => {
    const validation = validateBodyForAnalysis('a'.repeat(MAX_BODY_LENGTH + 1));
    expect(validation.valid).toBe(false);
  });
});
