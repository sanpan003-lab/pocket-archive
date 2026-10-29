// node --test reminderIntent.test.js — 15 phrasings of "remind me …"
const test = require('node:test');
const assert = require('node:assert');
const { analyze } = require('./reminderIntent');

const MIN = 60000, HOUR = 3600000;
const cases = [
  ['Remind me to call the pharmacy in 5 minutes', { intent: true, rel: 5 * MIN }],
  ['remind me in two minutes to check the oven', { intent: true, rel: 2 * MIN }],
  ['Remind me in an hour to move the car', { intent: true, rel: HOUR }],
  ['remind me in half an hour to stretch', { intent: true, rel: 30 * MIN }],
  ['Remind me in an hour and a half to call Mom', { intent: true, rel: 90 * MIN }],
  ['remind me in 1 hour and 15 minutes to leave', { intent: true, rel: 75 * MIN }],
  ['Remind me in twenty five minutes about the laundry', { intent: true, rel: 25 * MIN }],
  ['Remind me to take my pills at 3 pm', { intent: true, clock: { h: 3, mi: 0, meridiem: 'pm' } }],
  ['remind me at 9:30 am to email Sam', { intent: true, clock: { h: 9, mi: 30, meridiem: 'am' } }],
  ['Remind me tomorrow at 8 to bring the form', { intent: true, clock: { h: 8, mi: 0, meridiem: null }, tomorrow: true }],
  ['Set a reminder for 6:45 pm to start dinner', { intent: true, clock: { h: 6, mi: 45, meridiem: 'pm' } }],
  ['Remind me at noon to eat', { intent: true, clock: { h: 12, mi: 0, meridiem: 'pm' } }],
  ["Don't forget to water the plants at 7 pm", { intent: true, clock: { h: 7, mi: 0, meridiem: 'pm' } }],
  ['Add a reminder in 10 minutes to flip the laundry', { intent: true, rel: 10 * MIN }],
  ['Dentist appointment Tuesday at 3 pm', { intent: false, clock: { h: 3, mi: 0, meridiem: 'pm' } }],
  ['Pick up milk in the morning', { intent: false }],
];

for (const [text, want] of cases) {
  test(text, () => {
    const a = analyze(text);
    assert.strictEqual(a.intent, want.intent);
    assert.strictEqual(a.relativeMs, want.rel ?? null);
    assert.deepStrictEqual(a.clock, want.clock ?? null);
    assert.strictEqual(a.tomorrow, !!want.tomorrow);
  });
}
