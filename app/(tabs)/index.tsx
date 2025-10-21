// 無音検出用の定数と変数
const SILENCE_THRESHOLD = 0.02; // 音量の閾値（0〜1）
const SILENCE_DURATION = 3000; // 無音が続いた場合の停止時間（ms）
const MAX_RECORDING_MS_FALLBACK = 45000; // メータが取れない端末用の最大録音時間（ms）
let silenceTimer: ReturnType<typeof setTimeout> | null = null;
import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, FlatList, Animated, Platform, ScrollView } from "react-native";
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Audio from "expo-audio";
import * as AV from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import { Buffer } from 'buffer'; // RN で Base64 変換に使用
import * as Clipboard from 'expo-clipboard';

// FileSystem の型により cacheDirectory が undefined になる環境があるため安全に取得
const FS_CACHE_DIR: string = (FileSystem as any).cacheDirectory ?? (FileSystem as any).documentDirectory ?? '';

// Next.js(API)のベースURL：ご自宅LANのIP:3000（NextのNetwork表示より）
const API_BASE = Platform.select({
  web: '',
  default: 'https://interview-app-v1.vercel.app',
});

// ★ ElevenLabs で事前生成した mp3 の HTTPS 直リンクを入れると、サーバを経由せず直接再生します。
// 例: https://cdn.elevenlabs.io/speeches/xxxxxxxxxxxxxxxxxxxx.mp3
const TEST_TTS_URL = '' as string; // ← ここに貼ればこのURLを優先して再生

// 再生状態（モジュールスコープで共有）
const currentSoundRef: { current: AV.Audio.Sound | null } = { current: null };
const isPlayingRef: { current: boolean } = { current: false };

/**
 * 音声インタビューアプリ MVP コードモック（Expo単一ファイル版）
 * - 画面: Home → Interview → Result
 * - 仕様: 「1画面=1問」/ 基本5問 + 各1深掘り = 10ターン / 深掘りは自動表示
 * - 録音: expo-audio（無音自動停止はモック）
 * - 波形: 疑似アニメーション（録音中のみランダム値）
 * - TTS/LLM/STT は TODO スタブにしてあります（後でAPI接続）
 *
 * 使い方: App.js として Expo（SDK 51+ 目安）で実行。
 */

export default function App() {
  const [screen, setScreen] = useState<'home' | 'interview' | 'result'>("home");
  const [sheet, setSheet] = useState<SheetData | null>(null);

  return (
    <SafeAreaView style={styles.root}>
      {screen === "home" && (
        <HomeScreen onStart={() => setScreen("interview")} />
      )}
      {screen === "interview" && (
        <InterviewScreen
          onFinish={(data) => {
            setSheet(data);
            setScreen("result");
          }}
          onCancel={() => setScreen("home")} 
        />
      )}
      {screen === "result" && (
        <ResultScreen sheet={sheet} onBackHome={() => setScreen("home")} />
      )}
    </SafeAreaView>
  );
}

/** -------------------- 型 -------------------- */

type QA = {
  baseQuestion: string;
  followupTemplate: string; // 回答にあわせて微修正する用
  baseId: number; // 1..5
};

type Turn = {
  step: number; // 1..10
  type: 'base' | 'followup';
  question: string;
  answer?: string;
};

type SheetData = {
  summary: string;
  strengths: string[];
  acquisition: {
    channels: string[];
    issues: string[];
    ideas: string[];
  };
  tags: string[];
  raw: Turn[]; // 全回答ログ
};

/** -------------------- 定数（質問文） -------------------- */

const BASE_QA: QA[] = [
  {
    baseId: 1,
    baseQuestion: "最近、どんなお仕事をされていますか？",
    followupTemplate: "その中で一番やりがいを感じた瞬間はどんな時ですか？",
  },
  {
    baseId: 2,
    baseQuestion: "普段はどんなお客様と関わることが多いですか？",
    followupTemplate: "その方たちは、どんな気持ちであなたのもとに来られていると思いますか？",
  },
  {
    baseId: 3,
    baseQuestion: "お客様は、あなたのどんなところに惹かれていると思いますか？",
    followupTemplate: "そう感じる根拠になったエピソードがあれば教えてください。",
  },
  {
    baseId: 4,
    baseQuestion: "お仕事の中で『やりがい』を感じるのは、どんな瞬間ですか？",
    followupTemplate: "その出来事から学んだことや、今後に活かしたい点はありますか？",
  },
  {
    baseId: 5,
    baseQuestion: "今、集客や発信で気になっていることはありますか？",
    followupTemplate: "それを改善できたら、どんな変化がありそうですか？",
  },
];

