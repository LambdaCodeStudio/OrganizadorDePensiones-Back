// controllers/auth.js
const User = require('../models/user');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const register = async (req, res) => {
  try {
    // Verificar si el usuario ya existe por correo electrónico
    const existingUser = await User.findOne({ email: req.body.email });
    if (existingUser) {
      return res.status(400).json({ error: 'El correo electrónico ya está en uso' });
    }

    const user = new User({
      fullName: req.body.fullName,
      email: req.body.email,
      password: req.body.password,
      availableNextWeek: true // Por defecto disponible
    });
    
    await user.save();
    
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET);
    res.json({ token, user: { 
      id: user._id, 
      fullName: user.fullName, 
      email: user.email,
      isAdmin: user.isAdmin 
    }});
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const login = async (req, res) => {
  try {
    const user = await User.findOne({ email: req.body.email });
    if (!user) {
      return res.status(400).json({ error: 'Usuario no encontrado' });
    }

    const isMatch = await bcrypt.compare(req.body.password, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Contraseña incorrecta' });
    }

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET);
    res.json({ 
      token, 
      user: { 
        id: user._id, 
        fullName: user.fullName, 
        email: user.email,
        isAdmin: user.isAdmin
      } 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Para la ruta /me
const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Actualizar preferencias de usuario
const updatePreferences = async (req, res) => {
  try {
    const { preferences } = req.body;
    
    if (!preferences || typeof preferences !== 'object') {
      return res.status(400).json({ error: 'Las preferencias deben ser un objeto válido' });
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.user.id, 
      { $set: { preferences } },
      { new: true }
    ).select('-password');

    if (!updatedUser) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    res.json(updatedUser);
  } catch (error) {
    console.error('Error en updatePreferences:', error);
    res.status(500).json({ error: error.message });
  }
};

module.exports = { register, login, getMe, updatePreferences };