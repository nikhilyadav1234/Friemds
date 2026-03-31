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


/* ================= multer-storage-cloudinary ================= */


const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("cloudinary").v2;


/* ================= BREVO CONFIG ================= */

const defaultClient = SibApiV3Sdk.ApiClient.instance;
defaultClient.authentications["api-key"].apiKey = process.env.BREVO_API_KEY;

const emailApi = new SibApiV3Sdk.TransactionalEmailsApi();

/* ================= DB ================= */

mongoose.connect(process.env.MONGO_URL || "mongodb://127.0.0.1:27017/friemds")
  .then(() => console.log("MongoDB Connected"))
  .catch(err => console.log(err));




 /* ================= Cloudinary config ================= */


console.log("CLOUD:", process.env.CLOUD_NAME);
console.log("KEY:", process.env.CLOUDINARY_API_KEY);
console.log("SECRET:", process.env.CLOUDINARY_API_SECRET);  


  cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});


/* ================= Image Storage config ================= */
const storage = multer.memoryStorage();
const upload = multer({ storage });


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

const FriendRequest = mongoose.model("FriendRequest", new mongoose.Schema({
  request_id: String,
  sender_id: String,
  sender_name: String,
  sender_avatar: String,
  recipient_id: String,
  status: String,
  created_at: String,
}));

const Message = mongoose.model("Message", new mongoose.Schema({
  message_id: String,
  sender_id: String,
  recipient_id: String,
  content: String,
  created_at: String,
  read: Boolean,
}));

/* ================= HELPERS ================= */

const generateOTP = () =>
  Math.floor(100000 + Math.random() * 900000).toString();

const createToken = (user_id) => {
  return jwt.sign({ user_id }, process.env.JWT_SECRET || "secret123", {
    expiresIn: "30d",
  });
};

const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) return res.status(401).json({ msg: "No token" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "secret123");
    req.user = decoded.user_id;
    next();
  } catch {
    res.status(401).json({ msg: "Invalid token" });
  }
};

// ✅ EMAIL FUNCTION
const sendOTPEmail = async (email, otp) => {
  try {
    await emailApi.sendTransacEmail({
      sender: {
        email: process.env.SENDER_EMAIL,
        name: "Friemds"
      },
      to: [{ email }],
      subject: "Your Friemds OTP Code",
      htmlContent: `
        <div style="font-family: Arial; padding:20px;">
          <h2>Friemds Verification</h2>
          <p>Your OTP is:</p>
          <h1 style="letter-spacing:6px;">${otp}</h1>
          <p>This OTP expires in 10 minutes.</p>
        </div>
      `,
    });

    console.log("✅ OTP sent to:", email);
  } catch (err) {
    console.log("❌ Email error:", err.message);
  }
};

/* ================= AUTH ================= */

// SEND OTP
app.post("/api/auth/send-otp", async (req, res) => {
  const email = req.body.email.toLowerCase();

  const otp = generateOTP();

  await OTP.findOneAndUpdate(
    { email },
    {
      email,
      otp,
      expires_at: new Date(Date.now() + 600000).toISOString(),
    },
    { upsert: true }
  );

if (process.env.MOCK_OTP === "true") {
  console.log("🔥 MOCK OTP for", email, "is:", otp);
} else {
  await sendOTPEmail(email, otp);
}
  res.json({ message: "OTP sent to email" });
});

// VERIFY OTP
// app.post("/api/auth/verify-otp", async (req, res) => {
//   const { email, otp, name, interests } = req.body;

//   const otpDoc = await OTP.findOne({ email });

//   if (!otpDoc) return res.status(400).json({ msg: "OTP not found" });

//   if (otpDoc.otp !== otp) {
//     return res.status(400).json({ msg: "Invalid OTP" });
//   }

//   let user = await User.findOne({ email });

//   if (!user) {
//     const user_id = uuidv4();

//     user = await User.create({
//       user_id,
//       email,
//       name: name || "User",
//       interests: interests || [],
//       created_at: new Date().toISOString(),
//     });
//   }

//   res.json({
//     token: createToken(user.user_id),
//     user,
//   });
// });




app.post("/api/auth/verify-otp", async (req, res) => {
  const { email, otp, name, interests } = req.body;

  const otpDoc = await OTP.findOne({ email });

  if (!otpDoc) return res.status(400).json({ msg: "OTP not found" });

  if (otpDoc.otp !== otp) {
    return res.status(400).json({ msg: "Invalid OTP" });
  }

  let user = await User.findOne({ email });

  // 🔹 LOGIN FLOW
  if (user) {
    return res.json({
      message: "Login successful",
      token: createToken(user.user_id),
      user,
      isNewUser: false
    });
  }

  // 🔴 SIGNUP FLOW (new user)
  if (!name) {
    return res.status(400).json({
      msg: "Name required for new user signup",
    });
  }

  const user_id = uuidv4();

  user = await User.create({
    user_id,
    email,
    name,
    interests: interests || [],
    created_at: new Date().toISOString(),
  });

 res.json({
  message: "Signup successful",
  token: createToken(user_id),
  user,
  isNewUser: true
  });
});


