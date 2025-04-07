require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const os = require('os');
const admin = require('firebase-admin');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Firebase config
const serviceAccount = require('./firebaseKey.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: "be-hieu.appspot.com" // Thay bằng project-id thực tế
});
const bucket = admin.storage().bucket();

const upload = multer({ dest: os.tmpdir() }); // Lưu tạm vào thư mục tmp

// Cấu hình kết nối MySQL
const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
});

db.connect(err => {
  if (err) {
    console.error('Lỗi kết nối cơ sở dữ liệu:', err);
  } else {
    console.log('Kết nối cơ sở dữ liệu thành công');
  }
});

app.use('/images', express.static(path.join(__dirname, 'images')));

// Endpoint đăng nhập
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const sql = 'SELECT * FROM users WHERE username = ? AND password = ?';
  db.query(sql, [username, password], (err, results) => {
    if (err) {
      return res.status(500).json({ error: 'Lỗi truy vấn cơ sở dữ liệu' });
    }
    if (results.length > 0) {
      const user = results[0];
      res.json({ success: true, user: { id: user.id, username: user.username, role: user.role } });
    } else {
      res.status(401).json({ success: false, message: 'Sai thông tin đăng nhập' });
    }
  });
});

// Lấy danh sách ảnh cho trang Home
app.get('/api/images/home', (req, res) => {
  const sql = 'SELECT * FROM images WHERE JSON_CONTAINS(page, \'\"home"\')';
  db.query(sql, (err, results) => {
    if (err) {
      return res.status(500).json({ error: 'Lỗi truy vấn cơ sở dữ liệu' });
    }
    const sliderImage = results.find(image => image.type === "slider");
    const containerImageFirst = results.find(image => image.type === "container-first");
    const featureWorkImage = results.filter(image => image.type === "feature-work");
    const logosBrandImage = results.filter(image => image.type === "logos-brand");
    const containerImageSecond = results.find(image => image.type === "container-second");
    const footerImage = results.filter(image => image.type === "footer");
    const containerFooterImage = results.filter(image => image.type === "container-footer");
    res.json({ sliderImage, containerImageFirst, featureWorkImage, logosBrandImage, containerImageSecond, footerImage, containerFooterImage });
  });
});

// Lấy danh sách ảnh cho trang About
app.get('/api/images/about', (req, res) => {
  const sql = 'SELECT * FROM images WHERE JSON_CONTAINS(page, \'\"about"\')';
  db.query(sql, (err, results) => {
    if (err) {
      return res.status(500).json({ error: 'Lỗi truy vấn cơ sở dữ liệu' });
    }
    const containerLeftImage = results.filter(image => image.type === "container-left-about");
    const containerRightImage = results.filter(image => image.type === "container-right-about");
    const footerImage = results.filter(image => image.type === "footer");
    const containerFooterImage = results.filter(image => image.type === "container-footer");
    res.json({ containerLeftImage, containerRightImage, footerImage, containerFooterImage });
  });
});

// Lấy thông tin ảnh theo ID
app.get('/api/images/:id', (req, res) => {
  const { id } = req.params;
  const sql = 'SELECT * FROM images WHERE id = ?';
  db.query(sql, [id], (err, results) => {
    if (err) {
      return res.status(500).json({ error: 'Lỗi truy vấn cơ sở dữ liệu' });
    }
    if (results.length === 0) {
      return res.status(404).json({ error: 'Không tìm thấy ảnh' });
    }
    res.json(results[0]);
  });
});

// Upload ảnh lên Firebase Storage
app.post('/api/images/upload', upload.single('image'), async (req, res) => {
  try {
    const tempPath = req.file.path;
    const originalName = req.file.originalname;
    const firebaseFileName = `images/${Date.now()}_${originalName}`;

    const fileUpload = bucket.file(firebaseFileName);

    await bucket.upload(tempPath, {
      destination: firebaseFileName,
      metadata: {
        contentType: req.file.mimetype,
      },
    });

    fs.unlinkSync(tempPath);

    const [url] = await fileUpload.getSignedUrl({
      action: 'read',
      expires: '03-01-2035',
    });

    res.json({ success: true, url });
  } catch (err) {
    console.error('Lỗi khi upload ảnh lên Firebase:', err);
    res.status(500).json({ success: false, error: 'Lỗi khi upload ảnh' });
  }
});

// Cập nhật ảnh dùng Firebase
app.put('/api/images/:id', upload.single('image'), async (req, res) => {
  const { id } = req.params;
  const { type } = req.body;
  const file = req.file;

  if (!file) {
    return res.status(400).json({ success: false, message: 'No file uploaded' });
  }

  try {
    const tempPath = file.path;
    const firebaseFileName = `images/${Date.now()}_${file.originalname}`;
    const fileUpload = bucket.file(firebaseFileName);

    await bucket.upload(tempPath, {
      destination: firebaseFileName,
      metadata: {
        contentType: file.mimetype,
      },
    });
    fs.unlinkSync(tempPath);

    const [url] = await fileUpload.getSignedUrl({
      action: 'read',
      expires: '03-01-2035',
    });

    const checkImageSql = 'SELECT * FROM images WHERE id = ?';
    db.query(checkImageSql, [id], (err, results) => {
      if (err) return res.status(500).json({ success: false, error: 'Lỗi truy vấn kiểm tra ảnh' });
      if (results.length === 0) return res.status(404).json({ success: false, error: 'Ảnh không tồn tại' });

      const resetSliderType = type === 'slider' ? 'UPDATE images SET type = NULL WHERE page = "home" AND type = "slider"' : null;
      if (resetSliderType) {
        db.query(resetSliderType, (err) => {
          if (err) return res.status(500).json({ success: false, error: 'Lỗi khi reset slider' });
        });
      }

      const updateSql = 'UPDATE images SET url = ?, type = ? WHERE id = ?';
      db.query(updateSql, [url, type, id], (err, result) => {
        if (err) return res.status(500).json({ success: false, error: 'Lỗi khi cập nhật ảnh' });
        res.json({ success: true, url });
      });
    });
  } catch (error) {
    console.error('Lỗi khi cập nhật ảnh:', error);
    res.status(500).json({ success: false, error: 'Lỗi khi cập nhật ảnh' });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server đang chạy tại cổng ${PORT}`));
