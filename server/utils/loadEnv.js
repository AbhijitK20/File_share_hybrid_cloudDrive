const path = require('path');
const dotenv = require('dotenv');

// Load env from workspace root so client/server can share one .env file.
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
