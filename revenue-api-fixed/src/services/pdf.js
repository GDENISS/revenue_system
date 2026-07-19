import { mkdirSync, createWriteStream } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, "../../generated/notices");
mkdirSync(OUTPUT_DIR, { recursive: true });


const logoCache = new Map();

async function fetchLogo(url) {
  if (!url) return null;
  if (logoCache.has(url)) return logoCache.get(url);
  const promise = (async () => {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const ct = res.headers.get("content-type") ?? "";
      // pdfkit can only render PNG and JPEG.
      if (!/^image\/(png|jpe?g)/i.test(ct)) return null;
      return Buffer.from(await res.arrayBuffer());
    } catch {
      return null;
    }
  })();
  logoCache.set(url, promise);
  return promise;
}

/* ── helpers ────────────────────────────────────────────────────────── */

const fmtKes = (n) =>
  new Intl.NumberFormat("en-KE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);

const fmtDate = (d) => {
  if (!d) return "";
  const date = new Date(d);
  if (isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
};

const fmtTimestamp = (d) => {
  const date = d ? new Date(d) : new Date();
  return date.toISOString().slice(0, 19) + "+03:00 (EAT)";
};

// pdfkit colour helpers
const COL_PRIMARY = "#0c4a6e";
const COL_ACCENT = "#b91c1c";
const COL_TEXT = "#1f2937";
const COL_MUTED = "#6b7280";
const COL_LINE = "#e5e7eb";
const COL_HEAD_BG = COL_PRIMARY;
const COL_TOTAL_BG = "#fef3c7";
const COL_CARD_BG = "#f9fafb";
const COL_WARN_BG = "#fef2f2";

/**
 * Generate a demand-notice PDF and return its absolute file path.
 * `data` shape matches the previous (Puppeteer) implementation.
 */
export async function generateNoticePDF(data) {
  const {
    // notice
    noticeNumber,
    amountDue,
    dueDate,
    issuedDate = new Date().toISOString(),
    levyDescription = `Annual Land Rates — ${new Date().getFullYear()}/${(new Date().getFullYear() + 1).toString().slice(2)}`,
    // taxpayer
    taxpayerName,
    taxpayerIdNo,
    taxpayerPhone,
    taxpayerEmail,
    taxpayerAddress,
    plotReference,
    physicalAddress,
    recordType,
    zoneName,
    // billing line items
    lineItems,
    // officer
    officerName = "County Revenue Officer",
    officerId = "—",
    officerDesignation = "Revenue Officer, Rates Unit",
    // county branding
    countyName = "Nairobi City County",
    countyCode = "NCC",
    countyAddress = "City Hall Annex, P.O. Box 30075-00100, Nairobi, Kenya",
    countyDepartment = "Department of Finance & Economic Planning · Revenue Division",
    countyLogoUrl,
    legalBasis = "Issued under the Rating Act, 2024 (Cap. 267, Revised)",
    // payment + verification
    currencyCode = "KES",
    bankName = "Kenya Commercial Bank (KCB)",
    bankBranch = "City Hall Branch",
    bankAccountName,
    bankAccountNo = "1109876543",
    bankSwift = "KCBLKENX",
    paybillNumber = process.env.COUNTY_MPESA_PAYBILL || "222222",
    contactPhone = "0800 720 999",
    contactEmail = "revenue@nairobi.go.ke",
    counterOffice = "City Hall Annex, Ground",
    counterHours = "Mon–Fri 08:00–17:00 EAT",
    verifyBaseUrl = ""
  } = data;

  // .env values override DB / hardcoded defaults so the operator can rebrand
  // the template without a code change or DB migration. Trim because shell
  // .env files often leave a leading space after the equals sign.
  const envCountyName = process.env.COUNTY_NAME?.trim();
  const envLogoUrl = process.env.COUNTY_LOGO_URL?.trim();
  const effectiveCountyName = envCountyName || countyName;
  const effectiveLogoUrl = envLogoUrl || countyLogoUrl || null;
  const effectiveBankAccountName = bankAccountName || `${effectiveCountyName} — Revenue`;

  const items =
    Array.isArray(lineItems) && lineItems.length > 0
      ? lineItems
      : [
          {
            description: levyDescription,
            plotRef: plotReference ?? "—",
            rate: "—",
            area: "—",
            amount: amountDue,
          },
        ];
  const totalDue =
    items.reduce((s, i) => s + (Number(i.amount) || 0), 0) ||
    Number(amountDue) ||
    0;

  const verifyUrl = verifyBaseUrl
    ? `${verifyBaseUrl.replace(/\/$/, "")}/${encodeURIComponent(noticeNumber)}`
    : `https://verify.example.go.ke/${encodeURIComponent(noticeNumber)}`;

  // Render the QR to a PNG buffer in-process.
  const qrPng = await QRCode.toBuffer(verifyUrl, {
    type: "png",
    margin: 0,
    width: 140,
    color: { dark: COL_PRIMARY, light: "#FFFFFFFF" },
  });

  // Logo is best-effort — if the remote URL fails or returns a non-image we
  // silently fall back to the COUNTY_CODE-in-a-box placeholder.
  const logoBuf = await fetchLogo(effectiveLogoUrl);

  const filename = `${noticeNumber.replace(/[^a-zA-Z0-9-]/g, "_")}.pdf`;
  const outputPath = join(OUTPUT_DIR, filename);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 40, bottom: 40, left: 40, right: 40 },
      info: {
        Title: `Demand Notice ${noticeNumber}`,
        Author: effectiveCountyName,
        Subject: levyDescription,
      },
    });

    const stream = createWriteStream(outputPath);
    stream.on("finish", () => resolve(outputPath));
    stream.on("error", reject);
    doc.on("error", reject);
    doc.pipe(stream);

    // ── working area
    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const W = right - left;

    /* 1. HEADER ────────────────────────────────────────────────────── */
    const hdrTop = doc.y;
    if (logoBuf) {
      try {
        doc.image(logoBuf, left, hdrTop, {
          fit: [56, 56],
          align: "center",
          valign: "center",
        });
      } catch {
        // Corrupt / unsupported image bytes — fall through to placeholder.
        drawLogoPlaceholder(doc, left, hdrTop, countyCode);
      }
    } else {
      drawLogoPlaceholder(doc, left, hdrTop, countyCode);
    }

    // County text block
    const whoX = left + 68;
    doc
      .fillColor(COL_PRIMARY)
      .font("Helvetica-Bold")
      .fontSize(14)
      .text(effectiveCountyName.toUpperCase(), whoX, hdrTop + 2, { width: W - 270 });
    doc
      .fillColor("#4b5563")
      .font("Helvetica")
      .fontSize(9)
      .text(countyDepartment, whoX, doc.y, { width: W - 270 });
    doc
      .fillColor(COL_MUTED)
      .fontSize(8.5)
      .text(countyAddress, whoX, doc.y, { width: W - 270 });

    // Legal basis (right)
    const legalW = 200;
    doc
      .fillColor(COL_PRIMARY)
      .font("Helvetica-Bold")
      .fontSize(8)
      .text("ISSUED UNDER", right - legalW, hdrTop + 4, {
        width: legalW,
        align: "right",
      });
    doc
      .fillColor(COL_MUTED)
      .font("Helvetica")
      .fontSize(8)
      .text(legalBasis, right - legalW, doc.y, {
        width: legalW,
        align: "right",
      });

    // Move past the header band
    doc.y = Math.max(doc.y, hdrTop + 60);
    doc
      .moveTo(left, doc.y + 4)
      .lineTo(right, doc.y + 4)
      .lineWidth(2)
      .strokeColor(COL_PRIMARY)
      .stroke();
    doc.y += 14;

    /* 2. TITLE + REF ───────────────────────────────────────────────── */
    const titleY = doc.y;
    doc
      .rect(left, titleY, 3, 18)
      .fillColor(COL_ACCENT)
      .fill();
    doc
      .fillColor(COL_PRIMARY)
      .font("Helvetica-Bold")
      .fontSize(13)
      .text(
        recordType
          ? `${String(recordType).toUpperCase()} DEMAND NOTICE`
          : "LAND RATES DEMAND NOTICE",
        left + 10,
        titleY,
        { continued: false },
      );
    doc
      .fillColor(COL_MUTED)
      .font("Helvetica")
      .fontSize(9)
      .text("Notice Ref:  ", right - 200, titleY + 4, {
        width: 200,
        align: "right",
        continued: true,
      })
      .fillColor(COL_ACCENT)
      .font("Courier-Bold")
      .text(noticeNumber);
    doc.y = titleY + 24;

    /* 3. TAXPAYER INFO ─────────────────────────────────────────────── */
    sectionTitle(doc, left, W, "1. Taxpayer Information");
    kvGrid(doc, left, W, [
      ["Taxpayer Name", taxpayerName ?? "—"],
      ["Taxpayer UID / National ID", taxpayerIdNo || "—"],
      ["Postal Address", taxpayerAddress || "—"],
      ["Physical Address", physicalAddress || zoneName || "—"],
      ["Plot / Parcel Ref", plotReference || "—"],
      [
        "Phone / Email",
        [taxpayerPhone, taxpayerEmail].filter(Boolean).join("  |  ") || "—",
      ],
    ]);

    /* 4. LEVY TABLE ────────────────────────────────────────────────── */
    sectionTitle(doc, left, W, "2. Levy Description");
    drawLevyTable(doc, left, W, items, plotReference, totalDue, currencyCode);

    /* 5. AMOUNT DUE + DEADLINE ─────────────────────────────────────── */
    sectionTitle(doc, left, W, "3. Amount Due & Payment Deadline");
    dueCards(doc, left, W, currencyCode, totalDue, issuedDate, dueDate);

    // Penalty warning
    const warnY = doc.y + 6;
    const warnH = 36;
    doc
      .rect(left, warnY, W, warnH)
      .fillColor(COL_WARN_BG)
      .fill();
    doc
      .rect(left, warnY, 3, warnH)
      .fillColor(COL_ACCENT)
      .fill();
    doc
      .fillColor(COL_ACCENT)
      .font("Helvetica-Bold")
      .fontSize(8.5)
      .text("WARNING:", left + 10, warnY + 6, { continued: true })
      .fillColor("#7f1d1d")
      .font("Helvetica")
      .text(
        " Failure to pay by the due date will attract additional penalties at 2% per month as provided by the relevant rating Act. Legal recovery action may follow.",
        { width: W - 16 },
      );
    doc.y = warnY + warnH + 6;

    /* 6. PAYMENT INSTRUCTIONS ──────────────────────────────────────── */
    sectionTitle(doc, left, W, "4. Payment Instructions");
    paymentCards(doc, left, W, {
      bankName,
      bankBranch,
      bankAccountName: effectiveBankAccountName,
      bankAccountNo,
      bankSwift,
      paybillNumber,
      counterOffice,
      counterHours,
      noticeNumber,
    });

    /* 7. OFFICER + QR ──────────────────────────────────────────────── */
    sectionTitle(doc, left, W, "5. Issuing Officer & Verification");
    officerBlock(doc, left, W, {
      officerName,
      officerId,
      officerDesignation,
      issuedDate,
      qrPng,
      verifyUrl,
    });

    /* 8. FOOTER ────────────────────────────────────────────────────── */
    const footY = doc.page.height - doc.page.margins.bottom - 16;
    doc
      .moveTo(left, footY - 6)
      .lineTo(right, footY - 6)
      .lineWidth(1)
      .strokeColor(COL_LINE)
      .stroke();
    doc
      .fillColor(COL_MUTED)
      .font("Helvetica")
      .fontSize(8)
      .text(
        "This is a computer-generated notice. No handwritten signature required.",
        left,
        footY,
        { width: W / 2 },
      );
    doc
      .fontSize(8)
      .text(`Helpline: ${contactPhone} · ${contactEmail}`, left + W / 2, footY, {
        width: W / 2,
        align: "right",
      });

    doc.end();
  });
}

