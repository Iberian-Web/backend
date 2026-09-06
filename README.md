# Guía de despliegue a producción — Service Manager

Esta guía asume que ya tienes funcionando en local:

- Backend (`service-manager-backend`) con `pnpm dev`.
- Frontend (`service-manager-frontend`) con `pnpm dev` / `npm run dev`.

Y que vas a desplegar:

- **Backend** → un VPS con Ubuntu, usando Docker.
- **Frontend** → Cloudflare Pages.

---

## 1. `.env` del backend — qué cambiar

Este es el `.env` que usas en local (desarrollo):

```dotenv
DB_PASSWORD=dbpassword123

DATABASE_URL="postgresql://postgres:dbpassword123@localhost:5432/mydb?schema=public"

PORT=3001
NODE_ENV=production

ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123

ALLOWED_ORIGINS=http://localhost:5173
```

Para producción, **sustituye** por esto (en el `.env` que crees directamente
en el VPS, nunca lo subas a git):

```dotenv
DB_PASSWORD=una-contraseña-larga-y-aleatoria-solo-para-produccion

# Dentro de docker-compose el host es "postgres" (el nombre del servicio),
# no "localhost" — localhost solo vale cuando corres el backend fuera de Docker.
DATABASE_URL="postgresql://postgres:una-contraseña-larga-y-aleatoria-solo-para-produccion@postgres:5432/mydb?schema=public"

PORT=3001
NODE_ENV=production

ADMIN_USERNAME=admin
ADMIN_PASSWORD=otra-contraseña-fuerte-distinta-de-la-de-pruebas

# Dominios REALES de Cloudflare Pages, con https://, separados por coma,
# sin espacios y sin barra final:
ALLOWED_ORIGINS=https://admin.tudominio.com,https://portal.tudominio.com
```

Qué cambia y por qué:

| Campo                                      | Local                   | Producción                                 | Motivo                                                                                                |
| ------------------------------------------ | ----------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `DB_PASSWORD` / password en `DATABASE_URL` | cualquiera              | contraseña fuerte y única                  | credencial real, expuesta a internet                                                                  |
| host en `DATABASE_URL`                     | `localhost`             | `postgres`                                 | dentro de Docker Compose el backend habla con Postgres por el nombre del servicio, no por `localhost` |
| `ADMIN_PASSWORD`                           | `admin123`              | contraseña fuerte                          | es el login real del panel                                                                            |
| `ALLOWED_ORIGINS`                          | `http://localhost:5173` | dominios `https://...` de Cloudflare Pages | si no coincide exacto, el login falla con "No permitido por CORS"                                     |

---

## 2. `docker-compose.yml` — qué cambiar

En local (o si dejaste el puerto de Postgres abierto para hacer `pnpm dev`
fuera de Docker), tenías esto:

```yaml
postgres:
  image: postgres:18
  container_name: postgres
  restart: unless-stopped
  environment:
    POSTGRES_USER: postgres
    POSTGRES_PASSWORD: ${DB_PASSWORD}
    POSTGRES_DB: mydb
  ports:
    - "5432:5432" # ← esto permite conectar desde tu Windows local
  volumes:
    - postgres_data:/var/lib/postgresql
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U postgres -d mydb"]
    interval: 5s
    timeout: 5s
    retries: 5
```

En el VPS de producción, **quita el bloque `ports` de Postgres** (nadie fuera
del servidor necesita hablarle directamente a la base de datos; el backend
ya está en la misma red interna de Docker):

```yaml
postgres:
  image: postgres:18
  container_name: postgres
  restart: unless-stopped
  environment:
    POSTGRES_USER: postgres
    POSTGRES_PASSWORD: ${DB_PASSWORD}
    POSTGRES_DB: mydb
  volumes:
    - postgres_data:/var/lib/postgresql
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U postgres -d mydb"]
    interval: 5s
    timeout: 5s
    retries: 5
```

El servicio `backend` no necesita cambios: sigue publicando el puerto `3001`,
pero solo lo alcanzará el reverse proxy que instalamos en el siguiente paso
(o localhost del propio VPS).

---

## 3. Preparar el VPS Ubuntu

Conéctate por SSH y ejecuta:

```bash
sudo apt update && sudo apt upgrade -y

# Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# cierra sesión y vuelve a entrar para que el grupo docker surta efecto

# Firewall: solo abre lo necesario
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

Con esto, los puertos `3001` (backend) y `5432` (Postgres) quedan **cerrados
al exterior** — solo accesibles dentro del propio servidor/Docker.

---

## 4. Subir el proyecto y arrancarlo

```bash
git clone <tu-repo-del-backend> service-manager-backend
cd service-manager-backend
cp .env.example .env
nano .env   # rellena los valores de producción del paso 2

