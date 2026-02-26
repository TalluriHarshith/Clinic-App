const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { GoogleGenerativeAI } = require("@google/generative-ai");

admin.initializeApp();

const db = admin.firestore();

exports.analyzeLabReport = functions.https.onCall(async (data, _context) => {
  const { reportId } = data || {};
  if (!reportId) throw new functions.https.HttpsError("invalid-argument", "reportId required");

  const reportRef = db.collection("labReports").doc(reportId);
  const reportSnap = await reportRef.get();
  if (!reportSnap.exists) throw new functions.https.HttpsError("not-found", "Report not found");

  const report = reportSnap.data();
  await reportRef.update({ processingStatus: "processing", error: null });

  try {
    const geminiKey = functions.config().gemini?.key;
    if (!geminiKey) {
      throw new Error('Gemini key not set. Run: firebase functions:config:set gemini.key="YOUR_KEY"');
    }

    const genAI = new GoogleGenerativeAI(geminiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });

    const currentReportText = report.extractedText || `Report file: ${report.originalFileName}`;

    const prevSnap = await db
      .collection("analyses")
      .where("patientId", "==", report.patientId)
      .orderBy("createdAt", "desc")
      .limit(5)
      .get();

    const history = prevSnap.docs.map((d) => {
      const x = d.data();
      return { date: x.createdAt?.toDate?.()?.toISOString?.() || "", summary: x.doctorSummary || "" };
    });

    const prompt = `
Return STRICT JSON only with keys:
currentFindings, historicalTrends, criticalAlerts, doctorSummary, followUpSuggestions, confidenceNotes.
Assist doctor quick review; do NOT provide definitive diagnosis.

Current report:
${currentReportText}

Historical context:
${JSON.stringify(history)}
`;

    const resp = await model.generateContent(prompt);
    const raw = resp.response.text().trim().replace(/^```json/, "").replace(/```$/, "");
    const parsed = JSON.parse(raw);

    const analysisRef = db.collection("analyses").doc();
    await analysisRef.set({
      patientId: report.patientId,
      reportId,
      model: "gemini-1.5-pro",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      currentFindings: parsed.currentFindings || [],
      historicalTrends: parsed.historicalTrends || [],
      criticalAlerts: parsed.criticalAlerts || [],
      doctorSummary: parsed.doctorSummary || "",
      followUpSuggestions: parsed.followUpSuggestions || [],
      confidenceNotes: parsed.confidenceNotes || "",
      rawModelOutput: raw
    });

    await reportRef.update({
      processingStatus: "completed",
      analysisId: analysisRef.id
    });

    return { ok: true, analysisId: analysisRef.id };
  } catch (e) {
    await reportRef.update({ processingStatus: "failed", error: e.message || "analysis failed" });
    throw new functions.https.HttpsError("internal", e.message || "analysis failed");
  }
});