/* ── drawing primitives ─────────────────────────────────────────────── */

function drawLogoPlaceholder(doc, x, y, label) {
  doc.roundedRect(x, y, 56, 56, 6).fillColor(COL_PRIMARY).fill();
  doc
    .fillColor("#FFFFFF")
    .font("Helvetica-Bold")
    .fontSize(18)
    .text(label, x, y + 18, { width: 56, align: "center" });
}

function sectionTitle(doc, left, W, text) {
  doc.y = Math.max(doc.y, doc.y); // pdfkit position
  const y = doc.y + 6;
  doc
    .fillColor(COL_PRIMARY)
    .font("Helvetica-Bold")
    .fontSize(9)
    .text(text.toUpperCase(), left, y, { characterSpacing: 0.4 });
  doc
    .moveTo(left, doc.y + 2)
    .lineTo(left + W, doc.y + 2)
    .lineWidth(0.8)
    .strokeColor(COL_LINE)
    .stroke();
  doc.y += 8;
}

function kvGrid(doc, left, W, pairs) {
  const colW = (W - 16) / 2;
  const rowH = 16;
  let y = doc.y;
  pairs.forEach(([k, v], i) => {
    const col = i % 2;
    if (i > 0 && col === 0) y += rowH;
    const x = left + col * (colW + 16);
    doc
      .fillColor(COL_MUTED)
      .font("Helvetica")
      .fontSize(8.5)
      .text(k, x, y, { width: 130 });
    doc
      .fillColor("#111827")
      .font("Helvetica-Bold")
      .fontSize(9)
      .text(String(v), x + 130, y, { width: colW - 130 });
  });
  doc.y = y + rowH + 4;
}

