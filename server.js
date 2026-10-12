

const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const path = require("path");
const nodemailer = require("nodemailer");

dotenv.config({
  path: path.join(__dirname, ".env"),
});

const app = express();

const PORT = Number(process.env.PORT || 5000);

// ============================================================
// CORS
// ============================================================

const corsOrigins = (process.env.CORS_ORIGINS || "*")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: corsOrigins.includes("*") ? "*" : corsOrigins,
    credentials: !corsOrigins.includes("*"),
  })
);

app.use(express.json({ limit: "1mb" }));

// ============================================================
// EMAIL CONFIGURATION
// ============================================================

const transporter = nodemailer.createTransport({
  host: process.env.MAIL_HOST,
  port: Number(process.env.MAIL_PORT || 465),
  secure: process.env.MAIL_SECURE === "true",

  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
});

// ============================================================
// HELPERS
// ============================================================

function cleanString(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function validEmail(value) {
  if (!value) return true;

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

// ============================================================
// ENQUIRY VALIDATION
// ============================================================

function validateEnquiry(input) {
  const name = cleanString(input.name);
  const phone = cleanString(input.phone);
  const email = cleanString(input.email);
  const interest = cleanString(input.interest);
  const source = cleanString(input.source, "Website enquiry");
  const consent = Boolean(input.consent);

  if (name.length < 2 || name.length > 120) {
    return {
      error: "Name must be between 2 and 120 characters",
    };
  }

  if (
    phone.length < 5 ||
    phone.length > 25 ||
    phone.replace(/\D/g, "").length < 7
  ) {
    return {
      error: "Please provide a valid mobile number",
    };
  }

  if (email && !validEmail(email)) {
    return {
      error: "Please provide a valid email address",
    };
  }

  if (interest.length > 80 || source.length > 80) {
    return {
      error: "Invalid enquiry data",
    };
  }

  return {
    value: {
      name,
      phone,
      email,
      interest,
      source,
      consent,
    },
  };
}

// ============================================================
// HTML ESCAPING
// ============================================================

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// ============================================================
// ENQUIRY EMAIL TEMPLATE
// ============================================================

function enquiryEmailHtml(data) {
  const rows = [
    ["Name", data.name],
    ["Mobile", data.phone],
    ["Email", data.email || "—"],
    ["Interested in", data.interest || "—"],
    ["Consent given", data.consent ? "Yes" : "No"],
    ["Source", data.source],
    ["Received", data.created_at],
  ];

  const rowsHtml = rows
    .map(
      ([key, value]) => `
        <tr>
          <td
            style="
              padding:8px 0;
              font-size:12px;
              letter-spacing:2px;
              text-transform:uppercase;
              color:#D4A53C;
              white-space:nowrap;
              padding-right:24px;
            "
          >
            ${escapeHtml(key)}
          </td>

          <td
            style="
              padding:8px 0;
              font-size:14px;
              color:#F4EDE4;
            "
          >
            ${escapeHtml(value)}
          </td>
        </tr>
      `
    )
    .join("");

  return `
    <table
      role="presentation"
      width="100%"
      cellpadding="0"
      cellspacing="0"
      style="
        background:#0A0907;
        padding:32px;
        font-family:Arial,sans-serif;
      "
    >
      <tr>
        <td>

          <table
            role="presentation"
            width="100%"
            cellpadding="0"
            cellspacing="0"
            style="
              max-width:560px;
              margin:0 auto;
              background:#15120D;
              border:1px solid #D4A53C;
              border-radius:16px;
            "
          >

            <tr>
              <td
                style="
                  padding:28px 32px;
                  border-bottom:1px solid rgba(212,165,60,.3);
                "
              >

                <p
                  style="
                    margin:0;
                    font-size:12px;
                    letter-spacing:3px;
                    color:#D4A53C;
                    text-transform:uppercase;
                  "
                >
                  New enquiry
                </p>

                <h2
                  style="
                    margin:8px 0 0;
                    font-size:22px;
                    color:#F4EDE4;
                  "
                >
                  ${escapeHtml(data.source)}
                </h2>

              </td>
            </tr>

            <tr>
              <td style="padding:24px 32px">

                <table
                  role="presentation"
                  width="100%"
                  cellpadding="0"
                  cellspacing="0"
                >
                  ${rowsHtml}
                </table>

              </td>
            </tr>

            <tr>
              <td
                style="
                  padding:16px 32px 28px;
                  font-size:12px;
                  color:#8A8378;
                "
              >
                Sent by the MG Consultants website enquiry form.
                We never ask for your password or card details by email.
              </td>
            </tr>

          </table>

        </td>
      </tr>
    </table>
  `;
}

// ============================================================
// EMAIL SECURITY
// ============================================================

const CRED_ASK = [
  "reply with your password",
  "reply with the code",
  "send your password",
  "cvv",
  "send us your password",
  "enter your password below",
  "confirm your card number",
  "your full card number",
  "seed phrase",
  "recovery phrase",
  "verify your card",
  "social security number",
  "confirm your bank details",
];

function assertSafeEmail(subject, html) {
  const body = `${subject}\n${html}`.toLowerCase();

  if (/<\s*(form|input|textarea|select)\b/i.test(html)) {
    throw new Error("No forms or input fields in email");
  }

  for (const phrase of CRED_ASK) {
    if (body.includes(phrase)) {
      throw new Error(
        `Email asks the recipient for credentials: ${phrase}`
      );
    }
  }
}

// ============================================================
// SEND EMAIL
// ============================================================

async function sendEmail({
  to,
  subject,
  html,
  replyTo,
}) {
  assertSafeEmail(subject, html);

  if (!process.env.MAIL_USER || !process.env.MAIL_PASS) {
    throw new Error(
      "Email credentials are not configured"
    );
  }

  if (!to) {
    throw new Error(
      "Recipient email is not configured"
    );
  }

  const mailOptions = {
    from: `"${process.env.EMAIL_FROM_NAME || "MG Consultants"}" <${process.env.MAIL_USER}>`,

    to,

    subject,

    html,

    // When you click Reply in your email client,
    // it will reply directly to the person who submitted
    // the enquiry.
    replyTo: replyTo || process.env.MAIL_USER,
  };

  const info = await transporter.sendMail(mailOptions);

  console.log("Email sent successfully:", info.messageId);

  return info.messageId;
}

// ============================================================
// API ROUTES
// ============================================================

// Basic API test
app.get("/api/", (_req, res) => {
  res.json({
    message: "MG Consultants API is running",
  });
});

// ============================================================
// ENQUIRY API
// ============================================================

app.post("/api/enquiries", async (req, res) => {
  try {
    // Validate frontend data
    const result = validateEnquiry(req.body || {});

    // console.log("Enquiry validation:", result);

    if (result.error) {
      return res.status(400).json({
        status: "error",
        detail: result.error,
      });
    }

    const input = result.value;

    // Nothing is stored in a database.
    // Data only exists during this request.
    const enquiry = {
      ...input,
      created_at: new Date().toISOString(),
    };

    // console.log("Enquiry received:", enquiry);

    // Send email
    await sendEmail({
      to: process.env.OWNER_EMAIL,

      subject: `New enquiry — MG Consultants (${enquiry.source})`,

      html: enquiryEmailHtml(enquiry),

      replyTo: enquiry.email || undefined,
    });

    // Response to frontend
    return res.json({
      status: "success",
      message: "Your enquiry has been submitted successfully.",
      email_sent: true,
    });

  } catch (error) {
    console.error(
      "POST /api/enquiries:",
      error
    );

    return res.status(500).json({
      status: "error",
      detail:
        "Unable to submit your enquiry at the moment. Please try again later.",
    });
  }
});

// ============================================================
// HEALTH CHECK
// ============================================================

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
  });
});

// ============================================================
// START SERVER
// ============================================================

app.listen(PORT, () => {
  console.log(
    `Express API running on port ${PORT}`
  );
});

module.exports = app;