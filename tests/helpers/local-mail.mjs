import assert from 'node:assert/strict';

const inbox = 'http://127.0.0.1:54325';
/** Only a synthetic recipient in the loopback inbox; never reads or forwards real mail. */
export async function waitForLocalOtp(email, { after = Date.now() - 1000, timeoutMs = 20000 } = {}) {
  assert.ok(typeof email === 'string' && /^[a-z0-9.+_-]+@example\.test$/i.test(email), 'OTP helper accepts synthetic example.test recipients only');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(`${inbox}/api/v1/messages?limit=100`, { signal: AbortSignal.timeout(3000) });
    assert.equal(response.status, 200, 'Local inbox API unavailable');
    const listing = await response.json();
    const candidates = (listing.messages ?? []).filter(message =>
      (message.To ?? []).some(recipient => recipient.Address?.toLowerCase() === email.toLowerCase()) && Date.parse(message.Created) >= after - 1000,
    ).sort((a, b) => Date.parse(b.Created) - Date.parse(a.Created));
    for (const candidate of candidates) {
      const messageResponse = await fetch(`${inbox}/api/v1/message/${encodeURIComponent(candidate.ID)}`, { signal: AbortSignal.timeout(3000) });
      assert.equal(messageResponse.status, 200, 'Local inbox message unavailable');
      const message = await messageResponse.json();
      const text = `${message.Text ?? ''}\n${message.HTML ?? ''}`;
      const code = text.match(/(?:^|\D)(\d{6})(?!\d)/)?.[1];
      if (code) return code;
    }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw new Error('Timed out waiting for a matching synthetic OTP in the local inbox; no message content logged.');
}