function drawLevyTable(doc, left, W, items, plotReference, totalDue, currencyCode) {
  const cols = [
    { key: "description", label: "Description", w: 0.34, align: "left" },
    { key: "plotRef", label: "Property / Plot", w: 0.2, align: "left" },
    { key: "rate", label: "Rate", w: 0.12, align: "right" },
    { key: "area", label: "Area", w: 0.12, align: "right" },
    { key: "amount", label: `Amount (${currencyCode})`, w: 0.22, align: "right" },
  ];
  const colXs = [];
  let acc = 0;
  cols.forEach((c) => {
    colXs.push({ x: left + acc * W, w: c.w * W, align: c.align });
    acc += c.w;
  });

  // header
  const headY = doc.y;
  const headH = 18;
  doc.rect(left, headY, W, headH).fillColor(COL_HEAD_BG).fill();
  doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(8.5);
  cols.forEach((c, i) => {
    doc.text(c.label, colXs[i].x + 6, headY + 5, {
      width: colXs[i].w - 12,
      align: c.align,
    });
  });
  doc.y = headY + headH;

  // body rows
  doc.font("Helvetica").fontSize(9).fillColor(COL_TEXT);
  items.forEach((it) => {
    const rowY = doc.y;
    const rowH = 18;
    cols.forEach((c, i) => {
      let val;
      if (c.key === "amount") val = fmtKes(it.amount);
      else if (c.key === "plotRef") val = String(it.plotRef ?? plotReference ?? "—");
      else val = String(it[c.key] ?? "—");
      doc.text(val, colXs[i].x + 6, rowY + 5, {
        width: colXs[i].w - 12,
        align: c.align,
      });
    });
    doc
      .moveTo(left, rowY + rowH)
      .lineTo(left + W, rowY + rowH)
      .lineWidth(0.5)
      .strokeColor("#f1f5f9")
      .stroke();
    doc.y = rowY + rowH;
  });

  // total row
  const totalY = doc.y;
  const totalH = 22;
  doc.rect(left, totalY, W, totalH).fillColor(COL_TOTAL_BG).fill();
  doc
    .fillColor(COL_TEXT)
    .font("Helvetica-Bold")
    .fontSize(10)
    .text("TOTAL AMOUNT DUE", left + 6, totalY + 6, {
      width: W * 0.78,
      align: "left",
    })
    .text(
      `${currencyCode} ${fmtKes(totalDue)}`,
      left + W * 0.78,
      totalY + 6,
      { width: W * 0.22 - 6, align: "right" },
    );
  doc.y = totalY + totalH + 6;
}

