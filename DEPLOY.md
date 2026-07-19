# Deploying Revenue System to a Contabo VPS

Two containers built from this repo (`api` = Fastify backend, `web` = Next.js
frontend) plus a Postgres 16 container. Database migrations run automatically
every time the API container starts (they are idempotent).

## 1. One-time VPS setup (Ubuntu/Debian)

```bash
# Install Docker + compose plugin
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # log out and back in afterwards

# Open the two app ports (Postgres is NOT exposed publicly)
sudo ufw allow 22/tcp
sudo ufw allow 3000/tcp   # frontend
sudo ufw allow 8080/tcp   # API
sudo ufw enable
```

## 2. Get the code onto the VPS

```bash
git clone <your-repo-url> revenue-system
cd revenue-system
```

## 3. Configure

```bash
cp .env.example .env
nano .env
```

Required edits:

| Variable | Value |
|---|---|
| `POSTGRES_PASSWORD` | any strong password (internal only) |
| `JWT_SECRET` | output of `openssl rand -hex 48` |
| `API_PUBLIC_URL` | `http://<VPS_IP>:8080` |
| `WEB_PUBLIC_URL` | `http://<VPS_IP>:3000` |
| `ALLOWED_ORIGINS` | `http://<VPS_IP>:3000` |

ArcGIS and Paystack keys are optional — the system starts and serves the
seeded Nairobi demo data without them; fill them in when you want to test
those integrations.

> **Note:** `API_PUBLIC_URL` is baked into the frontend bundle at build time.
> If you change it later, rebuild with `docker compose up -d --build web`.

## 4. Build and start

```bash
docker compose up -d --build
```

First build takes a few minutes. Then verify:

```bash
docker compose ps                          # all three services healthy/running
curl http://localhost:8080/health          # {"status":"ok",...}
```

Share with colleagues:
- **App:** `http://<VPS_IP>:3000`
- **API docs (Swagger):** `http://<VPS_IP>:8080/docs`

Demo logins are seeded by `migrations/003_nairobi_dummy_data.sql`.

## 5. Day-to-day operations

```bash
docker compose logs -f api        # tail backend logs
docker compose logs -f web        # tail frontend logs
docker compose restart api        # restart one service
docker compose down               # stop everything (data volumes survive)
docker compose down -v            # stop AND wipe the database — careful

# Deploy an update
git pull && docker compose up -d --build

# Backup / restore the database
docker compose exec db pg_dump -U revenue revenue_db > backup.sql
cat backup.sql | docker compose exec -T db psql -U revenue revenue_db
```

## Persistence

| Volume | Contents |
|---|---|
| `pgdata` | Postgres data |
| `notices` | Generated demand-notice PDFs |

Both survive `docker compose down` and image rebuilds.

## Hardening for later (beyond the testing phase)

- Put nginx/Caddy in front for HTTPS and a real domain, then update the three
  URL variables in `.env` to `https://...` and rebuild.
- Switch Paystack to live keys only after HTTPS is in place.
