// Shared password policy — min length, common-password rejection, hash rounds.
// Existing hashes with lower rounds keep verifying; only new hashes use BCRYPT_ROUNDS.

import bcrypt from 'bcrypt';

export const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS) || 12;
export const MIN_PASSWORD_LENGTH = parseInt(process.env.MIN_PASSWORD_LENGTH) || 12;

// Compact built-in list of the most common patterns at 12+ chars.
// zxcvbn would be more robust but adds 800KB of dictionary. For a 12-char
// minimum the raw-list attacks matter less than top-of-mind reuse.
const COMMON_PASSWORDS = new Set([
  '123456789012', '123412341234', 'qwerty123456', 'qwertyuiop12',
  'password1234', 'passwordpass', 'password12345',
  'letmein12345', 'welcome12345', 'welcomehome1',
  'admin1234567', 'administrator',
  'aaaaaaaaaaaa', '000000000000', '111111111111',
  'iloveyou1234', 'trustno1trust',
]);

/**
 * Validate a proposed password. Returns an error message string, or null if OK.
 */
export function validatePassword(password) {
  if (!password || typeof password !== 'string') {
    return 'Password is required';
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return 'Password is too common — pick something less guessable';
  }
  return null;
}

/**
 * Hash a password with the current rounds cost.
 */
export function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}