docker compose up -d --build
```

Comprueba que arrancó bien:

```bash
docker compose ps
docker compose logs -f backend
```

---

## 5. HTTPS con reverse proxy (Caddy)

Las cookies de sesión usan `Secure`, así que el backend **debe** servirse por
HTTPS. La forma más simple es Caddy (gestiona el certificado solo).

```bash
sudo apt install -y caddy
```

Edita `/etc/caddy/Caddyfile`:

```
api.tudominio.com {
    reverse_proxy localhost:3001
}
```

```bash
sudo systemctl restart caddy
```

Requisito previo: el DNS de `api.tudominio.com` debe apuntar a la IP de este
VPS (registro A) antes de reiniciar Caddy, o no podrá emitir el certificado.

Verifica: `https://api.tudominio.com/` debe responder
`{"message":"CRM API running"}` con candado válido.

---

## 6. Frontend en Cloudflare Pages

Para **cada** frontend (`service-manager-frontend` y `Customer-Portal`):

1. Sube la carpeta como repositorio Git (GitHub/GitLab).
2. En Cloudflare Pages → crear proyecto → conectar ese repo.
3. Build command: `npm run build` (o `pnpm build`).
4. Output directory: `dist`.
5. En **Settings → Environment variables**, añade:
   ```
   VITE_API_URL = https://api.tudominio.com
   ```
   (la URL de tu backend del paso 6, sin barra final).
6. Despliega.

Cuando Cloudflare te dé el dominio final de cada proyecto (el tuyo propio o
el `*.pages.dev`), **vuelve al `.env` del backend** y actualiza
`ALLOWED_ORIGINS` con esos dominios exactos:

```dotenv
ALLOWED_ORIGINS=https://admin.tudominio.com,https://portal.tudominio.com
```

```bash
docker compose restart backend
```

---

## 7. Despliegue automático y CI con GitHub Actions

Con lo anterior, cada cambio requiere entrar por SSH al VPS y ejecutar `git pull` + `docker compose up -d --build` a mano. Esto lo automatiza: **haces `git push` y el propio servidor se actualiza solo**, sin que tengas que tocar nada más. De paso, se añaden dos comprobaciones automáticas (auditoría de dependencias y estilo de código) que corren en cada push, sin depender del VPS.

Los frontends ya tienen el despliegue automático gratis: Cloudflare Pages redespliega solo en cuanto detecta un commit nuevo en el repo conectado. Lo de SSH (7.1-7.4) es específicamente para el **backend**, que no trae nada parecido integrado — `audit.yml` y `prettier.yml` (7.5-7.6) sí aplican a los tres repos por igual.

### 7.1 Generar una clave SSH dedicada para el despliegue

En el propio VPS:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/deploy_key -N ""
cat ~/.ssh/deploy_key.pub >> ~/.ssh/authorized_keys
cat ~/.ssh/deploy_key
```

El último comando imprime la clave **privada** — copia toda la salida (incluidas las líneas `-----BEGIN...-----` y `-----END...-----`), la necesitas en el siguiente paso. Usar una clave dedicada (en vez de la tuya personal) significa que puedes revocarla más adelante sin perder tu propio acceso SSH.

### 7.2 Guardar 3 secrets en GitHub

En el repo del backend → **Settings → Secrets and variables → Actions → New repository secret**:

| Nombre del secret | Valor                                             |
| ----------------- | ------------------------------------------------- |
| `SSH_HOST`        | IP (o dominio) de tu VPS                          |
| `SSH_USERNAME`    | El usuario de Linux con el que te conectas al VPS |
| `SSH_PRIVATE_KEY` | La clave privada impresa en el paso 7.1           |

### 7.3 Crear el workflow

Archivo `.github/workflows/deploy.yml` en el repo del backend:

```yaml
name: Deploy backend

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: SSH and deploy
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.SSH_HOST }}
          username: ${{ secrets.SSH_USERNAME }}
          key: ${{ secrets.SSH_PRIVATE_KEY }}
          script: |
            cd ~/service-manager-backend
            git pull
            docker compose up -d --build backend
