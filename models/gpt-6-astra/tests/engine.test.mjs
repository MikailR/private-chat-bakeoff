import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate, reply, summarize } from '../app/engine.js';
const ask = content => reply([{ role: 'user', content }]);

test('offline starter produces a real calculation with precedence and percentages', () => {
  assert.match(ask('What is 180 * 0.15 + 24?'), /180 \* 0\.15 \+ 24 = 51/);
  assert.equal(calculate('(120 + 45) / 3'), '55');
  assert.equal(calculate('2^3^2'), '512');
  assert.equal(calculate('-2^2'), '-4');
  assert.equal(calculate('2^-2'), '0.25');
  assert.equal(calculate('200*15%'), '30');
  assert.match(ask('What is 15% of 200?'), /= 30/);
});
test('calculator rejects code, invalid syntax, nonfinite results, and zero division', () => {
  for (const expression of ['globalThis.fetch("https://example.com")', '2**3', '(1+2', '2 3', '1/0', '10^999', '1..2']) {
    assert.throws(() => calculate(expression), undefined, expression);
  }
});
test('summary selects actual supplied sentences without adding facts', () => {
  const note = 'The workshop is on Friday. We expect twenty participants. Bring a laptop. The next workshop will be in June.';
  const summary = summarize(note, 2);
  const bullets = summary.split('\n').filter(l => l.startsWith('• ')).map(l => l.slice(2));
  assert.equal(bullets.length, 2);
  for (const sentence of bullets) assert.ok(note.includes(sentence));
  assert.match(ask('Summarize: ' + note), /extractive summary/);
  assert.match(ask('Summarize:'), /Paste the note/);
});
test('planning uses the user tasks and unsupported questions stay honest', () => {
  const plan = ask('Plan: finish my proposal, clear my inbox, and take a walk.');
  assert.match(plan, /1\. Finish my proposal/);
  assert.match(plan, /2\. Clear my inbox/);
  assert.match(plan, /3\. Take a walk/);
  assert.match(ask('Explain the history of the Byzantine Empire'), /beyond my small offline toolkit/);
  assert.match(ask('How does privacy work?'), /local storage/);
});
test('follow-up draws from the supplied local conversation only', () => {
  const conversation = [
    { role: 'user', content: 'My name is Alex.' },
    { role: 'assistant', content: 'Nice to meet you, Alex.' },
    { role: 'user', content: 'What is my name?' }
  ];
  assert.match(reply(conversation), /name is Alex/);
  assert.match(ask('What is my name?'), /haven’t told me/);
  assert.match(reply([{role:'assistant', content: 'First note. Second note. Third note.'}, {role:'user', content:'Make it shorter'}]), /First note/);
});
