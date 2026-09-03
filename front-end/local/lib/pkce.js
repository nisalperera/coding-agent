'use client';

function base64Url(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function generateRandomToken() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64Url(array);
}

export async function generateCodeChallenge(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(digest);
}
