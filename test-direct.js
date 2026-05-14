const mongoose = require('mongoose');
require('dotenv').config();

console.log("Trying to connect with direct string...");

mongoose.connect(process.env.MONGO_URI)
    .then(() => {
        console.log("✅ SUCCESS! Connected to MongoDB Atlas");
        process.exit(0);
    })
    .catch(err => {
        console.error("❌ Failed:", err.message);
        process.exit(1);
    });