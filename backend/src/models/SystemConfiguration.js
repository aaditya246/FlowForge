const mongoose = require('mongoose');

// Singleton-per-key config store (e.g. external dependency simulation settings).
const systemConfigurationSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    value: { type: mongoose.Schema.Types.Mixed, required: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('SystemConfiguration', systemConfigurationSchema);
