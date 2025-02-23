const toobusy = require('toobusy-js');
const { validationResult } = require('express-validator');
const hpp = require('hpp');

// Protección contra DoS
const dosProtection = (req, res, next) => {
  if (toobusy()) {
    res.status(503).json({ error: 'Servidor ocupado' });
  } else {
    next();
  }
};

// Validación de entrada
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

module.exports = { dosProtection, validate };