/** -------------------- Home -------------------- */

function HomeScreen({ onStart }: { onStart: () => void }) {
  return (
    <View style={styles.page}>
      <Text style={styles.title}>音声インタビュー</Text>
      <Text style={styles.subtitle}>
        基本の5問と、各1つの深掘りを音声で収録します。\n所要時間の目安は 12〜15分です。
      </Text>

      <View style={{ height: 16 }} />

      <Bullet text="1画面=1問で、集中して回答できます" />
      <Bullet text="回答送信後、自動で深掘り質問が流れます" />
      <Bullet text="最後にヒアリングシート（Markdown）を生成" />

      <View style={{ height: 32 }} />
      <PrimaryButton label="インタビューを始める" onPress={onStart} />
    </View>
  );
}

function Bullet({ text }: { text: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#3CA68B', marginRight: 8 }} />
      <Text style={styles.body}>{text}</Text>
    </View>
  );
}

function PrimaryButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      disabled={disabled}
      style={[styles.button, disabled && { opacity: 0.5 }]}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </TouchableOpacity>
  );
}

function GhostButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8} style={styles.ghostButton}>
      <Text style={styles.ghostButtonText}>{label}</Text>
    </TouchableOpacity>
  );
}

/** -------------------- Interview -------------------- */

function InterviewScreen({ onFinish, onCancel }: { onFinish: (data: SheetData) => void; onCancel: () => void }) {
  // 10ターンぶんのシーケンスを作る（base→followup→...）
  const sequence: Turn[] = useMemo(() => {
    const arr: Turn[] = [];
    let step = 1;
    BASE_QA.forEach((qa) => {
      arr.push({ step: step++, type: 'base', question: qa.baseQuestion });
      arr.push({ step: step++, type: 'followup', question: qa.followupTemplate });
    });
    return arr;
  }, []);
// -------------------- Helper: Clear auto start timer --------------------
function clearAutoStartTimer(autoStartTimerRef: any) {
  if (autoStartTimerRef.current) {
    clearTimeout(autoStartTimerRef.current);
    autoStartTimerRef.current = null;
  }
}

// -------------------- Helper: Save session --------------------
async function saveSession(updatedTurns: Turn[], sheet: SheetData) {
  try {
    const res = await fetch(`${API_BASE}/api/save-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session: { client_name: 'テスト顧客', created_by: 'fu' },
        turns: updatedTurns,
        sheet,
      }),
    });
    const payload = await readJsonSafe(res);
    console.log('保存HTTP:', res.status, payload);
    if (!res.ok) {
      const msg = (payload && (payload.error || payload.message)) || `save failed: ${res.status}`;
      throw new Error(msg);
    }
  } catch (error) {
    console.error('保存エラー:', error);
  }
}

  const [index, setIndex] = useState(0); // 0..9
  const [turns, setTurns] = useState<Turn[]>(sequence);

  // 録音関連
  const [permission, setPermission] = useState<boolean | null>(null);
  const [recording, setRecording] = useState<AV.Audio.Recording | null>(null);
  const [isRecording, setIsRecording] = useState(false);
    useEffect(() => {
      isRecordingRef.current = isRecording;
    }, [isRecording]);
  const [seconds, setSeconds] = useState(0);
  const [transcribing, setTranscribing] = useState(false);

  // 波形用（疑似）
  const [levels, setLevels] = useState<number[]>(Array.from({ length: 24 }, () => 2));
  const levelTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const secTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const meterTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const silentMsRef = useRef(0);
  const recordingStartRef = useRef(0);
  const levelsAvgRef = useRef(0); // 視覚用レベルの平均値を保持（フォールバック用）
  const stoppingRef = useRef(false);
  const startingRef = useRef(false);   // 録音開始中ガード
  const recordingRef = useRef<AV.Audio.Recording | null>(null);
  const autoStartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isRecordingRef = useRef(false);
  // 同じindex/typeでの自動録音の重複を防ぐキー
  const lastAutoStartKeyRef = useRef<string | null>(null);
  
  // 深掘りの自動表示フラグ（アニメは上部カードで統一）
  const [showFollowupImmediately, setShowFollowupImmediately] = useState(false);
  // フォローアップ切替時に一瞬だけ表示を先行させるための上書き表示
  const [displayOverride, setDisplayOverride] = useState<{ type: 'base' | 'followup'; text: string } | null>(null);

  // 録音権限リクエスト（初回）とオーディオモード設定
  useEffect(() => {
    (async () => {
      try {
        const { granted } = await Audio.requestRecordingPermissionsAsync();
        setPermission(granted);
        await Audio.setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        await AV.Audio.setAudioModeAsync({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
        });
      } catch (e) {
        console.warn('permission init error', e);
      }
    })();
  }, []);

  const current = turns[index];

  // overrideを優先して表示・アニメ用の値を決定
  const renderType: 'base' | 'followup' | undefined = displayOverride?.type ?? current?.type;
  const renderText: string | undefined = displayOverride?.text ?? current?.question;

  // 質問カードのアニメ（ベース/フォローアップ統一）
  const questionAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!current) return;
    isPlayingRef.current = false; // 初回強制リセット

    // 質問カードのフェードインアニメーション
    questionAnim.setValue(0);
    Animated.timing(questionAnim, {
      toValue: 1,
      duration: 400,
      useNativeDriver: true,
    }).start();

    if (current && current.type === 'base' && !isRecordingRef.current && !transcribing && !isPlayingRef.current) {
      (async () => {
        await playQuestionAudio(current.question);

        // 予約は常に1つ、同じターンでは一度だけ
        clearAutoStartTimer(autoStartTimerRef);
        const baseKey = `${index}:base`;
        if (lastAutoStartKeyRef.current === baseKey) return;

        autoStartTimerRef.current = setTimeout(() => {
          if (!startingRef.current && !isRecordingRef.current && !transcribing && !isPlayingRef.current) {
            console.log('[AUTO] base auto-start after TTS');
            lastAutoStartKeyRef.current = baseKey; // 一度だけ
            beginRecording();
          }
          autoStartTimerRef.current = null;
        }, 700); // 600〜800msで微調整可
      })();
    }
  }, [index]);

  const beginRecording = async () => {
    if (startingRef.current || isRecording || transcribing) return;
    if (!permission) return;

    startingRef.current = true;
    clearAutoStartTimer(autoStartTimerRef);
    stoppingRef.current = false;
    isPlayingRef.current = false;

    let rec: AV.Audio.Recording | null = null;
    try {
      rec = new AV.Audio.Recording();
      await rec.prepareToRecordAsync({
        android: {
          extension: '.m4a',
          outputFormat: AV.Audio.AndroidOutputFormat.MPEG_4,
          audioEncoder: AV.Audio.AndroidAudioEncoder.AAC,
          sampleRate: 44100,
          numberOfChannels: 1,
          bitRate: 128000,
        },
        ios: {
          extension: '.m4a',
          outputFormat: AV.Audio.IOSOutputFormat.MPEG4AAC,
          audioQuality: AV.Audio.IOSAudioQuality.HIGH,
          sampleRate: 44100,
          numberOfChannels: 1,
          bitRate: 128000,
          linearPCMBitDepth: 16,
          linearPCMIsBigEndian: false,
          linearPCMIsFloat: false,
        },
        isMeteringEnabled: true,
      } as any);
      await rec.startAsync();
      console.log('[REC] started');
      recordingStartRef.current = Date.now();
      setRecording(rec);
      recordingRef.current = rec;
      setIsRecording(true);

      secTimer.current && clearInterval(secTimer.current);
      setSeconds(0);
      secTimer.current = setInterval(() => setSeconds((s) => s + 1), 1000);

      clearAutoStartTimer(autoStartTimerRef);

      if (silenceTimer) clearTimeout(silenceTimer);
      silentMsRef.current = 0;

      meterTimer.current && clearInterval(meterTimer.current);
      meterTimer.current = setInterval(async () => {
        try {
          const status: any = await rec?.getStatusAsync();
          const db: number | undefined = status?.metering;
          if (typeof db === 'number') {
            if (db < -45) {
              silentMsRef.current += 200;
              if (silentMsRef.current >= SILENCE_DURATION) {
                console.log('[REC] silence counter:', silentMsRef.current);
                console.log('Silence(meter) auto-stop');
                if (!stoppingRef.current) stopRecording();
              }
            } else {
              silentMsRef.current = 0;
            }
          } else {
            const avg = levelsAvgRef.current;
            if (avg < SILENCE_THRESHOLD * 100) {
              silentMsRef.current += 200;
              if (silentMsRef.current >= SILENCE_DURATION) {
                console.log('[REC] silence counter:', silentMsRef.current);
                console.log('Silence(fallback visual) auto-stop');
                if (!stoppingRef.current) stopRecording();
                return;
              }
            } else {
              silentMsRef.current = 0;
            }
            const elapsed = Date.now() - recordingStartRef.current;
            if (elapsed >= MAX_RECORDING_MS_FALLBACK) {
              console.log('Fallback max duration reached: auto-stop');
              if (!stoppingRef.current) {
                stoppingRef.current = true;
                stopRecording();
              }
            }
          }
        } catch {
          // エラー時は何もしない
        }
      }, 200);

      levelTimer.current && clearInterval(levelTimer.current);
      levelTimer.current = setInterval(() => {
        setLevels((prev) => {
          const newLevels = prev.map(() => Math.max(2, Math.floor(Math.random() * 16)));
          const avg = newLevels.reduce((a, b) => a + b, 0) / newLevels.length;
          levelsAvgRef.current = avg;
          return newLevels;
        });
      }, 500);
    } catch (e) {
      console.warn('record start error', e);
      if (rec) {
        try {
          await rec.stopAndUnloadAsync();
        } catch {
          // ignore stop errors
        }
      }
      setRecording(null);
      setIsRecording(false);
      if (meterTimer.current) {
        clearInterval(meterTimer.current);
        meterTimer.current = null;
      }
      if (levelTimer.current) {
        clearInterval(levelTimer.current);
        levelTimer.current = null;
      }
      if (secTimer.current) {
        clearInterval(secTimer.current);
        secTimer.current = null;
      }
      if (silenceTimer) {
        clearTimeout(silenceTimer);
        silenceTimer = null;
      }
    } finally {
      startingRef.current = false;
    }
    stoppingRef.current = false;
  };

  const stopRecording = async () => {
    // 無音タイマーをクリア
    if (stoppingRef.current) return;
    stoppingRef.current = true;

    // ★ 追加：自動開始予約を確実にキャンセル
    clearAutoStartTimer(autoStartTimerRef);
    
    // ★★★ ここから追加：スナップショット固定 ★★★
    const cur = turns[index];
    if (!cur) { stoppingRef.current = false; return; }
    const isBase = cur.type === 'base';
    const nextTurn = turns[index + 1] ?? null;
    const nextQuestion = nextTurn?.question ?? '';
    // ★★★ ここまで ★★★

    if (silenceTimer) {
      clearTimeout(silenceTimer);
      silenceTimer = null;
    }
    if (meterTimer.current) {
      clearInterval(meterTimer.current);
      meterTimer.current = null;
    }
    silentMsRef.current = 0;
    const rec = recordingRef.current;
    if (!rec) { stoppingRef.current = false; return; }

    try {
      await rec.stopAndUnloadAsync();
    } catch (e) {
      // Already stopped
      stoppingRef.current = false;
    }
    setIsRecording(false);
    levelTimer.current && clearInterval(levelTimer.current);
    secTimer.current && clearInterval(secTimer.current);

    setTranscribing(true);
    const uri = rec.getURI?.() ?? '';
    setRecording(null);
    recordingRef.current = null;        // 

    // TODO: Whisper へ送信してテキスト化
    const transcript = await mockTranscribe(uri || "");

    // 回答保存（ローカルにも保持して後続のシート生成に使う）
    const updatedTurns = (() => {
      const next = [...turns];
      next[index] = { ...next[index], answer: transcript };
      return next;
    })();
    setTurns(updatedTurns);

    // TODO: 回答に合わせて followup のテキストを微調整する（今はスタブ）
    if (isBase) {
      try {
        const baseQ = cur.question;
        const fq = await generateFollowup(transcript, baseQ);
        // フォローアップテキストを次のターンに反映（なければテンプレ維持）
        setTurns((list: Turn[]) => {
          const next = [...list];
          if (next[index + 1]) {
            next[index + 1] = { ...next[index + 1], question: fq || next[index + 1].question };
          }
          return next;
        });
        const followupText = fq || nextQuestion;
        setShowFollowupImmediately(true);
        setTranscribing(false);
        // 先にカードの中身を上書きしてフリッカーを防ぐ
        setDisplayOverride({ type: 'followup', text: followupText || '' });
        // 直後にインデックスを進める（見た目はoverrideで保持）
        setIndex((i: number) => i + 1);
        await waitForPaintAnd(200); // UI反映を待ってから次のベース再生に入る
        // 並列でTTS音声を事前生成
        const prefetch = prefetchTTS(followupText || '');
        await waitForPaintAnd(0);
        const uri = await prefetch;
        
        if (uri) {
          await playFromCache(uri);
        } else {
          await playQuestionAudio(followupText || '');
        }

        // 再生完了後にカード解除
        setDisplayOverride(null);

        // 再生完了後に自動で録音開始
        clearAutoStartTimer(autoStartTimerRef);
        autoStartTimerRef.current = setTimeout(() => {
          if (!startingRef.current && !isRecording && !transcribing) {
            console.log('[AUTO] followup auto-start after TTS');
            beginRecording();
          }
          autoStartTimerRef.current = null;
        }, 700);
      } catch (e) {
        console.warn('followup flow error', e);
        setShowFollowupImmediately(true);
        setTranscribing(false);

        const fallback = nextQuestion;
        setDisplayOverride({ type: 'followup', text: fallback });
        setIndex((i) => i + 1);
        await waitForPaintAnd(200); // ← 追加：UI反映を待ってから次のベース再生に入る
      
        // フォローアップTTS再生（fallback）
        const uri2 = await prefetchTTS(fallback);
        setDisplayOverride(null);
        if (uri2) {
          await playFromCache(uri2);
        } else {
          await playQuestionAudio(fallback);
        }

        // 再生完了後に自動録音開始（予約は常に1つ）
        clearAutoStartTimer(autoStartTimerRef);
        autoStartTimerRef.current = setTimeout(() => {
          if (!startingRef.current && !isRecordingRef.current && !transcribing && !isPlayingRef.current) {
            console.log('[AUTO] followup auto-start after TTS');
            beginRecording();
          }
          autoStartTimerRef.current = null;
        }, 700);
      }
    } else {
      // followup の回答が終わったら次の base へ
      setTranscribing(false);
      if (index + 1 >= turns.length) {
        // 完走 → シート生成（直前に更新した updatedTurns を使用）
        const sheet = await generateSheetAI(updatedTurns);
        await saveSession(updatedTurns, sheet);
        onFinish(sheet);
      } else {
        setShowFollowupImmediately(false);
        setIndex((i) => i + 1);
      }
    }
    stoppingRef.current = false;
  };

  const handleSkip = async () => {
    // 回答なしで次へ（ユーザースキップ）
    if (current.type === 'base') {
      // base をスキップしたら自動で followup を見せる（=index+1）
      setShowFollowupImmediately(true);
      setIndex((i) => Math.min(i + 1, total - 1));
    } else {
      // followup スキップで次の base
      setShowFollowupImmediately(false);
      if (index + 1 >= total) {
        const sheet = await generateSheetAI(turns);
        await saveSession(turns, sheet);
        onFinish(sheet);
      } else {
        setIndex((i) => i + 1);
      }
    }
  };

  const total = turns.length;
  const progressLabel = `${current?.step ?? 0} / ${total}`;

  return (
    <View style={styles.page}>
      <View style={styles.headerRow}>
        <Text style={styles.progress}>質問 {progressLabel}</Text>
        <Text style={styles.remain}>⏱ 残り 約{Math.max(0, Math.ceil((total - (current?.step ?? 0)) * 1.2))}分</Text>
      </View>

      <Animated.View style={{
        marginTop: 8,
        marginBottom: 12,
        padding: 12,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#D3EEE5',
        backgroundColor: '#F6FBF9',
        opacity: questionAnim,
        transform: [
          { translateY: questionAnim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) },
          { scale: questionAnim.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
        ],
      }}>
        <Text style={{ fontSize: 12, color: '#2F6F5F', marginBottom: 4, fontWeight: '700' }}>
          {renderType === 'base' ? '質問' : 'もう少し教えてください'}
        </Text>
        <Text style={styles.questionText}>{renderText}</Text>
      </Animated.View>

      {/* 波形（録音中のみ動く擬似アニメ） */}
      <Visualizer active={isRecording} levels={levels} />

      {/* タイマー ＆ 録音ボタン群 */}
      <View style={styles.recRow}>
        <Text style={styles.timer}>{secToMMSS(seconds)}</Text>
        {!isRecording ? (
          <TouchableOpacity style={styles.recBtn} onPress={beginRecording}>
            <Text style={styles.recBtnText}>▶ 質問に答える</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={[styles.recBtn, { backgroundColor: '#999' }]} onPress={stopRecording}>
            <Text style={styles.recBtnText}>この質問の回答を終了する</Text>
          </TouchableOpacity>
        )}
      </View>

      {transcribing && (
        <View style={styles.loadingBar}>
          <Text style={styles.loadingText}>自動文字起こし中…</Text>
        </View>
      )}
    </View>
  );
}
// --- END InterviewScreen ---

/** TTS音声を事前生成し、ローカルキャッシュパスを返す */
async function prefetchTTS(text: string): Promise<string> {
  try {
    const r = await fetch(`${API_BASE}/api/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!r.ok) throw new Error(`TTS request failed: ${r.status}`);

    const arrayBuf = await r.arrayBuffer();
    const bytes = new Uint8Array(arrayBuf);
    const b64 = Buffer.from(bytes).toString('base64');
    const fileUri = `${FS_CACHE_DIR}tts-${Date.now()}.mp3`;
    await FileSystem.writeAsStringAsync(fileUri, b64, { encoding: 'base64' as any });
    return fileUri;
  } catch (e) {
    console.warn('prefetchTTS error', e);
    return '';
  }
}

/** ローカルキャッシュ音声を再生 */
async function playFromCache(uri: string, onEnd?: () => void) {
  try {
    if (!uri) return;
    // すでに再生中の音があれば止める
    if (currentSoundRef.current) {
      try { await currentSoundRef.current.stopAsync(); } catch {}
      try { await currentSoundRef.current.unloadAsync(); } catch {}
      currentSoundRef.current = null;
    }
    const { sound } = await AV.Audio.Sound.createAsync({ uri });
    currentSoundRef.current = sound;
    isPlayingRef.current = true;

    const finished = new Promise<void>((resolve) => {
      sound.setOnPlaybackStatusUpdate((s: any) => { if (s?.didJustFinish) resolve(); });
    });
    await sound.playAsync();
    await finished;

    await sound.unloadAsync();
    currentSoundRef.current = null;
    isPlayingRef.current = false;
    if (onEnd) try { onEnd(); } catch {}
  } catch (e) {
    console.warn('playFromCache error', e);
    isPlayingRef.current = false;
    currentSoundRef.current = null;
  }
}

/** TTS（質問音声の自動再生）: ElevenLabsを /api/tts 経由で呼び出し、バイトをローカル保存→再生 */
async function playQuestionAudio(text: string, onEnd?: () => void) {
  try {
    // 既存再生を停止
    if (currentSoundRef.current) {
      try { await currentSoundRef.current.stopAsync(); } catch {}
      try { await currentSoundRef.current.unloadAsync(); } catch {}
      currentSoundRef.current = null;
    }

    let fileUri = '';
    if (TEST_TTS_URL && TEST_TTS_URL.startsWith('https://')) {
      fileUri = TEST_TTS_URL;
    } else {
      const r = await fetch(`${API_BASE}/api/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!r.ok) throw new Error(`TTS request failed: ${r.status}`);
      const arrayBuf = await r.arrayBuffer();
      const bytes = new Uint8Array(arrayBuf);
      const b64 = Buffer.from(bytes).toString('base64');
      fileUri = `${FS_CACHE_DIR}tts-${Date.now()}.mp3`;
      await FileSystem.writeAsStringAsync(fileUri, b64, { encoding: 'base64' as any });
    }

    const { sound } = await AV.Audio.Sound.createAsync({ uri: fileUri });
    currentSoundRef.current = sound;
    isPlayingRef.current = true;

    const finished = new Promise<void>((resolve) => {
      sound.setOnPlaybackStatusUpdate((s: any) => { if (s?.didJustFinish) resolve(); });
    });
    await sound.playAsync();
    await finished;

    await sound.unloadAsync();
    currentSoundRef.current = null;
    isPlayingRef.current = false;
    if (onEnd) try { onEnd(); } catch {}
  } catch (e) {
    console.warn('playQuestionAudio error', e);
    isPlayingRef.current = false;
    currentSoundRef.current = null;
  }
}

/** STT: 録音ファイルをAPIに送信し、テキスト化する */
async function mockTranscribe(uri: string): Promise<string> {
  if (!uri) return "";
  try {
    const fd = new FormData();
    fd.append("audio", {
      uri,
      name: "record.m4a",
      type: "audio/m4a",
    } as any);

    const r = await fetch(`${API_BASE}/api/transcribe`, {
      method: "POST",
      body: fd,
    });

    if (!r.ok) throw new Error(`transcribe failed: ${r.status}`);
    const data = await r.json(); // { text: string }
    return data.text || "";
  } catch (e) {
    console.warn("transcribe error", e);
    return "";
  }
}

/** Follow-up: 文字起こし結果に基づき次の1問を生成 */
async function generateFollowup(answerText: string, base?: string): Promise<string> {
  try {
    const r = await fetch(`${API_BASE}/api/followup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answerText, base, purpose: 'acquisition_and_strength' }),
    });
    if (!r.ok) throw new Error(`followup failed: ${r.status}`);
    const data = await r.json(); // { question }
    return (data?.question || '').trim();
  } catch (e) {
    console.warn('generateFollowup error', e);
    return '';
  }
}

