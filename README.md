# Backend Seguro con Express y MongoDB

Esta plantilla proporciona un backend seguro y listo para producción con Express.js y MongoDB.

## 🛠 Características de Seguridad

- ✅ Autenticación JWT
- ✅ Encriptación de contraseñas (bcrypt)
- ✅ Protección contra ataques comunes
- ✅ Rate limiting y DoS protection
- ✅ Cookies seguras
- ✅ CORS configurado
- ✅ Headers de seguridad (Helmet)
- ✅ Sanitización y validación de datos

## 📋 Requisitos Previos

- Node.js (v14 o superior)
- MongoDB instalado y corriendo
- npm o yarn

## 🚀 Instalación

1. Clonar e instalar:
```bash
git clone <tu-repositorio>
cd backend
npm install
```

2. Instalar dependencias de seguridad:
```bash
npm install express-rate-limit express-mongo-sanitize cookie-parser express-validator hpp toobusy-js express-session
```

3. Configurar `.env`:
```env
# Server
PORT=4000
NODE_ENV=production

# Database
MONGODB_URI=mongodb://localhost:27017/tubasededatos
MONGODB_USER=tu_usuario
MONGODB_PASSWORD=tu_password_seguro

# Security
JWT_SECRET=genera_un_token_aleatorio_largo_y_seguro_aqui
JWT_EXPIRES_IN=1d
SESSION_SECRET=otro_token_aleatorio_largo_y_seguro_diferente
COOKIE_SECRET=tercer_token_aleatorio_diferente

# CORS
CORS_ORIGIN=http://localhost:3000,https://tudominio.com

# Rate Limiting
RATE_LIMIT_WINDOW=900000  # 15 minutos en milisegundos
RATE_LIMIT_MAX=100        # máximo de peticiones
MAX_LOGIN_ATTEMPTS=5
LOGIN_TIMEOUT=300         # 5 minutos

# Passwords
PASSWORD_RESET_TOKEN_EXPIRES=3600  # 1 hora
PASSWORD_MIN_LENGTH=8
PASSWORD_SALT_ROUNDS=10

# API
API_VERSION=v1
API_PREFIX=/api

# Logs
LOG_LEVEL=error
LOG_FORMAT=combined
```

## 🏃‍♂️ Inicio

```bash
npm start
```

## 📁 Estructura y Flujo

```
backend/
  ├── src/
  │   ├── config/
  │   │   ├── db.js        # Conexión MongoDB
  │   │   └── cors.js      # Configuración CORS
  │   ├── controllers/
  |   |   └── auth.js
  │   ├── middleware/
  │   │   ├── auth.js      # JWT Middleware
  │   │   └── security.js  # Protecciones
  │   ├── models/
  │   ├── routes/
  │   └── index.js         # Entrada principal
```

### Orden de Middlewares (index.js)

1. Middlewares Básicos
   - CORS
   - Express JSON
   - Cookie Parser

2. Seguridad
   - Helmet (CSP, XSS, etc)
   - Mongo Sanitize
   - HPP
   - Rate Limiter
   - DoS Protection

3. Sesión y Cookies
   - Express Session
   - Headers de Seguridad

4. Rutas API

## 🔒 Detalles de Seguridad

### CORS
```javascript
{
  origin: [process.env.CORS_ORIGIN],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  maxAge: 600
}
```

### Rate Limiting
- 100 peticiones por IP cada 15 minutos

### Cookies
- Secure
- HttpOnly
- SameSite Strict
- 1 hora de expiración

## 📌 Endpoints

- POST `/api/auth/register` - Registro
- POST `/api/auth/login` - Login
- GET `/api/auth/me` - Perfil (autenticado)

## ⚠️ Producción

1. Usar HTTPS
2. Cambiar secretos
3. Ajustar CORS_ORIGIN
4. Configurar MongoDB con autenticación
5. Usar variables de entorno seguras

## 📝 Licencia

MIT
# OrganizadorDePensiones-Back
# OrganizadorDePensiones-Back