/* ================= Login ================= */
app.post("/api/auth/login", async (req, res) => {
  const email = req.body.email.toLowerCase();

  const user = await User.findOne({ email });

  // ❌ user exist nahi karta
  if (!user) {
    return res.status(400).json({
      msg: "User not found. Please signup first."
    });
  }

  const otp = generateOTP();

  await OTP.findOneAndUpdate(
    { email },
    {
      email,
      otp,
      expires_at: new Date(Date.now() + 600000).toISOString(),
    },
    { upsert: true }
  );

  // 📩 SEND EMAIL
if (process.env.MOCK_OTP === "true") {
  console.log("🔥 MOCK OTP for", email, "is:", otp);
} else {
  await sendOTPEmail(email, otp);
}
  res.json({ message: "OTP sent for login" });
});




/* ================= USER ================= */

app.get("/api/users/me", authMiddleware, async (req, res) => {
  const user = await User.findOne({ user_id: req.user });
  res.json(user);
});

app.put("/api/users/me", authMiddleware, async (req, res) => {
  await User.updateOne({ user_id: req.user }, { $set: req.body });

  const user = await User.findOne({ user_id: req.user });
  res.json({ message: "Profile updated", user });
});

app.get("/api/users", authMiddleware, async (req, res) => {
  const users = await User.aggregate([
  { $match: { user_id: { $ne: req.user } } },
  { $sample: { size: 20 } } // 👈 RANDOM USERS
]);
  res.json(users);
});

app.get("/api/users/search", authMiddleware, async (req, res) => {
  const { q, interests, year, major } = req.query;

  let query = { user_id: { $ne: req.user } };

  if (q) {
    query.$or = [
      { name: { $regex: q, $options: "i" } },
      { email: { $regex: q, $options: "i" } },
    ];
  }

  if (interests) {
    query.interests = { $in: interests.split(",") };
  }

  if (year) query.year = year;
  if (major) query.major = { $regex: major, $options: "i" };

  const users = await User.find(query);
  res.json(users);
});

/* ================= Profile photo ================= */

// app.post(
//   "/api/users/upload-avatar",
//   authMiddleware,
//   upload.single("avatar"),
//   async (req, res) => {
//     try {

//       console.log("FILE:", req.file);

// if (!req.file) {
//   return res.status(400).json({ msg: "No file uploaded" });
// }


//       const imageUrl = req.file.path;

//       await User.updateOne(
//         { user_id: req.user },
//         { $set: { avatar: imageUrl } }
//       );

//       const user = await User.findOne({ user_id: req.user });

//       res.json({
//         message: "Profile photo updated",
//         avatar: imageUrl,
//         user
//       });
//     } catch (err) {
//     console.log("🔥 ERROR DETAILS:");
//     console.log(err.message);
//     console.log(err.stack);
//     console.log("FILE:", req.file);

//   res.status(500).json({ msg: err.message });
// }
   
//   }
// );



app.post(
  "/api/users/upload-avatar",
  authMiddleware,
  upload.single("avatar"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ msg: "No file uploaded" });
      }

      // 🔥 convert buffer → base64
      const base64 = req.file.buffer.toString("base64");

      // 🔥 upload directly
      const result = await cloudinary.uploader.upload(
        `data:${req.file.mimetype};base64,${base64}`,
        {
          folder: "friemds"
        }
      );

      const imageUrl = result.secure_url;

      await User.updateOne(
        { user_id: req.user },
        { $set: { avatar: imageUrl } }
      );

      const user = await User.findOne({ user_id: req.user });

      res.json({
        message: "Profile photo updated",
        avatar: imageUrl,
        user,
      });

    } 
    catch (err) {
      console.log("🔥 UPLOAD ERROR:", err);
      res.status(500).json({ msg: err.message }); 
    }
  }
);



// /* ================= FRIEND ================= */

// // app.post("/api/friends/request", authMiddleware, async (req, res) => {
// //   const sender = await User.findOne({ user_id: req.user });

// //   const request = await FriendRequest.create({
// //     request_id: uuidv4(),
// //     sender_id: req.user,
// //     sender_name: sender.name,
// //     sender_avatar: sender.avatar,
// //     recipient_id: req.body.recipient_id,
// //     status: "pending",
// //     created_at: new Date().toISOString(),
// //   });

