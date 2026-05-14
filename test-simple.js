// test-simple.js
const { MongoClient } = require('mongodb');
require('dotenv').config();

async function test() {
    const client = new MongoClient(process.env.MONGO_URI);
    try {
        await client.connect();
        console.log("✅ Direct connection successful!");
    } catch (err) {
        console.error("❌ Failed:", err.message);
    } finally {
        await client.close();
    }
}

test();