/** -------------------- Result -------------------- */

function ResultScreen({ sheet, onBackHome }: { sheet: SheetData | null; onBackHome: () => void }) {
  if (!sheet) return null;

  const lines = [
    `# ヒアリングシート（自動生成）`,
    ``,
    `## 概要`,
    `${sheet.summary}`,
    ``,
    `## 強み`,
    ...sheet.strengths.map((s) => `- ${s}`),
    ``,
    `## 集客 / 改善アイデア`,
    `- チャネル: ${sheet.acquisition.channels.join(', ') || '-'}`,
    `- 課題: ${sheet.acquisition.issues.join(', ') || '-'}`,
    `- 改善アイデア:`,
    ...sheet.acquisition.ideas.map((i, idx) => `${idx + 1}. ${i}`),
    ``,
    `## タグ`,
    sheet.tags.map((t) => `\`${t}\``).join(' '),
    ``,
    `---`,
    `**原文ログ（抜粋）**`,
    ...sheet.raw.map((t) => `- Q${t.step} ${t.type === 'base' ? '(基本)' : '(深掘り)'}: ${t.answer ?? '-'}`),
  ].join("\n");

  const handleCopy = async () => {
    try {
      await Clipboard.setStringAsync(lines);
      alert('ヒアリングシートをコピーしました！');
    } catch (e) {
      console.warn('copy failed', e);
    }
  };

  return (
    <View style={styles.page}>
      <Text style={styles.title}>結果プレビュー</Text>
      <ScrollView style={{ flex: 1, marginTop: 8 }} contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
        <Text style={styles.monoBox}>{lines}</Text>
        <View style={{ height: 12 }} />
        <PrimaryButton label="コピーする" onPress={handleCopy} />
        <View style={{ height: 12 }} />
        <PrimaryButton label="ホームへ戻る" onPress={onBackHome} />
      </ScrollView>
    </View>
  );
}

