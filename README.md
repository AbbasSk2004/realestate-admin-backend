# Admin Panel Backend

Backend service built with Express.js that powers the admin panel application.

## Features

* RESTful API built on Express
* Authentication with JWT
* Supabase as the data store
* Security hardening with Helmet and rate limiting
* Environment-aware configuration (no secrets in code)
* Ready to deploy on [Render](https://render.com)

## Getting Started

### Prerequisites

* Node.js >= 18.x
* npm >= 9.x

### Installation

```bash
npm install
```

### Environment Variables

Copy `env.example` to `.env` and fill in **all** required values.

```bash
cp env.example .env
```

| Variable | Description |
|-----|-----|
| `PORT` | Port the server listens on (optional, defaults to 5000) |
| `NODE_ENV` | `development` \| `production` |
| `ALLOWED_ORIGINS` | Comma-separated list of URLs allowed by CORS |
| `JWT_SECRET` | A long, random string used to sign JWTs |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase Anon public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key (admin privileges) |

### Development

```bash
npm run dev
```

The API will be available at `http://localhost:5000` (or the port you specified).

### Production

```bash
npm start
```

## Deployment on Render

1. Push this repository to GitHub (make sure `.env` is **NOT** committed).
2. Create a new **Web Service** on Render and connect your repo.
3. Set the **Build Command** to `npm install` (Render's default).
4. Set the **Start Command** to `npm start` (already defined in `package.json`).
5. Add all environment variables from your `.env` file in Render's **Environment** tab.
6. Save and deploy.

Render will automatically install dependencies and start the service.

## Security Measures

* **Helmet** – sets secure HTTP headers.
* **Rate Limiting** – mitigates brute-force & DDoS attacks.
* **CORS** – configurable list of allowed origins (`ALLOWED_ORIGINS`).
* **Environment Variables** – secrets never live in source control.
* **Supabase Keys** – only logged in non-production environments.
* **JWT Secret Presence Check** – server exits if `JWT_SECRET` is missing.

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

## License

MIT 