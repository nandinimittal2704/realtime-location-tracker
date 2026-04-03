const mongoose = require("mongoose");

const locationSchema = new mongoose.Schema({
  userId: String,
  lat: Number,
  lng: Number,
  timestamp: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("Location", locationSchema);