```

Ajusta `cd ~/service-manager-backend` si en tu VPS el repo está en otra ruta.

Qué hace cada parte: al hacer push a `main`, GitHub abre una conexión SSH al VPS usando los 3 secrets y ejecuta ese `script` tal cual lo escribirías tú a mano — trae el código nuevo (`git pull`) y reconstruye **solo** el contenedor `backend` (`postgres` no se toca, no hace falta reiniciar la base de datos por un cambio de código).

### 7.4 Probarlo

```bash
git push origin main
```

Ve a la pestaña **Actions** del repo en GitHub — un check verde significa que el VPS ya hizo `pull` y reconstruyó el contenedor solo, sin que tú tocaras el servidor.

Como el `CMD` del `Dockerfile` ya ejecuta `prisma migrate deploy` al arrancar, cualquier migración pendiente se aplica sola como parte de este mismo despliegue — tampoco hace falta un paso manual aparte para eso.

> ⚠️ Esto le da acceso de despliegue al VPS a cualquiera que pueda hacer push a `main` (o mergear en ella). Si el repo lo tocáis varias personas, vale la pena configurar reglas de protección de rama en GitHub.

### 7.5 Auditoría de seguridad automática (`audit.yml`)

Además del despliegue, conviene tener comprobaciones automáticas que corran en cada push — sin depender del VPS. `.github/workflows/audit.yml`:

```yaml
name: Security Audit

on:
  push:
  pull_request:
    branches: ["main"]

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 24

      - name: Install pnpm
        uses: pnpm/action-setup@v3
        with:
          version: 12

      - name: Run Security Audit
        # Ejecuta pnpm audit. Si en el futuro quieres que solo revise paquetes de producción,
        # puedes cambiarlo a: pnpm audit --prod
        run: pnpm audit
```

Corre en **cada push** (a cualquier rama) y en cada pull request contra `main` — revisa las dependencias del proyecto en busca de vulnerabilidades conocidas. Este workflow no bloquea el despliegue de `deploy.yml` (son independientes); es una alerta temprana, no un requisito para desplegar.

### 7.6 Estilo de código automático (`prettier.yml`)

`.github/workflows/prettier.yml`:

```yaml
name: Code Style (Prettier)

on:
  push:
  pull_request:
    branches: ["main"]

jobs:
  prettier:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 24

      - name: Install pnpm
        uses: pnpm/action-setup@v3
        with:
          version: 11

      - name: Install Dependencies
        run: pnpm install --frozen-lockfile

      - name: Check Code Style
        run: pnpm run format:check
```

Falla si algún archivo no está formateado con Prettier (`pnpm run format:check`, el mismo script que corres en local) — útil para detectar en un pull request que alguien olvidó formatear antes de hacer commit.

### 7.7 Dónde van estos archivos

Los tres workflows (`deploy.yml`, `audit.yml`, `prettier.yml`) viven en la carpeta `.github/workflows/` **de cada repo**, no en uno compartido — al estar completamente separados (backend, `service-manager-frontend`, Customer-Portal), cada repositorio necesita su propia copia. `deploy.yml` solo tiene sentido en el repo del backend (es el único que se despliega por SSH a un VPS); `audit.yml` y `prettier.yml` puedes copiarlos tal cual a los tres repos, ajustando únicamente el script `format:check` de cada `package.json` si aún no lo tienes (ya lo añadimos al backend y al frontend anteriormente).

---

## 8. Checklist final

- [ ] `.env` de producción con contraseñas fuertes y `NODE_ENV=production`.
- [ ] `DATABASE_URL` usa `postgres` como host (no `localhost`).
- [ ] Puerto `5432` de Postgres **no** publicado en `docker-compose.yml`.
- [ ] `ufw` solo permite `22`, `80`, `443`.
- [ ] `https://api.tudominio.com` responde con candado válido.
- [ ] `VITE_API_URL` configurado en cada proyecto de Cloudflare Pages.
- [ ] `ALLOWED_ORIGINS` en el backend coincide EXACTO (protocolo + dominio,
      sin barra final) con los dominios finales de Pages.
- [ ] Login probado desde el dominio real de Pages (no `localhost`).
- [ ] Los 3 secrets (`SSH_HOST`, `SSH_USERNAME`, `SSH_PRIVATE_KEY`) creados en GitHub y `deploy.yml` probado con un push real.

---

## 9. Problemas típicos

| Síntoma                                                                  | Causa más probable                                                                                                                                                                      |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "No permitido por CORS"                                                  | `ALLOWED_ORIGINS` no coincide exacto con el dominio del frontend (falta `https://`, sobra `/`, o falta el dominio)                                                                      |
| Login dice "credenciales inválidas" siempre                              | El `.env` no se recargó (reinicia el contenedor: `docker compose restart backend`) o hay un contenedor viejo respondiendo en el puerto 3001                                             |
| La cookie no se guarda / login "funciona" pero luego pide login otra vez | El backend no está sirviéndose por HTTPS, o `NODE_ENV` no es `production` (las cookies necesitan `Secure` + `SameSite=None` en cross-domain)                                            |
| `P1000: Authentication failed` al arrancar                               | La contraseña del `.env` no coincide con la que ya tiene el volumen de Postgres creado. Solución: `docker compose down -v` (borra el volumen) y `docker compose up -d --build` de nuevo |