function dueCards(doc, left, W, currency, totalDue, issuedDate, dueDate) {
  const cards = [
    {
      k: "TOTAL AMOUNT DUE",
      v: `${currency} ${fmtKes(totalDue)}`,
      accent: true,
    },
    { k: "ISSUE DATE", v: fmtDate(issuedDate) || "—" },
    { k: "PAYMENT DUE DATE", v: fmtDate(dueDate) || "—" },
  ];
  const gap = 8;
  const cardW = (W - gap * 2) / 3;
  const cardH = 44;
  const y = doc.y;
  cards.forEach((c, i) => {
    const x = left + i * (cardW + gap);
    doc.roundedRect(x, y, cardW, cardH, 5).fillColor(COL_CARD_BG).fill();
    doc
      .strokeColor(COL_LINE)
      .lineWidth(0.8)
      .roundedRect(x, y, cardW, cardH, 5)
      .stroke();
    doc
      .fillColor(COL_MUTED)
      .font("Helvetica-Bold")
      .fontSize(7.5)
      .text(c.k, x + 10, y + 7, { width: cardW - 20, characterSpacing: 0.4 });
    doc
      .fillColor(c.accent ? COL_ACCENT : COL_PRIMARY)
      .font("Helvetica-Bold")
      .fontSize(c.accent ? 13 : 11)
      .text(c.v, x + 10, y + 22, { width: cardW - 20 });
  });
  doc.y = y + cardH;
}

