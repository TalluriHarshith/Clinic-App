import { useState } from "react";
import { db, storage, functions } from "../../firebase";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";

export default function LabReportUpload() {
  const [patientId, setPatientId] = useState("");
  const [file, setFile] = useState(null);
  const [msg, setMsg] = useState("");

  const upload = async () => {
    if (!patientId || !file) return setMsg("Patient and file required");
    const allowed = ["application/pdf", "image/png", "image/jpeg"];
    if (!allowed.includes(file.type)) return setMsg("Only PDF/JPG/PNG");
    if (file.size > 10 * 1024 * 1024) return setMsg("Max 10MB");

    const path = `labReports/${patientId}/${Date.now()}-${file.name}`;
    const sRef = ref(storage, path);
    await uploadBytes(sRef, file);
    const downloadUrl = await getDownloadURL(sRef);

    const docRef = await addDoc(collection(db, "labReports"), {
      patientId,
      originalFileName: file.name,
      mimeType: file.type,
      storagePath: path,
      downloadUrl,
      uploadedAt: serverTimestamp(),
      uploadedBy: "reception",
      processingStatus: "uploaded",
      analysisId: null,
      error: null
    });

    const analyze = httpsCallable(functions, "analyzeLabReport");
    await analyze({ reportId: docRef.id });

    setMsg("Uploaded and analysis started");
  };

  return (
    <div>
      <h2>Upload Lab Report</h2>
      <input value={patientId} onChange={(e) => setPatientId(e.target.value)} placeholder="Patient ID" />
      <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
      <button onClick={upload}>Upload + Analyze</button>
      <p>{msg}</p>
    </div>
  );
}