/** -------------------- ビジュアル波形 -------------------- */

function Visualizer({ active, levels }: { active: boolean; levels: number[] }) {
  return (
    <View style={styles.vizBox}>
      <FlatList
        data={levels}
        keyExtractor={(_, i) => String(i)}
        horizontal
        renderItem={({ item }) => (
          <View style={[styles.vizBar, { height: active ? 6 * item : 8 }]} />
        )}
        contentContainerStyle={{ alignItems: 'flex-end' }}
        showsHorizontalScrollIndicator={false}
      />
      <Text style={styles.vizHint}>{active ? '録音中…' : '録音してみましょう'}</Text>
    </View>
  );
}

/** -------------------- ユーティリティ -------------------- */

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

// 次の描画フレームが完了するまで待つ（UI反映を最優先）
async function waitForPaintAnd(ms: number = 0) {
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  );
  if (ms > 0) await sleep(ms);
}

// 安全にJSONを読む（空ボディやHTMLでも落ちない）
async function readJsonSafe(res: any): Promise<any> {
  try {
    const text = await res.text();
    if (!text) return null;                  // 空ボディ -> null
    try { return JSON.parse(text); } catch {  // JSON以外 -> __raw に保持
      return { __raw: text };
    }
  } catch {
    return null;
  }
}