function paymentCards(doc, left, W, p) {
  const gap = 12;
  const bankW = W * 0.58 - gap / 2;
  const counterW = W - bankW - gap;
  const y0 = doc.y;
  const cardH = 110;

  drawCard(doc, left, y0, bankW, cardH);
  doc
    .fillColor(COL_PRIMARY)
    .font("Helvetica-Bold")
    .fontSize(8.5)
    .text("BANK TRANSFER (PRIMARY)", left + 10, y0 + 8, {
      characterSpacing: 0.4,
    });
  doc.y = y0 + 24;
  rowKv(doc, left + 10, bankW - 20, "Bank Name", p.bankName);
  rowKv(doc, left + 10, bankW - 20, "Branch", p.bankBranch);
  rowKv(doc, left + 10, bankW - 20, "Account Name", p.bankAccountName);
  rowKv(doc, left + 10, bankW - 20, "Account No.", p.bankAccountNo);
  rowKv(doc, left + 10, bankW - 20, "Reference", p.noticeNumber);
  rowKv(doc, left + 10, bankW - 20, "SWIFT (Int'l)", p.bankSwift);

  // counter / mobile card
  const cX = left + bankW + gap;
  drawCard(doc, cX, y0, counterW, cardH);
  doc
    .fillColor(COL_PRIMARY)
    .font("Helvetica-Bold")
    .fontSize(8.5)
    .text("COUNTER / MOBILE MONEY", cX + 10, y0 + 8, { characterSpacing: 0.4 });
  doc.y = y0 + 24;
  rowKv(doc, cX + 10, counterW - 20, "Office", p.counterOffice);
  rowKv(doc, cX + 10, counterW - 20, "Hours", p.counterHours);
  rowKv(doc, cX + 10, counterW - 20, "M-Pesa Paybill", p.paybillNumber);
  rowKv(doc, cX + 10, counterW - 20, "M-Pesa Account", p.noticeNumber);
  rowKv(doc, cX + 10, counterW - 20, "Receipt", "e-Receipt issued immediately");

  doc.y = y0 + cardH + 6;
}

function drawCard(doc, x, y, w, h) {
  doc.roundedRect(x, y, w, h, 5).fillColor("#FFFFFF").fill();
  doc
    .strokeColor(COL_LINE)
    .lineWidth(0.8)
    .roundedRect(x, y, w, h, 5)
    .stroke();
}

function rowKv(doc, x, w, k, v) {
  const y = doc.y;
  doc
    .fillColor(COL_MUTED)
    .font("Helvetica")
    .fontSize(8.5)
    .text(k, x, y, { width: w * 0.45 });
  doc
    .fillColor("#111827")
    .font("Helvetica-Bold")
    .fontSize(8.5)
    .text(String(v ?? "—"), x + w * 0.45, y, {
      width: w * 0.55,
      align: "right",
    });
  doc.y = y + 12;
}

function officerBlock(doc, left, W, o) {
  const y0 = doc.y;
  const qrSize = 80;
  const textW = W - qrSize - 16;

  doc
    .fillColor(COL_PRIMARY)
    .font("Helvetica-Bold")
    .fontSize(10)
    .text(String(o.officerName).toUpperCase(), left, y0, { width: textW });
  doc
    .fillColor(COL_MUTED)
    .font("Helvetica")
    .fontSize(8.5)
    .text(
      `Officer ID: ${o.officerId}  ·  ${o.officerDesignation}`,
      left,
      doc.y,
      { width: textW },
    );

  // signature line
  const sigY = doc.y + 18;
  doc
    .moveTo(left, sigY)
    .lineTo(left + 220, sigY)
    .lineWidth(0.8)
    .strokeColor(COL_MUTED)
    .stroke();
  doc
    .fillColor(COL_TEXT)
    .font("Helvetica-Oblique")
    .fontSize(9)
    .text("Authorised electronic signature", left, sigY + 3);

  // timestamp + system
  doc
    .fillColor("#4b5563")
    .font("Courier")
    .fontSize(8)
    .text(`Issue timestamp: ${fmtTimestamp(o.issuedDate)}`, left, doc.y + 4);
  doc.text("System: e-Revenue Management System", left, doc.y);

  // QR on the right
  const qrX = left + W - qrSize;
  doc.image(o.qrPng, qrX, y0, { width: qrSize, height: qrSize });
  doc
    .strokeColor(COL_MUTED)
    .lineWidth(0.5)
    .dash(2, { space: 2 })
    .roundedRect(qrX - 6, y0 - 6, qrSize + 12, qrSize + 28, 5)
    .stroke()
    .undash();
  doc
    .fillColor(COL_MUTED)
    .font("Helvetica")
    .fontSize(7)
    .text("Scan to verify", qrX, y0 + qrSize + 4, {
      width: qrSize,
      align: "center",
    });

  doc.y = Math.max(doc.y, y0 + qrSize + 18);
}
