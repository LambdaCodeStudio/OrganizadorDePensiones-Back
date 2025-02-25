// routes/auth.js
const router = require('express').Router();
const { register, login, getMe, updatePreferences } = require('../controllers/auth');
const auth = require('../middleware/auth');
const { validate } = require('../middleware/security');
const { body } = require('express-validator');

// Validaciones para registro
const registerValidation = [
  body('fullName').notEmpty().withMessage('El nombre completo es requerido'),
  body('email').isEmail().withMessage('Email inválido'),
  body('password').isLength({ min: 6 }).withMessage('La contraseña debe tener al menos 6 caracteres')
];

// Validaciones para login
const loginValidation = [
  body('email').isEmail().withMessage('Email inválido'),
  body('password').notEmpty().withMessage('La contraseña es requerida')
];

// Rutas
router.post('/register', registerValidation, validate, register);
router.post('/login', loginValidation, validate, login);
router.get('/me', auth, getMe);
router.patch('/preferences', auth, updatePreferences);

module.exports = router;