// models/cleaningTask.js
const mongoose = require('mongoose');

const swapRequestSchema = new mongoose.Schema({
  requestedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  targetTask: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CleaningTask',
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'rejected'],
    default: 'pending'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const cleaningTaskSchema = new mongoose.Schema({
  area: {
    type: String,
    required: [true, 'El área es requerida'],
    enum: ['Baño 1', 'Baño 2', 'Baño 3', 'Terraza y Escaleras', 'Orden de Cocina', 'Cocina y Living', 'Basura', 'Cortar el pasto']
  },
  frequency: {
    type: String,
    required: true,
    enum: ['weekly', 'biweekly', 'monthly'],
    default: 'weekly'
  },
  responsibles: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }],
  startDate: {
    type: Date,
    required: true
  },
  endDate: {
    type: Date,
    required: true
  },
  completed: {
    type: Boolean,
    default: false
  },
  completedAt: {
    type: Date
  },
  temporaryResponsible: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  verifiers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  verificationStatus: {
    type: String,
    enum: ['pending', 'in_progress', 'approved', 'rejected'],
    default: 'pending'
  },
  verifications: [{
    verifier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    approved: Boolean,
    comment: String,
    verifiedAt: {
      type: Date,
      default: Date.now
    }
  }],
  notifications: {
    start: { type: Boolean, default: false },
    hours48: { type: Boolean, default: false },
    hours24: { type: Boolean, default: false }
  },
  swapRequests: [swapRequestSchema],
}, {
  timestamps: true
});

module.exports = mongoose.model('CleaningTask', cleaningTaskSchema);