// //   res.json(request);
// // });





app.get("/test-cloudinary", async (req, res) => {
  try {
    const result = await cloudinary.uploader.upload(
      "https://res.cloudinary.com/demo/image/upload/sample.jpg"
    );
    res.json(result);
  } catch (err) {
    console.log("🔥 TEST ERROR:", err);
    res.status(500).json(err);
  }
});



app.post("/api/friends/request", authMiddleware, async (req, res) => {
  const senderId = req.user;
  const recipientId = req.body.recipient_id;

  // ❌ cannot send to self
  if (senderId === recipientId) {
    return res.status(400).json({ msg: "Cannot add yourself" });
  }

  const sender = await User.findOne({ user_id: senderId });

  // ❌ already friends
  if (sender.friends.includes(recipientId)) {
    return res.status(400).json({ msg: "Already friends" });
  }

  // ❌ already sent request
  const existingRequest = await FriendRequest.findOne({
    sender_id: senderId,
    recipient_id: recipientId,
    status: "pending"
  });

  if (existingRequest) {
    return res.status(400).json({ msg: "Request already sent" });
  }

  const request = await FriendRequest.create({
    request_id: uuidv4(),
    sender_id: senderId,
    sender_name: sender.name,
    sender_avatar: sender.avatar,
    recipient_id: recipientId,
    status: "pending",
    created_at: new Date().toISOString(),
  });

  res.json({ message: "Request sent", request });
});



app.get("/api/friends/requests", authMiddleware, async (req, res) => {
  const requests = await FriendRequest.find({
    recipient_id: req.user,
    status: "pending",
  });
  res.json(requests);
});

app.post("/api/friends/accept", authMiddleware, async (req, res) => {
  const fr = await FriendRequest.findOne({
    request_id: req.body.request_id,
  });

  if (!fr) return res.status(404).json({ msg: "Not found" });

  fr.status = "accepted";
  await fr.save();

  await User.updateOne(
    { user_id: fr.sender_id },
    { $addToSet: { friends: fr.recipient_id } }
  );

  await User.updateOne(
    { user_id: fr.recipient_id },
    { $addToSet: { friends: fr.sender_id } }
  );

  res.json({ message: "Accepted" });
});

app.post("/api/friends/reject", authMiddleware, async (req, res) => {
  await FriendRequest.updateOne(
    { request_id: req.body.request_id },
    { $set: { status: "rejected" } }
  );

  res.json({ message: "Rejected" });
});

app.get("/api/friends", authMiddleware, async (req, res) => {
  const user = await User.findOne({ user_id: req.user });

  const friends = await User.find({
    user_id: { $in: user.friends },
  });

  res.json(friends);
});

/* ================= MESSAGE ================= */

app.post("/api/messages", authMiddleware, async (req, res) => {
  const message = await Message.create({
    message_id: uuidv4(),
    sender_id: req.user,
    recipient_id: req.body.recipient_id,
    content: req.body.content,
    created_at: new Date().toISOString(),
    read: false,
  });

  res.json(message);
});

app.get("/api/messages/:friendId", authMiddleware, async (req, res) => {
  const friendId = req.params.friendId;

  const messages = await Message.find({
    $or: [
      { sender_id: req.user, recipient_id: friendId },
      { sender_id: friendId, recipient_id: req.user },
    ],
  }).sort({ created_at: 1 });

  await Message.updateMany(
    {
      sender_id: friendId,
      recipient_id: req.user,
      read: false,
    },
    { $set: { read: true } }
  );

  res.json(messages);
});

app.get("/api/messages/unread/count", authMiddleware, async (req, res) => {
  const count = await Message.countDocuments({
    recipient_id: req.user,
    read: false,
  });

  res.json({ unread_count: count });
});

/* ================= START ================= */

// app.listen(8000, () => {
//   console.log("🔥 Server running on http://localhost:8000");
// });



const WebSocket = require("ws");
const PORT = process.env.PORT || 8000;

const server = app.listen(PORT, () => {
  console.log(`🔥 Server running on port ${PORT}`);
});

const wss = new WebSocket.Server({ server, path: "/ws" });

const clients = {};

wss.on("connection", (ws) => {
  console.log("✅ WebSocket connected");

  ws.on("message", (msg) => {
    const data = JSON.parse(msg);

    // user register karega
    if (data.type === "register") {
      clients[data.user_id] = ws;
    }

    // message send karega
    if (data.type === "message") {
      const target = clients[data.recipient_id];

      if (target) {
        target.send(JSON.stringify({
          message_id: Date.now(),
          sender_id: data.sender_id,
          content: data.content
        }));
      }
    }
  });

  ws.on("close", () => {
    console.log("❌ WebSocket disconnected");
  });
});