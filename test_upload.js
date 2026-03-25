const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

async function testUpload() {
  try {
    // 1. Login
    const loginRes = await axios.post('http://localhost:5000/api/auth/login', {
      email: 'jane@example.com',
      password: 'password123'
    });
    const token = loginRes.data.token;
    console.log('Logged in successfully', token);

    // 2. Create a dummy image
    const dummyPath = path.join(__dirname, 'dummy_test.jpg');
    fs.writeFileSync(dummyPath, 'a'.repeat(1024 * 10)); // 10KB fake image

    // 3. Upload file
    const formData = new FormData();
    formData.append('files', fs.createReadStream(dummyPath), {
      filename: 'dummy_test.jpg',
      contentType: 'image/jpeg'
    });

    const uploadRes = await axios.post('http://localhost:5000/api/files/upload', formData, {
      headers: {
        ...formData.getHeaders(),
        Authorization: `Bearer ${token}`
      }
    });

    console.log('Upload Result:', uploadRes.data);
    fs.unlinkSync(dummyPath);
  } catch (err) {
    console.error('Error:', err.response ? err.response.data : err.message);
  }
}

testUpload();
