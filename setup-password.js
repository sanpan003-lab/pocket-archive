#!/usr/bin/env node
// Emergency password reset for an account (e.g. if the admin is locked out):
//   docker exec -it <container> node setup-password.js <username>
// Sets a new password, clears the lockout and asks for a new password at next sign-in.
const readline = require('readline');
const users = require('./users');

const username = process.argv[2];
if (!username) {
  console.log('Usage: node setup-password.js <username>');
  console.log('Users:', users.listUsers().map(u => u.username).join(', ') || '(none — run scripts/migrate-users.mjs first)');
  process.exit(1);
}
const user = users.findByUsername(username);
if (!user) { console.log(`No user "${username}"`); process.exit(1); }

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question(`New password for ${user.username}: `, (password) => {
  try {
    users.setPassword(user.id, password, { mustChange: true });
    users.patchUser(user.id, { failedLogins: 0, lockCount: 0, lockedUntil: null });
    users.logEvent('password_reset', { userId: user.id, by: 'setup-password.js' });
    console.log('Password saved. You will be asked to choose a new one when you sign in.');
  } catch (err) {
    console.log(err.message);
  }
  rl.close();
});
