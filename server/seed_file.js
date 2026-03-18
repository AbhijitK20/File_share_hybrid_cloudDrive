require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const User = require('./models/User');
const File = require('./models/File');
const { generateUniqueCode } = require('./utils/codeGenerator');

async function seed() {
  mongoose.set('autoCreate', false);
  mongoose.set('autoIndex', false);
  await mongoose.connect(process.env.MONGO_URI);

  const user = await User.findOne({ email: 'jane@example.com' });
  if (!user) {
    console.log('Jane not found');
    process.exit(1);
  }

  const groupCode = await generateUniqueCode();
  const filename = `test-seed-${Date.now()}.jpg`;
  
  // Create dummy physical file
  const physicalPath = path.join(__dirname, 'uploads', filename);
  fs.writeFileSync(physicalPath, 'dummy image content');

  const file = await File.create({
    filename: filename,
    originalName: 'Secret Project Mockup.jpg',
    size: 1024,
    mimetype: 'image/jpeg',
    groupCode: groupCode,
    visibility: 'public',
    uploadedBy: user._id,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
  });

  console.log(`Seeded file! Code: ${groupCode}`);
  process.exit();
}

seed().catch(console.error);
