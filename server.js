require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const SibApiV3Sdk = require("sib-api-v3-sdk");

const app = express();

/* ================= MIDDLEWARE ================= */

app.use(express.json());

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

/* ================= MULTER + CLOUDINARY ================= */

const multer = require("multer");
const cloudinary = require("cloudinary").v2;

cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const upload = multer({ storage: multer.memoryStorage() });

/* ================= BREVO ================= */

const defaultClient = SibApiV3Sdk.ApiClient.instance;
defaultClient.authentications["api-key"].apiKey = process.env.BREVO_API_KEY;

const emailApi = new SibApiV3Sdk.TransactionalEmailsApi();

/* ================= DB ================= */

mongoose.connect(process.env.MONGO_URL || "mongodb://127.0.0.1:27017/friemds")
  .then(() => console.log("MongoDB Connected"))
  .catch(err => console.log(err));

/* ================= MODELS ================= */

const User = mongoose.model("User", new mongoose.Schema({
  user_id: String,
  email: String,
  name: String,
  bio: { type: String, default: "" },
  interests: { type: [String], default: [] },
  avatar: { type: String, default: null },
  year: { type: String, default: null },
  major: { type: String, default: null },
  friends: { type: [String], default: [] },
  created_at: String,
}));

const OTP = mongoose.model("OTP", new mongoose.Schema({
  email: String,
  otp: String,
  expires_at: String,
}));

/* ================= HELPERS ================= */

const generateOTP = () =>
  Math.floor(100000 + Math.random() * 900000).toString();

const createToken = (user_id) => {
  return jwt.sign({ user_id }, process.env.JWT_SECRET || "secret123", {
    expiresIn: "30d",
  });
};

/* ================= EMAIL ================= */

const sendOTPEmail = async (email, otp) => {
  try {
    await emailApi.sendTransacEmail({
      sender: { email: process.env.SENDER_EMAIL, name: "Friemds" },
      to: [{ email }],
      subject: "Your Friemds OTP Code",
      htmlContent: `<h2>Your OTP: ${otp}</h2>`
    });
    console.log("✅ OTP sent:", email);
  } catch (err) {
    console.log("❌ Email error:", err.message);
  }
};

/* ================= AUTH ================= */

app.post("/api/auth/send-otp", async (req, res) => {
  const email = req.body.email.toLowerCase();
  const otp = generateOTP();

  await OTP.findOneAndUpdate(
    { email },
    { email, otp, expires_at: new Date(Date.now() + 600000).toISOString() },
    { upsert: true }
  );

  await sendOTPEmail(email, otp);
  res.json({ message: "OTP sent" });
});

/* ================= PROFILE PHOTO ================= */

app.post(
  "/api/users/upload-avatar",
  upload.single("avatar"),
  async (req, res) => {
    try {
      const base64 = req.file.buffer.toString("base64");

      const result = await cloudinary.uploader.upload(
        `data:${req.file.mimetype};base64,${base64}`,
        { folder: "friemds" }
      );

      res.json({ avatar: result.secure_url });
    } catch (err) {
      res.status(500).json({ msg: err.message });
    }
  }
);

/* ================= START ================= */

app.listen(8000, () => {
  console.log("🔥 Server running on http://localhost:8000");
});