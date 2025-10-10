import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from "expo-av";
import { useRef, useState } from "react";
import { Alert, Button, Text, View } from "react-native";

export default function Home() {
  const recordingRef = useRef<Audio.Recording | null>(null);
  const [uri, setUri] = useState<string | null>(null);
  const [status, setStatus] = useState("待機中");

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

      recordingRef.current = rec;
      setStatus("録音中…");
    } catch (e: any) {
      Alert.alert("録音開始エラー", e?.message ?? String(e));
    }
  };

  const stop = async () => {
    try {
      const rec = recordingRef.current;
      if (!rec) return;
      setStatus("停止処理中…");
      await rec.stopAndUnloadAsync();
      const localUri = rec.getURI();
      setUri(localUri ?? null);
      recordingRef.current = null;
      setStatus("録音完了");
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

  const upload = async () => {
    if (!uri) return;
    try {
      setStatus("アップロード中…");

      const form = new FormData();
      form.append("file", {
        uri,
        name: `rec_${Date.now()}.m4a`,
        type: "audio/m4a",
      } as any);

      const res = await fetch(`${API_BASE}/api/transcribe`, {
        method: "POST",
        body: form,
      });

      if (!res.ok) {
        const t = await res.text();
        throw new Error(t);
      }
      const data = await res.json();
      setStatus(`文字起こし: ${data.text ?? ""}`);
    } catch (e: any) {
      setStatus(`エラー: ${e?.message ?? String(e)}`);
    }
  };

  return (
    <View style={{ padding: 24, gap: 12 }}>
      <Text style={{ fontSize: 20, fontWeight: "600" }}>🎙️ 録音テスト</Text>
      <Button title="▶️ 録音開始" onPress={start} />
      <Button title="⏹️ 録音停止" onPress={stop} />
      <Button title="🎧 再生" onPress={play} disabled={!uri} />
      <Button title="📤 Whisperへ送信" onPress={upload} disabled={!uri} />
      <Text style={{ marginTop: 8 }}>ステータス：{status}</Text>
      {uri ? <Text selectable style={{ color: "#555" }}>保存先: {uri}</Text> : null}
    </View>
  );
}