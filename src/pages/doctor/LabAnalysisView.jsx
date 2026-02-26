import { useEffect, useState } from "react";
import { db } from "../../firebase";
import { collection, query, where, onSnapshot, doc, getDoc } from "firebase/firestore";

export default function LabAnalysisView({ patientId }) {
  const [reports, setReports] = useState([]);
  const [analysis, setAnalysis] = useState(null);

  useEffect(() => {
    const q = query(collection(db, "labReports"), where("patientId", "==", patientId));
    return onSnapshot(q, (snap) => {
      setReports(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
  }, [patientId]);

  const openAnalysis = async (analysisId) => {
    if (!analysisId) return;
    const s = await getDoc(doc(db, "analyses", analysisId));
    if (s.exists()) setAnalysis(s.data());
  };

  return (
    <div>
      <h2>Patient Lab Analyses</h2>
      {reports.map((r) => (
        <div key={r.id} style={{ border: "1px solid #ddd", margin: 8, padding: 8 }}>
          <div>{r.originalFileName}</div>
          <div>Status: {r.processingStatus}</div>
          <button disabled={!r.analysisId} onClick={() => openAnalysis(r.analysisId)}>View Analysis</button>
        </div>
      ))}

      {analysis && (
        <div>
          <h3>Doctor Summary</h3>
          <p>{analysis.doctorSummary}</p>
          <h4>Critical Alerts</h4>
          <ul>{(analysis.criticalAlerts || []).map((x, i) => <li key={i}>{x}</li>)}</ul>
          <h4>Current Findings</h4>
          <ul>{(analysis.currentFindings || []).map((x, i) => <li key={i}>{x}</li>)}</ul>
          <h4>Historical Trends</h4>
          <ul>{(analysis.historicalTrends || []).map((x, i) => <li key={i}>{x}</li>)}</ul>
        </div>
      )}
    </div>
  );
}