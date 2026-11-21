import cors from "cors";
import express from "express";
import axios from "axios";
import multer from "multer";
import FormData from "form-data";
import dotenv from "dotenv";

dotenv.config();

const app = express();

const allowedOrigins = [
  "https://myucb.vercel.app",
  "http://localhost:5173",
  "http://localhost:3000",
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: ["GET", "POST"],
}));
const PORT = process.env.PORT || 3000;

// Validate environment
if (!process.env.OCR_API_KEY) {
  throw new Error("OCR_API_KEY is missing from .env");
}

// Configure upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "image/png",
      "image/jpeg",
      "image/gif",
      "image/tiff",
      "image/bmp",
      "application/pdf",
    ];

    if (!allowedTypes.includes(file.mimetype)) {
      return cb(new Error("Unsupported file type."));
    }

    cb(null, true);
  },
});

// Health check
app.get("/", (req, res) => {
  res.json({
    status: "online",
    service: "OCR API",
    endpoint: "POST /api/ocr",
  });
});

// OCR endpoint
app.post("/api/ocr", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Please upload an image or PDF.",
      });
    }

    // Prepare multipart form data
    const form = new FormData();

    form.append("file", req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype,
    });

    form.append("language", req.body.language || "eng");
    form.append("isOverlayRequired", "false");
    form.append("OCREngine", "2");

    // Send request to OCR.space
    const response = await axios.post(
      "https://api.ocr.space/parse/image",
      form,
      {
        headers: {
          ...form.getHeaders(),
          apikey: process.env.OCR_API_KEY,
        },
        timeout: 120000,
        maxBodyLength: Infinity,
      }
    );

    const result = response.data;

    // Check OCR errors
    if (
      result.IsErroredOnProcessing ||
      !result.ParsedResults
    ) {
      return res.status(422).json({
        success: false,
        message: "OCR processing failed.",
        error: result.ErrorMessage || result.ErrorDetails,
      });
    }

    // Extract text from all pages
    const pages = result.ParsedResults.map((page, index) => ({
      page: index + 1,
      text: page.ParsedText || "",
    }));

    const fullText = pages
      .map((page) => page.text)
      .join("\n\n");

    return res.json({
      success: true,
      filename: req.file.originalname,
      mimeType: req.file.mimetype,
      totalPages: pages.length,
      text: fullText,
      pages,
    });

  } catch (error) {
    console.error("OCR Error:", error.message);

    return res.status(
      error.response ? 502 : 500
    ).json({
      success: false,
      message: "Unable to process OCR request.",
      error: error.response?.data || error.message,
    });
  }
});

// Handle upload and other errors
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({
      success: false,
      message: err.code === "LIMIT_FILE_SIZE"
        ? "File exceeds the 10 MB limit."
        : err.message,
    });
  }

  return res.status(400).json({
    success: false,
    message: err.message || "Request error.",
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`OCR API running on port ${PORT}`);
});

