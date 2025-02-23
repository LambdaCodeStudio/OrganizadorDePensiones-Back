require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const connectDB = require('./config/db');
const mongoSanitize = require('express-mongo-sanitize');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const hpp = require('hpp');
const { dosProtection } = require('./middleware/security');
const corsOptions = require('./config/cors');
const MongoStore = require('connect-mongo');

const app = express();

// Configuración para Vercel
app.set('trust proxy', 1);

// Middlewares básicos
app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());

// Seguridad
app.use(helmet({
  contentSecurityPolicy: false, // Ajuste para Vercel
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: false
}));

app.use(mongoSanitize());
app.use(hpp());

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});
app.use(limiter);
app.use(dosProtection);

// Sesión con configuración para entorno serverless
app.use(session({
  secret: process.env.SESSION_SECRET,
  name: 'sessionId',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGODB_URI,
    ttl: 24 * 60 * 60 // 1 día
  }),
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'strict',
    maxAge: 3600000
  }
}));

// Headers adicionales
app.use((req, res, next) => {
  res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});

// Rutas
app.use('/api/auth', require('./routes/auth'));
app.use('/api/cleaning', require('./routes/cleaning'));

// Ruta de prueba para Vercel
app.get('/api', (req, res) => {
  res.json({ message: 'Backend funcionando correctamente' });
});

// Exportar para Vercel
module.exports = app;

// Conexión a la base de datos solo si se ejecuta localmente
if (require.main === module) {
  connectDB()
    .then(() => {
      const PORT = process.env.PORT || 4000;
      app.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`));
    })
    .catch(err => {
      console.error('Error al iniciar servidor:', err);
      process.exit(1);
    });
}