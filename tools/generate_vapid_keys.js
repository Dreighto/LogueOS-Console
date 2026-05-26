#!/usr/bin/env node
// One-shot VAPID key generator for Web Push (PR 6).
// Run once: node tools/generate_vapid_keys.js
// Then add the printed values to LogueOS-Orchestrator/.env.
//
// The private key never leaves the server. The public key is safe to expose
// to clients — it's the public half of the ECDH key pair.

import webpush from 'web-push';

const keys = webpush.generateVAPIDKeys();

console.log('\n=== VAPID Key Pair ===\n');
console.log('Add these to LogueOS-Orchestrator/.env (or the Console .env):\n');
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log('\nThe VAPID subject is hard-coded to mailto:dreighto@gmail.com in config.ts.');
console.log('Do NOT store VAPID_PRIVATE_KEY in version control.\n');
