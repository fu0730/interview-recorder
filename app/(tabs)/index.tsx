import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from "expo-av";
import * as FileSystem from "expo-file-system/legacy";
import * as Speech from "expo-speech";
import { useRef, useState, useEffect } from "react";
import { Alert, Button, Text, View } from "react-native";
import { BASE_QUESTIONS } from "../../constants/questions";

export default function Home() {
  const recordingRef = useRef<Audio.Recording | null>(null);
  const [uri, setUri] = useState<string | null>(null);
  const [status, setStatus] = useState("待機中");
  const [started, setStarted] = useState(false);
  const [qIndex, setQIndex] = useState(0);

  const [isRecording, setIsRecording] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [secs, setSecs] = useState(0);
  const autoStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const MAX_REC_SEC = 90;

  // 録音中の経過秒数カウント
  useEffect(() => {
    let t: ReturnType<typeof setInterval> | null = null;
    if (isRecording) {
      t = setInterval(() => setSecs((s) => s + 1), 1000);
    } else {
      setSecs(0);
    }
    return () => {
      if (t) clearInterval(t);
    };
  }, [isRecording]);

  const makeFollowup = async (base: string, answer: string) => {
    setStatus("深掘り生成中…");
    const r = await fetch(`${API_BASE}/api/followup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base, answer }),
    });
    if (!r.ok) throw new Error(await r.text());
    const d = await r.json();
    return (d.question as string) || "もう少し具体的に教えてください。";
  };

  const speakTextAndRecord = async (text: string) => {
    setStatus("質問を読み上げ中…");
    await new Promise<void>((resolve) => {
      Speech.speak(text, { language: "ja-JP", rate: 1.0, onDone: resolve });
    });
    setStatus("録音中…（最大90秒）");
    await start();
  };
  const speakAndRecord = async () => {
    try {
      const text = BASE_QUESTIONS[qIndex]?.text ?? "";
      if (!text) return;
      setStatus("質問を読み上げ中…");
      await new Promise<void>((resolve) => {
        Speech.speak(text, { language: "ja-JP", rate: 1.0, onDone: resolve });
      });
      // 読み上げ後に自動で録音開始
      await start();
    } catch (e: any) {
      Alert.alert("読み上げエラー", e?.message ?? String(e));
    }
  };

  const API_BASE = "https://whisper-proxy-bcxn.vercel.app"; // Vercelにデプロイした中継APIのベースURL（https必須）

  const start = async () => {
    try {
      setStatus("権限確認中…");
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("マイク権限が必要です");
        return;
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        interruptionModeIOS: InterruptionModeIOS.DoNotMix,
        interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
      });

      setIsRecording(true);

      const rec = new Audio.Recording();
      await rec.prepareToRecordAsync({
        // Cross‑platform: m4a(AAC) 44.1kHz / 128kbps
        android: {
          extension: ".m4a",
          outputFormat: Audio.AndroidOutputFormat.MPEG_4,
          audioEncoder: Audio.AndroidAudioEncoder.AAC,
          sampleRate: 44100,
          numberOfChannels: 1,
          bitRate: 128000,
        },
        ios: {
          // Use m4a(AAC) instead of CAF/PCM for Whisper互換 & 小さめサイズ
          extension: ".m4a",
          audioQuality: Audio.IOSAudioQuality.HIGH,
          sampleRate: 44100,
          numberOfChannels: 1,
          bitRate: 128000,
          // linearPCM系は使わない（CAF/PCMになり容量↑）
        },
        web: {
          // Expo WebはMediaRecorderを利用（参考設定）
          mimeType: "audio/webm",
          bitsPerSecond: 128000,
        },
      });
      await rec.startAsync();

      // 自動停止（MAX_REC_SEC）
      if (autoStopTimerRef.current) clearTimeout(autoStopTimerRef.current);
      autoStopTimerRef.current = setTimeout(() => {
        if (recordingRef.current) {
          stop(); // 停止後は自動でアップロードされる
        }
      }, MAX_REC_SEC * 1000);

      recordingRef.current = rec;
      setStatus("録音中…");
    } catch (e: any) {
      Alert.alert("録音開始エラー", e?.message ?? String(e));
    }
  };

  const stop = async () => {
    try {
      if (autoStopTimerRef.current) {
        clearTimeout(autoStopTimerRef.current);
        autoStopTimerRef.current = null;
      }
      const rec = recordingRef.current;
      if (!rec) return;
      setStatus("停止処理中…");
      await rec.stopAndUnloadAsync();
      const localUri = rec.getURI();
      const fileUri = localUri ?? null;
      setUri(fileUri);
      recordingRef.current = null;
      setIsRecording(false);
      setStatus("録音完了");
      if (fileUri) {
        await upload(fileUri); // 停止後に自動送信
      }
    } catch (e: any) {
      Alert.alert("停止エラー", e?.message ?? String(e));
    }
  };

  const play = async () => {
    try {
      if (!uri) return;
      const { sound } = await Audio.Sound.createAsync({ uri });
      await sound.playAsync();
    } catch (e: any) {
      Alert.alert("再生エラー", e?.message ?? String(e));
    }
  };

  const upload = async (fileUri?: string) => {
    const targetUri = fileUri ?? uri;
    if (!targetUri) return;
    try {
      setIsUploading(true);
      setStatus("アップロード中…");

      const res = await FileSystem.uploadAsync(
        `${API_BASE}/api/transcribe`,
        targetUri,
        {
          httpMethod: "POST",
          // @ts-ignore Expo SDK variations: FileSystemUploadType may be on the default export
          uploadType: (FileSystem as any).FileSystemUploadType?.MULTIPART ?? 1,
          fieldName: "file",          // ← サーバ側の formidable の files.file に入る
          mimeType: "audio/m4a",      // ← 録音設定に合わせる
        }
      );

      if (res.status !== 200) {
        throw new Error(`HTTP ${res.status}: ${res.body}`);
      }

      const data = JSON.parse(res.body);
      setStatus(`文字起こし: ${data.text ?? ""}`);
      const text = data.text ?? "";
      const baseQ = BASE_QUESTIONS[qIndex]?.text ?? "";
      try {
        const follow = await makeFollowup(baseQ, text);
        await speakTextAndRecord(follow);
        setQIndex((i) => Math.min(i + 1, BASE_QUESTIONS.length - 1));
      } catch (e: any) {
        setStatus(`フォローアップ生成エラー: ${e.message ?? String(e)}`);
      }
    } catch (e: any) {
      setStatus(`エラー: ${e?.message ?? String(e)}`);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <View style={{ padding: 24, gap: 12 }}>
      <Text style={{ fontSize: 20, fontWeight: "600" }}>
        🎙️ 録音テスト {isRecording ? `（${String(Math.floor(secs/60)).padStart(2,"0")}:${String(secs%60).padStart(2,"0")}）` : ""}
      </Text>
      {!started ? (
        <Button
          title="▶️ インタビュー開始（Q1）"
          onPress={async () => {
            setStarted(true);
            setQIndex(0);
            await speakAndRecord();
          }}
          disabled={isRecording || isUploading}
        />
      ) : (
        <Text>いまの質問：{BASE_QUESTIONS[qIndex]?.text}</Text>
      )}
      <Button title="▶️ 録音開始" onPress={() => start()} disabled={isRecording || isUploading} />
      <Button title="⏹️ 録音停止" onPress={() => stop()} disabled={!isRecording || isUploading} />
      <Button title="🎧 再生" onPress={() => play()} disabled={!uri || isRecording || isUploading} />
      <Button title="📤 Whisperへ送信" onPress={() => upload()} disabled={!uri || isRecording || isUploading} />
      <Text style={{ marginTop: 8 }}>ステータス：{status}</Text>
      {uri ? <Text selectable style={{ color: "#555" }}>保存先: {uri}</Text> : null}
    </View>
  );
}