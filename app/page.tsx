"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import QRCode from "qrcode";
import * as XLSX from "xlsx";
import {
  Camera,
  Check,
  ChevronRight,
  Download,
  FileSpreadsheet,
  Leaf,
  LocateFixed,
  MapPin,
  Move3d,
  RotateCcw,
  Save,
  School,
  ShieldCheck,
  Sparkles,
  Trees,
  Upload,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { sampleFileName, sampleSchoolName, sampleTreeReferences } from "@/lib/sample-tree-data";
import type { TreeReference } from "@/lib/tree-types";

type PermissionState = "idle" | "requesting" | "granted" | "partial" | "denied";
type LocationState = "idle" | "locating" | "ready" | "error";
type StepId = 1 | 2 | 3 | 4 | 5;

type SpeciesCandidate = {
  name: string;
  confidence: number;
  reason: string;
};

type SurveyRecord = {
  id: string;
  schoolName: string;
  observedAt: string;
  latitude?: number;
  longitude?: number;
  selectedTreeId?: string;
  confirmedSpecies: string;
  dbhCm: number;
  heightM?: number;
  estimatedCo2Kg: number;
  note: string;
};

const storageKey = "treecarbon-edu-records-v1";
const remoteAppUrl = "https://tree-carbon-edu.hsiehpangg.chatgpt.site";

const steps: { id: StepId; label: string }[] = [
  { id: 1, label: "準備" },
  { id: 2, label: "AI 辨識" },
  { id: 3, label: "確認樹種" },
  { id: 4, label: "量測" },
  { id: 5, label: "成果" },
];

const sampleCandidates: SpeciesCandidate[] = [
  { name: "樟樹", confidence: 0.82, reason: "葉形、校園常見樹種與清冊資料相符" },
  { name: "榕樹", confidence: 0.67, reason: "樹冠與枝幹型態相近，需由教師確認" },
  { name: "黑板樹", confidence: 0.54, reason: "高度與葉片排列可能吻合" },
];

export default function Home() {
  const [step, setStep] = useState<StepId>(1);
  const [permission, setPermission] = useState<PermissionState>("idle");
  const [cameraReady, setCameraReady] = useState(false);
  const [motionReady, setMotionReady] = useState(false);
  const [motionMessage, setMotionMessage] = useState("尚未檢查");
  const [location, setLocation] = useState<LocationState>("idle");
  const [schoolName, setSchoolName] = useState(sampleSchoolName);
  const [schoolConfirmed, setSchoolConfirmed] = useState(false);
  const [coords, setCoords] = useState<{ lat?: number; lng?: number }>({});
  const [fileName, setFileName] = useState(sampleFileName);
  const [treeRows, setTreeRows] = useState<TreeReference[]>(sampleTreeReferences);
  const [usingSampleData, setUsingSampleData] = useState(true);
  const [uploadError, setUploadError] = useState("");
  const [cameraActive, setCameraActive] = useState(false);
  const [aiRunning, setAiRunning] = useState(false);
  const [candidates, setCandidates] = useState<SpeciesCandidate[]>([]);
  const [confirmedSpecies, setConfirmedSpecies] = useState(sampleTreeReferences[0]?.speciesCommonName ?? "");
  const [selectedTreeId, setSelectedTreeId] = useState(sampleTreeReferences[0]?.sourceId ?? "");
  const [dbhCm, setDbhCm] = useState(sampleTreeReferences[0]?.dbhCm ? String(sampleTreeReferences[0].dbhCm) : "");
  const [heightM, setHeightM] = useState(sampleTreeReferences[0]?.heightM ? String(sampleTreeReferences[0].heightM) : "");
  const [note, setNote] = useState("");
  const [remoteQrCode, setRemoteQrCode] = useState("");
  const [records, setRecords] = useState<SurveyRecord[]>(() => {
    if (typeof window === "undefined") return [];
    const raw = window.localStorage.getItem(storageKey);
    return raw ? JSON.parse(raw) : [];
  });
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(records));
  }, [records]);

  useEffect(() => {
    QRCode.toDataURL(remoteAppUrl, {
      errorCorrectionLevel: "M",
      margin: 1,
      scale: 7,
      color: {
        dark: "#203a30",
        light: "#ffffff",
      },
    }).then(setRemoteQrCode);
  }, []);

  const readiness = useMemo(
    () => [cameraReady || motionReady, schoolConfirmed, treeRows.length > 0],
    [cameraReady, motionReady, schoolConfirmed, treeRows.length],
  );
  const speciesSummary = useMemo(() => {
    const counts = new Map<string, number>();
    for (const tree of treeRows) {
      if (!tree.speciesCommonName) continue;
      counts.set(tree.speciesCommonName, (counts.get(tree.speciesCommonName) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-Hant"));
  }, [treeRows]);
  const readyCount = readiness.filter(Boolean).length;
  const canStartAI = readyCount === 3;

  const selectedTree = treeRows.find((tree) => tree.sourceId === selectedTreeId);
  const carbon = estimateCo2(Number(dbhCm), Number(heightM));

  async function requestPermissions() {
    setPermission("requesting");
    setMotionMessage("請允許動作與方向感測，並輕輕晃動裝置");

    const motionOK = await requestMotionPermissionAndVerify();
    setMotionReady(motionOK);
    setMotionMessage(motionOK ? "已收到感測資料" : "未收到感測資料，請確認 Safari 已允許動作與方向取用");

    let cameraOK = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      stream.getTracks().forEach((track) => track.stop());
      cameraOK = true;
    } catch {
      cameraOK = false;
    }
    setCameraReady(cameraOK);

    setPermission(cameraOK && motionOK ? "granted" : cameraOK || motionOK ? "partial" : "denied");
  }

  function requestLocation() {
    setLocation("locating");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCoords({ lat: position.coords.latitude, lng: position.coords.longitude });
        setLocation("ready");
      },
      () => setLocation("error"),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setUploadError("");

    try {
      const rows = /\.(xlsx|xls)$/i.test(file.name) ? await readXlsx(file) : await readDelimited(file);
      const normalized = normalizeRows(rows);
      setTreeRows(normalized);
      setUsingSampleData(false);
      setSelectedTreeId(normalized[0]?.sourceId ?? "");
      setConfirmedSpecies(normalized[0]?.speciesCommonName ?? "");
      if (normalized[0]?.dbhCm) setDbhCm(String(normalized[0].dbhCm));
      if (normalized[0]?.heightM) setHeightM(String(normalized[0].heightM));
      if (normalized.length === 0) setUploadError("檔案中沒有可辨識的樹木資料，請確認第一列是欄位名稱。");
    } catch {
      setTreeRows([]);
      setUploadError("讀取失敗，請上傳 .csv、.tsv、.xlsx 或 .xls 檔案。");
    }
  }

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraActive(true);
    } catch {
      setCameraActive(false);
    }
  }

  async function runMockAI() {
    setAiRunning(true);
    await new Promise((resolve) => setTimeout(resolve, 900));
    const campusSpecies = treeRows.map((tree) => tree.speciesCommonName).filter(Boolean);
    const ranked = campusSpecies.length
      ? campusSpecies.slice(0, 3).map((name, index) => ({
          name,
          confidence: [0.86, 0.69, 0.53][index] ?? 0.48,
          reason: index === 0 ? "此樹種存在於已上傳校園清冊，且位置最接近。" : "清冊中有相近紀錄，建議現場比對葉片與樹皮。",
        }))
      : sampleCandidates;
    setCandidates(ranked);
    setConfirmedSpecies(ranked[0]?.name ?? "");
    setAiRunning(false);
    setStep(3);
  }

  function saveRecord() {
    if (!confirmedSpecies || !Number(dbhCm)) return;
    const record: SurveyRecord = {
      id: crypto.randomUUID(),
      schoolName,
      observedAt: new Date().toISOString(),
      latitude: coords.lat,
      longitude: coords.lng,
      selectedTreeId,
      confirmedSpecies,
      dbhCm: Number(dbhCm),
      heightM: Number(heightM) || undefined,
      estimatedCo2Kg: carbon,
      note,
    };
    setRecords((current) => [record, ...current]);
    setStep(5);
  }

  function exportRecords(kind: "json" | "csv") {
    const payload =
      kind === "json"
        ? JSON.stringify(records, null, 2)
        : Papa.unparse(records.map((record) => ({ ...record, latitude: record.latitude ?? "", longitude: record.longitude ?? "" })));
    const blob = new Blob([payload], { type: kind === "json" ? "application/json" : "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `treecarbon-edu-${new Date().toISOString().slice(0, 10)}.${kind}`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function resetSurvey() {
    setCameraActive(false);
    setCandidates([]);
    setConfirmedSpecies(selectedTree?.speciesCommonName ?? "");
    setDbhCm(selectedTree?.dbhCm ? String(selectedTree.dbhCm) : "");
    setHeightM(selectedTree?.heightM ? String(selectedTree.heightM) : "");
    setNote("");
    setStep(2);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <Trees />
          </span>
          <div>
            <strong>TreeCarbon EDU</strong>
            <small>校園樹木碳匯調查</small>
          </div>
        </div>
        <Badge variant="outline" className="device-badge">iPad / 手機現場版</Badge>
      </header>

      <nav className="stepper" aria-label="調查流程">
        {steps.map((item) => (
          <button key={item.id} className={`step ${item.id === step ? "active" : ""} ${item.id < step ? "complete" : ""}`} onClick={() => setStep(item.id)}>
            <span>{item.id < step ? <Check /> : item.id}</span>
            <b>{item.label}</b>
          </button>
        ))}
      </nav>

      <div className="content-wrap">
        {step === 1 && (
          <>
            <section className="intro-row">
              <div>
                <p className="eyebrow">上課前檢查</p>
                <h1 className="page-title">先完成權限、定位與手動上傳清冊</h1>
                <p className="page-lead">
                  這個版本不會預載學校資料。請在 iPad 或手機現場手動上傳校園樹木清冊，再進入拍照辨識、胸徑量測與碳匯估算。
                </p>
              </div>
              <div className="intro-side">
                <div className="readiness-card">
                  <span>完成狀態</span>
                  <strong>{readyCount} / 3</strong>
                  <Progress value={(readyCount / 3) * 100} />
                </div>
                <div className="qr-card">
                  <span>手機 / iPad 掃描登入</span>
                  {remoteQrCode ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={remoteQrCode} alt="TreeCarbon EDU 遠端 webapp QR Code" />
                  ) : (
                    <div className="qr-placeholder" />
                  )}
                  <a href={remoteAppUrl} target="_blank" rel="noreferrer">{remoteAppUrl.replace("https://", "")}</a>
                </div>
              </div>
            </section>

            <section className="setup-grid">
              <SetupPanel icon={<Move3d />} title="裝置權限" done={readiness[0]}>
                <p>開啟相機與動作感測，讓學生能在戶外用後鏡頭拍攝樹木。iOS 會跳出授權視窗。</p>
                <StatusLine label="相機" ok={cameraReady} />
                <StatusLine label="動作感測" ok={motionReady} detail={motionMessage} />
                <Button className="panel-action" onClick={requestPermissions} disabled={permission === "requesting"}>
                  <ShieldCheck /> {permission === "requesting" ? "正在要求權限" : "檢查裝置權限"}
                </Button>
              </SetupPanel>

              <SetupPanel icon={<School />} title="學校與定位" done={readiness[1]}>
                <label className="field-label" htmlFor="schoolName">學校名稱</label>
                <Input id="schoolName" value={schoolName} onChange={(event) => setSchoolName(event.target.value)} />
                <div className="location-box">
                  <MapPin />
                  <div>
                    <strong>{location === "ready" ? "已取得定位" : "尚未取得定位"}</strong>
                    <span>{coords.lat && coords.lng ? `${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}` : "請在校園現場取得目前位置"}</span>
                  </div>
                </div>
                {location === "error" && <p className="warning">定位失敗，請確認 Safari/瀏覽器允許位置權限。</p>}
                <div className="dual-actions">
                  <Button variant="outline" onClick={requestLocation} disabled={location === "locating"}>
                    <LocateFixed /> {location === "locating" ? "定位中" : "取得定位"}
                  </Button>
                  <Button onClick={() => setSchoolConfirmed(true)} disabled={!schoolName.trim()}>
                    <Check /> 確認
                  </Button>
                </div>
              </SetupPanel>

              <SetupPanel icon={<FileSpreadsheet />} title="上傳清冊" done={readiness[2]}>
                <p>支援 CSV、TSV、XLSX。欄位可使用「樹木編號、樹木種類、分類、樹高、胸徑、位置、座標」等常見中文名稱。</p>
                <label className="upload-zone">
                  <Upload />
                  <strong>{fileName || "選擇校園樹木資料檔"}</strong>
                  <span>正式使用時必須由使用者手動上傳</span>
                  <input type="file" accept=".csv,.tsv,.xlsx,.xls" onChange={handleUpload} />
                </label>
                {uploadError && <p className="warning">{uploadError}</p>}
                {usingSampleData && <p className="sample-note">目前先使用內建範本資料。正式調查時，請在這裡手動上傳本校最新清冊。</p>}
                {treeRows.length > 0 && (
                  <div className="tree-summary">
                    <p className="success">{usingSampleData ? "已載入範本" : "已匯入"} {treeRows.length} 筆樹木資料，包含 {speciesSummary.length} 種樹木類型。</p>
                    <div className="species-chips">
                      {speciesSummary.slice(0, 12).map((item) => (
                        <span key={item.name}>{item.name}<b>{item.count}</b></span>
                      ))}
                    </div>
                  </div>
                )}
              </SetupPanel>
            </section>

            <section className="next-panel">
              <div>
                <span className={`lock-dot ${canStartAI ? "ready" : ""}`}>{canStartAI ? <Check /> : readyCount}</span>
                <div>
                  <strong>{canStartAI ? "準備完成" : `還有 ${3 - readyCount} 項未完成`}</strong>
                  <p>完成三項檢查後，才能進入 AI 拍照辨識。</p>
                </div>
              </div>
              <Button size="lg" disabled={!canStartAI} onClick={() => setStep(2)}>
                前往 AI 辨識 <ChevronRight />
              </Button>
            </section>
          </>
        )}

        {step === 2 && (
          <section className="recognition-grid">
            <div>
              <p className="eyebrow">步驟 2</p>
              <h1 className="page-title">拍攝樹冠、樹皮與葉片</h1>
              <p className="page-lead">V1 使用 mock AI，不會外傳照片或使用 API key。系統會優先參考你剛上傳的校園清冊產生 Top 3 候選。</p>
              <div className="camera-stage">
                <video ref={videoRef} playsInline muted className={cameraActive ? "camera-video" : "hidden"} />
                {!cameraActive && (
                  <div className="camera-placeholder">
                    <div className="focus-frame"><Leaf /></div>
                    <strong>尚未開啟相機</strong>
                    <span>請讓樹木佔畫面中央，避免逆光。</span>
                  </div>
                )}
                <Badge className="camera-badge"><MapPin /> 清冊 {treeRows.length} 筆</Badge>
                <div className="camera-actions">
                  <Button variant="secondary" onClick={startCamera}><Camera /> 開啟相機</Button>
                  <Button onClick={runMockAI} disabled={aiRunning}><Sparkles /> {aiRunning ? "辨識中" : "模擬 AI 辨識"}</Button>
                </div>
              </div>
            </div>
            <aside className="guide-panel">
              <Sparkles />
              <h2>辨識不是最終答案</h2>
              <p>AI 只提供候選樹種。請學生觀察葉形、樹皮、樹高與清冊位置，再由學生或教師確認。</p>
              <div className="mini-list">
                <span>拍攝葉片近照</span>
                <span>拍攝樹幹紋理</span>
                <span>比對清冊樹種</span>
              </div>
            </aside>
          </section>
        )}

        {step === 3 && (
          <section className="work-grid">
            <div>
              <p className="eyebrow">步驟 3</p>
              <h1 className="page-title">確認這棵樹是哪一種</h1>
              <div className="candidate-list">
                {(candidates.length ? candidates : sampleCandidates).map((candidate) => (
                  <button
                    key={candidate.name}
                    className={`candidate ${confirmedSpecies === candidate.name ? "selected" : ""}`}
                    onClick={() => setConfirmedSpecies(candidate.name)}
                  >
                    <span>{Math.round(candidate.confidence * 100)}%</span>
                    <div>
                      <strong>{candidate.name}</strong>
                      <p>{candidate.reason}</p>
                    </div>
                    {confirmedSpecies === candidate.name && <Check />}
                  </button>
                ))}
              </div>
            </div>
            <aside className="form-panel">
              <label className="field-label" htmlFor="treeSelect">對應清冊紀錄</label>
              <select id="treeSelect" value={selectedTreeId} onChange={(event) => setSelectedTreeId(event.target.value)}>
                {treeRows.map((tree) => (
                  <option key={tree.sourceId} value={tree.sourceId}>
                    {tree.sourceId} {tree.speciesCommonName ? `- ${tree.speciesCommonName}` : ""}
                  </option>
                ))}
              </select>
              <label className="field-label" htmlFor="confirmedSpecies">確認樹種</label>
              <Input id="confirmedSpecies" value={confirmedSpecies} onChange={(event) => setConfirmedSpecies(event.target.value)} />
              <Button size="lg" onClick={() => setStep(4)} disabled={!confirmedSpecies.trim()}>
                進入量測 <ChevronRight />
              </Button>
            </aside>
          </section>
        )}

        {step === 4 && (
          <section className="work-grid">
            <div>
              <p className="eyebrow">步驟 4</p>
              <h1 className="page-title">在離地 1.3 m 測量胸徑</h1>
              <p className="page-lead">若現場量的是樹圍，請先用「樹圍 ÷ π」換算為胸徑 DBH。輸入範圍建議 1 到 300 cm。</p>
              <div className="measure-card">
                <label className="field-label" htmlFor="dbh">胸徑 DBH（cm）</label>
                <Input id="dbh" inputMode="decimal" value={dbhCm} onChange={(event) => setDbhCm(event.target.value)} placeholder="例如 26.5" />
                <label className="field-label" htmlFor="height">樹高（m，可選）</label>
                <Input id="height" inputMode="decimal" value={heightM} onChange={(event) => setHeightM(event.target.value)} placeholder="例如 8.2" />
                <label className="field-label" htmlFor="note">觀察備註</label>
                <textarea id="note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="葉片、樹皮、位置或學生觀察紀錄" />
              </div>
            </div>
            <aside className="result-panel">
              <span>預估 CO₂ 固存量</span>
              <strong>{carbon ? carbon.toFixed(1) : "0.0"} kg</strong>
              <p>採用教學用簡化估算：胸徑與樹高推估生物量，再轉為 CO₂ 當量。正式研究請改接校方核定公式。</p>
              <Button size="lg" onClick={saveRecord} disabled={!confirmedSpecies || !Number(dbhCm)}>
                <Save /> 儲存本筆紀錄
              </Button>
            </aside>
          </section>
        )}

        {step === 5 && (
          <section>
            <div className="intro-row">
              <div>
                <p className="eyebrow">步驟 5</p>
                <h1 className="page-title">本機成果與匯出</h1>
                <p className="page-lead">紀錄先存在這台裝置的瀏覽器中，可匯出 CSV 或 JSON，之後再交給教師彙整。</p>
              </div>
              <div className="export-actions">
                <Button variant="outline" onClick={() => exportRecords("csv")} disabled={records.length === 0}><Download /> CSV</Button>
                <Button variant="outline" onClick={() => exportRecords("json")} disabled={records.length === 0}><Download /> JSON</Button>
                <Button onClick={resetSurvey}><RotateCcw /> 新增下一棵</Button>
              </div>
            </div>
            <div className="record-list">
              {records.map((record) => (
                <article key={record.id} className="record-row">
                  <div>
                    <strong>{record.confirmedSpecies}</strong>
                    <span>{new Date(record.observedAt).toLocaleString("zh-TW")}</span>
                  </div>
                  <b>{record.dbhCm} cm</b>
                  <b>{record.estimatedCo2Kg.toFixed(1)} kg CO₂</b>
                </article>
              ))}
              {records.length === 0 && <p className="empty">尚未儲存任何調查紀錄。</p>}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

function SetupPanel({ icon, title, done, children }: { icon: React.ReactNode; title: string; done: boolean; children: React.ReactNode }) {
  return (
    <article className={`setup-panel ${done ? "done" : ""}`}>
      <div className="panel-heading">
        <span>{icon}</span>
        <h2>{title}</h2>
        {done && <Check />}
      </div>
      {children}
    </article>
  );
}

function StatusLine({ label, ok, detail }: { label: string; ok: boolean; detail?: string }) {
  return (
    <div className="status-line">
      <span>
        {label}
        {detail && <small>{detail}</small>}
      </span>
      <em className={ok ? "ok" : ""}>{ok ? "已就緒" : "待授權"}</em>
    </div>
  );
}

async function requestMotionPermissionAndVerify() {
  if (!("DeviceMotionEvent" in window) && !("DeviceOrientationEvent" in window)) return false;

  const motionPermission = await requestIosSensorPermission("DeviceMotionEvent");
  const orientationPermission = await requestIosSensorPermission("DeviceOrientationEvent");
  if (motionPermission === "denied" || orientationPermission === "denied") return false;

  return new Promise<boolean>((resolve) => {
    let resolved = false;
    const finish = (value: boolean) => {
      if (resolved) return;
      resolved = true;
      window.removeEventListener("devicemotion", onMotion);
      window.removeEventListener("deviceorientation", onOrientation);
      resolve(value);
    };
    const onMotion = (event: DeviceMotionEvent) => {
      const acceleration = event.accelerationIncludingGravity;
      if (acceleration && [acceleration.x, acceleration.y, acceleration.z].some((value) => typeof value === "number")) finish(true);
    };
    const onOrientation = (event: DeviceOrientationEvent) => {
      if ([event.alpha, event.beta, event.gamma].some((value) => typeof value === "number")) finish(true);
    };

    window.addEventListener("devicemotion", onMotion, { once: false });
    window.addEventListener("deviceorientation", onOrientation, { once: false });
    window.setTimeout(() => finish(false), 2500);
  });
}

async function requestIosSensorPermission(eventName: "DeviceMotionEvent" | "DeviceOrientationEvent") {
  const sensorEvent = window[eventName] as
    | {
        requestPermission?: () => Promise<"granted" | "denied">;
      }
    | undefined;
  if (!sensorEvent?.requestPermission) return "granted";

  try {
    return await sensorEvent.requestPermission();
  } catch {
    return "denied";
  }
}

async function readDelimited(file: File): Promise<Record<string, unknown>[]> {
  const text = await file.text();
  const parsed = Papa.parse<Record<string, unknown>>(text, {
    header: true,
    skipEmptyLines: true,
    delimiter: file.name.endsWith(".tsv") ? "\t" : "",
  });
  return parsed.data;
}

async function readXlsx(file: File): Promise<Record<string, unknown>[]> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", bookFiles: true, sheetStubs: true });
  const sheetName = pickTreeSheetName(workbook);
  const sheet = workbook.Sheets[sheetName];
  repairSheetRange(sheet);
  const rows = matrixToTreeRows(XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" }));
  return rows.length > 0 ? rows : readBrokenDimensionSheet(workbook, workbook.SheetNames.indexOf(sheetName));
}

function pickTreeSheetName(workbook: XLSX.WorkBook) {
  return (
    workbook.SheetNames.find((name) => name.includes("樹木列表")) ??
    workbook.SheetNames.find((name) => name.includes("樹木")) ??
    workbook.SheetNames[1] ??
    workbook.SheetNames[0]
  );
}

function repairSheetRange(sheet: XLSX.WorkSheet) {
  const cells = Object.keys(sheet).filter((key) => !key.startsWith("!"));
  if (cells.length === 0) return;

  const range = cells.reduce(
    (current, cell) => {
      const decoded = XLSX.utils.decode_cell(cell);
      return {
        minColumn: Math.min(current.minColumn, decoded.c),
        minRow: Math.min(current.minRow, decoded.r),
        maxColumn: Math.max(current.maxColumn, decoded.c),
        maxRow: Math.max(current.maxRow, decoded.r),
      };
    },
    { minColumn: Infinity, minRow: Infinity, maxColumn: 0, maxRow: 0 },
  );

  sheet["!ref"] = XLSX.utils.encode_range({
    s: { c: range.minColumn, r: range.minRow },
    e: { c: range.maxColumn, r: range.maxRow },
  });
}

function readBrokenDimensionSheet(workbook: XLSX.WorkBook, sheetIndex: number): Record<string, unknown>[] {
  const files = (workbook as XLSX.WorkBook & { files?: Record<string, { content?: Uint8Array } | string> }).files;
  const sheetFile = files?.[`xl/worksheets/sheet${sheetIndex + 1}.xml`];
  if (!sheetFile) return [];

  const decoder = new TextDecoder();
  const sheetXml = typeof sheetFile === "string" ? sheetFile : decoder.decode(sheetFile.content);
  const sharedStrings = readSharedStrings(files, decoder);
  const documentXml = new DOMParser().parseFromString(sheetXml, "application/xml");
  const rows = [...documentXml.getElementsByTagName("row")].map((row) => {
    const cells = [...row.getElementsByTagName("c")];
    const values: string[] = [];
    for (const cell of cells) {
      const address = cell.getAttribute("r");
      if (!address) continue;
      values[XLSX.utils.decode_cell(address).c] = readCellValue(cell, sharedStrings);
    }
    return values;
  });

  return matrixToTreeRows(rows);
}

function readSharedStrings(files: Record<string, { content?: Uint8Array } | string> | undefined, decoder: TextDecoder) {
  const sharedFile = files?.["xl/sharedStrings.xml"];
  if (!sharedFile) return [];

  const sharedXml = typeof sharedFile === "string" ? sharedFile : decoder.decode(sharedFile.content);
  const documentXml = new DOMParser().parseFromString(sharedXml, "application/xml");
  return [...documentXml.getElementsByTagName("si")].map((item) =>
    [...item.getElementsByTagName("t")].map((text) => text.textContent ?? "").join(""),
  );
}

function readCellValue(cell: Element, sharedStrings: string[]) {
  const rawValue = cell.getElementsByTagName("v")[0]?.textContent ?? "";
  if (cell.getAttribute("t") === "s") return sharedStrings[Number(rawValue)] ?? "";
  return rawValue;
}

function matrixToTreeRows(rows: unknown[][]): Record<string, unknown>[] {
  return rows
    .slice(1)
    .filter((row) => row[1] || row[2])
    .map((row, index) => ({
      sourceId: String(row[0] || `tree-${index + 1}`),
      speciesCommonName: String(row[1] || "").trim(),
      category: String(row[2] || "").trim(),
      heightM: row[3],
      dbhCm: row[4],
      storedCo2Kg: row[5],
    }));
}

function normalizeRows(rows: Record<string, unknown>[]): TreeReference[] {
  return rows
    .map((row, index) => {
      const value = (keys: string[]) => findValue(row, keys);
      const sourceId = value(["sourceId", "id", "樹木編號", "編號", "樹號"]) || `tree-${index + 1}`;
      const speciesCommonName = value(["speciesCommonName", "species", "樹木種類", "樹種", "中文名", "名稱"]);
      const category = value(["分類", "category"]);
      return {
        sourceId,
        speciesCommonName,
        category,
        locationText: value(["位置", "地點", "locationText", "備註"]),
        latitude: toNumber(value(["latitude", "lat", "緯度"])),
        longitude: toNumber(value(["longitude", "lng", "lon", "經度"])),
        heightM: toNumber(value(["heightM", "樹高", "樹高(必填)", "高度"])),
        dbhCm: toNumber(value(["dbhCm", "胸徑", "胸徑(必填)", "DBH"])),
        storedCo2Kg: toNumber(value(["總固碳量估算", "總固碳量估算(kg CO2e)", "co2", "CO2e"])),
      };
    })
    .filter((row) => row.speciesCommonName || row.category);
}

function findValue(row: Record<string, unknown>, keys: string[]) {
  const entries = Object.entries(row);
  for (const key of keys) {
    const found = entries.find(([name]) => normalizeKey(name).includes(normalizeKey(key)));
    if (found && String(found[1]).trim()) return String(found[1]).trim();
  }
  return "";
}

function normalizeKey(key: string) {
  return key.toLowerCase().replace(/[\s()（）_-]/g, "");
}

function toNumber(value: string) {
  const parsed = Number(String(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function estimateCo2(dbhCm: number, heightM: number) {
  if (!dbhCm || dbhCm < 1 || dbhCm > 300) return 0;
  const safeHeight = heightM && heightM > 0 ? heightM : 8;
  const biomassKg = 0.08 * dbhCm * dbhCm * safeHeight;
  return biomassKg * 0.47 * 3.67;
}
