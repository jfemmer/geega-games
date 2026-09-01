# Geega Games — Landing (Frontend)

React + TypeScript + Vite. Single-page launch site with an email-list signup
form and a "payment processing in progress" status. Frontend only — the signup
submit is stubbed and ready to point at a backend.

## Run locally
```bash
npm install
npm run dev
```
Open the printed localhost URL.

## Build
```bash
npm run build      # outputs to dist/
npm run preview    # preview the production build
```

## Deploy to Vercel
This is a standard Vite app. In Vercel:
- Framework preset: **Vite**
- Build command: `npm run build`
- Output directory: `dist`
No environment variables needed yet (frontend only).

## Wiring the backend later
The only integration point is `src/SignupForm.tsx`. Find the block marked
`BACKEND STUB` and replace the simulated delay with a real `fetch("/api/subscribe", …)`
call. That `/api/subscribe` Vercel function will write to Supabase and send the
welcome email via Resend. No other file needs to change.
