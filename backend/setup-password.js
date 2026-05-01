#!/usr/bin/env node
// Run once to set your password:
// node setup-password.js
const readline = require('readline');
const { hashPassword, savePassword } = require('./auth');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.question('Enter your new password: ', (password) => {
  if (password.length < 8) {
    console.log('Password must be at least 8 characters');
    process.exit(1);
  }
  savePassword(hashPassword(password));
  console.log('✅ Password saved successfully!');
  console.log('Restart your server/container for changes to take effect.');
  rl.close();
});
