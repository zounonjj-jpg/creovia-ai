# CREOVIA AI

A Next.js creative SaaS workspace connected to Supabase and Higgsfield API.

## Features
- Supabase email authentication and per-user project/job data.
- Higgsfield Seedance 2.5 text-to-video and image-to-video server routes.
- Asynchronous job status refresh.
- Server-only Higgsfield credentials.

## Environment
Copy .env.example to .env.local and set the Supabase URL, Supabase anon key, and Higgsfield API credentials. Never commit secrets.

Higgsfield API credentials are created at https://open.higgsfield.ai/api-keys. The API has separate pay-as-you-go billing from the Higgsfield creator subscription. Generation costs depend on model, duration, resolution and options.

## Development
npm install && npm run dev