/** AI版: 回答内容からヒアリングシートを生成（失敗時はローカルにフォールバック） */
async function generateSheetAI(turns: Turn[]): Promise<SheetData> {
  const transcript = turns.map((t) => `Q${t.step}(${t.type}): ${t.answer || '-'}`).join('\n');
  try {
    const res = await fetch(`${API_BASE}/api/ai-generate-sheet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript }),
    });
    if (!res.ok) throw new Error(`ai-generate-sheet failed: ${res.status}`);
    const data = await res.json();
    return {
      summary: data.summary || '要約生成に失敗しました。',
      strengths: data.strengths || ['未取得'],
      acquisition: data.acquisition || { channels: [], issues: [], ideas: [] },
      tags: data.tags || ['#未分類'],
      raw: turns,
    } as SheetData;
  } catch (e) {
    console.warn('generateSheetAI error', e);
    return generateSheet(turns); // フォールバック
  }
}

function generateSheet(turns: Turn[]): SheetData {
  // 簡易: 回答のキーワードからダミー情報を生成（本番は LLM 要約）
  const answers = turns.map((t) => t.answer || "").join(" ");
  const strengths: string[] = [];
  if (answers.includes("丁寧")) strengths.push("丁寧な傾聴");
  if (answers.includes("言語化")) strengths.push("言語化サポート");
  if (answers.includes("表情")) strengths.push("変化に寄り添う支援");

  const sheet: SheetData = {
    summary: "自己理解やキャリアのモヤモヤを対象に、対話を通じて言語化と前進を支援。",
    strengths: strengths.length ? strengths : ["共感的コミュニケーション", "安心感のある伴走"],
    acquisition: {
      channels: ["Instagram", "紹介"],
      issues: ["申込導線の弱さ"],
      ideas: [
        "体験セッションへの導線をプロフィール上部に固定",
        "ビフォー/アフターのストーリー投稿（週1）",
        "お客様の声を画像カルーセル化して保存率を向上",
      ],
    },
    tags: ["#コーチング", "#自己理解", "#女性支援", "#SNS集客"],
    raw: turns,
  };
  return sheet;
}

function secToMMSS(sec: number) {
  const m = Math.floor(sec / 60)
    .toString()
    .padStart(2, '0');
  const s = (sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

/** -------------------- スタイル -------------------- */

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  page: { flex: 1, padding: 16 },
  title: { fontSize: 24, fontWeight: '700', color: '#1E3F36' },
  subtitle: { marginTop: 8, fontSize: 14, color: '#334', lineHeight: 20 },
  body: { fontSize: 14, color: '#333' },

  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  progress: { fontSize: 14, color: '#2F6F5F' },
  remain: { fontSize: 14, color: '#666' },

  questionText: { fontSize: 18, color: '#111', lineHeight: 28, marginVertical: 16 },

  vizBox: { height: 140, borderWidth: 1, borderColor: '#D3EEE5', backgroundColor: '#F6FBF9', borderRadius: 12, padding: 12, justifyContent: 'flex-end' },
  vizBar: { width: 6, marginHorizontal: 2, borderTopLeftRadius: 3, borderTopRightRadius: 3, backgroundColor: '#3CA68B' },
  vizHint: { marginTop: 6, fontSize: 12, color: '#3B6', textAlign: 'center' },

  recRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 },
  timer: { fontSize: 18, color: '#333' },
  recBtn: { backgroundColor: '#E45865', paddingVertical: 12, paddingHorizontal: 18, borderRadius: 24 },
  recBtnText: { color: '#FFF', fontSize: 16, fontWeight: '700' },

  footerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 24 },
  button: { backgroundColor: '#2F6F5F', paddingVertical: 14, alignItems: 'center', borderRadius: 12 },
  buttonText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
  ghostButton: { paddingVertical: 12, paddingHorizontal: 16, borderRadius: 10, borderWidth: 1, borderColor: '#D3EEE5' },
  ghostButtonText: { color: '#2F6F5F', fontSize: 14, fontWeight: '600' },

  loadingBar: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 12, alignItems: 'center', backgroundColor: 'rgba(60,166,139,0.1)' },
  loadingText: { color: '#2F6F5F', fontSize: 13 },

  followupLabel: { fontSize: 12, color: '#2F6F5F', marginBottom: 4, fontWeight: '700' },
  followupText: { fontSize: 16, color: '#123', lineHeight: 24 },

  monoBox: { marginTop: 12, backgroundColor: '#F6FBF9', borderWidth: 1, borderColor: '#D3EEE5', borderRadius: 12, padding: 12, color: '#123', fontFamily: Platform?.OS === 'ios' ? 'Menlo' : 'monospace' },
});
